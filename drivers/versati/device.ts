import Homey from 'homey';
import {
  GreeVersatiClient,
  type BoundGreeVersatiDevice,
  type GreeVersatiState,
} from '../../src/lib/gree-versati-client';

const POLL_INTERVAL_MS = 30_000;

type VersatiSettings = BoundGreeVersatiDevice & {
  name?: string;
};

class GreeVersatiDevice extends Homey.Device {
  private client?: GreeVersatiClient;
  private pollTimer?: NodeJS.Timeout;

  async onInit(): Promise<void> {
    this.client = new GreeVersatiClient();
    await this.refreshState().catch((error) => {
      this.error('Initial Gree Versati refresh failed', error);
      return this.setUnavailable('Could not read heat pump state yet');
    });
    this.pollTimer = this.homey.setInterval(() => {
      this.refreshState().catch((error) => this.error('Failed to refresh Gree Versati state', error));
    }, POLL_INTERVAL_MS);
  }

  async onDeleted(): Promise<void> {
    if (this.pollTimer) {
      this.homey.clearInterval(this.pollTimer);
      this.pollTimer = undefined;
    }
  }

  private async refreshState(): Promise<void> {
    const state = await this.clientOrThrow().getState(this.boundDevice());
    await this.setAvailable();
    await this.applyCapabilities(state);
  }

  private async applyCapabilities(state: GreeVersatiState): Promise<void> {
    await this.setCapabilityIfPresent('measure_temperature_water_out', state.waterOutTemperature);
    await this.setCapabilityIfPresent('measure_temperature_water_in', state.waterInTemperature);
    await this.setCapabilityIfPresent('measure_temperature_hot_water', state.hotWaterTemperature);
    await this.setCapabilityIfPresent('target_temperature_heating', state.heatingTargetTemperature);
    await this.setCapabilityIfPresent('target_temperature_cooling', state.coolingTargetTemperature);
    await this.setCapabilityIfPresent('target_temperature_hot_water', state.hotWaterTargetTemperature);
    await this.setCapabilityIfPresent('heatpump_power', state.power);
    await this.setCapabilityIfPresent('heatpump_mode', state.mode);
    await this.setCapabilityIfPresent('heatpump_fast_hot_water', state.fastHotWater);
    await this.setCapabilityIfPresent('heatpump_defrosting', state.defrosting);
    await this.setCapabilityIfPresent('heatpump_tank_heater', state.tankHeaterActive);
    await this.setCapabilityIfPresent('heatpump_frost_protection', state.frostProtection);
  }

  private async setCapabilityIfPresent(capability: string, value: boolean | number | string | null): Promise<void> {
    if (value === null || !this.hasCapability(capability)) {
      return;
    }
    await this.setCapabilityValue(capability, value).catch((error) => {
      this.error(`Failed to set ${capability}`, error);
    });
  }

  private boundDevice(): BoundGreeVersatiDevice {
    const stored = this.getStore() as Partial<VersatiSettings>;
    if (!stored.ip || !stored.port || !stored.mac || !stored.key || !stored.encryptionVersion) {
      throw new Error('Gree Versati device is missing pairing store data');
    }
    return {
      ip: stored.ip,
      port: Number(stored.port),
      mac: stored.mac,
      key: stored.key,
      encryptionVersion: Number(stored.encryptionVersion) === 2 ? 2 : 1,
      name: stored.name,
    };
  }

  private clientOrThrow(): GreeVersatiClient {
    if (!this.client) {
      throw new Error('Gree Versati client is not initialized');
    }
    return this.client;
  }
}

module.exports = GreeVersatiDevice;
