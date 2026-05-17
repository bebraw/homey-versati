# Gree Versati Protocol Boundaries

Source read:

- `roihuvaara/hacs_gree_versati` Home Assistant wrapper, especially `custom_components/gree_versati/client.py`, `config_flow.py`, and `discovery_listener.py`.
- Its declared protocol dependency, `roihuvaara/greeclimate@r1.0.12`, especially `gree_versati/cipher.py`, `network.py`, `base_device.py`, `awhp_device.py`, and `discovery.py`.

## Boundary Summary

- Transport: UDP/IPv4, default device port `7000`.
- Discovery: plain JSON `{"t":"scan"}` broadcast. Device replies with plain JSON `t=pack` whose `pack.t` is `dev`, including `mac`/`cid`, name, model, version, and network endpoint.
- Envelope: application requests use outer JSON `{ cid:"app", i, t:"pack", uid:0, tcid:<mac>, pack:<encrypted> }`.
- Encryption selection: `i=1` packets use the default binding cipher. Binding first tries AES-128-ECB with key `a3K8Bx%2r8Y7#xDh`; if no response, try AES-128-GCM with key `{yxAHAY_Lm6pbC/<`, nonce `5440784449675a516c5e6313`, AAD `qualcomm-test`.
- Binding: encrypted inner pack `{ t:"bind", mac, uid:0 }`. Successful reply decrypts to `{ t:"bindok", mac, key, r:200 }`. That key is persistent device communication material.
- Read state: after binding, `i=0` status packets use the device key and the negotiated cipher version. Inner pack is `{ t:"status", mac, cols:[...] }`; replies decrypt to `{ t:"dat", mac, r:200, cols:[...], dat:[...] }`.
- Commands: writes are encrypted `cmd` packets with `{ t:"cmd", opt:[...], p:[...] }`, acknowledged by `res`. This implementation intentionally keeps Homey read-only at the driver level.

## Minimal Standalone Client API

- `discover(waitMs?) -> GreeVersatiDeviceInfo[]`
- `bind(device) -> BoundGreeVersatiDevice`
- `getState(boundDevice) -> GreeVersatiState`

The client module has no Homey dependency and can be integration-tested using a local UDP fake device.
