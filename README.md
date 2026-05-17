# Homey Gree Versati

Homey app for local, read-only monitoring of Gree Versati air-to-water heat pumps.

The app talks directly to the heat pump over the local network using UDP port `7000`. It currently supports discovery, binding, and read-only telemetry. Write commands are intentionally not exposed in Homey yet.

## Current Capabilities

- Discover Gree Versati devices on the local network
- Bind to a device and store its local encryption key in Homey device settings
- Poll read-only telemetry:
  - water out temperature
  - water in temperature
  - domestic hot water temperature
  - optional water sensor temperature
  - remote room temperature
  - heating target temperature
  - cooling target temperature
  - hot water target temperature
  - power state
  - heat pump mode mapping, including hot water mode
  - rapid hot water state
  - silence state
  - W-depend weather-dependent heating state
  - disinfect schedule/state
  - defrosting state
  - tank heater state
  - HP-heater 1 and 2 states
  - frost protection state

## Requirements

- Homey Pro with app development enabled
- Node.js `20` or newer
- A Gree Versati heat pump connected to the same LAN as Homey
- UDP traffic to the heat pump on port `7000`

## Install For Homey Development

Install dependencies:

```bash
npm install
```

Build and test the app:

```bash
npm test
```

Validate the Homey app package:

```bash
npx homey app validate
```

Capture a read-only protocol snapshot for field mapping:

```bash
npm run snapshot -- --ip 192.168.1.50 --mac 001122334455
```

Log in to the Homey CLI if needed:

```bash
npx homey login
```

Install and run the app on your Homey:

```bash
npx homey app run
```

The Homey CLI will ask which Homey to use if no device is selected yet. Keep the terminal running while testing; stopping the command stops the development app.

## Pairing

1. Open the Homey mobile app.
2. Go to **Devices**.
3. Select **Add device**.
4. Choose **Gree Versati**.
5. Pick the discovered heat pump.
6. Complete pairing.

During pairing, the app sends a local discovery request and then binds to the selected heat pump. The returned device key is saved in the Homey device settings and reused for later read-only polling.

## Repair And Diagnostics

The device settings page exposes the current local endpoint:

- IP address
- UDP port
- MAC address
- device key
- encryption version
- poll interval

Changing the endpoint settings tests the connection before saving. If the device key is left empty, the app attempts to bind again and stores the returned key.

The app also keeps internal diagnostics in the Homey device store:

- last successful poll time
- last poll error
- consecutive poll failure count
- raw `Pow`, `Mod`, `SvSt`, and `SwDisFct`
- normalized mode

After repeated polling failures, the device is marked unavailable. It becomes available again after the next successful poll.

## Troubleshooting

- If no device appears during pairing, confirm Homey and the heat pump are on the same subnet.
- Confirm UDP port `7000` is not blocked between Homey and the heat pump.
- Some devices return encrypted discovery packets; this client supports both plain and encrypted discovery replies.
- If the mode shows as `other`, the device returned a mode code not yet mapped to a known read-only mode. The raw mode is still read safely, but no command assumptions are made.

## Roadmap

Planned follow-up work, roughly in priority order:

1. Add manual pairing fallback for direct IP and MAC entry when UDP broadcast discovery is blocked before the device is paired.
2. Add write commands only after protocol and integration tests cover them, starting with low-risk targets: heating target, hot water target, Rapid, Silence, W-depend, and Disinfect schedule/state.
3. Investigate whether Homey can expose safer weather-dependent heating curve controls than the official Gree app. `W-depend` itself is mapped to `SvSt`, but curve parameters are not mapped yet.
4. Finish mode mapping only when safe to test cooling. Confirmed modes are `Hot water` (`Mod: 2`) and `Heat + hot water` (`Mod: 4`); cooling modes are intentionally untested.
5. Add Homey Flow cards for defrosting changes, hot water thresholds, W-depend, Rapid, Disinfect, device unavailable events, and telemetry changes.
6. Expose additional read-only diagnostics if useful, such as `EVU`, `ModelType`, firmware/HID, error codes, or energy/power fields if their LAN names are identified.
7. Replace placeholder app images with proper app artwork.
8. Harden local network discovery by scanning interfaces explicitly and preserving discovered IP updates.

## Protocol Notes

The protocol boundary analysis is in [docs/protocol-boundaries.md](docs/protocol-boundaries.md).

The standalone TypeScript client lives in [src/lib/gree-versati-client.ts](src/lib/gree-versati-client.ts) and has no Homey runtime dependency.
