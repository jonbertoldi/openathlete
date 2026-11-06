import axios, { isAxiosError } from 'axios';
import { createHash } from 'node:crypto';

import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import {
  ConnectorProvider,
  EventType,
  Prisma,
  ProviderAccount,
} from '@openathlete/database';
import { ApiEnvSchemaType } from '@openathlete/shared';

import { Language } from 'src/common/constants/languages.constant';
import { formatZoned, validTimeZone } from 'src/common/utils/time-zone';

import {
  FEED_EVENT_SELECT,
  FeedContext,
  describeFeedEvent,
} from '../../core/helpers/calendar-feed-event';
import { addUtcDays } from '../../core/helpers/training-load';
import { PrismaService } from '../../prisma/services/prisma.service';
import { BaseProviderService, OAuthConfig, OAuthTokenResponse } from '../base';
import { providerRedirectUri } from '../base/provider-urls';

const GOOGLE_CALENDAR_API = 'https://www.googleapis.com/calendar/v3';
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const GOOGLE_REVOKE_URL = 'https://oauth2.googleapis.com/revoke';
const MANAGED_PROPERTY = 'openathleteManaged';
const EVENT_ID_PROPERTY = 'openathleteEventId';
const HASH_PROPERTY = 'openathleteHash';

interface GoogleCalendarEvent {
  id?: string;
  summary?: string;
  description?: string;
  start?: { date?: string };
  end?: { date?: string };
  transparency?: string;
  visibility?: string;
  status?: string;
  extendedProperties?: {
    private?: Record<string, string>;
  };
  [key: string]: unknown;
}

interface GoogleCalendarListResponse {
  items?: GoogleCalendarEvent[];
  nextPageToken?: string;
}

type CalendarEvent = Prisma.EventGetPayload<{
  select: typeof FEED_EVENT_SELECT;
}>;

interface GoogleCalendarContext extends FeedContext {
  timeZone: string;
}

/** A stable Google event id; Google accepts only base32hex characters. */
export function googleCalendarEventId(eventId: number): string {
  return `openathlete${eventId.toString(32)}`;
}

@Injectable()
export class GoogleCalendarProviderService extends BaseProviderService {
  protected readonly provider = ConnectorProvider.GOOGLE_CALENDAR;
  private readonly syncLogger = new Logger(GoogleCalendarProviderService.name);

  protected get oauthConfig(): OAuthConfig {
    return {
      authorizationUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
      tokenUrl: GOOGLE_TOKEN_URL,
      clientId: this.configService.get('GOOGLE_CALENDAR_CLIENT_ID') ?? '',
      clientSecret:
        this.configService.get('GOOGLE_CALENDAR_CLIENT_SECRET') ?? '',
      redirectUri: providerRedirectUri(
        this.configService.get('GOOGLE_CALENDAR_REDIRECT_URI'),
        this.configService.get('APP_URL'),
        'google-calendar',
      ),
      scopes: ['https://www.googleapis.com/auth/calendar.app.created'],
    };
  }

  constructor(
    prisma: PrismaService,
    configService: ConfigService<ApiEnvSchemaType, true>,
  ) {
    super(prisma, configService);
  }

  override getAuthorizationUri(): string {
    const params = new URLSearchParams({
      client_id: this.oauthConfig.clientId,
      redirect_uri: this.oauthConfig.redirectUri,
      response_type: 'code',
      scope: this.oauthConfig.scopes.join(' '),
      access_type: 'offline',
      prompt: 'consent',
      include_granted_scopes: 'true',
    });
    return `${this.oauthConfig.authorizationUrl}?${params.toString()}`;
  }

