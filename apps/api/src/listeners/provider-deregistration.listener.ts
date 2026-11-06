import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';

import { ConnectorProvider } from '@openathlete/database';

import { AccountDeletingEvent } from 'src/events';
import { PrismaService } from 'src/modules/prisma/services/prisma.service';
import {
  GarminProviderService,
  GoogleCalendarProviderService,
  PolarProviderService,
} from 'src/modules/providers-sync/providers';

/**
 * Garmin and Polar must stop sending data when the user deletes their
 * account. Google Calendar must remove its dedicated calendar and consent
 * before the local credentials disappear.
 */
@Injectable()
export class ProviderDeregistrationListener {
  private readonly logger = new Logger(ProviderDeregistrationListener.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly garminProviderService: GarminProviderService,
    private readonly polarProviderService: PolarProviderService,
    private readonly googleCalendarProviderService: GoogleCalendarProviderService,
  ) {}

  @OnEvent(AccountDeletingEvent.SLUG)
  async handle(event: AccountDeletingEvent) {
    const { athleteId } = event.payload;
    if (!athleteId) return;

    const accounts = await this.prisma.providerAccount.findMany({
      where: {
        athleteId,
        provider: ConnectorProvider.GARMIN,
        refreshToken: { not: null },
      },
    });
    for (const account of accounts) {
      // Never blocks the deletion: the account goes either way
      await this.garminProviderService.disconnect(account).catch((error) => {
        this.logger.error(
          `Failed to deregister Garmin account ${account.providerAccountId}: ${error instanceof Error ? error.message : String(error)}`,
        );
      });
    }

    const polarAccounts = await this.prisma.providerAccount.findMany({
      where: { athleteId, provider: ConnectorProvider.POLAR },
    });
    for (const account of polarAccounts) {
      // Its failures are logged there and never block
      await this.polarProviderService.disconnect(account);
    }

    const googleAccounts = await this.prisma.providerAccount.findMany({
      where: { athleteId, provider: ConnectorProvider.GOOGLE_CALENDAR },
    });
    for (const account of googleAccounts) {
      // Remove mirrored events and revoke consent before the local account goes.
      await this.googleCalendarProviderService
        .disconnect(account)
        .catch((error) => {
          this.logger.error(
            `Failed to disconnect Google Calendar account ${account.providerAccountId}: ${error instanceof Error ? error.message : String(error)}`,
          );
        });
    }
  }
}
