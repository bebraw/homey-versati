import fs from 'node:fs/promises';
import readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import {
  GreeVersatiClient,
  type BoundGreeVersatiDevice,
  type GreeVersatiDeviceInfo,
  type GreeVersatiState,
} from '../src/lib/gree-versati-client';

interface CliOptions {
  ip?: string;
  mac?: string;
  port: number;
  waitMs: number;
  modes: ProbeMode[];
  output?: string;
  redact: boolean;
}

interface Snapshot {
  capturedAt: string;
  normalized: {
    power: boolean;
    mode: GreeVersatiState['mode'];
    heatingTargetTemperature: number | null;
    coolingTargetTemperature: number | null;
    hotWaterTargetTemperature: number | null;
    fastHotWater: boolean;
    silence: boolean;
    weatherDependent: boolean;
    disinfect: boolean;
  };
  raw: Record<string, unknown>;
}

interface ModeObservation {
  id: ProbeMode;
  label: string;
  before: Snapshot;
  after: Snapshot;
  changedFields: Record<string, { before: unknown; after: unknown }>;
}

interface ProbeReport {
  capturedAt: string;
  device: {
    ip: string;
    port: number;
    mac: string;
    name?: string;
    brand?: string;
    model?: string;
    firmware?: string;
    encryptionVersion: number;
  };
  fields: readonly string[];
  guidance: string[];
  baseline: Snapshot;
  observations: ModeObservation[];
  restored: Snapshot;
  restoreChangedFields: Record<string, { before: unknown; after: unknown }>;
}

type ProbeMode = 'cool' | 'cool_hot_water';

const DEFAULT_MODES: ProbeMode[] = ['cool', 'cool_hot_water'];
const RAW_MODE_FIELDS = [
  'Pow',
  'Mod',
  'CoWatOutTemSet',
  'HeWatOutTemSet',
  'WatBoxTemSet',
  'ColHtWter',
  'HetHtWter',
  'FastHtWter',
  'Quiet',
  'SvSt',
  'SwDisFct',
] as const;
const MODE_LABELS: Record<ProbeMode, string> = {
  cool: 'Cool',
  cool_hot_water: 'Cool + hot water',
};

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const clientOptions: ConstructorParameters<typeof GreeVersatiClient>[0] = {
    timeoutMs: 5000,
    bindTimeoutMs: 5000,
  };
  if (options.ip) {
    clientOptions.broadcastAddresses = [options.ip];
  }

  const client = new GreeVersatiClient(clientOptions);
  const discovered = options.ip && options.mac ? [] : await client.discover(options.waitMs);
  const device = pickDevice(discovered, options);
  if (!device) {
    throw new Error(
      `No matching Gree Versati found${options.mac ? ` for MAC ${options.mac}` : ''}. ` +
        'Pass --ip <address> and --mac <mac> to target a known device.',
    );
  }

  const bound = await client.bind({ ...device, port: options.port || device.port });
  const rl = readline.createInterface({ input, output });
  const observations: ModeObservation[] = [];

  try {
    const baseline = await captureSnapshot(client, bound);
    console.error(`Baseline mode: ${baseline.normalized.mode}`);

    for (const mode of options.modes) {
      const before = await captureSnapshot(client, bound);
      await rl.question(`Switch the heat pump to ${MODE_LABELS[mode]} in the Gree app/controller, wait for it to apply, then press Enter.`);
      const after = await captureSnapshot(client, bound);
      observations.push({
        id: mode,
        label: MODE_LABELS[mode],
        before,
        after,
        changedFields: changedFields(before, after),
      });
      console.error(`Captured ${MODE_LABELS[mode]} as normalized mode: ${after.normalized.mode}`);
    }

    await rl.question(`Restore the previous mode (${baseline.normalized.mode}) in the Gree app/controller, wait for it to apply, then press Enter.`);
    const restored = await captureSnapshot(client, bound);

    const reportDevice: ProbeReport['device'] = {
      ip: redactIp(bound.ip, options.redact),
      port: bound.port,
      mac: redactMac(bound.mac, options.redact),
      encryptionVersion: bound.encryptionVersion,
    };
    if (bound.name) reportDevice.name = bound.name;
    if (bound.brand) reportDevice.brand = bound.brand;
    if (bound.model) reportDevice.model = bound.model;
    if (bound.version) reportDevice.firmware = bound.version;

    const report: ProbeReport = {
      capturedAt: new Date().toISOString(),
      device: reportDevice,
      fields: RAW_MODE_FIELDS,
      guidance: [
        'This script is read-only; all mode changes are made externally.',
        'Use changedFields to confirm which raw status fields distinguish each cooling mode.',
        'Run again with --no-redact only for private debugging output.',
      ],
      baseline,
      observations,
      restored,
      restoreChangedFields: changedFields(baseline, restored),
    };
    await writeReport(report, options);
  } finally {
    rl.close();
  }
}

async function writeReport(report: ProbeReport, options: CliOptions): Promise<void> {
  const serialized = `${JSON.stringify(report, null, 2)}\n`;
  if (!options.output) {
    console.log(serialized);
    return;
  }
  await fs.writeFile(options.output, serialized, 'utf8');
  console.error(`Wrote redacted mode probe report to ${options.output}`);
}

