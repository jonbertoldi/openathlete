import { Module, forwardRef } from '@nestjs/common';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { ScheduleModule } from '@nestjs/schedule';

import { AuthModule } from '../auth';
import { CoreModule } from '../core';
import { QueueModule } from '../queue';
import { CorosAdapter } from './adapters/coros.adapter';
import { GarminAdapter } from './adapters/garmin.adapter';
import { IntervalsAdapter } from './adapters/intervals.adapter';
import { SuuntoAdapter } from './adapters/suunto.adapter';
import { ProviderOAuthController } from './controllers/provider-oauth.controller';
import { ProviderExportService } from './export.service';
import { GoogleCalendarSyncScheduler } from './google-calendar-sync.scheduler';
import {
  CorosProviderService,
  GarminProviderService,
  GoogleCalendarProviderService,
  IntervalsProviderService,
  PolarProviderService,
  StravaProviderService,
  SuuntoProviderService,
} from './providers';
import { ProviderExportScheduler } from './scheduler.service';

@Module({
  imports: [
    ScheduleModule.forRoot(),
    AuthModule,
    forwardRef(() => CoreModule),
    EventEmitterModule,
    forwardRef(() => QueueModule),
  ],
  controllers: [ProviderOAuthController],
  providers: [
    GarminAdapter,
    SuuntoAdapter,
    CorosAdapter,
    IntervalsAdapter,
    ProviderExportService,
    ProviderExportScheduler,
    StravaProviderService,
    GarminProviderService,
    SuuntoProviderService,
    CorosProviderService,
    PolarProviderService,
    IntervalsProviderService,
    GoogleCalendarProviderService,
    GoogleCalendarSyncScheduler,
  ],
  exports: [
    ProviderExportService,
    StravaProviderService,
    GarminProviderService,
    SuuntoProviderService,
    CorosProviderService,
    PolarProviderService,
    IntervalsProviderService,
    GoogleCalendarProviderService,
  ],
})
export class ProvidersSyncModule {}
