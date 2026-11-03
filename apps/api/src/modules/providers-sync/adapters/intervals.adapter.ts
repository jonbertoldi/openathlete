import axios from 'axios';

import { Injectable } from '@nestjs/common';

import { ConnectorProvider } from '@openathlete/database';

import { PrismaService } from '../../prisma/services/prisma.service';
import { mapToIntervals } from '../mapping/intervals.mapper';
import type {
  DeletePlannedWorkoutInput,
  ProviderAdapter,
  UpsertPlannedWorkoutInput,
  UpsertPlannedWorkoutResult,
} from '../provider-adapter.interface';
import { IntervalsProviderService } from '../providers/intervals.provider.service';

interface IntervalsEventResponse {
  id?: string | number;
  external_id?: string;
}

@Injectable()
export class IntervalsAdapter implements ProviderAdapter {
  constructor(
    private readonly prisma: PrismaService,
    private readonly intervalsProviderService: IntervalsProviderService,
  ) {}

  getProvider(): 'intervals' {
    return 'intervals';
  }

  private findAccount(athleteId: number) {
    return this.prisma.providerAccount.findFirst({
      where: {
        athleteId,
        provider: ConnectorProvider.INTERVALS,
        status: 'active',
      },
    });
  }

  async upsertPlannedWorkout(
    input: UpsertPlannedWorkoutInput,
  ): Promise<UpsertPlannedWorkoutResult> {
    const account = await this.findAccount(input.athleteId);
    if (!account) throw new Error('No active Intervals.icu account found');
    const token =
      await this.intervalsProviderService.getValidAccessToken(account);
    const payload = mapToIntervals(
      input.date,
      input.workoutId,
      input.normalized,
    );
    const { data } = await axios.post<IntervalsEventResponse[]>(
      'https://intervals.icu/api/v1/athlete/0/events/bulk?upsert=true',
      [payload],
      { headers: { Authorization: `Bearer ${token}` } },
    );
    const externalId = data[0]?.external_id ?? payload.external_id;
    return {
      externalId,
      scheduleId: data[0]?.id === undefined ? undefined : String(data[0].id),
    };
  }

  async deletePlannedWorkout(input: DeletePlannedWorkoutInput): Promise<void> {
    if (!input.externalId) return;
    const account = await this.findAccount(input.athleteId);
    if (!account) return;
    const token =
      await this.intervalsProviderService.getValidAccessToken(account);
    await axios.put(
      'https://intervals.icu/api/v1/athlete/0/events/bulk-delete',
      [{ external_id: input.externalId }],
      { headers: { Authorization: `Bearer ${token}` } },
    );
  }
}
