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
import { calculateCopEstimate, type CopEstimate } from '../../src/lib/cop-estimate';

const POLL_INTERVAL_MS = 30_000;
const MIN_POLL_INTERVAL_MS = 15_000;
const MAX_POLL_INTERVAL_MS = 300_000;
const UNAVAILABLE_AFTER_FAILURES = 3;
const TELEMETRY_HISTORY_LIMIT = 480;
const WEATHER_CURVE_AUDIT_LIMIT = 120;
const DEFAULT_CURVE_DEADBAND = 1;
const DEFAULT_CURVE_MIN_WRITE_INTERVAL_SECONDS = 1800;
const COP_NOMINAL_WATER_DELTA_C = 5;
const REQUIRED_CAPABILITIES = [
  'measure_temperature',
  'measure_temperature.water_in',
  'measure_temperature.hot_water',
  'measure_temperature.optional_water',
  'measure_temperature.remote_room',
  'measure_temperature.heating_target',
  'measure_temperature.cooling_target',
  'measure_temperature.hot_water_target',
  'measure_temperature.curve_outdoor',
  'measure_temperature.curve_heating_target',
  'measure_temperature.water_delta',
  'measure_power.heat_output_estimated',
  'measure_power.electrical_input_estimated',
  'measure_cop_estimated',
  'heatpump_cop_status',
  'heatpump_operating_state',
] as const;
const ALERT_SETTING_KEYS = [
  'alertDefrostingMinutes',
  'alertBackupHeaterMinutes',
  'alertLowWaterDelta',
  'alertLowWaterDeltaMinutes',
  'alertHotWaterRecoveryMargin',
  'alertHotWaterRecoveryMinutes',
] as const;
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
const COP_WATER_FLOW_PRESETS = {
  custom: null,
  gree_versati_4kw: nominalWaterFlowRate(4),
  gree_versati_6kw: nominalWaterFlowRate(6),
  gree_versati_8kw: nominalWaterFlowRate(8),
  gree_versati_10kw: nominalWaterFlowRate(10),
  gree_versati_12kw: nominalWaterFlowRate(12),
  gree_versati_14kw: nominalWaterFlowRate(14),
  gree_versati_16kw: nominalWaterFlowRate(16),
} as const satisfies Record<string, number | null>;
type CopWaterFlowPreset = keyof typeof COP_WATER_FLOW_PRESETS;
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
  'curveBoostTargetMin',
  'curveBoostTargetMax',
  'curveShape',
  'curveBend',
  'curveDeadband',
  'curveMinWriteInterval',
] as const;
const COP_SETTING_KEYS = [
  'copElectricalInputSource',
  'copWaterFlowPreset',
  'copWaterFlowRateLMin',
  'copElectricalInputKw',
  'copLowThreshold',
] as const;
const FLOW_TRIGGER_TOKENS: Record<string, string> = {
  measure_temperature_hot_water: 'measure_temperature_hot_water',
  target_temperature_heating: 'target_temperature_heating',
  target_temperature_hot_water: 'target_temperature_hot_water',
  heatpump_mode: 'heatpump_mode',
  heatpump_operating_state: 'state',
  weather_curve_outdoor_temperature: 'outdoor_temperature',
  weather_curve_heating_target: 'heating_target',
};
const FLOW_TRIGGER_CARD_IDS: Record<string, string> = {
  heatpump_operating_state: 'operating_state_changed',
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
const INSIGHTS_LOG_SPECS = [
  {
    id: 'waterout',
    title: 'Water out temperature',
    type: 'number',
    units: '°C',
    decimals: 1,
    value: (state: GreeVersatiState): number | null => state.waterOutTemperature,
  },
  {
    id: 'waterin',
    title: 'Water in temperature',
    type: 'number',
    units: '°C',
    decimals: 1,
    value: (state: GreeVersatiState): number | null => state.waterInTemperature,
  },
  {
    id: 'hotwater',
    title: 'Hot water temperature',
    type: 'number',
    units: '°C',
    decimals: 1,
    value: (state: GreeVersatiState): number | null => state.hotWaterTemperature,
  },
  {
    id: 'optionalwater',
    title: 'Optional water temperature',
    type: 'number',
    units: '°C',
    decimals: 1,
    value: (state: GreeVersatiState): number | null => state.optimalWaterTemperature,
  },
  {
    id: 'remoteroom',
    title: 'Remote room temperature',
    type: 'number',
    units: '°C',
    decimals: 1,
    value: (state: GreeVersatiState): number | null => state.remoteRoomTemperature,
  },
  {
    id: 'heatingtarget',
    title: 'Heating target',
    type: 'number',
    units: '°C',
    decimals: 0,
    value: (state: GreeVersatiState): number | null => state.heatingTargetTemperature,
  },
  {
    id: 'coolingtarget',
    title: 'Cooling target',
    type: 'number',
    units: '°C',
    decimals: 0,
    value: (state: GreeVersatiState): number | null => state.coolingTargetTemperature,
  },
  {
    id: 'hotwatertarget',
    title: 'Hot water target',
    type: 'number',
    units: '°C',
    decimals: 0,
    value: (state: GreeVersatiState): number | null => state.hotWaterTargetTemperature,
  },
  {
    id: 'curveoutdoor',
    title: 'Curve outdoor temperature',
    type: 'number',
    units: '°C',
    decimals: 1,
    value: (_state: GreeVersatiState, device: GreeVersatiDevice): number | null => numberOrNull(device.getCapabilityValue('weather_curve_outdoor_temperature')),
  },
  {
    id: 'curvetarget',
    title: 'Curve heating target',
    type: 'number',
    units: '°C',
    decimals: 0,
    value: (_state: GreeVersatiState, device: GreeVersatiDevice): number | null => numberOrNull(device.getCapabilityValue('weather_curve_heating_target')),
  },
  {
    id: 'waterdeltaestimated',
    title: 'Water delta',
    type: 'number',
    units: '°C',
    decimals: 2,
    value: (_state: GreeVersatiState, device: GreeVersatiDevice): number | null => numberOrNull(device.getCapabilityValue('measure_temperature.water_delta')),
  },
  {
    id: 'heatoutputestimated',
    title: 'Estimated heat output',
    type: 'number',
    units: 'W',
    decimals: 0,
    value: (_state: GreeVersatiState, device: GreeVersatiDevice): number | null => numberOrNull(device.getCapabilityValue('measure_power.heat_output_estimated')),
  },
  {
    id: 'electricalinputestimated',
    title: 'Estimated electrical input',
    type: 'number',
    units: 'W',
    decimals: 0,
    value: (_state: GreeVersatiState, device: GreeVersatiDevice): number | null => numberOrNull(device.getCapabilityValue('measure_power.electrical_input_estimated')),
  },
  {
    id: 'copestimated',
    title: 'Estimated COP',
    type: 'number',
    decimals: 2,
    value: (_state: GreeVersatiState, device: GreeVersatiDevice): number | null => numberOrNull(device.getCapabilityValue('measure_cop_estimated')),
  },
  {
    id: 'power',
    title: 'Power state',
    type: 'boolean',
    value: (state: GreeVersatiState): boolean => state.power,
  },
  {
    id: 'rapid',
    title: 'Rapid hot water',
    type: 'boolean',
    value: (state: GreeVersatiState): boolean => state.fastHotWater,
  },
  {
    id: 'silence',
    title: 'Silence',
    type: 'boolean',
    value: (state: GreeVersatiState): boolean => state.silence,
  },
  {
    id: 'wdepend',
    title: 'W-depend',
    type: 'boolean',
    value: (state: GreeVersatiState): boolean => state.weatherDependent,
  },
  {
    id: 'disinfect',
    title: 'Disinfect',
    type: 'boolean',
    value: (state: GreeVersatiState): boolean => state.disinfect,
  },
  {
    id: 'defrosting',
    title: 'Defrosting',
    type: 'boolean',
    value: (state: GreeVersatiState): boolean => state.defrosting,
  },
  {
    id: 'evu',
    title: 'EVU',
    type: 'boolean',
    value: (state: GreeVersatiState): boolean => state.evuActive,
  },
  {
    id: 'stateoff',
    title: 'Operating: Off',
    type: 'boolean',
    value: (_state: GreeVersatiState, device: GreeVersatiDevice): boolean => device.getCapabilityValue('heatpump_operating_state') === 'off',
  },
  {
    id: 'stateidle',
    title: 'Operating: Idle',
    type: 'boolean',
    value: (_state: GreeVersatiState, device: GreeVersatiDevice): boolean => device.getCapabilityValue('heatpump_operating_state') === 'idle',
  },
  {
    id: 'stateheating',
    title: 'Operating: Heating',
    type: 'boolean',
    value: (_state: GreeVersatiState, device: GreeVersatiDevice): boolean => device.getCapabilityValue('heatpump_operating_state') === 'heating',
  },
  {
    id: 'statehotwater',
    title: 'Operating: Hot water',
    type: 'boolean',
    value: (_state: GreeVersatiState, device: GreeVersatiDevice): boolean => device.getCapabilityValue('heatpump_operating_state') === 'hot_water',
  },
  {
    id: 'statecooling',
    title: 'Operating: Cooling',
    type: 'boolean',
    value: (_state: GreeVersatiState, device: GreeVersatiDevice): boolean => device.getCapabilityValue('heatpump_operating_state') === 'cooling',
  },
  {
    id: 'statedefrosting',
    title: 'Operating: Defrosting',
    type: 'boolean',
    value: (_state: GreeVersatiState, device: GreeVersatiDevice): boolean => device.getCapabilityValue('heatpump_operating_state') === 'defrosting',
  },
  {
    id: 'statebackupheater',
    title: 'Operating: Backup heater',
    type: 'boolean',
    value: (_state: GreeVersatiState, device: GreeVersatiDevice): boolean => device.getCapabilityValue('heatpump_operating_state') === 'backup_heater',
  },
  {
    id: 'staterapidhotwater',
    title: 'Operating: Rapid hot water',
    type: 'boolean',
    value: (_state: GreeVersatiState, device: GreeVersatiDevice): boolean => device.getCapabilityValue('heatpump_operating_state') === 'rapid_hot_water',
  },
  {
    id: 'statefrostprotection',
    title: 'Operating: Frost protection',
    type: 'boolean',
    value: (_state: GreeVersatiState, device: GreeVersatiDevice): boolean => device.getCapabilityValue('heatpump_operating_state') === 'frost_protection',
  },
  {
    id: 'stateunknown',
    title: 'Operating: Unknown',
    type: 'boolean',
    value: (_state: GreeVersatiState, device: GreeVersatiDevice): boolean => device.getCapabilityValue('heatpump_operating_state') === 'unknown',
  },
] as const satisfies readonly InsightsLogSpec[];

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
  curveBoostTargetMin?: number;
  curveBoostTargetMax?: number;
  curveShape?: WeatherCurveShape;
  curveBend?: number;
  curveDeadband?: number;
  curveMinWriteInterval?: number;
  allowCoolingModeWrites?: boolean;
  copElectricalInputSource?: 'fixed' | 'flow';
  copWaterFlowPreset?: CopWaterFlowPreset;
  copWaterFlowRateLMin?: number;
  copElectricalInputKw?: number;
  copLowThreshold?: number;
  alertDefrostingMinutes?: number;
  alertBackupHeaterMinutes?: number;
  alertLowWaterDelta?: number;
  alertLowWaterDeltaMinutes?: number;
  alertHotWaterRecoveryMargin?: number;
  alertHotWaterRecoveryMinutes?: number;
};

