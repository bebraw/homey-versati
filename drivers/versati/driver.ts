import Homey from 'homey';
import { GreeVersatiClient, type BoundGreeVersatiDevice } from '../../src/lib/gree-versati-client';

interface PairSession {
  setHandler(name: string, handler: (...args: unknown[]) => Promise<unknown> | unknown): void;
}

class GreeVersatiDriver extends Homey.Driver {
  async onInit(): Promise<void> {
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
}

function friendlyName(device: BoundGreeVersatiDevice): string {
  const rawName = device.name && !/^[0-9a-f]{8,12}$/i.test(device.name) ? device.name : undefined;
  const suffix = device.mac.replace(/[^0-9a-f]/gi, '').slice(-4).toUpperCase();
  return rawName ?? `Gree Versati${suffix ? ` ${suffix}` : ''}`;
}

module.exports = GreeVersatiDriver;
