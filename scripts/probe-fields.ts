import { GreeVersatiClient } from '../src/lib/gree-versati-client';

interface CliOptions {
  ip: string;
  mac: string;
  port: number;
  fields: string[];
}

const WEATHER_DEPEND_CANDIDATES = [
  'WDepend',
  'Wdepend',
  'WDep',
  'WdDep',
  'WthDep',
  'WthDepend',
  'WeatherDep',
  'WeatherDepend',
  'WeatherDependent',
  'WeaDep',
  'WeathDep',
  'WtrDep',
  'WatDep',
  'WatDepend',
  'TWeatherDepend',
  'TWeatherDep',
  'TWeaDep',
  'TWatDep',
  'TempCurve',
  'TemCurve',
  'HeatCurve',
  'HeatCur',
  'HetCurve',
  'HeaCurve',
  'WDCurve',
  'WDCur',
  'WdCur',
  'WDependSet',
  'WeatherDependSet',
  'EnWDepend',
  'SwWDepend',
  'WDepSwh',
  'WatDepSwh',
  'WeaDepSwh',
  'WthDepSwh',
  'WeatherDepSwh',
  'WDependSwh',
  'TemDepSwh',
  'TDepSwh',
  'HeatWDep',
  'HeatWDepend',
  'HeatWeatherDep',
  'HeWDep',
  'HeWeatherDep',
  'HeWeatherDepend',
  'HetWDep',
  'HetWeatherDep',
  'WthDepHeat',
  'WeatherDepHeat',
  'WeatherDependHeat',
  'TemCtrl',
  'WDepTem',
  'WDependTem',
  'WeatherDepTem',
  'WeatherDependTem',
  'WDepTemp',
  'WDependTemp',
  'WDepMod',
  'WeatherDepMod',
  'WDepMode',
  'WeatherDepMode',
  'LowTempHeat',
  'LoTempHeat',
  'CurveHeat',
  'CurHeat',
  'TemCrv',
  'HeTemCrv',
  'WdDepend',
  'WDependRunSta',
  'WeatherDepRunSta',
  'WDepRunSta',
  'WDependSta',
  'WeatherDepSta',
  'WDepSta',
];

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const client = new GreeVersatiClient({ timeoutMs: 5000, bindTimeoutMs: 5000 });
  const bound = await client.bind({ ip: options.ip, port: options.port, mac: options.mac });
  const found: Record<string, unknown> = {};
  const empty: string[] = [];

  for (let index = 0; index < options.fields.length; index += 20) {
    const fields = options.fields.slice(index, index + 20);
    const raw = await client.getRawColumns(bound, fields);
    if (!Object.keys(raw).length) {
      empty.push(...fields);
      continue;
    }
    Object.assign(found, raw);
  }

  console.log(JSON.stringify({
    capturedAt: new Date().toISOString(),
    device: {
      ip: bound.ip,
      port: bound.port,
      mac: bound.mac,
      encryptionVersion: bound.encryptionVersion,
    },
    found,
    foundCount: Object.keys(found).length,
    emptyCount: empty.length,
  }, null, 2));
}

function parseArgs(args: string[]): CliOptions {
  const options: CliOptions = {
    ip: process.env.GREE_VERSATI_IP ?? '',
    mac: normalizeMac(process.env.GREE_VERSATI_MAC ?? ''),
    port: Number(process.env.GREE_VERSATI_PORT ?? 7000),
    fields: WEATHER_DEPEND_CANDIDATES,
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
      options.fields = value.split(',').map((field) => field.trim()).filter(Boolean);
      index += 1;
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
  return options;
}

function normalizeMac(mac: string): string {
  return mac.replace(/[^0-9a-f]/gi, '').toLowerCase();
}

function printHelp(): void {
  console.log(`Usage: npm run probe:fields -- --ip <address> --mac <mac> [--fields A,B,C]`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
