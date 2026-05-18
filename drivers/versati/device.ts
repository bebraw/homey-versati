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
import {
  DEFAULT_WEATHER_CURVE_CONFIG,
  calculateWeatherCurveTarget,
  type WeatherCurveConfig,
  type WeatherCurveShape,
} from '../../src/lib/weather-curve';

const POLL_INTERVAL_MS = 30_000;
const MIN_POLL_INTERVAL_MS = 15_000;
const MAX_POLL_INTERVAL_MS = 300_000;
const UNAVAILABLE_AFTER_FAILURES = 3;
const TELEMETRY_HISTORY_LIMIT = 480;
const WEATHER_CURVE_AUDIT_LIMIT = 120;
const DEFAULT_CURVE_DEADBAND = 1;
const DEFAULT_CURVE_MIN_WRITE_INTERVAL_SECONDS = 1800;
const WEATHER_CURVE_PRESETS = {
  custom: null,
  mild_floor: {
    outdoorLow: -20,
    targetAtOutdoorLow: 35,
    outdoorHigh: 10,
    targetAtOutdoorHigh: 25,
    targetMin: 22,
    targetMax: 38,
    shape: 'mild',
    bend: 20,
  },
  radiators: {
    outdoorLow: -20,
    targetAtOutdoorLow: 45,
    outdoorHigh: 10,
    targetAtOutdoorHigh: 30,
    targetMin: 25,
    targetMax: 55,
    shape: 'normal',
    bend: 35,
  },
  conservative: {
    outdoorLow: -20,
    targetAtOutdoorLow: 40,
    outdoorHigh: 10,
    targetAtOutdoorHigh: 28,
    targetMin: 24,
    targetMax: 45,
    shape: 'linear',
    bend: 0,
  },
} as const satisfies Record<string, (WeatherCurveConfig & { shape: WeatherCurveShape }) | null>;
type WeatherCurvePreset = keyof typeof WEATHER_CURVE_PRESETS;
const CURVE_SETTING_KEYS = [
  'curvePreset',
  'curveControlMode',
  'curveOutdoorSource',
  'curveManualOutdoorTemperature',
  'curveOutdoorLow',
  'curveTargetAtOutdoorLow',
  'curveOutdoorHigh',
  'curveTargetAtOutdoorHigh',
  'curveTargetMin',
  'curveTargetMax',
  'curveShape',
  'curveBend',
  'curveDeadband',
  'curveMinWriteInterval',
];
const FLOW_TRIGGER_TOKENS: Record<string, string> = {
  measure_temperature_hot_water: 'measure_temperature_hot_water',
  target_temperature_heating: 'target_temperature_heating',
  target_temperature_hot_water: 'target_temperature_hot_water',
  heatpump_mode: 'heatpump_mode',
  weather_curve_outdoor_temperature: 'outdoor_temperature',
  weather_curve_heating_target: 'heating_target',
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
  curvePreset?: WeatherCurvePreset;
  curveControlMode?: 'disabled' | 'dry_run' | 'write';
  curveOutdoorSource?: 'manual' | 'flow';
  curveManualOutdoorTemperature?: number;
  curveOutdoorLow?: number;
  curveTargetAtOutdoorLow?: number;
  curveOutdoorHigh?: number;
  curveTargetAtOutdoorHigh?: number;
  curveTargetMin?: number;
  curveTargetMax?: number;
  curveShape?: WeatherCurveShape;
  curveBend?: number;
  curveDeadband?: number;
  curveMinWriteInterval?: number;
};

interface WeatherCurveSettings {
  preset: WeatherCurvePreset;
  controlMode: 'disabled' | 'dry_run' | 'write';
  outdoorSource: 'manual' | 'flow';
  manualOutdoorTemperature: number;
  config: WeatherCurveConfig;
  deadband: number;
  minWriteIntervalMs: number;
}