interface WeatherCurveSettings {
  preset: WeatherCurvePreset;
  controlMode: 'disabled' | 'dry_run' | 'write';
  outdoorSource: 'manual' | 'flow';
  manualOutdoorTemperature: number;
  config: WeatherCurveConfig;
  deadband: number;
  minWriteIntervalMs: number;
  boost: WeatherCurveBoost;
  boostTargetMin: number;
  boostTargetMax: number;
}

interface WeatherCurveBoost {
  offset: number;
  until: string;
  active: boolean;
}

interface WeatherCurveForecast {
  wouldWrite: boolean;
  reason: string;
  outdoorTemperature: number | null;
  calculatedTarget: number | null;
  currentTarget: number | null;
  mode: GreeVersatiState['mode'] | null;
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
  estimatedWaterDeltaTemperature: number | null;
  estimatedHeatOutputW: number | null;
  estimatedElectricalInputW: number | null;
  estimatedCop: number | null;
  estimatedCopStatus: CopStatus;
  mode: GreeVersatiState['mode'] | null;
  operatingState: OperatingState;
}

interface WeatherCurveAuditEntry {
  at: string;
  action: 'skip' | 'write' | 'error';
  reason: string;
  controlMode: WeatherCurveSettings['controlMode'];
  heatPumpMode: GreeVersatiState['mode'] | null;
  outdoorTemperature: number | null;
  calculatedTarget: number | null;
  boostOffset: number;
  previousTarget: number | null;
  writtenTarget: number | null;
  message: string;
}

