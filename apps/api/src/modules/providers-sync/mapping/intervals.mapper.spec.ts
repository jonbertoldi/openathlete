import {
  SPORT_TYPE,
  WORKOUT_DURATION_TYPE,
  WORKOUT_STEP_TYPE,
} from '@openathlete/shared';

import { mapToIntervals } from './intervals.mapper';

describe('mapToIntervals', () => {
  it('creates an idempotent structured calendar workout', () => {
    expect(
      mapToIntervals('2026-11-05', 42, {
        sport: SPORT_TYPE.RUNNING,
        title: 'Easy run',
        description: 'Stay relaxed',
        steps: [
          {
            orderIndex: 0,
            stepType: WORKOUT_STEP_TYPE.WARMUP,
            durationType: WORKOUT_DURATION_TYPE.TIME,
            durationValue: 600,
            name: 'Warmup',
            targets: [],
          },
          {
            orderIndex: 1,
            stepType: WORKOUT_STEP_TYPE.STEADY,
            durationType: WORKOUT_DURATION_TYPE.DISTANCE,
            durationValue: 5000,
            name: 'Easy',
            targets: [],
          },
        ],
      }),
    ).toEqual({
      category: 'WORKOUT',
      start_date_local: '2026-11-05T00:00:00',
      external_id: 'openathlete-42',
      name: 'Easy run',
      description: 'Stay relaxed\n- 10m Warmup\n- 5km Easy',
      type: 'Run',
    });
  });
});
