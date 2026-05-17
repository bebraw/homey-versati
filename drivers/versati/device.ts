import Homey from 'homey';
import {
  GreeVersatiClient,
  HEATING_TARGET_MAX,
  HEATING_TARGET_MIN,
  HOT_WATER_TARGET_MAX,
  HOT_WATER_TARGET_MIN,
  type BoundGreeVersatiDevice,
  type GreeVersatiState,
  type WritableGreeVersatiMode,
} from '../../src/lib/gree-versati-client';

const POLL_INTERVAL_MS = 30_000;
const MIN_POLL_INTERVAL_MS = 15_000;
const MAX_POLL_INTERVAL_MS = 300_000;
const UNAVAILABLE_AFTER_FAILURES = 3;
const FLOW_TRIGGER_TOKENS: Record<string, string> = {
  measure_temperature_hot_water: 'measure_temperature_hot_water',
  target_temperature_heating: 'target_temperature_heating',
  target_temperature_hot_water: 'target_temperature_hot_water',
  heatpump_mode: 'heatpump_mode',
};
const BOOLEAN_FLOW_TRIGGER_IDS: Record<string, { true: string; false: string }> = {
  heatpump_defrosting: {
    true: 'heatpump_defrosting_true',
    false: 'heatpump_defrosting_false',
  },
  heatpump_fast_hot_water: {
    true: 'heatpump_fast_hot_water_true',
    false: 'heatpump_fast_hot_water_false',
  },
  heatpump_weather_dependent: {
    true: 'heatpump_weather_dependent_true',
    false: 'heatpump_weather_dependent_false',
  },
  heatpump_disinfect: {
    true: 'heatpump_disinfect_true',
    false: 'heatpump_disinfect_false',
  },
  heatpump_evu: {
    true: 'heatpump_evu_true',
    false: 'heatpump_evu_false',
  },
};

type VersatiSettings = BoundGreeVersatiDevice & {
  name?: string;
  pollInterval?: number;
};

type SettingsValue = boolean | string | number | undefined | null;

interface SettingsEvent {
  oldSettings: Record<string, SettingsValue>;
  newSettings: Record<string, SettingsValue>;
  changedKeys: string[];
};

class GreeVersatiDevice extends Homey.Device {
  private client?: GreeVersatiClient;
  private pollTimer: NodeJS.Timeout | undefined;
  private consecutiveFailures = 0;
  private reachable = true;

  async onInit(): Promise<void> {
    this.client = new GreeVersatiClient();
    await this.syncSettingsFromStore();
    this.registerCapabilityListener('heatpump_mode', async (value) => {
      await this.setModeFromHomey(value);
    });
    this.registerCapabilityListener('target_temperature_heating', async (value) => {
      await this.setHeatingTargetFromHomey(value);
    });
    this.registerCapabilityListener('target_temperature_hot_water', async (value) => {
      await this.setHotWaterTargetFromHomey(value);
    });
    this.registerCapabilityListener('heatpump_fast_hot_water', async (value) => {
      await this.setFastHotWaterFromHomey(value);
    });
    this.registerCapabilityListener('heatpump_silence', async (value) => {
      await this.setSilenceFromHomey(value);
    });
    this.registerCapabilityListener('heatpump_weather_dependent', async (value) => {
      await this.setWeatherDependentFromHomey(value);
    });
    this.registerCapabilityListener('heatpump_disinfect', async (value) => {
      await this.setDisinfectFromHomey(value);
    });
    await this.refreshState().catch((error) => this.handleRefreshFailure(error, true));
    this.pollTimer = this.homey.setInterval(() => {
      this.refreshState().catch((error) => this.handleRefreshFailure(error, false));
    }, this.pollIntervalMs());
  }

  async onDeleted(): Promise<void> {
    if (this.pollTimer) {
      this.homey.clearInterval(this.pollTimer);
      this.pollTimer = undefined;
    }
  }

  async onSettings({ newSettings, changedKeys }: SettingsEvent): Promise<string | void> {
    if (!changedKeys.some((key) => ['ip', 'port', 'mac', 'key', 'encryptionVersion', 'pollInterval'].includes(key))) {
      return;
    }

    const endpoint = endpointFromSettings(newSettings);
    const client = this.clientOrThrow();
    let bound: BoundGreeVersatiDevice;

    if (endpoint.key) {
      bound = {
        ip: endpoint.ip,
        port: endpoint.port,
        mac: endpoint.mac,
        key: endpoint.key,
        encryptionVersion: endpoint.encryptionVersion,
      };
      await client.getState(bound);
    } else {
      bound = await client.bind(endpoint);
      await client.getState(bound);
    }

    await this.persistEndpoint(bound);
    this.consecutiveFailures = 0;
    await this.refreshState();
    return 'Gree Versati connection updated.';
  }

