import axios from 'axios';

import { ConfigService } from '@nestjs/config';

import type { ProviderAccount } from '@openathlete/database';
import type { ApiEnvSchemaType } from '@openathlete/shared';

import { PrismaService } from '../../prisma/services/prisma.service';
import {
  GoogleCalendarProviderService,
  googleCalendarEventId,
} from './google-calendar.provider.service';

jest.mock('axios', () => ({
  __esModule: true,
  ...jest.requireActual('axios'),
  default: {
    get: jest.fn(),
    post: jest.fn(),
    put: jest.fn(),
    delete: jest.fn(),
  },
}));

const http = jest.mocked(axios);

const account = {
  providerAccountId: 14,
  athleteId: 9,
  provider: 'GOOGLE_CALENDAR',
  status: 'active',
  accessToken: 'access-token',
  refreshToken: 'refresh-token',
  expiresAt: new Date('2099-01-01T00:00:00Z'),
  externalUserId: 'openathlete-calendar@example.com',
} as ProviderAccount;

const note = {
  eventId: 37,
  name: 'Recovery day',
  type: 'NOTE',
  startDate: new Date('2026-11-05T01:00:00Z'),
  endDate: new Date('2026-11-05T02:00:00Z'),
  training: null,
  competition: null,
  note: { description: 'Keep it easy' },
};

function setup(events: unknown[] = [note]) {
  const prisma = {
    event: {
      findMany: jest.fn().mockResolvedValue(events),
      findFirst: jest.fn(),
    },
    athlete: {
      findUniqueOrThrow: jest.fn().mockResolvedValue({
        user: { language: 'EN', timeZone: 'America/Sao_Paulo' },
      }),
    },
    athleteMetric: { findMany: jest.fn().mockResolvedValue([]) },
    trainingZone: { findMany: jest.fn().mockResolvedValue([]) },
    providerAccount: {
      update: jest.fn().mockImplementation(({ data }) =>
        Promise.resolve({
          ...account,
          ...data,
        }),
      ),
    },
  };
  const env: Record<string, string> = {
    APP_URL: 'https://athlete.example.com',
    GOOGLE_CALENDAR_CLIENT_ID: 'client-id',
    GOOGLE_CALENDAR_CLIENT_SECRET: 'client-secret',
  };
  const service = new GoogleCalendarProviderService(
    prisma as unknown as PrismaService,
    { get: (key: string) => env[key] } as ConfigService<ApiEnvSchemaType, true>,
  );
  return { service, prisma };
}

const notFound = Object.assign(new Error('not found'), {
  isAxiosError: true,
  response: { status: 404 },
});

beforeEach(() => jest.resetAllMocks());

describe('GoogleCalendarProviderService', () => {
  it('creates a valid stable Google event id', () => {
    expect(googleCalendarEventId(37)).toBe(googleCalendarEventId(37));
    expect(googleCalendarEventId(37)).toMatch(/^[a-v0-9]+$/);
  });

  it('requests offline Calendar access with the configured callback', () => {
    const { service } = setup();
    const uri = new URL(service.getAuthorizationUri());

    expect(uri.origin + uri.pathname).toBe(
      'https://accounts.google.com/o/oauth2/v2/auth',
    );
    expect(uri.searchParams.get('scope')).toBe(
      'https://www.googleapis.com/auth/calendar.app.created',
    );
    expect(uri.searchParams.get('access_type')).toBe('offline');
    expect(uri.searchParams.get('prompt')).toBe('consent');
    expect(uri.searchParams.get('redirect_uri')).toBe(
      'https://athlete.example.com/auth/callback/google-calendar',
    );
  });

  it('creates missing events and repairs visible edits made in Google', async () => {
    const { service } = setup();
    http.get
      .mockResolvedValueOnce({ data: {} })
      .mockResolvedValueOnce({ data: { items: [] } });
    http.put.mockRejectedValueOnce(notFound);
    http.post.mockResolvedValueOnce({ data: {} });

    await service.syncAccount(account);

    const created = http.post.mock.calls[0][1] as {
      id: string;
      summary: string;
      start: { date: string };
      end: { date: string };
      extendedProperties: { private: Record<string, string> };
    };
    expect(created).toMatchObject({
      id: googleCalendarEventId(37),
      summary: 'Recovery day',
      start: { date: '2026-11-04' },
      end: { date: '2026-11-05' },
    });

    http.get.mockResolvedValueOnce({
      data: {},
    });
    http.get.mockResolvedValueOnce({
      data: {
        items: [{ ...created, summary: 'Changed in Google' }],
      },
    });
    http.put.mockResolvedValueOnce({ data: {} });

    await service.syncAccount(account);

    expect(http.put).toHaveBeenLastCalledWith(
      expect.stringContaining(
        `/calendars/openathlete-calendar%40example.com/events/${googleCalendarEventId(37)}`,
      ),
      expect.objectContaining({ summary: 'Recovery day' }),
      expect.anything(),
    );

    http.get.mockResolvedValueOnce({ data: {} }).mockResolvedValueOnce({
      data: { items: [{ ...created, status: 'cancelled' }] },
    });
    http.put.mockResolvedValueOnce({ data: {} });

    await service.syncAccount(account);

    expect(http.put).toHaveBeenLastCalledWith(
      expect.stringContaining(`/events/${googleCalendarEventId(37)}`),
      expect.objectContaining({ status: 'confirmed' }),
      expect.anything(),
    );
  });

  it('creates a dedicated OpenAthlete calendar when none exists', async () => {
    const { service, prisma } = setup([]);
    const disconnected = { ...account, externalUserId: null };
    http.post.mockResolvedValueOnce({ data: { id: 'new-calendar' } });
    http.get.mockResolvedValueOnce({ data: { items: [] } });

    await service.syncAccount(disconnected);

    expect(http.post).toHaveBeenCalledWith(
      'https://www.googleapis.com/calendar/v3/calendars',
      expect.objectContaining({
        summary: 'OpenAthlete',
        timeZone: 'America/Sao_Paulo',
      }),
      expect.anything(),
    );
    expect(prisma.providerAccount.update).toHaveBeenCalledWith({
      where: { providerAccountId: 14 },
      data: { externalUserId: 'new-calendar' },
    });
  });

  it('deletes malformed or orphaned managed events', async () => {
    const { service } = setup([]);
    http.get.mockResolvedValueOnce({ data: {} });
    http.get.mockResolvedValueOnce({
      data: {
        items: [
          {
            id: 'orphan',
            extendedProperties: {
              private: { openathleteManaged: 'true' },
            },
          },
        ],
      },
    });
    http.delete.mockResolvedValueOnce({ data: {} });

    await service.syncAccount(account);

    expect(http.delete).toHaveBeenCalledWith(
      expect.stringContaining('/events/orphan'),
      expect.anything(),
    );
  });

  it('removes the dedicated calendar and revokes access on disconnect', async () => {
    const { service } = setup([]);
    http.delete.mockResolvedValueOnce({ data: {} });
    http.post.mockResolvedValueOnce({ data: {} });

    await service.disconnect(account);

    expect(http.delete).toHaveBeenCalledWith(
      'https://www.googleapis.com/calendar/v3/calendars/openathlete-calendar%40example.com',
      expect.anything(),
    );
    expect(http.post).toHaveBeenCalledWith(
      'https://oauth2.googleapis.com/revoke',
      expect.stringContaining('refresh-token'),
      expect.anything(),
    );
  });
});