  override async exchangeCodeForTokens(
    code: string,
  ): Promise<OAuthTokenResponse> {
    const { data } = await axios.post<OAuthTokenResponse>(
      GOOGLE_TOKEN_URL,
      new URLSearchParams({
        client_id: this.oauthConfig.clientId,
        client_secret: this.oauthConfig.clientSecret,
        code,
        grant_type: 'authorization_code',
        redirect_uri: this.oauthConfig.redirectUri,
      }).toString(),
      { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } },
    );
    return data;
  }

  override async refreshAccessToken(
    refreshToken: string,
  ): Promise<OAuthTokenResponse> {
    const { data } = await axios.post<OAuthTokenResponse>(
      GOOGLE_TOKEN_URL,
      new URLSearchParams({
        client_id: this.oauthConfig.clientId,
        client_secret: this.oauthConfig.clientSecret,
        refresh_token: refreshToken,
        grant_type: 'refresh_token',
      }).toString(),
      { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } },
    );
    return data;
  }

  async connect(code: string, athleteId: number): Promise<ProviderAccount> {
    const token = await this.exchangeCodeForTokens(code);
    const previous = await this.prisma.providerAccount.findFirst({
      where: { athleteId, provider: this.provider },
    });
    const refreshToken = token.refresh_token ?? previous?.refreshToken;
    if (!refreshToken) {
      throw new Error(
        'Google did not return offline access; remove OpenAthlete from Google account access and connect again',
      );
    }

    const savedAccount = await this.saveProviderAccount({
      athleteId,
      accessToken: token.access_token,
      refreshToken,
      expiresIn: token.expires_in,
      scopes: token.scope,
    });
    await this.prisma.providerAccount.update({
      where: { providerAccountId: savedAccount.providerAccountId },
      data: {
        importActivitiesEnabled: false,
        exportWorkoutsEnabled: false,
        importMetricsEnabled: false,
      },
    });

    let account = savedAccount;
    try {
      account = await this.ensureCalendar(savedAccount);
      await this.syncAccount(account);
    } catch (error) {
      // The periodic reconciliation will retry. OAuth should remain connected
      // after a transient Calendar API failure.
      this.syncLogger.warn(
        `Initial Google Calendar sync failed for athlete ${athleteId}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    return account;
  }

  /** Mirror one local change immediately; the scheduler repairs missed ones. */
  async syncEventForAthlete(
    athleteId: number,
    eventId: number,
    action: 'upsert' | 'delete',
  ): Promise<void> {
    const storedAccount = await this.prisma.providerAccount.findFirst({
      where: {
        athleteId,
        provider: this.provider,
        status: 'active',
      },
    });
    if (!storedAccount) return;
    const account = await this.ensureCalendar(storedAccount);

    if (action === 'delete') {
      await this.deleteEvent(account, eventId);
      return;
    }

    const event = await this.loadEvent(athleteId, eventId);
    if (!event) {
      await this.deleteEvent(account, eventId);
      return;
    }
    const context = await this.loadContext(athleteId);
    await this.upsertEvent(account, event, context);
  }

  /**
   * Reconcile all planned items. Hashes stored in private Google properties
   * keep the steady-state run to one list request and no writes.
   */
  async syncAccount(account: ProviderAccount): Promise<void> {
    account = await this.ensureCalendar(account);
    const [events, context, remote] = await Promise.all([
      this.prisma.event.findMany({
        where: {
          athleteId: account.athleteId,
          type: { not: EventType.ACTIVITY },
        },
        select: FEED_EVENT_SELECT,
        orderBy: { startDate: 'asc' },
      }),
      this.loadContext(account.athleteId),
      this.listManagedEvents(account),
    ]);

    const localIds = new Set(events.map((event) => String(event.eventId)));
    const remoteByLocalId = new Map(
      remote
        .map(
          (event) =>
            [
              event.extendedProperties?.private?.[EVENT_ID_PROPERTY],
              event,
            ] as const,
        )
        .filter((entry): entry is [string, GoogleCalendarEvent] => !!entry[0]),
    );

    for (const event of events) {
      const payload = this.eventPayload(event, context);
      const remoteEvent = remoteByLocalId.get(String(event.eventId));
      if (!this.remoteMatchesPayload(remoteEvent, payload)) {
        await this.writeEvent(account, event.eventId, payload);
      }
    }

    for (const remoteEvent of remote) {
      const localId =
        remoteEvent.extendedProperties?.private?.[EVENT_ID_PROPERTY];
      if ((!localId || !localIds.has(localId)) && remoteEvent.id) {
        await this.deleteRemoteEvent(account, remoteEvent.id);
      }
    }
  }

  async disconnect(account: ProviderAccount): Promise<void> {
    if (account.externalUserId) {
      const token = await this.getValidAccessToken(account);
      try {
        await axios.delete(
          `${GOOGLE_CALENDAR_API}/calendars/${encodeURIComponent(account.externalUserId)}`,
          {
            headers: { Authorization: `Bearer ${token}` },
            timeout: 30_000,
          },
        );
      } catch (error) {
        if (!isAxiosError(error) || error.response?.status !== 404) throw error;
      }
    }

    const token = account.refreshToken || account.accessToken;
    try {
      await axios.post(
        GOOGLE_REVOKE_URL,
        new URLSearchParams({ token }).toString(),
        { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } },
      );
    } catch (error) {
      if (!isAxiosError(error) || error.response?.status !== 400) throw error;
    }
  }

  private loadEvent(athleteId: number, eventId: number) {
    return this.prisma.event.findFirst({
      where: {
        eventId,
        athleteId,
        type: { not: EventType.ACTIVITY },
      },
      select: FEED_EVENT_SELECT,
    });
  }

  /**
   * A dedicated calendar keeps the permission narrow and lets the user hide
   * all OpenAthlete sessions at once. Recreate it if it was removed in Google.
   */
  private async ensureCalendar(
    account: ProviderAccount,
  ): Promise<ProviderAccount> {
    const token = await this.getValidAccessToken(account);
    if (account.externalUserId) {
      try {
        await axios.get(
          `${GOOGLE_CALENDAR_API}/calendars/${encodeURIComponent(account.externalUserId)}`,
          {
            headers: { Authorization: `Bearer ${token}` },
            timeout: 30_000,
          },
        );
        return account;
      } catch (error) {
        if (!isAxiosError(error) || error.response?.status !== 404) throw error;
      }
    }

    const athlete = await this.prisma.athlete.findUniqueOrThrow({
      where: { athleteId: account.athleteId },
      select: { user: { select: { timeZone: true } } },
    });
    const { data } = await axios.post<{ id: string }>(
      `${GOOGLE_CALENDAR_API}/calendars`,
      {
        summary: 'OpenAthlete',
        description: 'Planned sessions synchronized by OpenAthlete',
        timeZone: validTimeZone(athlete.user.timeZone),
      },
      {
        headers: { Authorization: `Bearer ${token}` },
        timeout: 30_000,
      },
    );
    return this.prisma.providerAccount.update({
      where: { providerAccountId: account.providerAccountId },
      data: { externalUserId: data.id },
    });
  }

  private async loadContext(athleteId: number): Promise<GoogleCalendarContext> {
    const [athlete, metrics, zones] = await Promise.all([
      this.prisma.athlete.findUniqueOrThrow({
        where: { athleteId },
        select: { user: { select: { language: true, timeZone: true } } },
      }),
      this.prisma.athleteMetric.findMany({
        where: { athleteId },
        distinct: ['type'],
        select: { type: true, value: true },
        orderBy: [{ type: 'asc' }, { date: 'desc' }],
      }),
      this.prisma.trainingZone.findMany({
        where: { athleteId },
        select: { trainingZoneId: true, name: true },
      }),
    ]);
    const appUrl = this.configService.get('APP_URL');
    return {
      language: athlete.user.language as Language,
      metrics: Object.fromEntries(
        metrics.map(({ type, value }) => [type, value]),
      ),
      zoneNames: new Map(zones.map((zone) => [zone.trainingZoneId, zone.name])),
      timeZone: validTimeZone(athlete.user.timeZone),
      url: appUrl || null,
    };
  }

  private eventPayload(event: CalendarEvent, context: GoogleCalendarContext) {
    const appUrl = context.url;
    const url = appUrl
      ? `${appUrl}/dashboard/calendar?event=${event.eventId}`
      : null;
    const presentation = describeFeedEvent(event, { ...context, url });
    const base = {
      summary: event.name,
      description: presentation.description ?? undefined,
      ...this.formatEventDates(event, context.timeZone),
      status: 'confirmed',
      transparency: 'transparent',
      visibility: 'private',
      source: url ? { title: 'OpenAthlete', url } : undefined,
      extendedProperties: {
        private: {
          [MANAGED_PROPERTY]: 'true',
          [EVENT_ID_PROPERTY]: String(event.eventId),
        },
      },
    };
    const hash = createHash('sha256')
      .update(JSON.stringify(base))
      .digest('hex');
    return {
      ...base,
      extendedProperties: {
        private: {
          ...base.extendedProperties.private,
          [HASH_PROPERTY]: hash,
        },
      },
    };
  }

  /**
   * The private hash detects local changes. Comparing the visible fields as
   * well means reconciliation also repairs edits made directly in Google.
   */
  private remoteMatchesPayload(
    remote: GoogleCalendarEvent | undefined,
    payload: ReturnType<GoogleCalendarProviderService['eventPayload']>,
  ) {
    if (!remote) return false;
    return (
      remote.extendedProperties?.private?.[HASH_PROPERTY] ===
        payload.extendedProperties.private[HASH_PROPERTY] &&
      remote.summary === payload.summary &&
      remote.description === payload.description &&
      remote.start?.date === payload.start.date &&
      remote.end?.date === payload.end.date &&
      remote.status === payload.status &&
      remote.transparency === payload.transparency &&
      remote.visibility === payload.visibility
    );
  }

  private formatEventDates(
    event: { startDate: Date; endDate: Date },
    timeZone: string,
  ) {
    const lastInstant = new Date(
      Math.max(event.startDate.getTime(), event.endDate.getTime() - 1),
    );
    return {
      start: { date: formatZoned(event.startDate, timeZone).slice(0, 10) },
      end: {
        date: addUtcDays(
          new Date(
            `${formatZoned(lastInstant, timeZone).slice(0, 10)}T00:00:00Z`,
          ),
          1,
        )
          .toISOString()
          .slice(0, 10),
      },
    };
  }

  private async upsertEvent(
    account: ProviderAccount,
    event: CalendarEvent,
    context: GoogleCalendarContext,
  ) {
    await this.writeEvent(
      account,
      event.eventId,
      this.eventPayload(event, context),
    );
  }

  private async writeEvent(
    account: ProviderAccount,
    eventId: number,
    payload: Record<string, unknown>,
  ): Promise<void> {
    const token = await this.getValidAccessToken(account);
    const calendarId = this.calendarId(account);
    const id = googleCalendarEventId(eventId);
    const url = `${GOOGLE_CALENDAR_API}/calendars/${calendarId}/events/${id}`;
    try {
      await axios.put(url, payload, {
        headers: { Authorization: `Bearer ${token}` },
        timeout: 30_000,
      });
    } catch (error) {
      if (!isAxiosError(error) || error.response?.status !== 404) throw error;
      await axios.post(
        `${GOOGLE_CALENDAR_API}/calendars/${calendarId}/events`,
        { id, ...payload },
        {
          headers: { Authorization: `Bearer ${token}` },
          timeout: 30_000,
        },
      );
    }
  }

  private async deleteEvent(account: ProviderAccount, eventId: number) {
    await this.deleteRemoteEvent(account, googleCalendarEventId(eventId));
  }

  private async deleteRemoteEvent(account: ProviderAccount, id: string) {
    const token = await this.getValidAccessToken(account);
    const calendarId = this.calendarId(account);
    try {
      await axios.delete(
        `${GOOGLE_CALENDAR_API}/calendars/${calendarId}/events/${encodeURIComponent(id)}`,
        {
          headers: { Authorization: `Bearer ${token}` },
          timeout: 30_000,
        },
      );
    } catch (error) {
      if (
        !isAxiosError(error) ||
        ![404, 410].includes(error.response?.status ?? 0)
      ) {
        throw error;
      }
    }
  }

  private async listManagedEvents(
    account: ProviderAccount,
  ): Promise<GoogleCalendarEvent[]> {
    const token = await this.getValidAccessToken(account);
    const calendarId = this.calendarId(account);
    const items: GoogleCalendarEvent[] = [];
    let pageToken: string | undefined;
    do {
      const { data } = await axios.get<GoogleCalendarListResponse>(
        `${GOOGLE_CALENDAR_API}/calendars/${calendarId}/events`,
        {
          params: {
            privateExtendedProperty: `${MANAGED_PROPERTY}=true`,
            showDeleted: true,
            singleEvents: true,
            maxResults: 2500,
            ...(pageToken && { pageToken }),
          },
          headers: { Authorization: `Bearer ${token}` },
          timeout: 30_000,
        },
      );
      items.push(...(data.items ?? []));
      pageToken = data.nextPageToken;
    } while (pageToken);
    return items;
  }

  private calendarId(account: ProviderAccount): string {
    if (!account.externalUserId) {
      throw new Error('Google Calendar account has no synchronized calendar');
    }
    return encodeURIComponent(account.externalUserId);
  }
}
