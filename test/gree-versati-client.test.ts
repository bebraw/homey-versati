import dgram from 'node:dgram';
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  GreeVersatiClient,
  type BoundGreeVersatiDevice,
} from '../src/lib/gree-versati-client';
import {
  AWHP_PROPS,
  CipherV1,
  createBindMessage,
  createStatusMessage,
  decodeEnvelope,
  encodeEnvelope,
  type PacketEnvelope,
} from '../src/lib/protocol';

const MAC = 'f4911e7aca59';
const DEVICE_KEY = 'St8Vw1Yz4Bc7Ef0H';

const FAKE_STATE: Record<string, unknown> = {
  [AWHP_PROPS.waterInHigh]: 125,
  [AWHP_PROPS.waterInLow]: 5,
  [AWHP_PROPS.waterOutHigh]: 126,
  [AWHP_PROPS.waterOutLow]: 3,
  [AWHP_PROPS.optimalWaterHigh]: 127,
  [AWHP_PROPS.optimalWaterLow]: 2,
  [AWHP_PROPS.hotWaterHigh]: 128,
  [AWHP_PROPS.hotWaterLow]: 1,
  [AWHP_PROPS.remoteRoomHigh]: 120,
  [AWHP_PROPS.remoteRoomLow]: 3,
  [AWHP_PROPS.power]: 1,
  [AWHP_PROPS.mode]: 2,
  [AWHP_PROPS.heatingTarget]: 33,
  [AWHP_PROPS.coolingTarget]: 18,
  [AWHP_PROPS.hotWaterTarget]: 55,
  [AWHP_PROPS.fastHotWater]: 0,
  [AWHP_PROPS.quiet]: 1,
  [AWHP_PROPS.weatherDependent]: 1,
  [AWHP_PROPS.disinfect]: 1,
  [AWHP_PROPS.tankHeaterStatus]: 1,
  [AWHP_PROPS.defrostingStatus]: 0,
  [AWHP_PROPS.hpHeater1Status]: 1,
  [AWHP_PROPS.hpHeater2Status]: 0,
  [AWHP_PROPS.frostProtection]: 1,
  [AWHP_PROPS.versatiSeries]: 3,
};

test('discovers and binds a Gree Versati device over UDP', async () => {
  const server = await startFakeDevice({ encryptedDiscovery: false });
  try {
    const client = new GreeVersatiClient({
      port: server.port,
      broadcastAddresses: ['127.0.0.1'],
      timeoutMs: 500,
      bindTimeoutMs: 500,
    });

    const devices = await client.discover(100);
    assert.equal(devices.length, 1);
    assert.equal(devices[0]?.mac, MAC);

    const bound = await client.bind(devices[0]!);
    assert.equal(bound.key, DEVICE_KEY);
    assert.equal(bound.encryptionVersion, 1);
  } finally {
    await server.close();
  }
});

test('discovers a device with an encrypted discovery response', async () => {
  const server = await startFakeDevice({ encryptedDiscovery: true });
  try {
    const client = new GreeVersatiClient({
      port: server.port,
      broadcastAddresses: ['127.0.0.1'],
      timeoutMs: 500,
      bindTimeoutMs: 500,
    });

    const devices = await client.discover(100);
    assert.equal(devices.length, 1);
    assert.equal(devices[0]?.mac, MAC);
  } finally {
    await server.close();
  }
});

test('reads and normalizes read-only state over UDP', async () => {
  const server = await startFakeDevice({ encryptedDiscovery: false });
  try {
    const client = new GreeVersatiClient({ port: server.port, timeoutMs: 500 });
    const bound: BoundGreeVersatiDevice = {
      ip: '127.0.0.1',
      port: server.port,
      mac: MAC,
      key: DEVICE_KEY,
      encryptionVersion: 1,
    };

    const state = await client.getState(bound);
    assert.equal(state.waterInTemperature, 25.5);
    assert.equal(state.waterOutTemperature, 26.3);
    assert.equal(state.hotWaterTemperature, 28.1);
    assert.equal(state.optimalWaterTemperature, 27.2);
    assert.equal(state.remoteRoomTemperature, 20.3);
    assert.equal(state.heatingTargetTemperature, 33);
    assert.equal(state.coolingTargetTemperature, 18);
    assert.equal(state.hotWaterTargetTemperature, 55);
    assert.equal(state.power, true);
    assert.equal(state.mode, 'hot_water');
    assert.equal(state.tankHeaterActive, true);
    assert.equal(state.silence, true);
    assert.equal(state.weatherDependent, true);
    assert.equal(state.disinfect, true);
    assert.equal(state.frostProtection, true);
  } finally {
    await server.close();
  }
});

