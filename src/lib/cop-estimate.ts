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
}

const WATER_HEAT_CAPACITY_KJ_PER_KG_K = 4.186;
const LITERS_PER_MINUTE_TO_KG_PER_SECOND = 1 / 60;

export function calculateCopEstimate(input: CopEstimateInput): CopEstimate | null {
  const {
    waterInTemperature,
    waterOutTemperature,
    waterFlowRateLMin,
    electricalInputKw,
    power,
    defrosting,
  } = input;

  if (!power || defrosting) {
    return null;
  }
  if (waterInTemperature === null || waterOutTemperature === null) {
    return null;
  }
  if (!Number.isFinite(waterFlowRateLMin) || waterFlowRateLMin <= 0) {
    return null;
  }
  if (!Number.isFinite(electricalInputKw) || electricalInputKw <= 0) {
    return null;
  }

  const waterDeltaTemperature = waterOutTemperature - waterInTemperature;
  if (waterDeltaTemperature <= 0) {
    return null;
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
  };
}

function round(value: number, decimals: number): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}
