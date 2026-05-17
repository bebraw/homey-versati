import { GreeVersatiClient } from '../src/lib/gree-versati-client';

interface CliOptions {
  ip: string;
  mac: string;
  port: number;
  fields: string[];
  intervalMs: number;
  samples: number;
  redact: boolean;
}

interface FieldObservation {
  field: string;
  values: unknown[];
  changed: boolean;
  classification: 'empty' | 'zero' | 'boolean' | 'number' | 'string' | 'object' | 'mixed';
}

const DEFAULT_INTERVAL_MS = 15_000;
const DEFAULT_SAMPLES = 2;
const MAX_COLUMNS_PER_REQUEST = 20;

const WEATHER_CURVE_FIELDS = [
  'SvSt',
  'WdMod',
  'WDepend',
  'WDependMode',
  'WeatherDepend',
  'WeatherDependent',
  'WeatherCurve',
  'WCur',
  'Curve',
  'CurveSet',
  'HeatCurve',
  'HeCurve',
  'HeatCur',
  'HeCur',
  'HCur',
  'HC',
  'WeatherCurveHe',
  'HeWeatherCurve',
  'HeWeatherDepend',
  'HeWDepend',
  'HeWD',
  'HeWatCurve',
  'HeWatCurveSet',
  'HeWatOutCurve',
  'HeWatOutTemCurve',
  'HeWatOutTemSet',
  'HeWatOutTemSetMin',
  'HeWatOutTemSetMax',
  'HeWatOutTemMin',
  'HeWatOutTemMax',
  'HeWatOutTemHi',
  'HeWatOutTemLo',
  'HeatWatOutTemMin',
  'HeatWatOutTemMax',
  'HeatWatOutTemSetMin',
  'HeatWatOutTemSetMax',
  'OutEnvTem',
  'OutdoorTemp',
  'AmbientTemp',
  'AmbientTem',
  'LowOutTemp',
  'HighOutTemp',
  'OutTempLow',
  'OutTempHigh',
  'OTLow',
  'OTHigh',
  'CurveLowOutTemp',
  'CurveHighOutTemp',
  'CurveLowWaterTemp',
  'CurveHighWaterTemp',
  'LowWaterTemp',
  'HighWaterTemp',
  'WaterTempLow',
  'WaterTempHigh',
  'WTLow',
  'WTHigh',
  'RoomTempSet',
  'RmoHomTemSet',
  'RoomTemSet',
  'TargetRoomTemp',
  'Offset',
  'CurveOffset',
  'WeatherOffset',
  'HeCurveOffset',
  'Compensation',
  'TempCompensation',
  'HeTempCompensation',
  'Shift',
  'CurveShift',
  'ParallelShift',
  'Slope',
  'CurveSlope',
  'HeatCurveSlope',
  'HeCurveSlope',
  'K',
] as const;

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const client = new GreeVersatiClient({ timeoutMs: 5000, bindTimeoutMs: 5000 });
  const bound = await client.bind({ ip: options.ip, port: options.port, mac: options.mac });
  const samples: Array<Record<string, unknown>> = [];

  for (let sampleIndex = 0; sampleIndex < options.samples; sampleIndex += 1) {
    samples.push(await readFields(client, bound, options.fields));
    if (sampleIndex < options.samples - 1) {
      await delay(options.intervalMs);
    }
  }

  const observations = observeFields(options.fields, samples);
  const changed = observations.filter((observation) => observation.changed);
  const nonEmpty = observations.filter((observation) => observation.classification !== 'empty');

  console.log(JSON.stringify({
    capturedAt: new Date().toISOString(),
    device: {
      ip: redactIp(bound.ip, options.redact),
      port: bound.port,
      mac: redactMac(bound.mac, options.redact),
      encryptionVersion: bound.encryptionVersion,
    },
    sampleCount: samples.length,
    intervalMs: options.intervalMs,
    fields: options.fields,
    changed,
    nonEmpty,
    observations,
    guidance: [
      'Capture a baseline, change one weather-curve setting externally, then capture again.',
      'Fields in changed are the best mapping candidates.',
      'Fields in nonEmpty may still be useful if they remain static during this run.',
    ],
  }, null, 2));
}

