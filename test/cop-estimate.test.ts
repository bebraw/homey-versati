import assert from 'node:assert/strict';
import test from 'node:test';
import { calculateCopEstimate } from '../src/lib/cop-estimate';

test('estimates COP from water delta, flow rate, and electrical input', () => {
  const estimate = calculateCopEstimate({
    waterInTemperature: 25,
    waterOutTemperature: 30,
    waterFlowRateLMin: 20,
    electricalInputKw: 2,
    power: true,
    defrosting: false,
  });

  assert.deepEqual(estimate, {
    waterDeltaTemperature: 5,
    heatOutputKw: 6.98,
    electricalInputKw: 2,
    cop: 3.49,
  });
});

test('does not estimate COP without usable operating inputs', () => {
  assert.equal(calculateCopEstimate({
    waterInTemperature: 30,
    waterOutTemperature: 25,
    waterFlowRateLMin: 20,
    electricalInputKw: 2,
    power: true,
    defrosting: false,
  }), null);
  assert.equal(calculateCopEstimate({
    waterInTemperature: 25,
    waterOutTemperature: 30,
    waterFlowRateLMin: 0,
    electricalInputKw: 2,
    power: true,
    defrosting: false,
  }), null);
  assert.equal(calculateCopEstimate({
    waterInTemperature: 25,
    waterOutTemperature: 30,
    waterFlowRateLMin: 20,
    electricalInputKw: 0,
    power: true,
    defrosting: false,
  }), null);
  assert.equal(calculateCopEstimate({
    waterInTemperature: 25,
    waterOutTemperature: 30,
    waterFlowRateLMin: 20,
    electricalInputKw: 2,
    power: false,
    defrosting: false,
  }), null);
  assert.equal(calculateCopEstimate({
    waterInTemperature: 25,
    waterOutTemperature: 30,
    waterFlowRateLMin: 20,
    electricalInputKw: 2,
    power: true,
    defrosting: true,
  }), null);
});
