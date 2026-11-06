import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';

import { CalendarEventChangedEvent } from 'src/events';
import { GoogleCalendarProviderService } from 'src/modules/providers-sync/providers';

@Injectable()
export class GoogleCalendarSyncListener {
  private readonly logger = new Logger(GoogleCalendarSyncListener.name);

  constructor(private readonly googleCalendar: GoogleCalendarProviderService) {}

  @OnEvent(CalendarEventChangedEvent.SLUG, { async: true })
  async handle(event: CalendarEventChangedEvent) {
    const { athleteId, eventId, action } = event.payload;
    try {
      await this.googleCalendar.syncEventForAthlete(athleteId, eventId, action);
    } catch (error) {
      // The 15-minute reconciliation retries transient failures.
      this.logger.warn(
        `Google Calendar ${action} failed for event ${eventId}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}
