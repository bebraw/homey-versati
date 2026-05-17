import {
  GreeVersatiClient,
  type BoundGreeVersatiDevice,
  type GreeVersatiState,
} from '../src/lib/gree-versati-client';

type ToggleId = 'rapid' | 'silence' | 'w_depend' | 'disinfect';

interface ToggleDefinition {
  id: ToggleId;
  label: string;
  risky: boolean;
  read(state: GreeVersatiState): boolean;
  write(client: GreeVersatiClient, device: BoundGreeVersatiDevice, enabled: boolean): Promise<void>;
}

interface CliOptions {
  ip: string;
  mac: string;
  port: number;
  toggles: ToggleId[];
  settleMs: number;
  redact: boolean;
}

interface ToggleObservation {
  id: ToggleId;
  baseline: boolean;
  changed: boolean;
  restored: boolean;
  passed: boolean;
}

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
  const client = new GreeVersatiClient({ timeoutMs: 5000, bindTimeoutMs: 5000 });
  const bound = await client.bind({ ip: options.ip, port: options.port, mac: options.mac });
  const baseline = await client.getState(bound);
  const baselineValues = Object.fromEntries(
    options.toggles.map((id) => [id, TOGGLES[id].read(baseline)]),
  ) as Record<ToggleId, boolean>;

  const observations: ToggleObservation[] = [];

  try {
    for (const id of options.toggles) {
      const toggle = TOGGLES[id];
      const original = baselineValues[id];
      const target = !original;
      let changed = original;
      let restored = original;

      try {
        await toggle.write(client, bound, target);
        await delay(options.settleMs);
        changed = toggle.read(await client.getState(bound));
      } finally {
        await toggle.write(client, bound, original);
        await delay(options.settleMs);
        restored = toggle.read(await client.getState(bound));
      }

      observations.push({
        id,
        baseline: original,
        changed,
        restored,
        passed: changed === target && restored === original,
      });
    }
  } finally {
    await restoreAll(client, bound, baselineValues, options.settleMs);
  }

  const finalState = await client.getState(bound);
  const finalValues = Object.fromEntries(
    options.toggles.map((id) => [id, TOGGLES[id].read(finalState)]),
  ) as Record<ToggleId, boolean>;
  const passed = observations.every((observation) => observation.passed) &&
    options.toggles.every((id) => finalValues[id] === baselineValues[id]);

  console.log(JSON.stringify({
    capturedAt: new Date().toISOString(),
    device: {
      ip: redactIp(bound.ip, options.redact),
      port: bound.port,
      mac: redactMac(bound.mac, options.redact),
      encryptionVersion: bound.encryptionVersion,
    },
    toggles: options.toggles.map((id) => ({
      id,
      label: TOGGLES[id].label,
      risky: TOGGLES[id].risky,
    })),
    observations,
    finalValues,
    passed,
  }, null, 2));

  if (!passed) {
    process.exitCode = 1;
  }
}

async function restoreAll(
  client: GreeVersatiClient,
  device: BoundGreeVersatiDevice,
  baselineValues: Record<ToggleId, boolean>,
  settleMs: number,
): Promise<void> {
  for (const id of Object.keys(baselineValues) as ToggleId[]) {
    await TOGGLES[id].write(client, device, baselineValues[id]);
    await delay(settleMs);
  }
}

function parseArgs(args: string[]): CliOptions {
  const options: CliOptions = {
    ip: process.env.GREE_VERSATI_IP ?? '',
    mac: normalizeMac(process.env.GREE_VERSATI_MAC ?? ''),
    port: Number(process.env.GREE_VERSATI_PORT ?? 7000),
    toggles: ['rapid', 'silence'],
    settleMs: Number(process.env.GREE_VERSATI_SETTLE_MS ?? 1500),
    redact: process.env.GREE_VERSATI_REDACT !== 'false',
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
    } else if (arg === '--toggles' && value) {
      options.toggles = parseToggleList(value);
      index += 1;
    } else if (arg === '--all') {
      options.toggles = ['rapid', 'silence', 'w_depend', 'disinfect'];
    } else if (arg === '--redact') {
      options.redact = true;
    } else if (arg === '--no-redact') {
      options.redact = false;
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

function parseToggleList(value: string): ToggleId[] {
  const toggles = value.split(',').map((item) => item.trim()).filter(Boolean);
  if (!toggles.length) {
    throw new Error('At least one toggle is required');
  }
  return toggles.map((toggle) => {
    if (toggle in TOGGLES) {
      return toggle as ToggleId;
    }
    throw new Error(`Unknown toggle: ${toggle}. Use one of ${Object.keys(TOGGLES).join(', ')}`);
  });
}

function normalizeMac(mac: string): string {
  return mac.replace(/[^0-9a-f]/gi, '').toLowerCase();
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function redactMac(mac: string, redact: boolean): string {
  return redact ? `********${normalizeMac(mac).slice(-4)}` : mac;
}

function redactIp(ip: string, redact: boolean): string {
  return redact ? '<redacted-ip>' : ip;
}

function printHelp(): void {
  console.log(`Usage: npm run smoke:toggles -- --ip <address> --mac <mac> [--toggles rapid,silence] [--all] [--settle-ms 1500] [--no-redact]

Default toggles:
  rapid,silence

Available toggles:
  rapid
  silence
  w_depend
  disinfect

Environment variables:
  GREE_VERSATI_IP
  GREE_VERSATI_MAC
  GREE_VERSATI_PORT
  GREE_VERSATI_SETTLE_MS
  GREE_VERSATI_REDACT=false
`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
