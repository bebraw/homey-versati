export interface CopEstimateInput {
  waterInTemperature: number | null;
  waterOutTemperature: number | null;
  waterFlowRateLMin: number;
  electricalInputKw: number;
  power: boolean;
  defrosting: boolean;
}

export interface CopEstimate {
  waterDeltaTemperature: number;
  heatOutputKw: number;
  electricalInputKw: number;
  cop: number;
  status: CopEstimateStatus;
}

export type CopEstimateStatus =
  | 'ok'
  | 'off'
  | 'defrosting'
  | 'missing_temperature'
  | 'missing_flow'
  | 'missing_electrical_input'
  | 'no_positive_water_delta';

const WATER_HEAT_CAPACITY_KJ_PER_KG_K = 4.186;
const LITERS_PER_MINUTE_TO_KG_PER_SECOND = 1 / 60;

export function calculateCopEstimate(input: CopEstimateInput): CopEstimate {
  const {
    waterInTemperature,
    waterOutTemperature,
    waterFlowRateLMin,
    electricalInputKw,
    power,
    defrosting,
  } = input;

  if (!power || defrosting) {
    return emptyEstimate(defrosting ? 'defrosting' : 'off');
  }
  if (waterInTemperature === null || waterOutTemperature === null) {
    return emptyEstimate('missing_temperature');
  }
  if (!Number.isFinite(waterFlowRateLMin) || waterFlowRateLMin <= 0) {
    return emptyEstimate('missing_flow');
  }
  if (!Number.isFinite(electricalInputKw) || electricalInputKw <= 0) {
    return emptyEstimate('missing_electrical_input');
  }

  const waterDeltaTemperature = waterOutTemperature - waterInTemperature;
  if (waterDeltaTemperature <= 0) {
    return emptyEstimate('no_positive_water_delta');
  }

  const heatOutputKw = waterFlowRateLMin
    * LITERS_PER_MINUTE_TO_KG_PER_SECOND
    * WATER_HEAT_CAPACITY_KJ_PER_KG_K
    * waterDeltaTemperature;

  return {
    waterDeltaTemperature: round(waterDeltaTemperature, 2),
    heatOutputKw: round(heatOutputKw, 2),
    electricalInputKw: round(electricalInputKw, 2),
    cop: round(heatOutputKw / electricalInputKw, 2),
    status: 'ok',
  };
}

function emptyEstimate(status: CopEstimateStatus): CopEstimate {
  return {
    waterDeltaTemperature: 0,
    heatOutputKw: 0,
    electricalInputKw: 0,
    cop: 0,
    status,
  };
}

function round(value: number, decimals: number): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}
