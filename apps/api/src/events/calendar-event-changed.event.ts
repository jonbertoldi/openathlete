export type CalendarEventChangeAction = 'upsert' | 'delete';

/**
 * A planned calendar item changed after its database transaction completed.
 * Provider listeners use the stable OpenAthlete event id to mirror or remove
 * the item without coupling the core calendar module to an external API.
 */
export class CalendarEventChangedEvent {
  static readonly SLUG = 'calendar.event-changed';

  constructor(
    public readonly payload: {
      eventId: number;
      athleteId: number;
      action: CalendarEventChangeAction;
    },
  ) {}
}
