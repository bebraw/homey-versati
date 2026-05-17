import Homey from 'homey';
import {
  GreeVersatiClient,
  type BoundGreeVersatiDevice,
  type GreeVersatiDeviceInfo,
} from '../../src/lib/gree-versati-client';

interface PairSession {
  setHandler(name: string, handler: (...args: unknown[]) => Promise<unknown> | unknown): void;
}

interface ManualPairInput {
  ip?: unknown;
  port?: unknown;
  mac?: unknown;
}

interface FlowDevice {
  flowSetMode(mode: unknown): Promise<void>;
  flowSetHeatingTarget(temperature: unknown): Promise<void>;
  flowSetHotWaterTarget(temperature: unknown): Promise<void>;
  flowSetFastHotWater(enabled: unknown): Promise<void>;
  flowSetSilence(enabled: unknown): Promise<void>;
  flowSetWeatherDependent(enabled: unknown): Promise<void>;
  flowSetDisinfect(enabled: unknown): Promise<void>;
  flowModeIs(mode: unknown): boolean;
  flowHotWaterBelow(temperature: unknown): boolean;
  flowCapabilityIsOn(capability: string): boolean;
  flowIsReachable(): boolean;
}

class GreeVersatiDriver extends Homey.Driver {
  async onInit(): Promise<void> {
    this.registerFlowCards();
    this.log('Gree Versati driver initialized');
  }

  async onPair(session: PairSession): Promise<void> {
    const client = new GreeVersatiClient();

    session.setHandler('list_devices', async () => {
      const discovered = await client.discover();
      const boundDevices = await Promise.allSettled(discovered.map((device) => client.bind(device)));

      return boundDevices
        .filter((result): result is PromiseFulfilledResult<BoundGreeVersatiDevice> => result.status === 'fulfilled')
        .map((result) => pairDevice(result.value));
    });

    session.setHandler('manual_pair', async (input) => {
      const endpoint = manualEndpoint(input as ManualPairInput);
      const bound = await client.bind(endpoint);
      await client.getState(bound);
      return pairDevice(bound);
    });
  }

  private registerFlowCards(): void {
    this.homey.flow.getActionCard('set_mode').registerRunListener(async (args) => {
      await flowDevice(args).flowSetMode(dropdownValue(args.mode));
    });

    this.homey.flow.getActionCard('set_heating_target').registerRunListener(async (args) => {
      await flowDevice(args).flowSetHeatingTarget(numberValue(args.temperature));
    });

    this.homey.flow.getActionCard('set_hot_water_target').registerRunListener(async (args) => {
      await flowDevice(args).flowSetHotWaterTarget(numberValue(args.temperature));
    });

    this.homey.flow.getActionCard('set_rapid_hot_water').registerRunListener(async (args) => {
      await flowDevice(args).flowSetFastHotWater(dropdownValue(args.enabled));
    });

    this.homey.flow.getActionCard('set_silence').registerRunListener(async (args) => {
      await flowDevice(args).flowSetSilence(dropdownValue(args.enabled));
    });

    this.homey.flow.getActionCard('set_w_depend').registerRunListener(async (args) => {
      await flowDevice(args).flowSetWeatherDependent(dropdownValue(args.enabled));
    });

    this.homey.flow.getActionCard('set_disinfect').registerRunListener(async (args) => {
      await flowDevice(args).flowSetDisinfect(dropdownValue(args.enabled));
    });

    this.homey.flow.getConditionCard('mode_is').registerRunListener((args) => {
      return flowDevice(args).flowModeIs(dropdownValue(args.mode));
    });

    this.homey.flow.getConditionCard('hot_water_below').registerRunListener((args) => {
      return flowDevice(args).flowHotWaterBelow(numberValue(args.temperature));
    });

    this.homey.flow.getConditionCard('rapid_is_on').registerRunListener((args) => {
      return flowDevice(args).flowCapabilityIsOn('heatpump_fast_hot_water');
    });

    this.homey.flow.getConditionCard('w_depend_is_on').registerRunListener((args) => {
      return flowDevice(args).flowCapabilityIsOn('heatpump_weather_dependent');
    });

    this.homey.flow.getConditionCard('disinfect_is_on').registerRunListener((args) => {
      return flowDevice(args).flowCapabilityIsOn('heatpump_disinfect');
    });

    this.homey.flow.getConditionCard('defrosting_is_on').registerRunListener((args) => {
      return flowDevice(args).flowCapabilityIsOn('heatpump_defrosting');
    });

    this.homey.flow.getConditionCard('device_is_reachable').registerRunListener((args) => {
      return flowDevice(args).flowIsReachable();
    });
  }
}

function friendlyName(device: BoundGreeVersatiDevice): string {
  const rawName = device.name && !/^[0-9a-f]{8,12}$/i.test(device.name) ? device.name : undefined;
  const suffix = device.mac.replace(/[^0-9a-f]/gi, '').slice(-4).toUpperCase();
  return rawName ?? `Gree Versati${suffix ? ` ${suffix}` : ''}`;
}

function pairDevice(device: BoundGreeVersatiDevice): Record<string, unknown> {
  const title = friendlyName(device);
  return {
    name: title,
    data: {
      id: device.mac,
    },
    store: {
      ip: device.ip,
      port: device.port,
      mac: device.mac,
      key: device.key,
      encryptionVersion: device.encryptionVersion,
      name: title,
    },
    settings: {
      ip: device.ip,
      port: device.port,
      mac: device.mac,
      key: device.key,
      encryptionVersion: device.encryptionVersion,
    },
  };
}

function manualEndpoint(input: ManualPairInput): GreeVersatiDeviceInfo {
  const ip = cleanString(input.ip);
  const mac = normalizeMac(cleanString(input.mac));
  const port = Number(input.port || 7000);

  if (!ip) {
    throw new Error('IP address is required.');
  }
  if (!isValidIpv4(ip)) {
    throw new Error('IP address must be a valid IPv4 address.');
  }
  if (!mac || !/^[0-9a-f]{12}$/.test(mac)) {
    throw new Error('MAC address must contain 12 hexadecimal characters.');
  }
  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    throw new Error('UDP port must be between 1 and 65535.');
  }

  return {
    ip,
    port,
    mac,
  };
}

function cleanString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeMac(mac: string): string {
  return mac.replace(/[^0-9a-f]/gi, '').toLowerCase();
}

function isValidIpv4(ip: string): boolean {
  const parts = ip.split('.');
  return parts.length === 4 && parts.every((part) => {
    if (!/^\d{1,3}$/.test(part)) {
      return false;
    }
    const value = Number(part);
    return value >= 0 && value <= 255 && String(value) === String(Number(part));
  });
}

function flowDevice(args: Record<string, unknown>): FlowDevice {
  const device = args.device;
  if (!device || typeof device !== 'object') {
    throw new Error('Missing Gree Versati device');
  }
  return device as FlowDevice;
}

function dropdownValue(value: unknown): unknown {
  if (value && typeof value === 'object' && 'id' in value) {
    return (value as { id: unknown }).id;
  }
  return value;
}

function numberValue(value: unknown): number {
  if (value && typeof value === 'object' && 'value' in value) {
    return Number((value as { value: unknown }).value);
  }
  return Number(value);
}

module.exports = GreeVersatiDriver;
