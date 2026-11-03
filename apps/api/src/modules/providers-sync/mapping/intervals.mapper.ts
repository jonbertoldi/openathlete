import type {
  NormalizedWorkout,
  NormalizedWorkoutStep,
} from '@openathlete/shared';
import { SPORT_TYPE, WORKOUT_DURATION_TYPE } from '@openathlete/shared';

export interface IntervalsPlannedWorkout {
  category: 'WORKOUT';
  start_date_local: string;
  external_id: string;
  name: string;
  description: string;
  type: string;
}

function duration(step: NormalizedWorkoutStep): string {
  const value = step.durationValue ?? 0;
  switch (step.durationType) {
    case WORKOUT_DURATION_TYPE.TIME:
      if (value >= 3600 && value % 3600 === 0) return `${value / 3600}h`;
      if (value >= 60 && value % 60 === 0) return `${value / 60}m`;
      return `${Math.max(1, Math.round(value))}s`;
    case WORKOUT_DURATION_TYPE.DISTANCE:
      return value >= 1000 && value % 1000 === 0
        ? `${value / 1000}km`
        : `${Math.max(1, Math.round(value))}m`;
    case WORKOUT_DURATION_TYPE.REPS:
      return `${Math.max(1, Math.round(value))}x`;
    default:
      return '1m';
  }
}

function workoutType(sport: SPORT_TYPE): string {
  switch (sport) {
    case SPORT_TYPE.RUNNING:
    case SPORT_TYPE.TRAIL_RUNNING:
    case SPORT_TYPE.VIRTUAL_RUN:
      return 'Run';
    case SPORT_TYPE.CYCLING:
    case SPORT_TYPE.GRAVEL_RIDE:
    case SPORT_TYPE.MOUNTAIN_BIKE_RIDE:
    case SPORT_TYPE.VIRTUAL_RIDE:
      return 'Ride';
    case SPORT_TYPE.SWIMMING:
      return 'Swim';
    case SPORT_TYPE.STRENGTH:
    case SPORT_TYPE.WEIGHT_TRAINING:
      return 'WeightTraining';
    default:
      return 'Workout';
  }
}

/** Intervals.icu parses this text into a structured planned workout. */
export function mapToIntervals(
  date: string,
  workoutId: number,
  workout: NormalizedWorkout,
): IntervalsPlannedWorkout {
  const steps = workout.steps.map((step) => {
    const label = step.name || step.notes || step.stepType.replaceAll('_', ' ');
    return `- ${duration(step)} ${label}`;
  });
  return {
    category: 'WORKOUT',
    start_date_local: `${date}T00:00:00`,
    external_id: `openathlete-${workoutId}`,
    name: workout.title || 'OpenAthlete workout',
    description: [workout.description, ...steps].filter(Boolean).join('\n'),
    type: workoutType(workout.sport),
  };
}
