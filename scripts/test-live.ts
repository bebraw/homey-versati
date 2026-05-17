import {
  GreeVersatiClient,
  type BoundGreeVersatiDevice,
  type GreeVersatiState,
  type WritableGreeVersatiMode,
} from '../src/lib/gree-versati-client';

type ToggleId = 'rapid' | 'silence' | 'w_depend' | 'disinfect';

interface CliOptions {
  ip: string;
  mac: string;
  port: number;
  settleMs: number;
  includeRisky: boolean;
}

interface LiveCheck {
  id: string;
  passed: boolean;
  details: Record<string, unknown>;
}

interface Baseline {
  mode: WritableGreeVersatiMode;
  heatingTargetTemperature: number;
  hotWaterTargetTemperature: number;
  toggles: Record<ToggleId, boolean>;
}

interface ToggleDefinition {
  id: ToggleId;
  label: string;
  risky: boolean;
  read(state: GreeVersatiState): boolean;
  write(client: GreeVersatiClient, device: BoundGreeVersatiDevice, enabled: boolean): Promise<void>;
}

const SAFE_TOGGLES: ToggleId[] = ['rapid', 'silence'];
const RISKY_TOGGLES: ToggleId[] = ['w_depend', 'disinfect'];
const TOGGLES: Record<ToggleId, ToggleDefinition> = {
  rapid: {
    id: 'rapid',
    label: 'Rapid hot water',
    risky: false,
    read: (state) => state.fastHotWater,
    write: (client, device, enabled) => client.setFastHotWater(device, enabled),
  },
  silence: {
    id: 'silence',
    label: 'Silence',
    risky: false,
    read: (state) => state.silence,
    write: (client, device, enabled) => client.setSilence(device, enabled),
  },
  w_depend: {
    id: 'w_depend',
    label: 'W-depend',
    risky: true,
    read: (state) => state.weatherDependent,
    write: (client, device, enabled) => client.setWeatherDependent(device, enabled),
  },
  disinfect: {
    id: 'disinfect',
    label: 'Disinfect',
    risky: true,
    read: (state) => state.disinfect,
    write: (client, device, enabled) => client.setDisinfect(device, enabled),
  },
};

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const toggleIds = options.includeRisky ? [...SAFE_TOGGLES, ...RISKY_TOGGLES] : SAFE_TOGGLES;
  const client = new GreeVersatiClient({ timeoutMs: 5000, bindTimeoutMs: 5000 });
  const bound = await client.bind({ ip: options.ip, port: options.port, mac: options.mac });
  const initialState = await client.getState(bound);
  const baseline = baselineFromState(initialState, toggleIds);
  const checks: LiveCheck[] = [];

  try {
    checks.push(await checkSnapshot(initialState));
    checks.push(await checkMode(client, bound, baseline, options.settleMs));
    checks.push(await checkTargets(client, bound, baseline, options.settleMs));
    checks.push(...await checkToggles(client, bound, baseline, toggleIds, options.settleMs));
  } finally {
    await restoreBaseline(client, bound, baseline, toggleIds, options.settleMs);
  }

  const finalState = await client.getState(bound);
  checks.push(checkRestored(finalState, baseline, toggleIds));
  const passed = checks.every((check) => check.passed);

  console.log(JSON.stringify({
    capturedAt: new Date().toISOString(),
    device: {
      ip: bound.ip,
      port: bound.port,
      mac: bound.mac,
      encryptionVersion: bound.encryptionVersion,
    },
    includeRisky: options.includeRisky,
    baseline: {
      mode: baseline.mode,
      heatingTargetTemperature: baseline.heatingTargetTemperature,
      hotWaterTargetTemperature: baseline.hotWaterTargetTemperature,
      toggles: baseline.toggles,
    },
    checks,
    passed,
  }, null, 2));

  if (!passed) {
    process.exitCode = 1;
  }
}

async function checkSnapshot(state: GreeVersatiState): Promise<LiveCheck> {
  return {
    id: 'snapshot',
    passed: state.power !== null && state.mode !== 'other',
    details: {
      power: state.power,
      mode: state.mode,
      heatingTargetTemperature: state.heatingTargetTemperature,
      hotWaterTargetTemperature: state.hotWaterTargetTemperature,
    },
  };
}