test('normalizes heat plus hot water mode', async () => {
  const server = await startFakeDevice({ encryptedDiscovery: false, state: { [AWHP_PROPS.mode]: 4 } });
  try {
    const client = new GreeVersatiClient({ port: server.port, timeoutMs: 500 });
    const state = await client.getState({
      ip: '127.0.0.1',
      port: server.port,
      mac: MAC,
      key: DEVICE_KEY,
      encryptionVersion: 1,
    });
    assert.equal(state.mode, 'heat_hot_water');
  } finally {
    await server.close();
  }
});

test('writes heat pump mode over UDP command packets', async () => {
  const server = await startFakeDevice({ encryptedDiscovery: false });
  try {
    const client = new GreeVersatiClient({ port: server.port, timeoutMs: 500 });
    const bound: BoundGreeVersatiDevice = {
      ip: '127.0.0.1',
      port: server.port,
      mac: MAC,
      key: DEVICE_KEY,
      encryptionVersion: 1,
    };

    await client.setMode(bound, 'heat_hot_water');
    let state = await client.getState(bound);
    assert.equal(state.mode, 'heat_hot_water');
    assert.equal(state.raw[AWHP_PROPS.power], 1);
    assert.equal(state.raw[AWHP_PROPS.mode], 4);

    await client.setMode(bound, 'off');
    state = await client.getState(bound);
    assert.equal(state.mode, 'off');
    assert.equal(state.raw[AWHP_PROPS.power], 0);
    assert.equal(state.raw[AWHP_PROPS.mode], 4);
  } finally {
    await server.close();
  }
});

test('writes heating and hot water targets over UDP command packets', async () => {
  const server = await startFakeDevice({ encryptedDiscovery: false });
  try {
    const client = new GreeVersatiClient({ port: server.port, timeoutMs: 500 });
    const bound: BoundGreeVersatiDevice = {
      ip: '127.0.0.1',
      port: server.port,
      mac: MAC,
      key: DEVICE_KEY,
      encryptionVersion: 1,
    };

    await client.setHeatingTargetTemperature(bound, 36);
    await client.setHotWaterTargetTemperature(bound, 51);

    const state = await client.getState(bound);
    assert.equal(state.heatingTargetTemperature, 36);
    assert.equal(state.hotWaterTargetTemperature, 51);
    assert.equal(state.raw[AWHP_PROPS.heatingTarget], 36);
    assert.equal(state.raw[AWHP_PROPS.hotWaterTarget], 51);
  } finally {
    await server.close();
  }
});

test('writes guarded boolean toggles over UDP command packets', async () => {
  const server = await startFakeDevice({ encryptedDiscovery: false });
  try {
    const client = new GreeVersatiClient({ port: server.port, timeoutMs: 500 });
    const bound: BoundGreeVersatiDevice = {
      ip: '127.0.0.1',
      port: server.port,
      mac: MAC,
      key: DEVICE_KEY,
      encryptionVersion: 1,
    };

    await client.setFastHotWater(bound, true);
    await client.setSilence(bound, false);
    await client.setWeatherDependent(bound, false);
    await client.setDisinfect(bound, false);

    let state = await client.getState(bound);
    assert.equal(state.fastHotWater, true);
    assert.equal(state.silence, false);
    assert.equal(state.weatherDependent, false);
    assert.equal(state.disinfect, false);
    assert.equal(state.raw[AWHP_PROPS.fastHotWater], 1);
    assert.equal(state.raw[AWHP_PROPS.quiet], 0);
    assert.equal(state.raw[AWHP_PROPS.weatherDependent], 0);
    assert.equal(state.raw[AWHP_PROPS.disinfect], 0);

    await client.setFastHotWater(bound, false);
    await client.setSilence(bound, true);
    await client.setWeatherDependent(bound, true);
    await client.setDisinfect(bound, true);

    state = await client.getState(bound);
    assert.equal(state.fastHotWater, false);
    assert.equal(state.silence, true);
    assert.equal(state.weatherDependent, true);
    assert.equal(state.disinfect, true);
    assert.equal(state.raw[AWHP_PROPS.fastHotWater], 0);
    assert.equal(state.raw[AWHP_PROPS.quiet], 1);
    assert.equal(state.raw[AWHP_PROPS.weatherDependent], 1);
    assert.equal(state.raw[AWHP_PROPS.disinfect], 1);
  } finally {
    await server.close();
  }
});

