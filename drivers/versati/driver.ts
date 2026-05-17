import Homey from 'homey';
import { GreeVersatiClient, type BoundGreeVersatiDevice } from '../../src/lib/gree-versati-client';

interface PairSession {
  setHandler(name: string, handler: (...args: unknown[]) => Promise<unknown> | unknown): void;
}

interface FlowDevice {
  flowSetMode(mode: unknown): Promise<void>;
  flowSetHeatingTarget(temperature: unknown): Promise<void>;
  flowSetHotWaterTarget(temperature: unknown): Promise<void>;
  flowModeIs(mode: unknown): boolean;
  flowHotWaterBelow(temperature: unknown): boolean;
  flowCapabilityIsOn(capability: string): boolean;
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
        .map((result) => {
          const device = result.value;
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
          };
      });
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
  }
}

function friendlyName(device: BoundGreeVersatiDevice): string {
  const rawName = device.name && !/^[0-9a-f]{8,12}$/i.test(device.name) ? device.name : undefined;
  const suffix = device.mac.replace(/[^0-9a-f]/gi, '').slice(-4).toUpperCase();
  return rawName ?? `Gree Versati${suffix ? ` ${suffix}` : ''}`;
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
