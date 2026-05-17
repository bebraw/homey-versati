import { GreeVersatiClient, type GreeVersatiDeviceInfo } from '../src/lib/gree-versati-client';

interface CliOptions {
  ip?: string;
  mac?: string;
  port: number;
  waitMs: number;
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const client = new GreeVersatiClient({
    timeoutMs: 5000,
    bindTimeoutMs: 5000,
    broadcastAddresses: options.ip ? [options.ip] : undefined,
  });

  const discovered = options.ip && options.mac ? [] : await client.discover(options.waitMs);
  const device = pickDevice(discovered, options);
  if (!device) {
    throw new Error(
      `No matching Gree Versati found${options.mac ? ` for MAC ${options.mac}` : ''}. ` +
        'Pass --ip <address> and --mac <mac> to target a known device.',
    );
  }

  const bound = await client.bind({ ...device, port: options.port || device.port });
  const state = await client.getState(bound);

  const snapshot = {
    capturedAt: new Date().toISOString(),
    device: {
      ip: bound.ip,
      port: bound.port,
      mac: bound.mac,
      name: bound.name,
      brand: bound.brand,
      model: bound.model,
      firmware: bound.version,
      encryptionVersion: bound.encryptionVersion,
    },
    normalized: {
      power: state.power,
      mode: state.mode,
      waterOutTemperature: state.waterOutTemperature,
      waterInTemperature: state.waterInTemperature,
      hotWaterTemperature: state.hotWaterTemperature,
      optimalWaterTemperature: state.optimalWaterTemperature,
      remoteRoomTemperature: state.remoteRoomTemperature,
      heatingTargetTemperature: state.heatingTargetTemperature,
      coolingTargetTemperature: state.coolingTargetTemperature,
      hotWaterTargetTemperature: state.hotWaterTargetTemperature,
      fastHotWater: state.fastHotWater,
      silence: state.silence,
      weatherDependent: state.weatherDependent,
      disinfect: state.disinfect,
      tankHeaterActive: state.tankHeaterActive,
      defrosting: state.defrosting,
      hpHeater1Active: state.hpHeater1Active,
      hpHeater2Active: state.hpHeater2Active,
      frostProtection: state.frostProtection,
      versatiSeries: state.versatiSeries,
    },
    raw: sortObject(state.raw),
  };

  console.log(JSON.stringify(snapshot, null, 2));
}

function parseArgs(args: string[]): CliOptions {
  const options: CliOptions = {
    mac: process.env.GREE_VERSATI_MAC,
    ip: process.env.GREE_VERSATI_IP,
    port: Number(process.env.GREE_VERSATI_PORT ?? 7000),
    waitMs: Number(process.env.GREE_VERSATI_WAIT_MS ?? 4000),
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
    } else if (arg === '--wait-ms' && value) {
      options.waitMs = Number(value);
      index += 1;
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
  return options;
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

function normalizeMac(mac: string): string {
  return mac.replace(/[^0-9a-f]/gi, '').toLowerCase();
}

function sortObject(input: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(input).sort(([left], [right]) => left.localeCompare(right)));
}

function printHelp(): void {
  console.log(`Usage: npm run snapshot -- [--ip <address>] [--mac <mac>] [--port 7000] [--wait-ms 4000]

Environment variables:
  GREE_VERSATI_IP
  GREE_VERSATI_MAC
  GREE_VERSATI_PORT
  GREE_VERSATI_WAIT_MS
`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
