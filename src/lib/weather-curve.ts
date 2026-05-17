import { HEATING_TARGET_MAX, HEATING_TARGET_MIN } from './gree-versati-client';

export type WeatherCurveShape = 'linear' | 'mild' | 'normal' | 'aggressive' | 'custom';

export interface WeatherCurveConfig {
  outdoorLow: number;
  targetAtOutdoorLow: number;
  outdoorHigh: number;
  targetAtOutdoorHigh: number;
  targetMin: number;
  targetMax: number;
  shape: WeatherCurveShape;
  bend: number;
}

export interface WeatherCurveResult {
  outdoorTemperature: number;
  targetTemperature: number;
}

export const DEFAULT_WEATHER_CURVE_CONFIG: WeatherCurveConfig = {
  outdoorLow: -20,
  targetAtOutdoorLow: 40,
  outdoorHigh: 10,
  targetAtOutdoorHigh: 25,
  targetMin: HEATING_TARGET_MIN,
  targetMax: HEATING_TARGET_MAX,
  shape: 'linear',
  bend: 0,
};

export function calculateWeatherCurveTarget(outdoorTemperature: number, config: WeatherCurveConfig): WeatherCurveResult {
  assertFinite(outdoorTemperature, 'outdoor temperature');
  assertFinite(config.outdoorLow, 'low outdoor temperature');
  assertFinite(config.outdoorHigh, 'high outdoor temperature');
  assertFinite(config.targetAtOutdoorLow, 'low outdoor target');
  assertFinite(config.targetAtOutdoorHigh, 'high outdoor target');
  assertFinite(config.targetMin, 'minimum target');
  assertFinite(config.targetMax, 'maximum target');
  assertFinite(config.bend, 'bend');

  if (config.outdoorLow === config.outdoorHigh) {
    throw new Error('Weather curve outdoor points must use different temperatures');
  }
  if (config.targetMin > config.targetMax) {
    throw new Error('Weather curve minimum target cannot be higher than maximum target');
  }

  const ratio = clamp((outdoorTemperature - config.outdoorLow) / (config.outdoorHigh - config.outdoorLow), 0, 1);
  const shapedRatio = applyCurveShape(ratio, config.shape, config.bend);
  const rawTarget = config.targetAtOutdoorLow + shapedRatio * (config.targetAtOutdoorHigh - config.targetAtOutdoorLow);
  const boundedTarget = clamp(rawTarget, config.targetMin, config.targetMax);

  return {
    outdoorTemperature: roundToTenth(outdoorTemperature),
    targetTemperature: clamp(Math.round(boundedTarget), HEATING_TARGET_MIN, HEATING_TARGET_MAX),
  };
}

function applyCurveShape(ratio: number, shape: WeatherCurveShape, bend: number): number {
  const effectiveBend = shape === 'custom' ? bend : presetBend(shape);
  if (effectiveBend === 0) {
    return ratio;
  }

  const amount = Math.min(Math.abs(effectiveBend), 100) / 100;
  const exponent = 1 + amount * 3;
  return effectiveBend > 0
    ? 1 - ((1 - ratio) ** exponent)
    : ratio ** exponent;
}

function presetBend(shape: WeatherCurveShape): number {
  switch (shape) {
    case 'mild':
      return 25;
    case 'normal':
      return 50;
    case 'aggressive':
      return 75;
    case 'linear':
    case 'custom':
      return 0;
  }
}

function assertFinite(value: number, label: string): void {
  if (!Number.isFinite(value)) {
    throw new Error(`Invalid weather curve ${label}: ${String(value)}`);
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function roundToTenth(value: number): number {
  return Math.round(value * 10) / 10;
}
