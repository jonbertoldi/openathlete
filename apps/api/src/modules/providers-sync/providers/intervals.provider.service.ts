import axios, { isAxiosError } from 'axios';

import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron } from '@nestjs/schedule';

import {
  ConnectorProvider,
  EventType,
  ProviderAccount,
} from '@openathlete/database';
import { ApiEnvSchemaType } from '@openathlete/shared';

import { mapStravaSportType } from '../../core/helpers/strava';
import { PrismaService } from '../../prisma/services/prisma.service';
import { QueueService } from '../../queue/queue.service';
import {
  BaseProviderService,
  FullImportResult,
  OAuthConfig,
  OAuthTokenResponse,
} from '../base';
import {
  ImportOptions,
  ImportResult,
  ImportedActivity,
  ProviderImportCapability,
} from '../base/provider-import.interface';
import { providerRedirectUri } from '../base/provider-urls';

const API_URL = 'https://intervals.icu/api/v1';
const DAY_MS = 86_400_000;

interface IntervalsAthlete {
  id: string | number;
  name?: string;
}

interface IntervalsTokenResponse extends OAuthTokenResponse {
  athlete?: IntervalsAthlete;
}

export interface IntervalsActivity {
  id: string | number;
  name?: string;
  type?: string;
  icu_type?: string;
  start_date?: string;
  start_date_local?: string;
  moving_time?: number;
  elapsed_time?: number;
  distance?: number;
  total_elevation_gain?: number;
  average_speed?: number;
  max_speed?: number;
  average_heartrate?: number;
  max_heartrate?: number;
  average_watts?: number;
  max_watts?: number;
  weighted_average_watts?: number;
  average_cadence?: number;
  calories?: number;
  description?: string;
  [key: string]: unknown;
}

interface IntervalsWebhookEvent {
  athlete_id?: string | number;
  type?: string;
  activity?: IntervalsActivity;
}

interface IntervalsWebhookPayload {
  secret?: string;
  events?: IntervalsWebhookEvent[];
}