async function checkMode(
  client: GreeVersatiClient,
  device: BoundGreeVersatiDevice,
  baseline: Baseline,
  settleMs: number,
): Promise<LiveCheck> {
  const target = baseline.mode === 'hot_water' ? 'heat_hot_water' : 'hot_water';
  let changed = baseline.mode;
  let restored = baseline.mode;

  try {
    await client.setMode(device, target);
    await delay(settleMs);
    changed = writableModeOrThrow((await client.getState(device)).mode);
  } finally {
    await client.setMode(device, baseline.mode);
    await delay(settleMs);
    restored = writableModeOrThrow((await client.getState(device)).mode);
  }

  return {
    id: 'mode_write_restore',
    passed: changed === target && restored === baseline.mode,
    details: {
      baseline: baseline.mode,
      target,
      changed,
      restored,
    },
  };
}

async function checkTargets(
  client: GreeVersatiClient,
  device: BoundGreeVersatiDevice,
  baseline: Baseline,
  settleMs: number,
): Promise<LiveCheck> {
  const heatingTarget = baseline.heatingTargetTemperature === 36 ? 35 : 36;
  const hotWaterTarget = baseline.hotWaterTargetTemperature === 51 ? 50 : 51;
  let changedHeating = baseline.heatingTargetTemperature;
  let changedHotWater = baseline.hotWaterTargetTemperature;
  let restoredHeating = baseline.heatingTargetTemperature;
  let restoredHotWater = baseline.hotWaterTargetTemperature;

  try {
    await client.setHeatingTargetTemperature(device, heatingTarget);
    await client.setHotWaterTargetTemperature(device, hotWaterTarget);
    await delay(settleMs);
    const changed = await client.getState(device);
    changedHeating = numberOrThrow(changed.heatingTargetTemperature, 'changed heating target');
    changedHotWater = numberOrThrow(changed.hotWaterTargetTemperature, 'changed hot water target');
  } finally {
    await client.setHeatingTargetTemperature(device, baseline.heatingTargetTemperature);
    await client.setHotWaterTargetTemperature(device, baseline.hotWaterTargetTemperature);
    await delay(settleMs);
    const restored = await client.getState(device);
    restoredHeating = numberOrThrow(restored.heatingTargetTemperature, 'restored heating target');
    restoredHotWater = numberOrThrow(restored.hotWaterTargetTemperature, 'restored hot water target');
  }

  return {
    id: 'target_write_restore',
    passed: changedHeating === heatingTarget &&
      changedHotWater === hotWaterTarget &&
      restoredHeating === baseline.heatingTargetTemperature &&
      restoredHotWater === baseline.hotWaterTargetTemperature,
    details: {
      baselineHeating: baseline.heatingTargetTemperature,
      baselineHotWater: baseline.hotWaterTargetTemperature,
      heatingTarget,
      hotWaterTarget,
      changedHeating,
      changedHotWater,
      restoredHeating,
      restoredHotWater,
    },
  };
}

async function checkToggles(
  client: GreeVersatiClient,
  device: BoundGreeVersatiDevice,
  baseline: Baseline,
  toggleIds: ToggleId[],
  settleMs: number,
): Promise<LiveCheck[]> {
  const checks: LiveCheck[] = [];

  for (const id of toggleIds) {
    const toggle = TOGGLES[id];
    const original = baseline.toggles[id];
    const target = !original;
    let changed = original;
    let restored = original;

    try {
      await toggle.write(client, device, target);
      await delay(settleMs);
      changed = toggle.read(await client.getState(device));
    } finally {
      await toggle.write(client, device, original);
      await delay(settleMs);
      restored = toggle.read(await client.getState(device));
    }

    checks.push({
      id: `toggle_${id}_write_restore`,
      passed: changed === target && restored === original,
      details: {
        label: toggle.label,
        risky: toggle.risky,
        baseline: original,
        target,
        changed,
        restored,
      },
    });
  }

  return checks;
}

