import dgram from 'node:dgram';
import os from 'node:os';
import {
  AWHP_PROPS,
  COOL_MODE,
  Cipher,
  CipherV1,
  CipherV2,
  HEAT_MODE,
  HOT_WATER_MODE,
  PacketEnvelope,
  READ_ONLY_COLUMNS,
  celsiusFromSplit,
  createBindMessage,
  createScanMessage,
  createStatusMessage,
  decodeEnvelope,
  encodeEnvelope,
  type EncryptionVersion,
} from './protocol';

export interface GreeVersatiDeviceInfo {
  ip: string;
  port: number;
  mac: string;
  name?: string;
  brand?: string;
  model?: string;
  version?: string;
}

export interface BoundGreeVersatiDevice extends GreeVersatiDeviceInfo {
  key: string;
  encryptionVersion: EncryptionVersion;
}

export interface GreeVersatiState {
  raw: Record<string, unknown>;
  waterInTemperature: number | null;
  waterOutTemperature: number | null;
  hotWaterTemperature: number | null;
  optimalWaterTemperature: number | null;
  remoteRoomTemperature: number | null;
  heatingTargetTemperature: number | null;
  coolingTargetTemperature: number | null;
  hotWaterTargetTemperature: number | null;
  power: boolean;
  mode: 'off' | 'heat_hot_water' | 'cool' | 'hot_water' | 'other';
  fastHotWater: boolean;
  silence: boolean;
  weatherDependent: boolean;
  disinfect: boolean;
  tankHeaterActive: boolean;
  defrosting: boolean;
  hpHeater1Active: boolean;
  hpHeater2Active: boolean;
  frostProtection: boolean;
  versatiSeries: unknown;
}

export interface GreeVersatiClientOptions {
  port?: number;
  timeoutMs?: number;
  bindTimeoutMs?: number;
  broadcastAddresses?: string[];
}

const DEFAULT_PORT = 7000;
const DEFAULT_TIMEOUT_MS = 3000;
const DEFAULT_BIND_TIMEOUT_MS = 3500;
const MAX_COLUMNS_PER_REQUEST = 23;

export class GreeVersatiClient {
  private readonly port: number;
  private readonly timeoutMs: number;
  private readonly bindTimeoutMs: number;
  private readonly broadcastAddresses?: string[];

  constructor(options: GreeVersatiClientOptions = {}) {
    this.port = options.port ?? DEFAULT_PORT;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.bindTimeoutMs = options.bindTimeoutMs ?? DEFAULT_BIND_TIMEOUT_MS;
    this.broadcastAddresses = options.broadcastAddresses;
  }

  async discover(waitMs = 2500): Promise<GreeVersatiDeviceInfo[]> {
    const socket = dgram.createSocket('udp4');
    const found = new Map<string, GreeVersatiDeviceInfo>();

    await bindSocket(socket);
    socket.setBroadcast(true);

    const onMessage = (message: Buffer, rinfo: dgram.RemoteInfo): void => {
      try {
        const envelope = decodeDiscoveryEnvelope(message);
        const pack = envelope.pack as Record<string, unknown> | undefined;
        if (!pack || pack.t !== 'dev') {
          return;
        }
        const mac = String(pack.mac ?? pack.cid ?? '');
        if (!mac) {
          return;
        }
        found.set(mac, {
          ip: rinfo.address,
          port: rinfo.port || this.port,
          mac,
          name: maybeString(pack.name),
          brand: maybeString(pack.brand),
          model: maybeString(pack.model),
          version: maybeString(pack.ver),
        });
      } catch {
        // Ignore unrelated UDP traffic while scanning.
      }
    };

    socket.on('message', onMessage);
    for (const address of this.broadcastAddresses ?? getBroadcastAddresses()) {
      socket.send(encodeEnvelope(createScanMessage()), this.port, address);
    }

    await delay(waitMs);
    socket.off('message', onMessage);
    socket.close();
    return [...found.values()];
  }

  async bind(device: GreeVersatiDeviceInfo): Promise<BoundGreeVersatiDevice> {
    const errors: unknown[] = [];
    for (const cipher of [new CipherV1(), new CipherV2()]) {
      try {
        const envelope = await this.sendAndReceive(device, createBindMessage(device.mac), cipher, this.bindTimeoutMs);
        const pack = envelope.pack as Record<string, unknown> | undefined;
        if (pack?.t === 'bindok' && typeof pack.key === 'string') {
          return { ...device, key: pack.key, encryptionVersion: cipher.version };
        }
      } catch (error) {
        errors.push(error);
      }
    }
    throw new Error(`Unable to bind to ${device.mac}; attempted ECB and GCM (${errors.length} failures)`);
  }

  async getState(device: BoundGreeVersatiDevice): Promise<GreeVersatiState> {
    const raw: Record<string, unknown> = {};

    for (let index = 0; index < READ_ONLY_COLUMNS.length; index += MAX_COLUMNS_PER_REQUEST) {
      const columns = READ_ONLY_COLUMNS.slice(index, index + MAX_COLUMNS_PER_REQUEST);
      Object.assign(raw, await this.getRawColumns(device, columns));
    }

    return normalizeState(raw);
  }

  async getRawColumns(device: BoundGreeVersatiDevice, columns: readonly string[]): Promise<Record<string, unknown>> {
    const cipher = createDeviceCipher(device);
    const envelope = await this.sendAndReceive(device, createStatusMessage(device.mac, columns), cipher, this.timeoutMs);
    const pack = envelope.pack as Record<string, unknown> | undefined;
    if (pack?.t !== 'dat' || !Array.isArray(pack.cols) || !Array.isArray(pack.dat)) {
      throw new Error(`Unexpected status response from ${device.mac}`);
    }
    const raw: Record<string, unknown> = {};
    for (const [columnIndex, column] of pack.cols.entries()) {
      raw[String(column)] = pack.dat[columnIndex];
    }
    return raw;
  }