interface TelemetryHistorySample {
  at: string;
  waterOutTemperature: number | null;
  waterInTemperature: number | null;
  hotWaterTemperature: number | null;
  remoteRoomTemperature: number | null;
  heatingTargetTemperature: number | null;
  hotWaterTargetTemperature: number | null;
  curveOutdoorTemperature: number | null;
  curveHeatingTarget: number | null;
}

interface WeatherCurveAuditEntry {
  at: string;
  action: 'skip' | 'write' | 'error';
  reason: string;
  controlMode: WeatherCurveSettings['controlMode'];
  heatPumpMode: GreeVersatiState['mode'] | null;
  outdoorTemperature: number | null;
  calculatedTarget: number | null;
  previousTarget: number | null;
  writtenTarget: number | null;
  message: string;
}

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
    this.registerCapabilityListener('button.refresh', async () => {
      await this.refreshState();
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
      if (changedKeys.some((key) => CURVE_SETTING_KEYS.includes(key))) {
        await this.refreshState();
        return 'Gree Versati weather curve settings updated.';
      }
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

  async flowSetCurveOutdoorTemperature(temperature: unknown): Promise<void> {
    const outdoorTemperature = Number(temperature);
    if (!Number.isFinite(outdoorTemperature)) {
      throw new Error(`Invalid curve outdoor temperature: ${String(temperature)}`);
    }
    await this.setStoreValue('weatherCurveFlowOutdoorTemperature', outdoorTemperature);
    await this.refreshState();
  }

  async flowPauseWeatherCurve(minutes: unknown): Promise<void> {
    await this.pauseWeatherCurve(minutes);
  }

  async flowResumeWeatherCurve(): Promise<void> {
    await this.resumeWeatherCurve();
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

  flowCurveControlModeIs(mode: unknown): boolean {
    return this.getStore().weatherCurveMode === mode;
  }

  flowCurveSkippedReasonIs(reason: unknown): boolean {
    return this.getStore().weatherCurveLastSkippedReason === reason;
  }

  flowCurveWriteAllowed(): boolean {
    return this.getStore().weatherCurveMode === 'write' && this.getCapabilityValue('heatpump_mode') === 'heat_hot_water';
  }

  flowHasPollHistory(): boolean {
    return telemetryHistory(this.getStore().telemetryHistory).length > 1;
  }

  async weatherCurveWidgetState(): Promise<Record<string, unknown>> {
    const settings = this.weatherCurveSettings();
    return {
      device: {
        id: this.getData().id,
        name: this.getName(),
      },
      preset: settings.preset,
      controlMode: settings.controlMode,
      outdoorSource: settings.outdoorSource,
      manualOutdoorTemperature: settings.manualOutdoorTemperature,
      config: settings.config,
      deadband: settings.deadband,
      minWriteIntervalSeconds: Math.round(settings.minWriteIntervalMs / 1000),
      values: {
        waterOutTemperature: this.getCapabilityValue('measure_temperature_water_out'),
        heatingTargetTemperature: this.getCapabilityValue('target_temperature_heating'),
        curveOutdoorTemperature: this.getCapabilityValue('weather_curve_outdoor_temperature'),
        curveHeatingTarget: this.getCapabilityValue('weather_curve_heating_target'),
        mode: this.getCapabilityValue('heatpump_mode'),
      },
      diagnostics: {
        lastEvaluatedAt: stringStoreValue(this.getStore().weatherCurveLastEvaluatedAt),
        lastWriteAt: stringStoreValue(this.getStore().weatherCurveLastWriteAt),
        lastSkippedReason: stringStoreValue(this.getStore().weatherCurveLastSkippedReason),
        lastError: stringStoreValue(this.getStore().weatherCurveLastError),
        pausedUntil: stringStoreValue(this.getStore().weatherCurvePausedUntil),
        auditHistory: weatherCurveAuditHistory(this.getStore().weatherCurveAuditHistory).slice(-12).reverse(),
      },
    };
  }

  async updateWeatherCurveFromWidget(input: Record<string, unknown>): Promise<Record<string, unknown>> {
    const updates = weatherCurveWidgetSettings(input);
    await this.setSettings(updates);
    await this.refreshState();
    return this.weatherCurveWidgetState();
  }

  async pauseWeatherCurveFromWidget(input: Record<string, unknown>): Promise<Record<string, unknown>> {
    await this.pauseWeatherCurve(input.minutes);
    return this.weatherCurveWidgetState();
  }

  async resumeWeatherCurveFromWidget(): Promise<Record<string, unknown>> {
    await this.resumeWeatherCurve();
    return this.weatherCurveWidgetState();
  }

  async telemetryWidgetState(): Promise<Record<string, unknown>> {
    const history = telemetryHistory(this.getStore().telemetryHistory);
    const latest = history.at(-1);
    return {
      device: {
        id: this.getData().id,
        name: this.getName(),
      },
      updatedAt: latest?.at ?? '',
      sampleCount: history.length,
      history,
      latest: latest ?? null,
    };
  }

  async diagnosticSnapshot(): Promise<Record<string, unknown>> {
    const settings = this.getSettings() as Partial<VersatiSettings>;
    const store = this.getStore();
    const capabilities = [
      'measure_temperature_water_out',
      'measure_temperature_water_in',
      'measure_temperature_hot_water',
      'measure_temperature_optional_water',
      'measure_temperature_remote_room',
      'target_temperature_heating',
      'target_temperature_cooling',
      'target_temperature_hot_water',
      'heatpump_power',
      'heatpump_mode',
      'heatpump_fast_hot_water',
      'heatpump_silence',
      'heatpump_weather_dependent',
      'heatpump_disinfect',
      'heatpump_defrosting',
      'heatpump_tank_heater',
      'heatpump_hp_heater_1',
      'heatpump_hp_heater_2',
      'heatpump_frost_protection',
      'heatpump_evu',
      'weather_curve_outdoor_temperature',
      'weather_curve_heating_target',
    ];

    return {
      capturedAt: new Date().toISOString(),
      device: {
        id: redactMac(String(this.getData().id ?? '')),
        name: this.getName(),
      },
      endpoint: {
        ip: '<redacted-ip>',
        port: Number(settings.port || store.port || 7000),
        mac: redactMac(String(settings.mac || store.mac || '')),
        encryptionVersion: Number(settings.encryptionVersion || store.encryptionVersion || 1),
        hasKey: Boolean(settings.key || store.key),
      },
      capabilities: Object.fromEntries(capabilities.map((capability) => [
        capability,
        this.hasCapability(capability) ? this.getCapabilityValue(capability) : null,
      ])),
      diagnostics: {
        lastSuccessfulPollAt: stringStoreValue(store.lastSuccessfulPollAt),
        lastPollError: stringStoreValue(store.lastPollError),
        lastPollErrorAt: stringStoreValue(store.lastPollErrorAt),
        consecutivePollFailures: Number(store.consecutivePollFailures || 0),
        normalizedMode: store.diagnosticNormalizedMode,
        rawPower: store.diagnosticPower,
        rawMode: store.diagnosticMode,
        rawEVU: store.diagnosticEVU,
        modelType: store.diagnosticModelType,
        versatiSeries: store.diagnosticVersatiSeries,
        rawWeatherDependent: store.diagnosticWeatherDependent,
        rawDisinfect: store.diagnosticDisinfect,
      },
      weatherCurve: {
        mode: store.weatherCurveMode,
        pausedUntil: store.weatherCurvePausedUntil,
        outdoorTemperature: store.weatherCurveOutdoorTemperature,
        heatingTarget: store.weatherCurveHeatingTarget,
        lastEvaluatedAt: store.weatherCurveLastEvaluatedAt,
        lastWriteAt: store.weatherCurveLastWriteAt,
        lastWrittenTarget: store.weatherCurveLastWrittenTarget,
        lastSkippedReason: store.weatherCurveLastSkippedReason,
        lastError: store.weatherCurveLastError,
        auditHistory: weatherCurveAuditHistory(store.weatherCurveAuditHistory).slice(-20).reverse(),
      },
      telemetryHistorySamples: telemetryHistory(store.telemetryHistory).length,
    };
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
    await this.applyWeatherCurveControl(device, state);
    await this.appendTelemetryHistory(state);
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

  private async applyWeatherCurveControl(device: BoundGreeVersatiDevice, state: GreeVersatiState): Promise<void> {
    const settings = this.weatherCurveSettings();
    await this.setStoreValue('weatherCurveMode', settings.controlMode);
    const pauseReason = this.weatherCurvePauseReason();
    if (pauseReason) {
      await this.appendWeatherCurveAudit({
        action: 'skip',
        reason: pauseReason,
        settings,
        state,
      });
      await this.setWeatherCurveSkipped(pauseReason);
      return;
    }
    if (settings.controlMode === 'disabled') {
      await this.appendWeatherCurveAudit({
        action: 'skip',
        reason: 'disabled',
        settings,
        state,
      });
      await this.setWeatherCurveSkipped('disabled');
      return;
    }

    try {
      const outdoorTemperature = await this.weatherCurveOutdoorTemperature(settings);
      const result = calculateWeatherCurveTarget(outdoorTemperature, settings.config);
      await this.setCapabilityIfPresent('weather_curve_outdoor_temperature', result.outdoorTemperature);
      await this.setCapabilityIfPresent('weather_curve_heating_target', result.targetTemperature);
      await this.setStoreValue('weatherCurveOutdoorTemperature', result.outdoorTemperature);
      await this.setStoreValue('weatherCurveHeatingTarget', result.targetTemperature);
      await this.setStoreValue('weatherCurveLastEvaluatedAt', new Date().toISOString());

      if (settings.controlMode === 'dry_run') {
        await this.appendWeatherCurveAudit({
          action: 'skip',
          reason: 'dry_run',
          settings,
          state,
          outdoorTemperature: result.outdoorTemperature,
          calculatedTarget: result.targetTemperature,
          previousTarget: state.heatingTargetTemperature,
        });
        await this.setWeatherCurveSkipped('dry_run');
        return;
      }
      if (state.mode !== 'heat_hot_water') {
        const reason = `mode:${state.mode}`;
        await this.appendWeatherCurveAudit({
          action: 'skip',
          reason,
          settings,
          state,
          outdoorTemperature: result.outdoorTemperature,
          calculatedTarget: result.targetTemperature,
          previousTarget: state.heatingTargetTemperature,
        });
        await this.setWeatherCurveSkipped(reason);
        return;
      }
      if (state.heatingTargetTemperature === null) {
        await this.appendWeatherCurveAudit({
          action: 'skip',
          reason: 'missing_current_heating_target',
          settings,
          state,
          outdoorTemperature: result.outdoorTemperature,
          calculatedTarget: result.targetTemperature,
        });
        await this.setWeatherCurveSkipped('missing_current_heating_target');
        return;
      }
      if (Math.abs(state.heatingTargetTemperature - result.targetTemperature) < settings.deadband) {
        await this.appendWeatherCurveAudit({
          action: 'skip',
          reason: 'deadband',
          settings,
          state,
          outdoorTemperature: result.outdoorTemperature,
          calculatedTarget: result.targetTemperature,
          previousTarget: state.heatingTargetTemperature,
        });
        await this.setWeatherCurveSkipped('deadband');
        return;
      }
      if (!this.weatherCurveWriteIntervalElapsed(settings.minWriteIntervalMs)) {
        await this.appendWeatherCurveAudit({
          action: 'skip',
          reason: 'minimum_write_interval',
          settings,
          state,
          outdoorTemperature: result.outdoorTemperature,
          calculatedTarget: result.targetTemperature,
          previousTarget: state.heatingTargetTemperature,
        });
        await this.setWeatherCurveSkipped('minimum_write_interval');
        return;
      }

      const previousTarget = state.heatingTargetTemperature;
      await this.clientOrThrow().setHeatingTargetTemperature(device, result.targetTemperature);
      await this.setCapabilityIfPresent('target_temperature_heating', result.targetTemperature);
      await this.setStoreValue('weatherCurveLastWriteAt', new Date().toISOString());
      await this.setStoreValue('weatherCurveLastWrittenTarget', result.targetTemperature);
      await this.setStoreValue('weatherCurveLastSkippedReason', '');
      await this.appendWeatherCurveAudit({
        action: 'write',
        reason: 'written',
        settings,
        state,
        outdoorTemperature: result.outdoorTemperature,
        calculatedTarget: result.targetTemperature,
        previousTarget,
        writtenTarget: result.targetTemperature,
      });
      await this.triggerWeatherCurveWritten(result.outdoorTemperature, result.targetTemperature, previousTarget);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await this.setStoreValue('weatherCurveLastError', message);
      await this.appendWeatherCurveAudit({
        action: 'error',
        reason: 'error',
        settings,
        state,
        message,
      });
      await this.setWeatherCurveSkipped(`error:${message}`);
      await this.triggerWeatherCurveError(message);
      this.error('Failed to apply Homey curve control', error);
    }
  }

  private async pauseWeatherCurve(minutes: unknown): Promise<void> {
    const durationMinutes = weatherCurvePauseMinutes(minutes);
    const pausedUntil = durationMinutes === 0
      ? 'manual'
      : new Date(Date.now() + durationMinutes * 60_000).toISOString();
    await this.setStoreValue('weatherCurvePausedUntil', pausedUntil);
    await this.refreshState();
  }

  private async resumeWeatherCurve(): Promise<void> {
    await this.setStoreValue('weatherCurvePausedUntil', '');
    await this.refreshState();
  }

  private weatherCurvePauseReason(): string {
    const pausedUntil = stringStoreValue(this.getStore().weatherCurvePausedUntil);
    if (!pausedUntil) {
      return '';
    }
    if (pausedUntil === 'manual') {
      return 'paused:manual';
    }
    const untilMs = Date.parse(pausedUntil);
    if (!Number.isFinite(untilMs)) {
      return '';
    }
    if (Date.now() < untilMs) {
      return 'paused:temporary';
    }
    this.setStoreValue('weatherCurvePausedUntil', '').catch((error) => {
      this.error('Failed to clear expired weather curve pause', error);
    });
    return '';
  }

  private async appendWeatherCurveAudit(input: {
    action: WeatherCurveAuditEntry['action'];
    reason: string;
    settings: WeatherCurveSettings;
    state: GreeVersatiState;
    outdoorTemperature?: number | null;
    calculatedTarget?: number | null;
    previousTarget?: number | null;
    writtenTarget?: number | null;
    message?: string;
  }): Promise<void> {
    const history = weatherCurveAuditHistory(this.getStore().weatherCurveAuditHistory);
    const entry: WeatherCurveAuditEntry = {
      at: new Date().toISOString(),
      action: input.action,
      reason: input.reason,
      controlMode: input.settings.controlMode,
      heatPumpMode: input.state.mode,
      outdoorTemperature: numberOrNull(input.outdoorTemperature),
      calculatedTarget: numberOrNull(input.calculatedTarget),
      previousTarget: numberOrNull(input.previousTarget),
      writtenTarget: numberOrNull(input.writtenTarget),
      message: input.message ?? '',
    };
    await this.setStoreValue('weatherCurveAuditHistory', [...history, entry].slice(-WEATHER_CURVE_AUDIT_LIMIT));
  }

  private async setWeatherCurveSkipped(reason: string): Promise<void> {
    const previous = stringStoreValue(this.getStore().weatherCurveLastSkippedReason);
    await this.setStoreValue('weatherCurveLastSkippedReason', reason);
    if (previous === reason) {
      return;
    }
    await this.homey.flow.getTriggerCard('weather_curve_skipped').trigger(this, { reason }).catch((error) => {
      this.error('Failed to trigger weather_curve_skipped flow', error);
    });
  }

  private async triggerWeatherCurveWritten(
    outdoorTemperature: number,
    targetTemperature: number,
    previousTarget: number,
  ): Promise<void> {
    await this.homey.flow.getTriggerCard('weather_curve_written').trigger(this, {
      outdoor_temperature: outdoorTemperature,
      heating_target: targetTemperature,
      previous_heating_target: previousTarget,
    }).catch((error) => {
      this.error('Failed to trigger weather_curve_written flow', error);
    });
  }

  private async triggerWeatherCurveError(message: string): Promise<void> {
    await this.homey.flow.getTriggerCard('weather_curve_error').trigger(this, {
      error: message,
    }).catch((error) => {
      this.error('Failed to trigger weather_curve_error flow', error);
    });
  }

  private async weatherCurveOutdoorTemperature(settings: WeatherCurveSettings): Promise<number> {
    if (settings.outdoorSource === 'manual') {
      return settings.manualOutdoorTemperature;
    }
    const temperature = Number(this.getStore().weatherCurveFlowOutdoorTemperature);
    if (!Number.isFinite(temperature)) {
      throw new Error('No flow-provided outdoor temperature is available yet');
    }
    return temperature;
  }

  private weatherCurveWriteIntervalElapsed(minWriteIntervalMs: number): boolean {
    const lastWriteAt = stringStoreValue(this.getStore().weatherCurveLastWriteAt);
    if (!lastWriteAt) {
      return true;
    }
    const elapsedMs = Date.now() - Date.parse(lastWriteAt);
    return !Number.isFinite(elapsedMs) || elapsedMs >= minWriteIntervalMs;
  }

  private weatherCurveSettings(): WeatherCurveSettings {
    const settings = this.getSettings() as Partial<VersatiSettings>;
    const preset = weatherCurvePreset(settings.curvePreset);
    const controlMode = settings.curveControlMode === 'write' || settings.curveControlMode === 'disabled'
      ? settings.curveControlMode
      : 'dry_run';
    const outdoorSource = settings.curveOutdoorSource === 'flow' ? 'flow' : 'manual';
    const configured: WeatherCurveConfig = {
      outdoorLow: numberSetting(settings.curveOutdoorLow, DEFAULT_WEATHER_CURVE_CONFIG.outdoorLow),
      targetAtOutdoorLow: numberSetting(settings.curveTargetAtOutdoorLow, DEFAULT_WEATHER_CURVE_CONFIG.targetAtOutdoorLow),
      outdoorHigh: numberSetting(settings.curveOutdoorHigh, DEFAULT_WEATHER_CURVE_CONFIG.outdoorHigh),
      targetAtOutdoorHigh: numberSetting(settings.curveTargetAtOutdoorHigh, DEFAULT_WEATHER_CURVE_CONFIG.targetAtOutdoorHigh),
      targetMin: numberSetting(settings.curveTargetMin, DEFAULT_WEATHER_CURVE_CONFIG.targetMin),
      targetMax: numberSetting(settings.curveTargetMax, DEFAULT_WEATHER_CURVE_CONFIG.targetMax),
      shape: weatherCurveShape(settings.curveShape),
      bend: numberSetting(settings.curveBend, DEFAULT_WEATHER_CURVE_CONFIG.bend),
    };
    const config = WEATHER_CURVE_PRESETS[preset] ?? configured;

    return {
      preset,
      controlMode,
      outdoorSource,
      manualOutdoorTemperature: numberSetting(settings.curveManualOutdoorTemperature, 0),
      config,
      deadband: Math.max(0, numberSetting(settings.curveDeadband, DEFAULT_CURVE_DEADBAND)),
      minWriteIntervalMs: Math.max(0, numberSetting(
        settings.curveMinWriteInterval,
        DEFAULT_CURVE_MIN_WRITE_INTERVAL_SECONDS,
      ) * 1000),
    };
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

  private async appendTelemetryHistory(state: GreeVersatiState): Promise<void> {
    const history = telemetryHistory(this.getStore().telemetryHistory);
    const sample: TelemetryHistorySample = {
      at: new Date().toISOString(),
      waterOutTemperature: state.waterOutTemperature,
      waterInTemperature: state.waterInTemperature,
      hotWaterTemperature: state.hotWaterTemperature,
      remoteRoomTemperature: state.remoteRoomTemperature,
      heatingTargetTemperature: state.heatingTargetTemperature,
      hotWaterTargetTemperature: state.hotWaterTargetTemperature,
      curveOutdoorTemperature: numberOrNull(this.getCapabilityValue('weather_curve_outdoor_temperature')),
      curveHeatingTarget: numberOrNull(this.getCapabilityValue('weather_curve_heating_target')),
    };
    await this.setStoreValue('telemetryHistory', [...history, sample].slice(-TELEMETRY_HISTORY_LIMIT));
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
      settingsUpdates.encryptionVersion = String(device.encryptionVersion);
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
    if (store.encryptionVersion && !settings.encryptionVersion) updates.encryptionVersion = String(store.encryptionVersion);

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

function redactMac(mac: string): string {
  const normalized = normalizeMac(mac);
  return normalized ? `********${normalized.slice(-4)}` : '';
}

function stringStoreValue(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function numberOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function telemetryHistory(value: unknown): TelemetryHistorySample[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.flatMap((sample) => {
    if (!isRecord(sample) || typeof sample.at !== 'string') {
      return [];
    }
    return [{
      at: sample.at,
      waterOutTemperature: numberOrNull(sample.waterOutTemperature),
      waterInTemperature: numberOrNull(sample.waterInTemperature),
      hotWaterTemperature: numberOrNull(sample.hotWaterTemperature),
      remoteRoomTemperature: numberOrNull(sample.remoteRoomTemperature),
      heatingTargetTemperature: numberOrNull(sample.heatingTargetTemperature),
      hotWaterTargetTemperature: numberOrNull(sample.hotWaterTargetTemperature),
      curveOutdoorTemperature: numberOrNull(sample.curveOutdoorTemperature),
      curveHeatingTarget: numberOrNull(sample.curveHeatingTarget),
    }];
  }).slice(-TELEMETRY_HISTORY_LIMIT);
}

function weatherCurveAuditHistory(value: unknown): WeatherCurveAuditEntry[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.flatMap((entry) => {
    if (!isRecord(entry) || typeof entry.at !== 'string') {
      return [];
    }
    return [{
      at: entry.at,
      action: weatherCurveAuditAction(entry.action),
      reason: stringStoreValue(entry.reason),
      controlMode: weatherCurveControlMode(entry.controlMode),
      heatPumpMode: weatherCurveHeatPumpMode(entry.heatPumpMode),
      outdoorTemperature: numberOrNull(entry.outdoorTemperature),
      calculatedTarget: numberOrNull(entry.calculatedTarget),
      previousTarget: numberOrNull(entry.previousTarget),
      writtenTarget: numberOrNull(entry.writtenTarget),
      message: stringStoreValue(entry.message),
    }];
  }).filter((entry) => entry.reason).slice(-WEATHER_CURVE_AUDIT_LIMIT);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function numberSetting(value: unknown, fallback: number): number {
  const numberValue = Number(value);
  return Number.isFinite(numberValue) ? numberValue : fallback;
}

function weatherCurvePreset(value: unknown): WeatherCurvePreset {
  return value === 'mild_floor' || value === 'radiators' || value === 'conservative'
    ? value
    : 'custom';
}

function weatherCurveAuditAction(value: unknown): WeatherCurveAuditEntry['action'] {
  return value === 'write' || value === 'error' ? value : 'skip';
}

function weatherCurveControlMode(value: unknown): WeatherCurveSettings['controlMode'] {
  return value === 'disabled' || value === 'write' ? value : 'dry_run';
}

function weatherCurveHeatPumpMode(value: unknown): GreeVersatiState['mode'] | null {
  return value === 'off' || value === 'heat_hot_water' || value === 'cool' || value === 'hot_water' || value === 'other'
    ? value
    : null;
}

function weatherCurvePauseMinutes(value: unknown): number {
  if (value === 'manual') {
    return 0;
  }
  const minutes = Number(value);
  if ([60, 360, 1440].includes(minutes)) {
    return minutes;
  }
  throw new Error('Weather curve pause duration must be 1 hour, 6 hours, 24 hours, or until resumed');
}

function weatherCurveShape(value: unknown): WeatherCurveShape {
  return value === 'mild' || value === 'normal' || value === 'aggressive' || value === 'custom'
    ? value
    : 'linear';
}

function weatherCurveWidgetSettings(input: Record<string, unknown>): Record<string, string | number> {
  const preset = weatherCurvePreset(input.curvePreset);
  const shape = weatherCurveShape(input.curveShape);
  const controlMode = input.curveControlMode === 'disabled' || input.curveControlMode === 'write'
    ? input.curveControlMode
    : 'dry_run';
  const outdoorSource = input.curveOutdoorSource === 'flow' ? 'flow' : 'manual';

  return {
    curvePreset: preset,
    curveControlMode: controlMode,
    curveOutdoorSource: outdoorSource,
    curveManualOutdoorTemperature: clampedNumber(input.curveManualOutdoorTemperature, -50, 50, 0),
    curveOutdoorLow: clampedNumber(input.curveOutdoorLow, -50, 30, DEFAULT_WEATHER_CURVE_CONFIG.outdoorLow),
    curveTargetAtOutdoorLow: clampedNumber(
      input.curveTargetAtOutdoorLow,
      HEATING_TARGET_MIN,
      HEATING_TARGET_MAX,
      DEFAULT_WEATHER_CURVE_CONFIG.targetAtOutdoorLow,
    ),
    curveOutdoorHigh: clampedNumber(input.curveOutdoorHigh, -30, 50, DEFAULT_WEATHER_CURVE_CONFIG.outdoorHigh),
    curveTargetAtOutdoorHigh: clampedNumber(
      input.curveTargetAtOutdoorHigh,
      HEATING_TARGET_MIN,
      HEATING_TARGET_MAX,
      DEFAULT_WEATHER_CURVE_CONFIG.targetAtOutdoorHigh,
    ),
    curveTargetMin: clampedNumber(input.curveTargetMin, HEATING_TARGET_MIN, HEATING_TARGET_MAX, DEFAULT_WEATHER_CURVE_CONFIG.targetMin),
    curveTargetMax: clampedNumber(input.curveTargetMax, HEATING_TARGET_MIN, HEATING_TARGET_MAX, DEFAULT_WEATHER_CURVE_CONFIG.targetMax),
    curveShape: shape,
    curveBend: clampedNumber(input.curveBend, -100, 100, DEFAULT_WEATHER_CURVE_CONFIG.bend),
    curveDeadband: clampedNumber(input.curveDeadband, 0, 10, DEFAULT_CURVE_DEADBAND),
    curveMinWriteInterval: clampedNumber(input.curveMinWriteInterval, 300, 86400, DEFAULT_CURVE_MIN_WRITE_INTERVAL_SECONDS),
  };
}

function clampedNumber(value: unknown, min: number, max: number, fallback: number): number {
  const numberValue = Number(value);
  if (!Number.isFinite(numberValue)) {
    return fallback;
  }
  return Math.min(Math.max(numberValue, min), max);
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