interface InsightsLogSpec {
  id: string;
  title: string;
  type: 'number' | 'boolean';
  units?: string;
  decimals?: number;
  value(state: GreeVersatiState, device: GreeVersatiDevice): number | boolean | null;
}

type CopStatus = CopEstimate['status'] | 'fixed_estimate';
type OperatingState =
  | 'off'
  | 'idle'
  | 'heating'
  | 'hot_water'
  | 'cooling'
  | 'defrosting'
  | 'backup_heater'
  | 'rapid_hot_water'
  | 'frost_protection'
  | 'unknown';
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
    await this.ensureRequiredCapabilities();
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
    this.registerCapabilityListener('button.reset_insights', async () => {
      await this.resetInsightsLogs();
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
      if (changedKeys.some((key) => CURVE_SETTING_KEYS.includes(key as typeof CURVE_SETTING_KEYS[number]))) {
        await this.refreshState();
        return 'Gree Versati weather curve settings updated.';
      }
      if (changedKeys.some((key) => COP_SETTING_KEYS.includes(key as typeof COP_SETTING_KEYS[number]))) {
        if (changedKeys.includes('copWaterFlowPreset')) {
          await this.applyCopWaterFlowPreset(newSettings);
        }
        await this.refreshState();
        return 'Gree Versati COP estimate settings updated.';
      }
      if (changedKeys.some((key) => ALERT_SETTING_KEYS.includes(key as typeof ALERT_SETTING_KEYS[number]))) {
        await this.refreshState();
        return 'Gree Versati alert settings updated.';
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

  async flowSetCopElectricalInput(power: unknown): Promise<void> {
    const electricalInputKw = Number(power);
    if (!Number.isFinite(electricalInputKw) || electricalInputKw < 0 || electricalInputKw > 50) {
      throw new Error(`Invalid COP electrical input: ${String(power)}`);
    }
    await this.setStoreValue('copFlowElectricalInputKw', electricalInputKw);
    await this.setStoreValue('copFlowElectricalInputAt', new Date().toISOString());
    await this.refreshState();
  }

  async flowPauseWeatherCurve(minutes: unknown): Promise<void> {
    await this.pauseWeatherCurve(minutes);
  }

  async flowResumeWeatherCurve(): Promise<void> {
    await this.resumeWeatherCurve();
  }

  async flowSetWeatherCurveBoost(offset: unknown, minutes: unknown): Promise<void> {
    await this.setWeatherCurveBoost(offset, minutes);
  }

  async flowClearWeatherCurveBoost(): Promise<void> {
    await this.clearWeatherCurveBoost();
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

  flowCopBelow(cop: unknown): boolean {
    const threshold = Number(cop);
    const current = this.getCapabilityValue('measure_cop_estimated');
    return Number.isFinite(threshold) && typeof current === 'number' && current < threshold;
  }

  flowCopStatusIs(status: unknown): boolean {
    return this.getCapabilityValue('heatpump_cop_status') === status;
  }

  flowOperatingStateIs(state: unknown): boolean {
    return this.getCapabilityValue('heatpump_operating_state') === state;
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
      boost: settings.boost,
      boostTargetMin: settings.boostTargetMin,
      boostTargetMax: settings.boostTargetMax,
      values: {
        waterOutTemperature: this.getCapabilityValue('measure_temperature_water_out'),
        heatingTargetTemperature: this.getCapabilityValue('target_temperature_heating'),
        curveOutdoorTemperature: this.getCapabilityValue('weather_curve_outdoor_temperature'),
        curveHeatingTarget: this.getCapabilityValue('weather_curve_heating_target'),
        estimatedCop: this.getCapabilityValue('measure_cop_estimated'),
        estimatedCopStatus: this.getCapabilityValue('heatpump_cop_status'),
        operatingState: this.getCapabilityValue('heatpump_operating_state'),
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
      forecast: this.weatherCurveForecast(settings),
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

  async setWeatherCurveBoostFromWidget(input: Record<string, unknown>): Promise<Record<string, unknown>> {
    await this.setWeatherCurveBoost(input.offset, input.minutes);
    return this.weatherCurveWidgetState();
  }

  async clearWeatherCurveBoostFromWidget(): Promise<Record<string, unknown>> {
    await this.clearWeatherCurveBoost();
    return this.weatherCurveWidgetState();
  }

  async exportWeatherCurveFromWidget(): Promise<Record<string, unknown>> {
    const settings = this.weatherCurveSettings();
    return {
      schema: 'com.gree.versati.weatherCurveProfile.v1',
      exportedAt: new Date().toISOString(),
      profile: {
        curvePreset: settings.preset,
        curveControlMode: settings.controlMode,
        curveOutdoorSource: settings.outdoorSource,
        curveManualOutdoorTemperature: settings.manualOutdoorTemperature,
        curveOutdoorLow: settings.config.outdoorLow,
        curveTargetAtOutdoorLow: settings.config.targetAtOutdoorLow,
        curveOutdoorHigh: settings.config.outdoorHigh,
        curveTargetAtOutdoorHigh: settings.config.targetAtOutdoorHigh,
        curveTargetMin: settings.config.targetMin,
        curveTargetMax: settings.config.targetMax,
        curveBoostTargetMin: settings.boostTargetMin,
        curveBoostTargetMax: settings.boostTargetMax,
        curveShape: settings.config.shape,
        curveBend: settings.config.bend,
        curveDeadband: settings.deadband,
        curveMinWriteInterval: Math.round(settings.minWriteIntervalMs / 1000),
      },
    };
  }

  async importWeatherCurveFromWidget(input: Record<string, unknown>): Promise<Record<string, unknown>> {
    const profile = isRecord(input.profile) ? input.profile : input;
    const updates = weatherCurveWidgetSettings(profile);
    await this.setSettings(updates);
    await this.refreshState();
    return this.weatherCurveWidgetState();
  }

  async telemetryWidgetState(): Promise<Record<string, unknown>> {
    const history = telemetryHistory(this.getStore().telemetryHistory);
    const latest = history.at(-1);
    const settings = this.getSettings() as Partial<VersatiSettings>;
    const store = this.getStore();
    const auditHistory = weatherCurveAuditHistory(store.weatherCurveAuditHistory);
    const lastCurveDecision = auditHistory.at(-1) ?? null;
    return {
      device: {
        id: this.getData().id,
        name: this.getName(),
      },
      updatedAt: latest?.at ?? '',
      sampleCount: history.length,
      history,
      latest: latest ?? null,
      values: {
        mode: this.getCapabilityValue('heatpump_mode'),
        operatingState: this.getCapabilityValue('heatpump_operating_state'),
      },
      diagnostics: {
        reachable: this.reachable,
        lastSuccessfulPollAt: stringStoreValue(store.lastSuccessfulPollAt),
        lastPollError: stringStoreValue(store.lastPollError),
        consecutivePollFailures: Number(store.consecutivePollFailures || 0),
        endpoint: {
          ip: '<redacted-ip>',
          port: Number(settings.port || store.port || 7000),
          mac: redactMac(String(settings.mac || store.mac || '')),
          encryptionVersion: Number(settings.encryptionVersion || store.encryptionVersion || 1),
        },
        weatherCurve: {
          mode: stringStoreValue(store.weatherCurveMode),
          pausedUntil: stringStoreValue(store.weatherCurvePausedUntil),
          lastSkippedReason: stringStoreValue(store.weatherCurveLastSkippedReason),
          lastWriteAt: stringStoreValue(store.weatherCurveLastWriteAt),
          lastDecision: lastCurveDecision,
        },
        cop: this.copDiagnostics(),
      },
    };
  }

  async insightsStatus(): Promise<Record<string, unknown>> {
    const logs = await Promise.all(INSIGHTS_LOG_SPECS.map(async (spec) => {
      const id = this.insightsLogId(spec.id);
      try {
        await this.homey.insights.getLog(id);
        return {
          id,
          metric: spec.id,
          title: spec.title,
          type: spec.type,
          exists: true,
          lastEntryAt: stringStoreValue(this.getStore()[`insightsLastEntryAt:${spec.id}`]),
          lastError: stringStoreValue(this.getStore()[`insightsLastError:${spec.id}`]),
        };
      } catch (error) {
        return {
          id,
          metric: spec.id,
          title: spec.title,
          type: spec.type,
          exists: false,
          lastEntryAt: stringStoreValue(this.getStore()[`insightsLastEntryAt:${spec.id}`]),
          lastError: error instanceof Error ? error.message : String(error),
        };
      }
    }));
    return {
      checkedAt: new Date().toISOString(),
      device: {
        id: redactMac(String(this.getData().id ?? '')),
        name: this.getName(),
      },
      created: logs.filter((log) => log.exists).length,
      total: logs.length,
      logs,
    };
  }

  async resetInsightsLogs(): Promise<void> {
    for (const spec of INSIGHTS_LOG_SPECS) {
      const id = this.insightsLogId(spec.id);
      try {
        const log = await this.homey.insights.getLog(id);
        await this.homey.insights.deleteLog(log);
      } catch {
        // Missing logs are fine; they will be recreated below.
      }
      await this.setStoreValue(`insightsLastEntryAt:${spec.id}`, '');
      await this.setStoreValue(`insightsLastError:${spec.id}`, '');
      await this.insightsLog(spec);
    }
  }

  async diagnosticSnapshot(): Promise<Record<string, unknown>> {
    const settings = this.getSettings() as Partial<VersatiSettings>;
    const store = this.getStore();
    const capabilities = [
      'measure_temperature',
      'measure_temperature.water_in',
      'measure_temperature.hot_water',
      'measure_temperature.optional_water',
      'measure_temperature.remote_room',
      'measure_temperature.heating_target',
      'measure_temperature.cooling_target',
      'measure_temperature.hot_water_target',
      'measure_temperature.curve_outdoor',
      'measure_temperature.curve_heating_target',
      'measure_temperature.water_delta',
      'measure_power.heat_output_estimated',
      'measure_power.electrical_input_estimated',
      'measure_cop_estimated',
      'heatpump_cop_status',
      'heatpump_operating_state',
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
      cop: this.copDiagnostics(),
      weatherCurve: {
        mode: store.weatherCurveMode,
        pausedUntil: store.weatherCurvePausedUntil,
        boost: weatherCurveBoost(store.weatherCurveBoostOffset, store.weatherCurveBoostUntil),
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
      insights: await this.insightsStatus(),
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
    await this.appendInsightsLogs(state);
    await this.setAvailable();
    this.reachable = true;
    if (!wasReachable) {
      await this.triggerDeviceAvailable();
    }
  }

  private async applyCapabilities(state: GreeVersatiState): Promise<void> {
    const copEstimate = this.copEstimate(state);
    const copStatus = this.copStatus(copEstimate);
    const operatingState = this.operatingState(state, copEstimate);
    await this.setCapabilityIfPresent('measure_temperature', state.waterOutTemperature);
    await this.setCapabilityIfPresent('measure_temperature.water_in', state.waterInTemperature);
    await this.setCapabilityIfPresent('measure_temperature.hot_water', state.hotWaterTemperature);
    await this.setCapabilityIfPresent('measure_temperature.optional_water', state.optimalWaterTemperature);
    await this.setCapabilityIfPresent('measure_temperature.remote_room', state.remoteRoomTemperature);
    await this.setCapabilityIfPresent('measure_temperature.heating_target', state.heatingTargetTemperature);
    await this.setCapabilityIfPresent('measure_temperature.cooling_target', state.coolingTargetTemperature);
    await this.setCapabilityIfPresent('measure_temperature.hot_water_target', state.hotWaterTargetTemperature);
    await this.setNullableCapabilityIfPresent('measure_temperature.water_delta', waterDeltaTemperature(state));
    await this.setNullableCapabilityIfPresent('measure_power.heat_output_estimated', copEstimate.status === 'ok' ? copEstimate.heatOutputKw * 1000 : null);
    await this.setNullableCapabilityIfPresent('measure_power.electrical_input_estimated', copEstimate.status === 'ok' ? copEstimate.electricalInputKw * 1000 : null);
    await this.setNullableCapabilityIfPresent('measure_cop_estimated', copEstimate.status === 'ok' ? copEstimate.cop : null);
    await this.setCapabilityIfPresent('heatpump_cop_status', copStatus);
    await this.setCapabilityIfPresent('heatpump_operating_state', operatingState);
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
    await this.updateCopFlowAlerts(copEstimate, copStatus);
    await this.updateOperatingAlerts(state, copEstimate, operatingState);
  }

  private copEstimate(state: GreeVersatiState): CopEstimate {
    const settings = this.getSettings() as Partial<VersatiSettings>;
    return calculateCopEstimate({
      waterInTemperature: state.waterInTemperature,
      waterOutTemperature: state.waterOutTemperature,
      waterFlowRateLMin: this.copWaterFlowRateLMin(settings),
      electricalInputKw: this.copElectricalInputKw(settings),
      power: state.power,
      defrosting: state.defrosting,
    });
  }

  private copWaterFlowRateLMin(settings = this.getSettings() as Partial<VersatiSettings>): number {
    const preset = copWaterFlowPreset(settings.copWaterFlowPreset);
    const presetFlow = COP_WATER_FLOW_PRESETS[preset];
    return presetFlow ?? numberSetting(settings.copWaterFlowRateLMin, 0);
  }

  private async applyCopWaterFlowPreset(settings: Record<string, SettingsValue>): Promise<void> {
    const preset = copWaterFlowPreset(settings.copWaterFlowPreset);
    const presetFlow = COP_WATER_FLOW_PRESETS[preset];
    if (presetFlow === null || numberSetting(settings.copWaterFlowRateLMin, 0) === presetFlow) {
      return;
    }
    await this.setSettings({ copWaterFlowRateLMin: presetFlow });
  }

  private copElectricalInputKw(settings = this.getSettings() as Partial<VersatiSettings>): number {
    if (settings.copElectricalInputSource === 'flow') {
      return numberOrNull(this.getStore().copFlowElectricalInputKw) ?? 0;
    }
    return numberSetting(settings.copElectricalInputKw, 0);
  }

  private copStatus(estimate: CopEstimate): CopStatus {
    const settings = this.getSettings() as Partial<VersatiSettings>;
    if (estimate.status === 'ok' && settings.copElectricalInputSource !== 'flow') {
      return 'fixed_estimate';
    }
    return estimate.status;
  }

  private copDiagnostics(): Record<string, unknown> {
    const settings = this.getSettings() as Partial<VersatiSettings>;
    return {
      inputSource: settings.copElectricalInputSource ?? 'fixed',
      waterFlowPreset: copWaterFlowPreset(settings.copWaterFlowPreset),
      waterFlowRateLMin: this.copWaterFlowRateLMin(settings),
      fixedElectricalInputKw: numberSetting(settings.copElectricalInputKw, 0),
      flowElectricalInputKw: numberOrNull(this.getStore().copFlowElectricalInputKw),
      flowElectricalInputAt: stringStoreValue(this.getStore().copFlowElectricalInputAt),
      lowThreshold: numberSetting(settings.copLowThreshold, 2),
      status: this.getCapabilityValue('heatpump_cop_status'),
    };
  }

  private operatingState(state: GreeVersatiState, estimate: CopEstimate): OperatingState {
    const waterDelta = waterDeltaTemperature(state);
    if (!state.power) {
      return 'off';
    }
    if (state.defrosting) {
      return 'defrosting';
    }
    if (state.tankHeaterActive || state.hpHeater1Active || state.hpHeater2Active) {
      return 'backup_heater';
    }
    if (state.fastHotWater) {
      return 'rapid_hot_water';
    }
    if (state.frostProtection) {
      return 'frost_protection';
    }
    if (state.mode === 'cool') {
      return 'cooling';
    }
    if (state.mode === 'hot_water') {
      return 'hot_water';
    }
    if (state.mode === 'heat_hot_water') {
      return (estimate.status === 'ok' ? estimate.waterDeltaTemperature : waterDelta ?? 0) > 0.5 ? 'heating' : 'idle';
    }
    return 'unknown';
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

  private async setNullableCapabilityIfPresent(capability: string, value: number | null): Promise<void> {
    if (!this.hasCapability(capability)) {
      return;
    }
    const previous = this.getCapabilityValue(capability);
    if (previous === value) {
      return;
    }
    try {
      await this.setCapabilityValue(capability, value);
    } catch (error) {
      this.error(`Failed to set ${capability}`, error);
    }
  }

  private async ensureRequiredCapabilities(): Promise<void> {
    for (const capability of REQUIRED_CAPABILITIES) {
      if (!this.hasCapability(capability)) {
        await this.addCapability(capability);
      }
    }
  }

  private async triggerCapabilityFlow(capability: string, value: boolean | number | string): Promise<void> {
    const token = FLOW_TRIGGER_TOKENS[capability];
    const booleanTriggerIds = BOOLEAN_FLOW_TRIGGER_IDS[capability];
    const triggerId = typeof value === 'boolean' && booleanTriggerIds ? booleanTriggerIds[String(value) as 'true' | 'false'] : undefined;

    if (token) {
      const cardId = FLOW_TRIGGER_CARD_IDS[capability] ?? `${capability}_changed`;
      await this.homey.flow.getTriggerCard(cardId).trigger({ [token]: value }).catch((error) => {
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
    const settings = this.getSettings() as Partial<VersatiSettings>;
    if (value === 'cool' && settings.allowCoolingModeWrites !== true) {
      throw new Error('Cool mode writes are disabled. Enable "Allow cooling mode writes" in device settings after confirming cooling is safe for this installation.');
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
      const targetTemperature = this.applyWeatherCurveBoost(result.targetTemperature, settings);
      await this.setCapabilityIfPresent('weather_curve_outdoor_temperature', result.outdoorTemperature);
      await this.setCapabilityIfPresent('weather_curve_heating_target', targetTemperature);
      await this.setCapabilityIfPresent('measure_temperature.curve_outdoor', result.outdoorTemperature);
      await this.setCapabilityIfPresent('measure_temperature.curve_heating_target', targetTemperature);
      await this.setStoreValue('weatherCurveOutdoorTemperature', result.outdoorTemperature);
      await this.setStoreValue('weatherCurveHeatingTarget', targetTemperature);
      await this.setStoreValue('weatherCurveLastEvaluatedAt', new Date().toISOString());

      if (settings.controlMode === 'dry_run') {
        await this.appendWeatherCurveAudit({
          action: 'skip',
          reason: 'dry_run',
          settings,
          state,
          outdoorTemperature: result.outdoorTemperature,
          calculatedTarget: targetTemperature,
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
          calculatedTarget: targetTemperature,
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
          calculatedTarget: targetTemperature,
        });
        await this.setWeatherCurveSkipped('missing_current_heating_target');
        return;
      }
      if (Math.abs(state.heatingTargetTemperature - targetTemperature) < settings.deadband) {
        await this.appendWeatherCurveAudit({
          action: 'skip',
          reason: 'deadband',
          settings,
          state,
          outdoorTemperature: result.outdoorTemperature,
          calculatedTarget: targetTemperature,
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
          calculatedTarget: targetTemperature,
          previousTarget: state.heatingTargetTemperature,
        });
        await this.setWeatherCurveSkipped('minimum_write_interval');
        return;
      }

      const previousTarget = state.heatingTargetTemperature;
      await this.clientOrThrow().setHeatingTargetTemperature(device, targetTemperature);
      await this.setCapabilityIfPresent('target_temperature_heating', targetTemperature);
      await this.setStoreValue('weatherCurveLastWriteAt', new Date().toISOString());
      await this.setStoreValue('weatherCurveLastWrittenTarget', targetTemperature);
      await this.setStoreValue('weatherCurveLastSkippedReason', '');
      await this.appendWeatherCurveAudit({
        action: 'write',
        reason: 'written',
        settings,
        state,
        outdoorTemperature: result.outdoorTemperature,
        calculatedTarget: targetTemperature,
        previousTarget,
        writtenTarget: targetTemperature,
      });
      await this.triggerWeatherCurveWritten(result.outdoorTemperature, targetTemperature, previousTarget);
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
    await this.triggerWeatherCurvePaused(pausedUntil);
    await this.refreshState();
  }

  private async setWeatherCurveBoost(offset: unknown, minutes: unknown): Promise<void> {
    const boostOffset = clampedNumber(offset, -5, 5, 0);
    const durationMinutes = weatherCurvePauseMinutes(minutes);
    const until = durationMinutes === 0
      ? 'manual'
      : new Date(Date.now() + durationMinutes * 60_000).toISOString();
    await this.setStoreValue('weatherCurveBoostOffset', boostOffset);
    await this.setStoreValue('weatherCurveBoostUntil', until);
    await this.refreshState();
  }

  private async clearWeatherCurveBoost(): Promise<void> {
    await this.setStoreValue('weatherCurveBoostOffset', 0);
    await this.setStoreValue('weatherCurveBoostUntil', '');
    await this.refreshState();
  }

  private async resumeWeatherCurve(): Promise<void> {
    await this.setStoreValue('weatherCurvePausedUntil', '');
    await this.triggerWeatherCurveResumed();
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

  private weatherCurveForecast(settings: WeatherCurveSettings): WeatherCurveForecast {
    const mode = heatPumpModeOrNull(this.getCapabilityValue('heatpump_mode'));
    const currentTarget = numberOrNull(this.getCapabilityValue('target_temperature_heating'));
    const base: WeatherCurveForecast = {
      wouldWrite: false,
      reason: '',
      outdoorTemperature: null,
      calculatedTarget: null,
      currentTarget,
      mode,
    };
    const pauseReason = this.weatherCurvePauseReason();
    if (pauseReason) {
      return { ...base, reason: pauseReason };
    }
    if (settings.controlMode === 'disabled') {
      return { ...base, reason: 'disabled' };
    }

    try {
      const outdoorTemperature = this.weatherCurveOutdoorTemperatureSync(settings);
      const result = calculateWeatherCurveTarget(outdoorTemperature, settings.config);
      const calculatedTarget = this.applyWeatherCurveBoost(result.targetTemperature, settings);
      const withTarget = { ...base, outdoorTemperature: result.outdoorTemperature, calculatedTarget };
      if (settings.controlMode === 'dry_run') {
        return { ...withTarget, reason: 'dry_run' };
      }
      if (mode !== 'heat_hot_water') {
        return { ...withTarget, reason: `mode:${mode ?? 'unknown'}` };
      }
      if (currentTarget === null) {
        return { ...withTarget, reason: 'missing_current_heating_target' };
      }
      if (Math.abs(currentTarget - calculatedTarget) < settings.deadband) {
        return { ...withTarget, reason: 'deadband' };
      }
      if (!this.weatherCurveWriteIntervalElapsed(settings.minWriteIntervalMs)) {
        return { ...withTarget, reason: 'minimum_write_interval' };
      }
      return { ...withTarget, wouldWrite: true, reason: 'write' };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { ...base, reason: `error:${message}` };
    }
  }

  private applyWeatherCurveBoost(targetTemperature: number, settings: WeatherCurveSettings): number {
    if (!settings.boost.active || settings.boost.offset === 0) {
      return targetTemperature;
    }
    return Math.min(Math.max(Math.round(targetTemperature + settings.boost.offset), settings.boostTargetMin), settings.boostTargetMax);
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
      boostOffset: input.settings.boost.active ? input.settings.boost.offset : 0,
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
    await this.homey.flow.getTriggerCard('weather_curve_skipped').trigger({ reason }).catch((error) => {
      this.error('Failed to trigger weather_curve_skipped flow', error);
    });
    if (this.shouldTriggerWeatherCurveWriteBlocked(reason)) {
      await this.triggerWeatherCurveWriteBlocked(reason);
    }
  }

  private async triggerWeatherCurveWritten(
    outdoorTemperature: number,
    targetTemperature: number,
    previousTarget: number,
  ): Promise<void> {
    await this.homey.flow.getTriggerCard('weather_curve_written').trigger({
      outdoor_temperature: outdoorTemperature,
      heating_target: targetTemperature,
      previous_heating_target: previousTarget,
    }).catch((error) => {
      this.error('Failed to trigger weather_curve_written flow', error);
    });
  }

  private async triggerWeatherCurveError(message: string): Promise<void> {
    await this.homey.flow.getTriggerCard('weather_curve_error').trigger({
      error: message,
    }).catch((error) => {
      this.error('Failed to trigger weather_curve_error flow', error);
    });
  }

  private shouldTriggerWeatherCurveWriteBlocked(reason: string): boolean {
    if (this.getStore().weatherCurveMode !== 'write') {
      return false;
    }
    return reason.startsWith('mode:') ||
      reason.startsWith('paused:') ||
      reason.startsWith('error:') ||
      reason === 'missing_current_heating_target';
  }

  private async triggerWeatherCurveWriteBlocked(reason: string): Promise<void> {
    await this.homey.flow.getTriggerCard('weather_curve_write_blocked').trigger({
      reason,
      hours_since_write: this.hoursSinceLastWeatherCurveWrite(),
    }).catch((error) => {
      this.error('Failed to trigger weather_curve_write_blocked flow', error);
    });
  }

  private async triggerWeatherCurvePaused(pausedUntil: string): Promise<void> {
    await this.homey.flow.getTriggerCard('weather_curve_paused').trigger({
      paused_until: pausedUntil,
    }).catch((error) => {
      this.error('Failed to trigger weather_curve_paused flow', error);
    });
  }

  private async triggerWeatherCurveResumed(): Promise<void> {
    await this.homey.flow.getTriggerCard('weather_curve_resumed').trigger().catch((error) => {
      this.error('Failed to trigger weather_curve_resumed flow', error);
    });
  }

  private async updateCopFlowAlerts(estimate: CopEstimate, status: CopStatus): Promise<void> {
    const previousStatus = stringStoreValue(this.getStore().copLastStatus);
    if (previousStatus !== status) {
      await this.setStoreValue('copLastStatus', status);
      await this.homey.flow.getTriggerCard('cop_status_changed').trigger({ status }).catch((error) => {
        this.error('Failed to trigger cop_status_changed flow', error);
      });
    }

    const settings = this.getSettings() as Partial<VersatiSettings>;
    const threshold = numberSetting(settings.copLowThreshold, 2);
    const belowThreshold = threshold > 0 && estimate.status === 'ok' && estimate.cop < threshold;
    const wasBelowThreshold = this.getStore().copWasBelowThreshold === true;
    await this.setStoreValue('copWasBelowThreshold', belowThreshold);
    if (belowThreshold && !wasBelowThreshold) {
      await this.homey.flow.getTriggerCard('cop_below_threshold').trigger({
        cop: estimate.cop,
        threshold,
        status,
      }).catch((error) => {
        this.error('Failed to trigger cop_below_threshold flow', error);
      });
    }
  }

  private async updateOperatingAlerts(
    state: GreeVersatiState,
    estimate: CopEstimate,
    operatingState: OperatingState,
  ): Promise<void> {
    const settings = this.getSettings() as Partial<VersatiSettings>;
    const waterDelta = waterDeltaTemperature(state);
    const lowWaterDeltaThreshold = numberSetting(settings.alertLowWaterDelta, 1);
    const hotWaterMargin = numberSetting(settings.alertHotWaterRecoveryMargin, 5);

    await this.updateSustainedAlert({
      key: 'defrosting',
      active: state.defrosting,
      thresholdMinutes: numberSetting(settings.alertDefrostingMinutes, 20),
      triggerId: 'defrosting_active_long',
      tokens: (minutes) => ({ minutes }),
    });
    await this.updateSustainedAlert({
      key: 'backup_heater',
      active: state.tankHeaterActive || state.hpHeater1Active || state.hpHeater2Active,
      thresholdMinutes: numberSetting(settings.alertBackupHeaterMinutes, 30),
      triggerId: 'backup_heater_active_long',
      tokens: (minutes) => ({ minutes, state: operatingState }),
    });
    await this.updateSustainedAlert({
      key: 'low_water_delta',
      active: Boolean(
        state.power &&
        state.mode === 'heat_hot_water' &&
        !state.defrosting &&
        lowWaterDeltaThreshold > 0 &&
        waterDelta !== null &&
        waterDelta < lowWaterDeltaThreshold,
      ),
      thresholdMinutes: numberSetting(settings.alertLowWaterDeltaMinutes, 20),
      triggerId: 'water_delta_low_long',
      tokens: (minutes) => ({
        water_delta: estimate.status === 'ok' ? estimate.waterDeltaTemperature : (waterDelta ?? 0),
        threshold: lowWaterDeltaThreshold,
        minutes,
      }),
    });
    await this.updateSustainedAlert({
      key: 'hot_water_recovery',
      active: Boolean(
        state.power &&
        (state.mode === 'hot_water' || state.mode === 'heat_hot_water' || state.fastHotWater) &&
        hotWaterMargin > 0 &&
        state.hotWaterTemperature !== null &&
        state.hotWaterTargetTemperature !== null &&
        state.hotWaterTemperature < state.hotWaterTargetTemperature - hotWaterMargin,
      ),
      thresholdMinutes: numberSetting(settings.alertHotWaterRecoveryMinutes, 120),
      triggerId: 'hot_water_recovery_slow',
      tokens: (minutes) => ({
        temperature: state.hotWaterTemperature ?? 0,
        target: state.hotWaterTargetTemperature ?? 0,
        minutes,
      }),
    });
  }

  private async updateSustainedAlert(input: {
    key: string;
    active: boolean;
    thresholdMinutes: number;
    triggerId: string;
    tokens(minutes: number): Record<string, string | number>;
  }): Promise<void> {
    const sinceKey = `alert:${input.key}:since`;
    const triggeredKey = `alert:${input.key}:triggered`;
    if (!input.active || input.thresholdMinutes <= 0) {
      await Promise.all([
        this.setStoreValue(sinceKey, ''),
        this.setStoreValue(triggeredKey, false),
      ]);
      return;
    }

    const now = Date.now();
    const existingSince = stringStoreValue(this.getStore()[sinceKey]);
    const since = existingSince || new Date(now).toISOString();
    if (!existingSince) {
      await this.setStoreValue(sinceKey, since);
    }

    const elapsedMinutes = (now - Date.parse(since)) / 60_000;
    if (elapsedMinutes < input.thresholdMinutes || this.getStore()[triggeredKey] === true) {
      return;
    }

    await this.setStoreValue(triggeredKey, true);
    await this.homey.flow.getTriggerCard(input.triggerId).trigger(input.tokens(Math.round(elapsedMinutes))).catch((error) => {
      this.error(`Failed to trigger ${input.triggerId} flow`, error);
    });
  }

  private hoursSinceLastWeatherCurveWrite(): number {
    const lastWriteAt = stringStoreValue(this.getStore().weatherCurveLastWriteAt);
    if (!lastWriteAt) {
      return -1;
    }
    const elapsedMs = Date.now() - Date.parse(lastWriteAt);
    if (!Number.isFinite(elapsedMs)) {
      return -1;
    }
    return Math.round(elapsedMs / 36_000) / 100;
  }

  private async weatherCurveOutdoorTemperature(settings: WeatherCurveSettings): Promise<number> {
    return this.weatherCurveOutdoorTemperatureSync(settings);
  }

  private weatherCurveOutdoorTemperatureSync(settings: WeatherCurveSettings): number {
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
      boost: weatherCurveBoost(this.getStore().weatherCurveBoostOffset, this.getStore().weatherCurveBoostUntil),
      boostTargetMin: clampedNumber(settings.curveBoostTargetMin, HEATING_TARGET_MIN, HEATING_TARGET_MAX, config.targetMin),
      boostTargetMax: clampedNumber(settings.curveBoostTargetMax, HEATING_TARGET_MIN, HEATING_TARGET_MAX, config.targetMax),
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
    const copEstimate = this.copEstimate(state);
    const copStatus = this.copStatus(copEstimate);
    const operatingState = this.operatingState(state, copEstimate);
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
      estimatedWaterDeltaTemperature: waterDeltaTemperature(state),
      estimatedHeatOutputW: copEstimate.status === 'ok' ? copEstimate.heatOutputKw * 1000 : null,
      estimatedElectricalInputW: copEstimate.status === 'ok' ? copEstimate.electricalInputKw * 1000 : null,
      estimatedCop: copEstimate.status === 'ok' ? copEstimate.cop : null,
      estimatedCopStatus: copStatus,
      mode: state.mode,
      operatingState,
    };
    await this.setStoreValue('telemetryHistory', [...history, sample].slice(-TELEMETRY_HISTORY_LIMIT));
  }

  private async appendInsightsLogs(state: GreeVersatiState): Promise<void> {
    for (const spec of INSIGHTS_LOG_SPECS) {
      const value = spec.value(state, this);
      if (value === null) {
        continue;
      }
      try {
        const log = await this.insightsLog(spec);
        await log.createEntry(value);
        await this.setStoreValue(`insightsLastEntryAt:${spec.id}`, new Date().toISOString());
        await this.setStoreValue(`insightsLastError:${spec.id}`, '');
      } catch (error) {
        await this.setStoreValue(`insightsLastError:${spec.id}`, error instanceof Error ? error.message : String(error));
        this.error(`Failed to write Insights log ${spec.id}`, error);
      }
    }
  }

  private async insightsLog(spec: InsightsLogSpec): Promise<{ createEntry(value: number | boolean): Promise<void> }> {
    const id = this.insightsLogId(spec.id);
    try {
      return await this.homey.insights.getLog(id);
    } catch {
      const options: {
        title: string;
        type: 'number' | 'boolean';
        units?: string;
        decimals?: number;
      } = {
        title: `${this.getName()} ${spec.title}`,
        type: spec.type,
      };
      if (spec.units) {
        options.units = spec.units;
      }
      if (typeof spec.decimals === 'number') {
        options.decimals = spec.decimals;
      }
      return this.homey.insights.createLog(id, options);
    }
  }

  private insightsLogId(metric: string): string {
    return `gv${stableDeviceHash(String(this.getData().id ?? this.getName()))}${metric}`.replace(/[^a-z0-9]/g, '').slice(0, 64);
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

function stableDeviceHash(value: string): string {
  let hash = 0x811c9dc5;
  for (const char of value) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}

function stringStoreValue(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function numberOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function nominalWaterFlowRate(heatingCapacityKw: number): number {
  return roundNumber(heatingCapacityKw * 60 / (4.186 * COP_NOMINAL_WATER_DELTA_C), 1);
}

function waterDeltaTemperature(state: GreeVersatiState): number | null {
  if (state.waterOutTemperature === null || state.waterInTemperature === null) {
    return null;
  }
  return roundNumber(state.waterOutTemperature - state.waterInTemperature, 2);
}

function roundNumber(value: number, decimals: number): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

function copStatus(value: unknown): CopStatus {
  return value === 'ok' ||
    value === 'fixed_estimate' ||
    value === 'off' ||
    value === 'defrosting' ||
    value === 'missing_temperature' ||
    value === 'missing_flow' ||
    value === 'missing_electrical_input' ||
    value === 'no_positive_water_delta'
    ? value
    : 'missing_electrical_input';
}

function operatingState(value: unknown): OperatingState {
  return value === 'off' ||
    value === 'idle' ||
    value === 'heating' ||
    value === 'hot_water' ||
    value === 'cooling' ||
    value === 'defrosting' ||
    value === 'backup_heater' ||
    value === 'rapid_hot_water' ||
    value === 'frost_protection' ||
    value === 'unknown'
    ? value
    : 'unknown';
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
      estimatedWaterDeltaTemperature: numberOrNull(sample.estimatedWaterDeltaTemperature),
      estimatedHeatOutputW: numberOrNull(sample.estimatedHeatOutputW),
      estimatedElectricalInputW: numberOrNull(sample.estimatedElectricalInputW),
      estimatedCop: numberOrNull(sample.estimatedCop),
      estimatedCopStatus: copStatus(sample.estimatedCopStatus),
      mode: weatherCurveHeatPumpMode(sample.mode),
      operatingState: operatingState(sample.operatingState),
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
      boostOffset: numberOrNull(entry.boostOffset) ?? 0,
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

function copWaterFlowPreset(value: unknown): CopWaterFlowPreset {
  return typeof value === 'string' && value in COP_WATER_FLOW_PRESETS
    ? value as CopWaterFlowPreset
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

function heatPumpModeOrNull(value: unknown): GreeVersatiState['mode'] | null {
  return weatherCurveHeatPumpMode(value);
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

function weatherCurveBoost(offsetValue: unknown, untilValue: unknown): WeatherCurveBoost {
  const offset = clampedNumber(offsetValue, -5, 5, 0);
  const until = stringStoreValue(untilValue);
  if (!offset || !until) {
    return { offset: 0, until: '', active: false };
  }
  if (until === 'manual') {
    return { offset, until, active: true };
  }
  const untilMs = Date.parse(until);
  return { offset, until, active: Number.isFinite(untilMs) && Date.now() < untilMs };
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
    curveBoostTargetMin: clampedNumber(input.curveBoostTargetMin, HEATING_TARGET_MIN, HEATING_TARGET_MAX, DEFAULT_WEATHER_CURVE_CONFIG.targetMin),
    curveBoostTargetMax: clampedNumber(input.curveBoostTargetMax, HEATING_TARGET_MIN, HEATING_TARGET_MAX, DEFAULT_WEATHER_CURVE_CONFIG.targetMax),
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