  private async sendAndReceive(
    device: GreeVersatiDeviceInfo,
    envelope: PacketEnvelope,
    cipher: Cipher,
    timeoutMs: number,
  ): Promise<PacketEnvelope> {
    const socket = dgram.createSocket('udp4');
    await bindSocket(socket);

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        cleanup();
        reject(new Error(`Timed out waiting for ${device.mac}`));
      }, timeoutMs);

      const cleanup = (): void => {
        clearTimeout(timer);
        socket.off('message', onMessage);
        socket.close();
      };

      const onMessage = (message: Buffer): void => {
        try {
          const decoded = decodeEnvelope(message, cipher);
          cleanup();
          resolve(decoded);
        } catch (error) {
          cleanup();
          reject(error);
        }
      };

      socket.on('message', onMessage);
      socket.send(encodeEnvelope(envelope, cipher), device.port || this.port, device.ip, (error) => {
        if (error) {
          cleanup();
          reject(error);
        }
      });
    });
  }
}

export function normalizeState(raw: Record<string, unknown>): GreeVersatiState {
  const modeNumber = typeof raw[AWHP_PROPS.mode] === 'number' ? raw[AWHP_PROPS.mode] : null;
  const power = Boolean(raw[AWHP_PROPS.power]);

  return {
    raw,
    waterInTemperature: celsiusFromSplit(raw[AWHP_PROPS.waterInHigh], raw[AWHP_PROPS.waterInLow]),
    waterOutTemperature: celsiusFromSplit(raw[AWHP_PROPS.waterOutHigh], raw[AWHP_PROPS.waterOutLow]),
    hotWaterTemperature: celsiusFromSplit(raw[AWHP_PROPS.hotWaterHigh], raw[AWHP_PROPS.hotWaterLow]),
    optimalWaterTemperature: celsiusFromSplit(raw[AWHP_PROPS.optimalWaterHigh], raw[AWHP_PROPS.optimalWaterLow]),
    remoteRoomTemperature: celsiusFromSplit(raw[AWHP_PROPS.remoteRoomHigh], raw[AWHP_PROPS.remoteRoomLow]),
    heatingTargetTemperature: maybeNumber(raw[AWHP_PROPS.heatingTarget]),
    coolingTargetTemperature: maybeNumber(raw[AWHP_PROPS.coolingTarget]),
    hotWaterTargetTemperature: maybeNumber(raw[AWHP_PROPS.hotWaterTarget]),
    power,
    mode: !power
      ? 'off'
      : modeNumber === HEAT_MODE
        ? 'heat_hot_water'
        : modeNumber === COOL_MODE
          ? 'cool'
          : modeNumber === HOT_WATER_MODE
            ? 'hot_water'
            : 'other',
    fastHotWater: Boolean(raw[AWHP_PROPS.fastHotWater]),
    silence: Boolean(raw[AWHP_PROPS.quiet]),
    weatherDependent: Boolean(raw[AWHP_PROPS.weatherDependent]),
    disinfect: Boolean(raw[AWHP_PROPS.disinfect]),
    tankHeaterActive: Boolean(raw[AWHP_PROPS.tankHeaterStatus]),
    defrosting: Boolean(raw[AWHP_PROPS.defrostingStatus]),
    hpHeater1Active: Boolean(raw[AWHP_PROPS.hpHeater1Status]),
    hpHeater2Active: Boolean(raw[AWHP_PROPS.hpHeater2Status]),
    frostProtection: Boolean(raw[AWHP_PROPS.frostProtection]),
    versatiSeries: raw[AWHP_PROPS.versatiSeries],
  };
}

function createDeviceCipher(device: BoundGreeVersatiDevice): Cipher {
  return device.encryptionVersion === 2 ? new CipherV2(device.key) : new CipherV1(device.key);
}

function decodeDiscoveryEnvelope(message: Buffer): PacketEnvelope {
  const errors: unknown[] = [];
  for (const cipher of [undefined, new CipherV1(), new CipherV2()] as const) {
    try {
      return decodeEnvelope(message, cipher);
    } catch (error) {
      errors.push(error);
    }
  }
  throw new Error(`Unable to decode discovery packet (${errors.length} attempts)`);
}

function getBroadcastAddresses(): string[] {
  const addresses = new Set<string>(['255.255.255.255']);
  for (const iface of Object.values(os.networkInterfaces())) {
    for (const address of iface ?? []) {
      if (address.family !== 'IPv4' || address.internal || !address.cidr) {
        continue;
      }
      const [ip, prefixText] = address.cidr.split('/');
      const prefix = Number(prefixText);
      if (!ip || !Number.isInteger(prefix)) {
        continue;
      }
      const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
      const ipNumber = ipv4ToNumber(ip);
      addresses.add(numberToIpv4((ipNumber & mask) | (~mask >>> 0)));
    }
  }
  return [...addresses];
}

function ipv4ToNumber(ip: string): number {
  return ip.split('.').reduce((acc, part) => (acc << 8) + Number(part), 0) >>> 0;
}

function numberToIpv4(value: number): string {
  return [24, 16, 8, 0].map((shift) => (value >>> shift) & 255).join('.');
}

function bindSocket(socket: dgram.Socket): Promise<void> {
  return new Promise((resolve) => {
    socket.bind(0, '0.0.0.0', resolve);
  });
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function maybeString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function maybeNumber(value: unknown): number | null {
  return typeof value === 'number' ? value : null;
}