  async flowSetMode(mode: unknown): Promise<void> {
    await this.setModeFromHomey(mode);
  }

  async flowSetHeatingTarget(temperature: unknown): Promise<void> {
    await this.setHeatingTargetFromHomey(temperature);
  }

  async flowSetHotWaterTarget(temperature: unknown): Promise<void> {
    await this.setHotWaterTargetFromHomey(temperature);
  }

  async flowSetFastHotWater(enabled: unknown): Promise<void> {
    await this.setFastHotWaterFromHomey(enabled);
  }

  async flowSetSilence(enabled: unknown): Promise<void> {
    await this.setSilenceFromHomey(enabled);
  }

  async flowSetWeatherDependent(enabled: unknown): Promise<void> {
    await this.setWeatherDependentFromHomey(enabled);
  }

  async flowSetDisinfect(enabled: unknown): Promise<void> {
    await this.setDisinfectFromHomey(enabled);
  }

  flowModeIs(mode: unknown): boolean {
    return this.getCapabilityValue('heatpump_mode') === mode;
  }

  flowHotWaterBelow(temperature: unknown): boolean {
    const threshold = Number(temperature);
    const current = this.getCapabilityValue('measure_temperature_hot_water');
    return Number.isFinite(threshold) && typeof current === 'number' && current < threshold;
  }

  flowCapabilityIsOn(capability: string): boolean {
    return this.getCapabilityValue(capability) === true;
  }

  flowIsReachable(): boolean {
    return this.reachable;
  }

  private async refreshState(): Promise<void> {
    const device = this.boundDevice();
    const state = await this.clientOrThrow().getState(device);
    await this.applyState(device, state);
  }

  private async applyState(device: BoundGreeVersatiDevice, state: GreeVersatiState): Promise<void> {
    const wasReachable = this.reachable;
    this.consecutiveFailures = 0;
    await this.applyCapabilities(state);
    await this.updateDiagnostics(device, state);
    await this.setAvailable();
    this.reachable = true;
    if (!wasReachable) {
      await this.triggerDeviceAvailable();
    }
  }

  private async applyCapabilities(state: GreeVersatiState): Promise<void> {
    await this.setCapabilityIfPresent('measure_temperature_water_out', state.waterOutTemperature);
    await this.setCapabilityIfPresent('measure_temperature_water_in', state.waterInTemperature);
    await this.setCapabilityIfPresent('measure_temperature_hot_water', state.hotWaterTemperature);
    await this.setCapabilityIfPresent('measure_temperature_optional_water', state.optimalWaterTemperature);
    await this.setCapabilityIfPresent('measure_temperature_remote_room', state.remoteRoomTemperature);
    await this.setCapabilityIfPresent('target_temperature_heating', state.heatingTargetTemperature);
    await this.setCapabilityIfPresent('target_temperature_cooling', state.coolingTargetTemperature);
    await this.setCapabilityIfPresent('target_temperature_hot_water', state.hotWaterTargetTemperature);
    await this.setCapabilityIfPresent('heatpump_power', state.power);
    await this.setCapabilityIfPresent('heatpump_mode', state.mode);
    await this.setCapabilityIfPresent('heatpump_fast_hot_water', state.fastHotWater);
    await this.setCapabilityIfPresent('heatpump_silence', state.silence);
    await this.setCapabilityIfPresent('heatpump_weather_dependent', state.weatherDependent);
    await this.setCapabilityIfPresent('heatpump_disinfect', state.disinfect);
    await this.setCapabilityIfPresent('heatpump_defrosting', state.defrosting);
    await this.setCapabilityIfPresent('heatpump_tank_heater', state.tankHeaterActive);
    await this.setCapabilityIfPresent('heatpump_hp_heater_1', state.hpHeater1Active);
    await this.setCapabilityIfPresent('heatpump_hp_heater_2', state.hpHeater2Active);
    await this.setCapabilityIfPresent('heatpump_frost_protection', state.frostProtection);
    await this.setCapabilityIfPresent('heatpump_evu', state.evuActive);
  }

