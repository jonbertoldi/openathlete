import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';

import { ConnectorProvider } from '@openathlete/database';

import { PrismaService } from '../prisma/services/prisma.service';
import { GoogleCalendarProviderService } from './providers';

/** Repairs missed Google Calendar writes without polling when nothing changed. */
@Injectable()
export class GoogleCalendarSyncScheduler {
  private readonly logger = new Logger(GoogleCalendarSyncScheduler.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly googleCalendar: GoogleCalendarProviderService,
  ) {}

  @Cron('*/15 * * * *', { timeZone: 'UTC' })
  async reconcile() {
    const accounts = await this.prisma.providerAccount.findMany({
      where: {
        provider: ConnectorProvider.GOOGLE_CALENDAR,
        status: 'active',
      },
    });
    for (const account of accounts) {
      try {
        await this.googleCalendar.syncAccount(account);
      } catch (error) {
        this.logger.warn(
          `Google Calendar reconciliation failed for athlete ${account.athleteId}: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
  }
}
