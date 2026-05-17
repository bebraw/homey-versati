import assert from 'node:assert/strict';
import test from 'node:test';
import { calculateWeatherCurveTarget, DEFAULT_WEATHER_CURVE_CONFIG } from '../src/lib/weather-curve';

test('calculates a two-point weather compensation target', () => {
  assert.deepEqual(calculateWeatherCurveTarget(-20, DEFAULT_WEATHER_CURVE_CONFIG), {
    outdoorTemperature: -20,
    targetTemperature: 40,
  });
  assert.deepEqual(calculateWeatherCurveTarget(10, DEFAULT_WEATHER_CURVE_CONFIG), {
    outdoorTemperature: 10,
    targetTemperature: 25,
  });
  assert.deepEqual(calculateWeatherCurveTarget(-5, DEFAULT_WEATHER_CURVE_CONFIG), {
    outdoorTemperature: -5,
    targetTemperature: 33,
  });
});

test('clamps weather compensation target to configured and device-safe bounds', () => {
  const config = {
    ...DEFAULT_WEATHER_CURVE_CONFIG,
    targetMin: 28,
    targetMax: 38,
    targetAtOutdoorLow: 70,
    targetAtOutdoorHigh: 10,
  };

  assert.equal(calculateWeatherCurveTarget(-40, config).targetTemperature, 38);
  assert.equal(calculateWeatherCurveTarget(30, config).targetTemperature, 28);
});

test('applies preset and custom weather compensation curve bends', () => {
  const linear = calculateWeatherCurveTarget(-10, DEFAULT_WEATHER_CURVE_CONFIG).targetTemperature;
  const mild = calculateWeatherCurveTarget(-10, {
    ...DEFAULT_WEATHER_CURVE_CONFIG,
    shape: 'mild',
  }).targetTemperature;
  const aggressive = calculateWeatherCurveTarget(-10, {
    ...DEFAULT_WEATHER_CURVE_CONFIG,
    shape: 'aggressive',
  }).targetTemperature;
  const customNegative = calculateWeatherCurveTarget(-10, {
    ...DEFAULT_WEATHER_CURVE_CONFIG,
    shape: 'custom',
    bend: -75,
  }).targetTemperature;

  assert.equal(linear, 35);
  assert.equal(mild, 32);
  assert.equal(aggressive, 29);
  assert.equal(customNegative, 40);
});

test('rejects invalid weather compensation curve settings', () => {
  assert.throws(() => calculateWeatherCurveTarget(0, {
    ...DEFAULT_WEATHER_CURVE_CONFIG,
    outdoorLow: 0,
    outdoorHigh: 0,
  }), /different temperatures/);
  assert.throws(() => calculateWeatherCurveTarget(0, {
    ...DEFAULT_WEATHER_CURVE_CONFIG,
    targetMin: 40,
    targetMax: 30,
  }), /minimum target/);
});