  private async setCapabilityIfPresent(capability: string, value: boolean | number | string | null): Promise<void> {
    if (value === null || !this.hasCapability(capability)) {
      return;
    }
    const previous = this.getCapabilityValue(capability);
    try {
      await this.setCapabilityValue(capability, value);
    } catch (error) {
      this.error(`Failed to set ${capability}`, error);
      return;
    }
    if (previous !== null && previous !== value) {
      await this.triggerCapabilityFlow(capability, value);
    }
  }

  private async triggerCapabilityFlow(capability: string, value: boolean | number | string): Promise<void> {
    const token = FLOW_TRIGGER_TOKENS[capability];
    const booleanTriggerIds = BOOLEAN_FLOW_TRIGGER_IDS[capability];
    const triggerId = typeof value === 'boolean' && booleanTriggerIds ? booleanTriggerIds[String(value) as 'true' | 'false'] : undefined;

    if (token) {
      await this.homey.flow.getTriggerCard(`${capability}_changed`).trigger({ [token]: value }).catch((error) => {
        this.error(`Failed to trigger ${capability}_changed flow`, error);
      });
    }

    if (triggerId) {
      await this.homey.flow.getTriggerCard(triggerId).trigger().catch((error) => {
        this.error(`Failed to trigger ${triggerId} flow`, error);
      });
    }
  }

  private boundDevice(): BoundGreeVersatiDevice {
    const settings = this.getSettings() as Partial<VersatiSettings>;
    const stored = this.getStore() as Partial<VersatiSettings>;
    const merged = {
      ...stored,
      ip: cleanString(settings.ip) || stored.ip,
      port: Number(settings.port || stored.port),
      mac: cleanString(settings.mac) || stored.mac,
      key: cleanString(settings.key) || stored.key,
      encryptionVersion: Number(settings.encryptionVersion || stored.encryptionVersion),
      name: cleanString(settings.name) || stored.name,
    };

    if (!merged.ip || !merged.port || !merged.mac || !merged.key || !merged.encryptionVersion) {
      throw new Error('Gree Versati device is missing pairing store data');
    }
    const device: BoundGreeVersatiDevice = {
      ip: merged.ip,
      port: Number(merged.port),
      mac: normalizeMac(merged.mac),
      key: merged.key,
      encryptionVersion: Number(merged.encryptionVersion) === 2 ? 2 : 1,
    };
    if (merged.name) {
      device.name = merged.name;
    }
    return device;
  }

  private clientOrThrow(): GreeVersatiClient {
    if (!this.client) {
      throw new Error('Gree Versati client is not initialized');
    }
    return this.client;
  }

  private async setModeFromHomey(value: unknown): Promise<void> {
    if (!isWritableMode(value)) {
      throw new Error(`Unsupported Gree Versati mode: ${String(value)}`);
    }
    await this.clientOrThrow().setMode(this.boundDevice(), value);
    await this.refreshState();
  }

  private async setHeatingTargetFromHomey(value: unknown): Promise<void> {
    const temperature = parseTemperature(value, HEATING_TARGET_MIN, HEATING_TARGET_MAX, 'heating target');
    await this.clientOrThrow().setHeatingTargetTemperature(this.boundDevice(), temperature);
    await this.refreshState();
  }

  private async setHotWaterTargetFromHomey(value: unknown): Promise<void> {
    const temperature = parseTemperature(value, HOT_WATER_TARGET_MIN, HOT_WATER_TARGET_MAX, 'hot water target');
    await this.clientOrThrow().setHotWaterTargetTemperature(this.boundDevice(), temperature);
    await this.refreshState();
  }

  private async setFastHotWaterFromHomey(value: unknown): Promise<void> {
    await this.clientOrThrow().setFastHotWater(this.boundDevice(), parseBoolean(value, 'Rapid hot water'));
    await this.refreshState();
  }

  private async setSilenceFromHomey(value: unknown): Promise<void> {
    await this.clientOrThrow().setSilence(this.boundDevice(), parseBoolean(value, 'Silence'));
    await this.refreshState();
  }

  private async setWeatherDependentFromHomey(value: unknown): Promise<void> {
    await this.clientOrThrow().setWeatherDependent(this.boundDevice(), parseBoolean(value, 'W-depend'));
    await this.refreshState();
  }