async function readFields(
  client: GreeVersatiClient,
  device: Parameters<GreeVersatiClient['getRawColumns']>[0],
  fields: string[],
): Promise<Record<string, unknown>> {
  const raw: Record<string, unknown> = {};
  for (let index = 0; index < fields.length; index += MAX_COLUMNS_PER_REQUEST) {
    Object.assign(raw, await client.getRawColumns(device, fields.slice(index, index + MAX_COLUMNS_PER_REQUEST)));
  }
  return raw;
}

function observeFields(fields: string[], samples: Array<Record<string, unknown>>): FieldObservation[] {
  return fields.map((field) => {
    const values = samples.map((sample) => sample[field]);
    return {
      field,
      values,
      changed: new Set(values.map(stableValue)).size > 1,
      classification: classifyValues(values),
    };
  });
}

function classifyValues(values: unknown[]): FieldObservation['classification'] {
  const classifications = new Set(values.map(classifyValue));
  if (classifications.size === 1) {
    const [classification] = [...classifications];
    return classification ?? 'empty';
  }
  return 'mixed';
}

function classifyValue(value: unknown): Exclude<FieldObservation['classification'], 'mixed'> {
  if (value === '' || value === undefined || value === null) {
    return 'empty';
  }
  if (value === 0) {
    return 'zero';
  }
  if (value === 1 || value === true || value === false) {
    return 'boolean';
  }
  if (typeof value === 'number') {
    return 'number';
  }
  if (typeof value === 'string') {
    return 'string';
  }
  return 'object';
}

function stableValue(value: unknown): string {
  return JSON.stringify(value);
}

function parseArgs(args: string[]): CliOptions {
  const options: CliOptions = {
    ip: process.env.GREE_VERSATI_IP ?? '',
    mac: normalizeMac(process.env.GREE_VERSATI_MAC ?? ''),
    port: Number(process.env.GREE_VERSATI_PORT ?? 7000),
    fields: [...WEATHER_CURVE_FIELDS],
    intervalMs: Number(process.env.GREE_VERSATI_INTERVAL_MS ?? DEFAULT_INTERVAL_MS),
    samples: Number(process.env.GREE_VERSATI_SAMPLES ?? DEFAULT_SAMPLES),
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
    } else if (arg === '--fields' && value) {
      options.fields = unique([...options.fields, ...value.split(',').map((field) => field.trim()).filter(Boolean)]);
      index += 1;
    } else if (arg === '--only-fields' && value) {
      options.fields = unique(value.split(',').map((field) => field.trim()).filter(Boolean));
      index += 1;
    } else if (arg === '--interval-ms' && value) {
      options.intervalMs = Number(value);
      index += 1;
    } else if (arg === '--samples' && value) {
      options.samples = Number(value);
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

  if (!options.ip || !options.mac) {
    throw new Error('Both --ip and --mac are required');
  }
  if (!Number.isInteger(options.port) || options.port <= 0 || options.port > 65535) {
    throw new Error('UDP port must be between 1 and 65535');
  }
  if (!Number.isInteger(options.samples) || options.samples < 1) {
    throw new Error('--samples must be a positive integer');
  }
  if (!Number.isInteger(options.intervalMs) || options.intervalMs < 0) {
    throw new Error('--interval-ms must be a non-negative integer');
  }
  if (!options.fields.length) {
    throw new Error('At least one field is required');
  }

  return options;
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
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

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function printHelp(): void {
  console.log(`Usage: npm run probe:weather-curve -- --ip <address> --mac <mac> [--samples 2] [--interval-ms 15000] [--fields A,B,C] [--only-fields A,B,C] [--no-redact]

Workflow:
  1. Start with two samples and a long enough interval to change one curve setting externally.
  2. Run this script.
  3. Change one weather-dependent curve value in the official/controller UI between samples.
  4. Inspect the "changed" output.

Environment variables:
  GREE_VERSATI_IP
  GREE_VERSATI_MAC
  GREE_VERSATI_PORT
  GREE_VERSATI_INTERVAL_MS
  GREE_VERSATI_SAMPLES
  GREE_VERSATI_REDACT=false
`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