test('clamps target temperature writes to conservative ranges', async () => {
  const server = await startFakeDevice({ encryptedDiscovery: false });
  try {
    const client = new GreeVersatiClient({ port: server.port, timeoutMs: 500 });
    const bound: BoundGreeVersatiDevice = {
      ip: '127.0.0.1',
      port: server.port,
      mac: MAC,
      key: DEVICE_KEY,
      encryptionVersion: 1,
    };

    await client.setHeatingTargetTemperature(bound, 100);
    await client.setHotWaterTargetTemperature(bound, 1);

    const state = await client.getState(bound);
    assert.equal(state.heatingTargetTemperature, 55);
    assert.equal(state.hotWaterTargetTemperature, 30);
  } finally {
    await server.close();
  }
});

test('protocol helpers encode bind and status envelopes with encrypted pack data', () => {
  const cipher = new CipherV1();
  const bind = JSON.parse(encodeEnvelope(createBindMessage(MAC), cipher).toString('utf8')) as PacketEnvelope;
  assert.equal(bind.t, 'pack');
  assert.equal(bind.i, 1);
  assert.equal(typeof bind.pack, 'string');

  const decodedBind = decodeEnvelope(Buffer.from(JSON.stringify(bind)), cipher);
  assert.deepEqual(decodedBind.pack, { t: 'bind', mac: MAC, uid: 0 });

  const deviceCipher = new CipherV1(DEVICE_KEY);
  const status = JSON.parse(encodeEnvelope(createStatusMessage(MAC, ['Pow']), deviceCipher).toString('utf8')) as PacketEnvelope;
  const decodedStatus = decodeEnvelope(Buffer.from(JSON.stringify(status)), deviceCipher);
  assert.deepEqual(decodedStatus.pack, { t: 'status', mac: MAC, cols: ['Pow'] });
});

async function startFakeDevice(options: { encryptedDiscovery: boolean; state?: Record<string, unknown> }): Promise<{ port: number; close: () => Promise<void> }> {
  const socket = dgram.createSocket('udp4');
  const defaultCipher = new CipherV1();
  const deviceCipher = new CipherV1(DEVICE_KEY);
  const mutableState = { ...FAKE_STATE, ...options.state };

  socket.on('message', (message, rinfo) => {
    const outer = JSON.parse(message.toString('utf8')) as PacketEnvelope;
    if (outer.t === 'scan') {
      const response: PacketEnvelope = {
        t: 'pack',
        i: 1,
        uid: 0,
        cid: MAC,
        tcid: '',
        pack: {
          t: 'dev',
          cid: MAC,
          mac: MAC,
          name: 'Versati',
          brand: 'gree',
          model: 'gree',
          ver: 'V1.2.1',
        },
      };
      socket.send(
        options.encryptedDiscovery
          ? encodeEnvelope(response, defaultCipher)
          : JSON.stringify(response),
        rinfo.port,
        rinfo.address,
      );
      return;
    }

    const cipher = outer.i === 1 ? defaultCipher : deviceCipher;
    const decoded = decodeEnvelope(message, cipher);
    const pack = decoded.pack as Record<string, unknown>;

    if (pack.t === 'bind') {
      socket.send(encodeEnvelope({
        t: 'pack',
        i: 1,
        uid: 0,
        cid: MAC,
        tcid: '',
        pack: {
          t: 'bindok',
          mac: MAC,
          key: DEVICE_KEY,
          r: 200,
        },
      }, defaultCipher), rinfo.port, rinfo.address);
      return;
    }

    if (pack.t === 'status' && Array.isArray(pack.cols)) {
      const cols = pack.cols.map(String);
      socket.send(encodeEnvelope({
        t: 'pack',
        i: 0,
        uid: 0,
        cid: MAC,
        tcid: '',
        pack: {
          t: 'dat',
          mac: MAC,
          r: 200,
          cols,
          dat: cols.map((column) => mutableState[column] ?? 0),
        },
      }, deviceCipher), rinfo.port, rinfo.address);
      return;
    }

    if (pack.t === 'cmd' && Array.isArray(pack.opt) && Array.isArray(pack.p)) {
      for (const [index, property] of pack.opt.entries()) {
        mutableState[String(property)] = pack.p[index];
      }
      const props = pack.opt.map(String);
      socket.send(encodeEnvelope({
        t: 'pack',
        i: 0,
        uid: 0,
        cid: MAC,
        tcid: '',
        pack: {
          t: 'res',
          mac: MAC,
          r: 200,
          opt: props,
          p: props.map((property) => mutableState[property]),
          val: props.map((property) => mutableState[property]),
        },
      }, deviceCipher), rinfo.port, rinfo.address);
    }
  });

  await new Promise<void>((resolve) => socket.bind(0, '127.0.0.1', resolve));
  const address = socket.address();
  assert.equal(typeof address, 'object');
  return {
    port: address.port,
    close: () => new Promise((resolve) => socket.close(() => resolve())),
  };
}
