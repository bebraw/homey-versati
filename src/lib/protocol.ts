import crypto from 'node:crypto';

export type EncryptionVersion = 1 | 2;

export interface Cipher {
  readonly version: EncryptionVersion;
  key: string;
  encrypt(pack: unknown): { pack: string; tag?: string };
  decrypt(pack: string, tag?: string): unknown;
}

const V1_DEFAULT_KEY = 'a3K8Bx%2r8Y7#xDh';
const V2_DEFAULT_KEY = '{yxAHAY_Lm6pbC/<';
const V2_NONCE = Buffer.from([0x54, 0x40, 0x78, 0x44, 0x49, 0x67, 0x5a, 0x51, 0x6c, 0x5e, 0x63, 0x13]);
const V2_AAD = Buffer.from('qualcomm-test');

function trimJsonPadding(data: Buffer): string {
  const text = data.toString('utf8');
  const end = text.lastIndexOf('}');
  if (end === -1) {
    throw new Error('Decrypted payload did not contain a JSON object');
  }
  return text.slice(0, end + 1);
}

function pkcs7Pad(data: Buffer): Buffer {
  const pad = 16 - (data.length % 16);
  return Buffer.concat([data, Buffer.alloc(pad, pad)]);
}

export class CipherV1 implements Cipher {
  readonly version = 1;
  key: string;

  constructor(key = V1_DEFAULT_KEY) {
    this.key = key;
  }

  encrypt(pack: unknown): { pack: string } {
    const cipher = crypto.createCipheriv('aes-128-ecb', Buffer.from(this.key), null);
    cipher.setAutoPadding(false);
    const encrypted = Buffer.concat([
      cipher.update(pkcs7Pad(Buffer.from(JSON.stringify(pack), 'utf8'))),
      cipher.final(),
    ]);
    return { pack: encrypted.toString('base64') };
  }

  decrypt(pack: string): unknown {
    const decipher = crypto.createDecipheriv('aes-128-ecb', Buffer.from(this.key), null);
    decipher.setAutoPadding(false);
    const decrypted = Buffer.concat([
      decipher.update(Buffer.from(pack, 'base64')),
      decipher.final(),
    ]);
    return JSON.parse(trimJsonPadding(decrypted));
  }
}

export class CipherV2 implements Cipher {
  readonly version = 2;
  key: string;

  constructor(key = V2_DEFAULT_KEY) {
    this.key = key;
  }

  encrypt(pack: unknown): { pack: string; tag: string } {
    const cipher = crypto.createCipheriv('aes-128-gcm', Buffer.from(this.key), V2_NONCE);
    cipher.setAAD(V2_AAD);
    const encrypted = Buffer.concat([
      cipher.update(Buffer.from(JSON.stringify(pack), 'utf8')),
      cipher.final(),
    ]);
    return {
      pack: encrypted.toString('base64'),
      tag: cipher.getAuthTag().toString('base64'),
    };
  }

  decrypt(pack: string, tag?: string): unknown {
    const decipher = crypto.createDecipheriv('aes-128-gcm', Buffer.from(this.key), V2_NONCE);
    decipher.setAAD(V2_AAD);
    if (tag) {
      decipher.setAuthTag(Buffer.from(tag, 'base64'));
    }
    const decrypted = decipher.update(Buffer.from(pack, 'base64'));
    if (tag) {
      decipher.final();
    }
    return JSON.parse(trimJsonPadding(decrypted));
  }
}

export const AWHP_PROPS = {
  waterInHigh: 'AllInWatTemHi',
  waterInLow: 'AllInWatTemLo',
  waterOutHigh: 'AllOutWatTemHi',
  waterOutLow: 'AllOutWatTemLo',
  optimalWaterHigh: 'HepOutWatTemHi',
  optimalWaterLow: 'HepOutWatTemLo',
  hotWaterHigh: 'WatBoxTemHi',
  hotWaterLow: 'WatBoxTemLo',
  tankHeaterStatus: 'WatBoxElcHeRunSta',
  defrostingStatus: 'SyAnFroRunSta',
  hpHeater1Status: 'ElcHe1RunSta',
  hpHeater2Status: 'ElcHe2RunSta',
  frostProtection: 'AnFrzzRunSta',
  power: 'Pow',
  mode: 'Mod',
  coolingTarget: 'CoWatOutTemSet',
  heatingTarget: 'HeWatOutTemSet',
  hotWaterTarget: 'WatBoxTemSet',
  fastHotWater: 'FastHtWter',
  quiet: 'Quiet',
  powerSave: 'SvSt',
  versatiSeries: 'VersatiSeries',
  modelType: 'ModelType',
  evu: 'EVU',
} as const;

export const READ_ONLY_COLUMNS = Object.values(AWHP_PROPS);

export const HEAT_MODE = 4;
export const COOL_MODE = 1;

export interface PacketEnvelope {
  t: string;
  i?: number;
  uid?: number;
  cid?: string;
  tcid?: string;
  pack?: unknown;
  tag?: string;
}

export function createScanMessage(): PacketEnvelope {
  return { t: 'scan' };
}

export function createBindMessage(mac: string): PacketEnvelope {
  return {
    cid: 'app',
    i: 1,
    t: 'pack',
    uid: 0,
    tcid: mac,
    pack: { t: 'bind', mac, uid: 0 },
  };
}

export function createStatusMessage(mac: string, columns = READ_ONLY_COLUMNS): PacketEnvelope {
  return {
    cid: 'app',
    i: 0,
    t: 'pack',
    uid: 0,
    tcid: mac,
    pack: { t: 'status', mac, cols: columns },
  };
}

export function encodeEnvelope(envelope: PacketEnvelope, cipher?: Cipher): Buffer {
  const outgoing: PacketEnvelope = { ...envelope };
  if (outgoing.pack) {
    if (!cipher) {
      throw new Error('Cipher is required for encrypted pack payloads');
    }
    const encrypted = cipher.encrypt(outgoing.pack);
    outgoing.pack = encrypted.pack;
    if (encrypted.tag) {
      outgoing.tag = encrypted.tag;
    }
  }
  return Buffer.from(JSON.stringify(outgoing), 'utf8');
}

export function decodeEnvelope(data: Buffer, cipher?: Cipher): PacketEnvelope {
  const envelope = JSON.parse(data.toString('utf8')) as PacketEnvelope;
  if (typeof envelope.pack === 'string') {
    if (!cipher) {
      throw new Error('Cipher is required for encrypted pack payloads');
    }
    envelope.pack = cipher.decrypt(envelope.pack, envelope.tag);
  }
  return envelope;
}

export function celsiusFromSplit(high: unknown, low: unknown): number | null {
  if (typeof high !== 'number' || typeof low !== 'number') {
    return null;
  }
  return high - 100 + low / 10;
}