@Injectable()
export class IntervalsProviderService
  extends BaseProviderService
  implements ProviderImportCapability
{
  protected readonly provider = ConnectorProvider.INTERVALS;

  protected get oauthConfig(): OAuthConfig {
    return {
      authorizationUrl: 'https://intervals.icu/oauth/authorize',
      tokenUrl: 'https://intervals.icu/api/oauth/token',
      clientId: this.configService.get('INTERVALS_CLIENT_ID') ?? '',
      clientSecret: this.configService.get('INTERVALS_CLIENT_SECRET') ?? '',
      redirectUri: providerRedirectUri(
        this.configService.get('INTERVALS_REDIRECT_URI'),
        this.configService.get('APP_URL'),
        'intervals',
      ),
      scopes: ['ACTIVITY:READ', 'CALENDAR:WRITE'],
    };
  }

  constructor(
    prisma: PrismaService,
    configService: ConfigService<ApiEnvSchemaType, true>,
    private readonly queueService: QueueService,
  ) {
    super(prisma, configService);
  }

  override async exchangeCodeForTokens(
    code: string,
  ): Promise<IntervalsTokenResponse> {
    const { data } = await axios.post<IntervalsTokenResponse>(
      this.oauthConfig.tokenUrl,
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

  async connect(code: string, athleteId: number): Promise<ProviderAccount> {
    const token = await this.exchangeCodeForTokens(code);
    if (!token.athlete?.id) {
      throw new Error('Intervals.icu did not return the connected athlete');
    }
    return this.saveProviderAccount({
      athleteId,
      accessToken: token.access_token,
      refreshToken: token.refresh_token ?? '',
      expiresIn: token.expires_in,
      scopes: token.scope,
      externalUserId: String(token.athlete.id),
    });
  }

  override async getValidAccessToken(
    account: ProviderAccount,
  ): Promise<string> {
    // Intervals.icu access tokens do not currently use a refresh-token flow.
    if (account.status !== 'active' || !account.accessToken) {
      throw new Error('Intervals.icu account is not active');
    }
    return account.accessToken;
  }

  async disconnect(account: ProviderAccount): Promise<void> {
    try {
      await axios.delete(`${API_URL}/disconnect-app`, {
        headers: { Authorization: `Bearer ${account.accessToken}` },
      });
    } catch (error) {
      if (
        !isAxiosError(error) ||
        ![401, 404].includes(error.response?.status ?? 0)
      ) {
        throw error;
      }
    }
  }

  private async request<T>(
    account: ProviderAccount,
    path: string,
    params?: Record<string, string>,
  ): Promise<T> {
    const token = await this.getValidAccessToken(account);
    const { data } = await axios.get<T>(`${API_URL}${path}`, {
      params,
      headers: { Authorization: `Bearer ${token}` },
      timeout: 30_000,
    });
    return data;
  }

  private toImportedActivity(row: IntervalsActivity): ImportedActivity {
    const started = new Date(
      row.start_date ?? row.start_date_local ?? new Date().toISOString(),
    );
    const duration = Number(row.moving_time ?? row.elapsed_time ?? 0);
    return {
      externalId: `intervals:${String(row.id)}`,
      name: row.name || row.type || 'Activity',
      startDate: started,
      endDate: new Date(started.getTime() + duration * 1000),
      sport: row.icu_type ?? row.type ?? 'Other',
      distance: Number(row.distance ?? 0),
      duration,
      raw: row,
    };
  }

  async importActivities(
    account: ProviderAccount,
    options?: ImportOptions,
  ): Promise<ImportedActivity[]> {
    const oldest = (options?.startDate ?? new Date('2000-01-01T00:00:00Z'))
      .toISOString()
      .slice(0, 10);
    const newest = (options?.endDate ?? new Date()).toISOString().slice(0, 10);
    const rows = await this.request<IntervalsActivity[]>(
      account,
      '/athlete/0/activities',
      { oldest, newest },
    );
    return rows
      .slice(0, options?.limit)
      .map((row) => this.toImportedActivity(row));
  }

  async importActivity(
    account: ProviderAccount,
    activity: ImportedActivity,
  ): Promise<ImportResult> {
    const existing = await this.prisma.eventActivity.findFirst({
      where: {
        provider: ConnectorProvider.INTERVALS,
        externalId: activity.externalId,
        event: { athleteId: account.athleteId },
      },
    });
    if (existing) return { activity: existing, created: false };

    const row = activity.raw as IntervalsActivity;
    const duration = Math.max(0, Math.round(activity.duration ?? 0));
    const distance = Math.max(0, Number(activity.distance ?? 0));
    const saved = await this.prisma.eventActivity.create({
      data: {
        provider: ConnectorProvider.INTERVALS,
        externalId: activity.externalId,
        distance,
        elevationGain: Math.max(0, Number(row.total_elevation_gain ?? 0)),
        movingTime: duration,
        averageSpeed: Number(
          row.average_speed ?? (duration ? distance / duration : 0),
        ),
        maxSpeed: Number(row.max_speed ?? 0),
        averageCadence: numberOrUndefined(row.average_cadence),
        averageHeartrate: numberOrUndefined(row.average_heartrate),
        maxHeartrate: numberOrUndefined(row.max_heartrate),
        averageWatts: numberOrUndefined(row.average_watts),
        maxWatts: numberOrUndefined(row.max_watts),
        weightedAverageWatts: numberOrUndefined(row.weighted_average_watts),
        kilojoules: row.calories ? Number(row.calories) * 4.184 : undefined,
        description: row.description ?? '',
        sport: mapStravaSportType(row.icu_type ?? row.type ?? ''),
        event: {
          create: {
            athleteId: account.athleteId,
            name: activity.name,
            type: EventType.ACTIVITY,
            startDate: new Date(activity.startDate),
            endDate: new Date(activity.endDate),
          },
        },
      },
    });
    return { activity: saved, created: true };
  }

  async queueFullImport(account: ProviderAccount): Promise<FullImportResult> {
    const activities = await this.importActivities(account);
    const known = await this.prisma.eventActivity.findMany({
      where: {
        provider: ConnectorProvider.INTERVALS,
        externalId: { in: activities.map((activity) => activity.externalId) },
      },
      select: { externalId: true },
    });
    const ids = new Set(known.map((activity) => activity.externalId));
    const missing = activities.filter(
      (activity) => !ids.has(activity.externalId),
    );
    await this.queueService.addActivityImportJobs(account, missing, true);
    return { queuedActivities: missing.length };
  }

  async handleWebhook(payload: IntervalsWebhookPayload): Promise<void> {
    const expected = this.configService.get('INTERVALS_WEBHOOK_SECRET');
    if (!expected || payload.secret !== expected) {
      throw new UnauthorizedException('Invalid Intervals.icu webhook secret');
    }
    for (const event of payload.events ?? []) {
      if (event.type !== 'ACTIVITY_UPLOADED' || !event.activity?.id) continue;
      const account = await this.prisma.providerAccount.findFirst({
        where: {
          provider: ConnectorProvider.INTERVALS,
          externalUserId: String(event.athlete_id),
          status: 'active',
          importActivitiesEnabled: true,
        },
      });
      if (account) {
        await this.queueService.addActivityImportJob(
          account,
          this.toImportedActivity(event.activity),
        );
      }
    }
  }

  /** Webhooks are primary; this catches notifications missed during downtime. */
  @Cron('17 * * * *', { timeZone: 'UTC' })
  async syncRecentActivities(): Promise<void> {
    if (this.configService.get('ENABLE_ACTIVITY_IMPORT') !== true) return;
    const accounts = await this.prisma.providerAccount.findMany({
      where: {
        provider: ConnectorProvider.INTERVALS,
        status: 'active',
        importActivitiesEnabled: true,
      },
    });
    for (const account of accounts) {
      try {
        const activities = await this.importActivities(account, {
          startDate: new Date(Date.now() - 3 * DAY_MS),
        });
        await this.queueService.addActivityImportJobs(account, activities);
      } catch (error) {
        this.logger.warn(
          `Intervals.icu sync failed for account ${account.providerAccountId}: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
  }
}

function numberOrUndefined(value: unknown): number | undefined {
  const number = Number(value);
  return Number.isFinite(number) ? number : undefined;
}