  private async setDisinfectFromHomey(value: unknown): Promise<void> {
    await this.clientOrThrow().setDisinfect(this.boundDevice(), parseBoolean(value, 'Disinfect'));
    await this.refreshState();
  }

  private async handleRefreshFailure(error: unknown, initial: boolean): Promise<void> {
    const recovered = await this.recoverEndpointByDiscovery(error);
    if (recovered) {
      return;
    }

    this.consecutiveFailures += 1;
    const message = error instanceof Error ? error.message : String(error);
    const lastSuccessfulPollAt = stringStoreValue(this.getStore().lastSuccessfulPollAt);
    this.error(initial ? 'Initial Gree Versati refresh failed' : 'Failed to refresh Gree Versati state', error);
    await this.setStoreValue('lastPollError', message);
    await this.setStoreValue('lastPollErrorAt', new Date().toISOString());
    await this.setStoreValue('consecutivePollFailures', this.consecutiveFailures);
    await this.triggerPollFailed(message, lastSuccessfulPollAt);

    if (initial || this.consecutiveFailures >= UNAVAILABLE_AFTER_FAILURES) {
      await this.setUnavailable(`Could not read heat pump state: ${message}`);
      if (this.reachable) {
        this.reachable = false;
        await this.triggerDeviceUnavailable(message, lastSuccessfulPollAt);
      }
    }
  }

  private async recoverEndpointByDiscovery(error: unknown): Promise<boolean> {
    try {
      const current = this.boundDevice();
      const client = this.clientOrThrow();
      const discovered = await client.discover();
      const match = discovered.find((device) => normalizeMac(device.mac) === normalizeMac(current.mac));
      if (!match) {
        return false;
      }

      const rebound = await client.bind(match);
      const state = await client.getState(rebound);
      const ipChanged = rebound.ip !== current.ip || rebound.port !== current.port;
      await this.persistEndpoint(rebound);
      if (ipChanged) {
        await this.triggerDeviceIpChanged(current, rebound);
      }
      await this.applyState(rebound, state);
      return true;
    } catch (recoveryError) {
      this.error('Failed to recover Gree Versati endpoint after poll failure', error, recoveryError);
      return false;
    }
  }

  private async triggerPollFailed(error: string, lastSuccessfulPollAt: string): Promise<void> {
    await this.homey.flow.getTriggerCard('poll_failed').trigger({
      error,
      failures: this.consecutiveFailures,
      last_success: lastSuccessfulPollAt,
    }).catch((triggerError) => {
      this.error('Failed to trigger poll_failed flow', triggerError);
    });
  }

  private async triggerDeviceUnavailable(error: string, lastSuccessfulPollAt: string): Promise<void> {
    await this.homey.flow.getTriggerCard('device_unavailable').trigger({
      error,
      failures: this.consecutiveFailures,
      last_success: lastSuccessfulPollAt,
    }).catch((triggerError) => {
      this.error('Failed to trigger device_unavailable flow', triggerError);
    });
  }

  private async triggerDeviceAvailable(): Promise<void> {
    await this.homey.flow.getTriggerCard('device_available').trigger({
      last_success: stringStoreValue(this.getStore().lastSuccessfulPollAt),
    }).catch((triggerError) => {
      this.error('Failed to trigger device_available flow', triggerError);
    });
  }

  private async triggerDeviceIpChanged(previous: BoundGreeVersatiDevice, next: BoundGreeVersatiDevice): Promise<void> {
    await this.homey.flow.getTriggerCard('device_ip_changed').trigger({
      old_ip: previous.ip,
      new_ip: next.ip,
    }).catch((triggerError) => {
      this.error('Failed to trigger device_ip_changed flow', triggerError);
    });
  }

  private async updateDiagnostics(device: BoundGreeVersatiDevice, state: GreeVersatiState): Promise<void> {
    const now = new Date().toISOString();
    await Promise.all([
      this.setStoreValue('ip', device.ip),
      this.setStoreValue('port', device.port),
      this.setStoreValue('mac', device.mac),
      this.setStoreValue('encryptionVersion', device.encryptionVersion),
      this.setStoreValue('lastSuccessfulPollAt', now),
      this.setStoreValue('lastPollError', ''),
      this.setStoreValue('consecutivePollFailures', 0),
      this.setStoreValue('diagnosticPower', state.raw.Pow),
      this.setStoreValue('diagnosticMode', state.raw.Mod),
      this.setStoreValue('diagnosticEVU', state.raw.EVU),
      this.setStoreValue('diagnosticModelType', state.raw.ModelType),
      this.setStoreValue('diagnosticVersatiSeries', state.raw.VersatiSeries),
      this.setStoreValue('diagnosticWeatherDependent', state.raw.SvSt),
      this.setStoreValue('diagnosticDisinfect', state.raw.SwDisFct),
      this.setStoreValue('diagnosticNormalizedMode', state.mode),
    ]);
  }

