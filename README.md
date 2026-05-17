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
  - heating target temperature
  - cooling target temperature
  - hot water target temperature
  - power state
  - raw heat pump mode mapping
  - fast hot water state
  - defrosting state
  - tank heater state
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

## Troubleshooting

- If no device appears during pairing, confirm Homey and the heat pump are on the same subnet.
- Confirm UDP port `7000` is not blocked between Homey and the heat pump.
- Some devices return encrypted discovery packets; this client supports both plain and encrypted discovery replies.
- If the mode shows as `other`, the device returned a mode code not yet mapped to `heat` or `cool`. The raw mode is still read safely, but no command assumptions are made.

## Protocol Notes

The protocol boundary analysis is in [docs/protocol-boundaries.md](docs/protocol-boundaries.md).

The standalone TypeScript client lives in [src/lib/gree-versati-client.ts](src/lib/gree-versati-client.ts) and has no Homey runtime dependency.
