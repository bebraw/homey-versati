import { GreeVersatiClient } from '../src/lib/gree-versati-client';

interface CliOptions {
  ip: string;
  mac: string;
  port: number;
  groups: ProbeGroupId[];
  fields: string[];
  redact: boolean;
}

type ProbeGroupId = 'identity' | 'errors' | 'energy' | 'runtime' | 'grid' | 'temperatures';

interface ProbeGroup {
  id: ProbeGroupId;
  description: string;
  fields: string[];
}

interface FieldObservation {
  field: string;
  value: unknown;
  classification: 'empty' | 'zero' | 'boolean' | 'number' | 'string' | 'object';
}

const PROBE_GROUPS: Record<ProbeGroupId, ProbeGroup> = {
  identity: {
    id: 'identity',
    description: 'Model, firmware, hardware, and controller identifiers',
    fields: [
      'ModelType',
      'VersatiSeries',
      'HID',
      'IDUVer',
      'ODUVer',
      'MainVer',
      'SubVer',
      'FirmVer',
      'Firmware',
      'Version',
      'ProtocolVer',
      'WifiVer',
      'Mac',
      'Name',
      'SN',
      'Serial',
    ],
  },
  errors: {
    id: 'errors',
    description: 'Fault, alarm, protection, and warning candidates',
    fields: [
      'Err',
      'Error',
      'ErrCode',
      'ErrorCode',
      'Fault',
      'FaultCode',
      'Malfunction',
      'Alarm',
      'AlarmCode',
      'Warn',
      'Warning',
      'Protect',
      'ProtectCode',
      'Protection',
      'Defrost',
      'SyAnFroRunSta',
      'AnFrzzRunSta',
      'HighPressProtect',
      'LowPressProtect',
      'CompressorProtect',
      'WaterFlowProtect',
      'FlowSwitch',
    ],
  },
  energy: {
    id: 'energy',
    description: 'Power, energy, compressor, and consumption candidates',
    fields: [
      'Power',
      'Pow',
      'Pwr',
      'ActPow',
      'PowerInput',
      'InputPower',
      'Energy',
      'EnergyTotal',
      'TotalEnergy',
      'Consume',
      'Consumption',
      'Elec',
      'Electricity',
      'Watt',
      'kWh',
      'EHeat',
      'ECool',
      'EHotWater',
      'CompressorFreq',
      'CompFreq',
      'CompFrq',
      'CompRunTime',
      'CompressorRunTime',
      'RunTime',
    ],
  },
  runtime: {
    id: 'runtime',
    description: 'Operating state, pumps, fans, valves, and heaters',
    fields: [
      'RunSta',
      'RunState',
      'WorkSta',
      'WorkState',
      'OduRunSta',
      'IduRunSta',
      'PumpSta',
      'WaterPump',
      'WaterPumpSta',
      'FanSta',
      'FanSpeed',
      'CompressorSta',
      'CompSta',
      'FourWayValve',
      'ValveSta',
      'EXV',
      'EXVStep',
      'WatBoxElcHeRunSta',
      'ElcHe1RunSta',
      'ElcHe2RunSta',
    ],
  },
  grid: {
    id: 'grid',
    description: 'External grid, EVU, SG Ready, and tariff candidates',
    fields: [
      'EVU',
      'SgReady',
      'SGReady',
      'SmartGrid',
      'Grid',
      'GridSta',
      'Tariff',
      'LowTariff',
      'Peak',
      'Demand',
      'DemandLimit',
      'PowerLimit',
    ],
  },
  temperatures: {
    id: 'temperatures',
    description: 'Additional temperature and pressure candidates',
    fields: [
      'OutEnvTem',
      'OutdoorTemp',
      'AmbientTemp',
      'AmbientTem',
      'DischargeTemp',
      'DischTemp',
      'SuctionTemp',
      'EvapTemp',
      'CondTemp',
      'PlateTemp',
      'TankTemp',
      'WaterTemp',
      'Pressure',
      'HighPressure',
      'LowPressure',
    ],
  },
};

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const client = new GreeVersatiClient({ timeoutMs: 5000, bindTimeoutMs: 5000 });
  const bound = await client.bind({ ip: options.ip, port: options.port, mac: options.mac });
  const groups = options.groups.map((id) => PROBE_GROUPS[id]);
  const fields = unique([...groups.flatMap((group) => group.fields), ...options.fields]);
  const raw: Record<string, unknown> = {};

  for (let index = 0; index < fields.length; index += 20) {
    Object.assign(raw, await client.getRawColumns(bound, fields.slice(index, index + 20)));
  }

  const observations = Object.fromEntries(
    groups.map((group) => [
      group.id,
      {
        description: group.description,
        fields: observeFields(group.fields, raw),
      },
    ]),
  );

  console.log(JSON.stringify({
    capturedAt: new Date().toISOString(),
    device: {
      ip: redactIp(bound.ip, options.redact),
      port: bound.port,
      mac: redactMac(bound.mac, options.redact),
      encryptionVersion: bound.encryptionVersion,
    },
    groups: options.groups,
    customFields: observeFields(options.fields, raw),
    observations,
    nonEmpty: observeFields(fields, raw).filter((field) => field.classification !== 'empty'),
  }, null, 2));
}

function observeFields(fields: string[], raw: Record<string, unknown>): FieldObservation[] {
  return fields.map((field) => {
    const value = raw[field];
    return {
      field,
      value,
      classification: classifyValue(value),
    };
  });
}

function classifyValue(value: unknown): FieldObservation['classification'] {
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

function parseArgs(args: string[]): CliOptions {
  const options: CliOptions = {
    ip: process.env.GREE_VERSATI_IP ?? '',
    mac: normalizeMac(process.env.GREE_VERSATI_MAC ?? ''),
    port: Number(process.env.GREE_VERSATI_PORT ?? 7000),
    groups: ['identity', 'errors', 'energy', 'runtime', 'grid'],
    fields: [],
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
    } else if (arg === '--groups' && value) {
      options.groups = parseGroups(value);
      index += 1;
    } else if (arg === '--fields' && value) {
      options.fields = value.split(',').map((field) => field.trim()).filter(Boolean);
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
  return options;
}

function parseGroups(value: string): ProbeGroupId[] {
  const groups = value.split(',').map((group) => group.trim()).filter(Boolean);
  if (!groups.length) {
    throw new Error('At least one diagnostics group is required');
  }
  return groups.map((group) => {
    if (group in PROBE_GROUPS) {
      return group as ProbeGroupId;
    }
    throw new Error(`Unknown diagnostics group: ${group}. Use one of ${Object.keys(PROBE_GROUPS).join(', ')}`);
  });
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

function printHelp(): void {
  console.log(`Usage: npm run probe:diagnostics -- --ip <address> --mac <mac> [--groups identity,errors,energy,runtime,grid,temperatures] [--fields A,B,C] [--no-redact]

Default groups:
  identity,errors,energy,runtime,grid

Available groups:
  ${Object.keys(PROBE_GROUPS).join('\n  ')}

Environment variables:
  GREE_VERSATI_IP
  GREE_VERSATI_MAC
  GREE_VERSATI_PORT
  GREE_VERSATI_REDACT=false
`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