  private async persistEndpoint(device: BoundGreeVersatiDevice): Promise<void> {
    const settings = this.getSettings() as Partial<VersatiSettings>;
    const normalizedMac = normalizeMac(device.mac);
    const settingsUpdates: Record<string, string | number> = {};

    if (settings.ip !== device.ip) settingsUpdates.ip = device.ip;
    if (Number(settings.port) !== device.port) settingsUpdates.port = device.port;
    if (settings.mac !== normalizedMac) settingsUpdates.mac = normalizedMac;
    if (settings.key !== device.key) settingsUpdates.key = device.key;
    if (Number(settings.encryptionVersion) !== device.encryptionVersion) {
      settingsUpdates.encryptionVersion = device.encryptionVersion;
    }

    await Promise.all([
      this.setStoreValue('ip', device.ip),
      this.setStoreValue('port', device.port),
      this.setStoreValue('mac', normalizedMac),
      this.setStoreValue('key', device.key),
      this.setStoreValue('encryptionVersion', device.encryptionVersion),
    ]);
    if (Object.keys(settingsUpdates).length) {
      await this.setSettings(settingsUpdates);
    }
  }

  private async syncSettingsFromStore(): Promise<void> {
    const store = this.getStore() as Partial<VersatiSettings>;
    const settings = this.getSettings() as Partial<VersatiSettings>;
    const updates: Record<string, string | number> = {};

    if (store.ip && !settings.ip) updates.ip = store.ip;
    if (store.port && !settings.port) updates.port = Number(store.port);
    if (store.mac && !settings.mac) updates.mac = normalizeMac(store.mac);
    if (store.key && !settings.key) updates.key = store.key;
    if (store.encryptionVersion && !settings.encryptionVersion) updates.encryptionVersion = store.encryptionVersion;

    if (Object.keys(updates).length) {
      await this.setSettings(updates);
    }
  }

  private pollIntervalMs(): number {
    const settings = this.getSettings() as Partial<VersatiSettings>;
    const seconds = Number(settings.pollInterval || POLL_INTERVAL_MS / 1000);
    if (!Number.isFinite(seconds)) {
      return POLL_INTERVAL_MS;
    }
    return Math.min(Math.max(seconds * 1000, MIN_POLL_INTERVAL_MS), MAX_POLL_INTERVAL_MS);
  }
}

module.exports = GreeVersatiDevice;

function endpointFromSettings(settings: Record<string, SettingsValue>): BoundGreeVersatiDevice {
  const ip = cleanString(settings.ip);
  const mac = normalizeMac(cleanString(settings.mac));
  const port = Number(settings.port || 7000);
  const key = cleanString(settings.key);
  const encryptionVersion = Number(settings.encryptionVersion) === 2 ? 2 : 1;

  if (!ip || !mac || !Number.isInteger(port) || port <= 0 || port > 65535) {
    throw new Error('IP address, MAC address, and valid UDP port are required.');
  }

  return {
    ip,
    port,
    mac,
    key,
    encryptionVersion,
  };
}

function cleanString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeMac(mac: string): string {
  return mac.replace(/[^0-9a-f]/gi, '').toLowerCase();
}

function stringStoreValue(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function isWritableMode(value: unknown): value is WritableGreeVersatiMode {
  return value === 'off' || value === 'heat_hot_water' || value === 'hot_water' || value === 'cool';
}

function parseTemperature(value: unknown, min: number, max: number, label: string): number {
  const temperature = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(temperature)) {
    throw new Error(`Invalid ${label}: ${String(value)}`);
  }
  if (temperature < min || temperature > max) {
    throw new Error(`${label} must be between ${min} and ${max} °C`);
  }
  return temperature;
}

function parseBoolean(value: unknown, label: string): boolean {
  if (typeof value === 'boolean') {
    return value;
  }
  if (value === 'true') {
    return true;
  }
  if (value === 'false') {
    return false;
  }
  throw new Error(`${label} must be true or false`);
}
