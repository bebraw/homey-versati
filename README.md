# Homey Gree Versati

Homey app for local monitoring and limited control of Gree Versati air-to-water heat pumps.

The app talks directly to the heat pump over the local network using UDP port `7000`. It currently supports discovery, binding, telemetry, target temperature control, mode control, and Homey Flow cards.

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
- Change heat pump mode:
  - off
  - hot water
  - heat + hot water
  - cool
- Change target temperatures:
  - heating target, clamped to `20-55°C`
  - hot water target, clamped to `30-60°C`
- Toggle guarded boolean commands:
  - Rapid hot water
  - Silence
  - W-depend weather-dependent heating
  - Disinfect schedule/state
- Use Homey Flow cards:
  - triggers for mode, hot water temperature, target temperature, Rapid, W-depend, Disinfect, and defrosting changes
  - conditions for current mode, hot water thresholds, Rapid, W-depend, Disinfect, and defrosting state
  - actions for changing mode, target temperatures, Rapid, Silence, W-depend, and Disinfect

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

Smoke-test guarded toggle commands against a live unit:

```bash
npm run smoke:toggles -- --ip 192.168.1.50 --mac 001122334455
```

The toggle smoke test reads the current state, changes one toggle at a time, verifies the change, and restores the original value before moving to the next toggle. By default it only tests Rapid hot water and Silence. Include W-depend and Disinfect explicitly when you are ready to test behavior that may affect heating curves or schedules:

```bash
npm run smoke:toggles -- --ip 192.168.1.50 --mac 001122334455 --toggles rapid,silence,w_depend,disinfect
```

Run the broader live integration harness:

```bash
npm run test:live -- --ip 192.168.1.50 --mac 001122334455
```

The live integration harness runs a snapshot check, mode write/restore check, heating and hot water target write/restore check, and safe toggle write/restore checks. It restores the captured baseline in a final cleanup step. Add `--include-risky` to include W-depend and Disinfect.

Snapshot and live-test outputs redact device identifiers by default. Use `--no-redact` only for private debugging output.

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
5. Choose **Scan network** and pick the discovered heat pump, or choose **Enter IP and MAC manually** if broadcast discovery does not find it.
6. Complete pairing.

During pairing, the app sends a local discovery request and then binds to the selected heat pump. The returned device key is saved in the Homey device settings and reused for later read-only polling.

Manual pairing binds directly to the entered IP address, MAC address, and UDP port. The app reads one state snapshot before adding the device, so pairing fails early if the endpoint cannot be reached or bound.

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

1. Run the live integration harness against a real unit, especially with `--include-risky` when ready to verify W-depend and Disinfect because they may affect operating schedules.
2. Investigate weather-dependent heating curve parameters. `W-depend` itself is mapped to `SvSt`, but the curve configuration fields are not mapped yet and would be more useful than the flag alone.
3. Finish mode mapping when safe to test cooling. Confirmed modes are `Hot water` (`Mod: 2`) and `Heat + hot water` (`Mod: 4`); `Cool` uses the upstream value `Mod: 1` but is intentionally untested on the live system.
4. Add more Flow cards only where they create practical automation value, such as device unavailable events or newly mapped telemetry fields.
5. Expose additional read-only diagnostics if useful, such as `EVU`, `ModelType`, firmware/HID, error codes, or energy/power fields if their LAN names are identified.
6. Harden local network discovery by scanning interfaces explicitly and preserving discovered IP updates.
7. Replace placeholder app images with proper app artwork before distribution outside local development.

## Protocol Notes

The protocol boundary analysis is in [docs/protocol-boundaries.md](docs/protocol-boundaries.md).

The standalone TypeScript client lives in [src/lib/gree-versati-client.ts](src/lib/gree-versati-client.ts) and has no Homey runtime dependency.

## Credits

This project was started from protocol analysis of the original [roihuvaara/hacs_gree_versati](https://github.com/roihuvaara/hacs_gree_versati) Home Assistant integration. The Homey app and TypeScript client are separate implementations, but the original project provided the key reference point for understanding the Gree Versati LAN protocol.