function checkRestored(state: GreeVersatiState, baseline: Baseline, toggleIds: ToggleId[]): LiveCheck {
  const mode = state.mode;
  const heatingTargetTemperature = state.heatingTargetTemperature;
  const hotWaterTargetTemperature = state.hotWaterTargetTemperature;
  const toggles = Object.fromEntries(toggleIds.map((id) => [id, TOGGLES[id].read(state)])) as Record<ToggleId, boolean>;

  return {
    id: 'final_restore',
    passed: mode === baseline.mode &&
      heatingTargetTemperature === baseline.heatingTargetTemperature &&
      hotWaterTargetTemperature === baseline.hotWaterTargetTemperature &&
      toggleIds.every((id) => toggles[id] === baseline.toggles[id]),
    details: {
      mode,
      heatingTargetTemperature,
      hotWaterTargetTemperature,
      toggles,
    },
  };
}

async function restoreBaseline(
  client: GreeVersatiClient,
  device: BoundGreeVersatiDevice,
  baseline: Baseline,
  toggleIds: ToggleId[],
  settleMs: number,
): Promise<void> {
  await client.setHeatingTargetTemperature(device, baseline.heatingTargetTemperature);
  await client.setHotWaterTargetTemperature(device, baseline.hotWaterTargetTemperature);
  for (const id of toggleIds) {
    await TOGGLES[id].write(client, device, baseline.toggles[id]);
  }
  await client.setMode(device, baseline.mode);
  await delay(settleMs);
}

function baselineFromState(state: GreeVersatiState, toggleIds: ToggleId[]): Baseline {
  return {
    mode: writableModeOrThrow(state.mode),
    heatingTargetTemperature: numberOrThrow(state.heatingTargetTemperature, 'baseline heating target'),
    hotWaterTargetTemperature: numberOrThrow(state.hotWaterTargetTemperature, 'baseline hot water target'),
    toggles: Object.fromEntries(toggleIds.map((id) => [id, TOGGLES[id].read(state)])) as Record<ToggleId, boolean>,
  };
}

function writableModeOrThrow(mode: GreeVersatiState['mode']): WritableGreeVersatiMode {
  if (mode === 'off' || mode === 'heat_hot_water' || mode === 'hot_water' || mode === 'cool') {
    return mode;
  }
  throw new Error(`Live test cannot restore unsupported mode: ${mode}`);
}

function numberOrThrow(value: number | null, label: string): number {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  throw new Error(`Missing ${label}`);
}

function parseArgs(args: string[]): CliOptions {
  const options: CliOptions = {
    ip: process.env.GREE_VERSATI_IP ?? '',
    mac: normalizeMac(process.env.GREE_VERSATI_MAC ?? ''),
    port: Number(process.env.GREE_VERSATI_PORT ?? 7000),
    settleMs: Number(process.env.GREE_VERSATI_SETTLE_MS ?? 1500),
    includeRisky: false,
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    const value = args[index + 1];
    if (arg === '--ip' && value) {
      options.ip = value;
      index += 1;
    } else if (arg === '--mac' && value) {
      options.mac = normalizeMac(value);
      index += 1;
    } else if (arg === '--port' && value) {
      options.port = Number(value);
      index += 1;
    } else if (arg === '--settle-ms' && value) {
      options.settleMs = Number(value);
      index += 1;
    } else if (arg === '--include-risky') {
      options.includeRisky = true;
    } else if (arg === '--help') {
      printHelp();
      process.exit(0);
    } else {
      throw new Error(`Unknown or incomplete argument: ${arg}`);
    }
  }

  if (!options.ip || !options.mac) {
    throw new Error('Both --ip and --mac are required');
  }
  if (!Number.isInteger(options.port) || options.port <= 0 || options.port > 65535) {
    throw new Error('UDP port must be between 1 and 65535');
  }
  if (!Number.isFinite(options.settleMs) || options.settleMs < 0) {
    throw new Error('Settle time must be a non-negative number of milliseconds');
  }
  return options;
}

function normalizeMac(mac: string): string {
  return mac.replace(/[^0-9a-f]/gi, '').toLowerCase();
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function printHelp(): void {
  console.log(`Usage: npm run test:live -- --ip <address> --mac <mac> [--include-risky] [--settle-ms 1500]

Runs live write/restore checks for:
  snapshot
  mode
  heating and hot water targets
  safe toggles: rapid,silence

Optional with --include-risky:
  w_depend
  disinfect

Environment variables:
  GREE_VERSATI_IP
  GREE_VERSATI_MAC
  GREE_VERSATI_PORT
  GREE_VERSATI_SETTLE_MS
`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