async function captureSnapshot(client: GreeVersatiClient, device: BoundGreeVersatiDevice): Promise<Snapshot> {
  const state = await client.getState(device);
  const raw = await client.getRawColumns(device, RAW_MODE_FIELDS);

  return {
    capturedAt: new Date().toISOString(),
    normalized: {
      power: state.power,
      mode: state.mode,
      heatingTargetTemperature: state.heatingTargetTemperature,
      coolingTargetTemperature: state.coolingTargetTemperature,
      hotWaterTargetTemperature: state.hotWaterTargetTemperature,
      fastHotWater: state.fastHotWater,
      silence: state.silence,
      weatherDependent: state.weatherDependent,
      disinfect: state.disinfect,
    },
    raw: sortObject(raw),
  };
}

function changedFields(before: Snapshot, after: Snapshot): Record<string, { before: unknown; after: unknown }> {
  const beforeFlat = flattenSnapshot(before);
  const afterFlat = flattenSnapshot(after);
  const keys = [...new Set([...Object.keys(beforeFlat), ...Object.keys(afterFlat)])].sort();
  const changes: Record<string, { before: unknown; after: unknown }> = {};

  for (const key of keys) {
    const beforeValue = beforeFlat[key];
    const afterValue = afterFlat[key];
    if (stableValue(beforeValue) !== stableValue(afterValue)) {
      changes[key] = { before: beforeValue, after: afterValue };
    }
  }

  return changes;
}

function flattenSnapshot(snapshot: Snapshot): Record<string, unknown> {
  return {
    ...Object.fromEntries(Object.entries(snapshot.normalized).map(([key, value]) => [`normalized.${key}`, value])),
    ...Object.fromEntries(Object.entries(snapshot.raw).map(([key, value]) => [`raw.${key}`, value])),
  };
}

function parseArgs(args: string[]): CliOptions {
  const options: CliOptions = {
    port: Number(process.env.GREE_VERSATI_PORT ?? 7000),
    waitMs: Number(process.env.GREE_VERSATI_WAIT_MS ?? 4000),
    modes: [...DEFAULT_MODES],
    redact: process.env.GREE_VERSATI_REDACT !== 'false',
  };
  if (process.env.GREE_VERSATI_MAC) {
    options.mac = normalizeMac(process.env.GREE_VERSATI_MAC);
  }
  if (process.env.GREE_VERSATI_IP) {
    options.ip = process.env.GREE_VERSATI_IP;
  }

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
    } else if (arg === '--wait-ms' && value) {
      options.waitMs = Number(value);
      index += 1;
    } else if (arg === '--modes' && value) {
      options.modes = parseModes(value);
      index += 1;
    } else if (arg === '--output' && value) {
      options.output = value;
      index += 1;
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

  if (options.mac) {
    options.mac = normalizeMac(options.mac);
  }
  if (!Number.isInteger(options.port) || options.port <= 0 || options.port > 65535) {
    throw new Error('UDP port must be between 1 and 65535');
  }
  if (!Number.isInteger(options.waitMs) || options.waitMs < 0) {
    throw new Error('--wait-ms must be a non-negative integer');
  }
  if (!options.modes.length) {
    throw new Error('At least one mode is required');
  }

  return options;
}

function parseModes(value: string): ProbeMode[] {
  const modes = value.split(',').map((mode) => mode.trim()).filter(Boolean);
  const parsed = modes.map((mode) => {
    if (mode !== 'cool' && mode !== 'cool_hot_water') {
      throw new Error(`Unsupported mode probe: ${mode}`);
    }
    return mode;
  });
  return [...new Set(parsed)];
}

function pickDevice(devices: GreeVersatiDeviceInfo[], options: CliOptions): GreeVersatiDeviceInfo | undefined {
  if (options.ip && options.mac) {
    return {
      ip: options.ip,
      port: options.port,
      mac: options.mac,
    };
  }
  if (options.mac) {
    return devices.find((device) => normalizeMac(device.mac) === options.mac);
  }
  if (options.ip) {
    return devices.find((device) => device.ip === options.ip) ?? devices[0];
  }
  if (devices.length === 1) {
    return devices[0];
  }
  if (devices.length > 1) {
    throw new Error(`Multiple devices found. Re-run with --mac. Found: ${devices.map((device) => device.mac).join(', ')}`);
  }
  return undefined;
}

function sortObject(input: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(input).sort(([left], [right]) => left.localeCompare(right)));
}

function stableValue(value: unknown): string {
  return JSON.stringify(value);
}

function normalizeMac(mac: string): string {
  return mac.replace(/[^0-9a-f]/gi, '').toLowerCase();
}

function redactMac(mac: string, redact: boolean): string {
  return redact ? `********${normalizeMac(mac).slice(-4)}` : mac;
}

function redactIp(ip: string, redact: boolean): string {
  return redact ? '<redacted-ip>' : ip;
}

function printHelp(): void {
  console.log(`Usage: npm run probe:modes -- [--ip <address>] [--mac <mac>] [--port 7000] [--modes cool,cool_hot_water] [--output report.json] [--no-redact]

Workflow:
  1. Run the script while the heat pump is in its normal mode.
  2. When prompted, change the mode externally in the Gree app or indoor controller.
  3. Press Enter after each external change has applied.
  4. Restore the previous mode when prompted.

Environment variables:
  GREE_VERSATI_IP
  GREE_VERSATI_MAC
  GREE_VERSATI_PORT
  GREE_VERSATI_WAIT_MS
  GREE_VERSATI_REDACT=false
`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
