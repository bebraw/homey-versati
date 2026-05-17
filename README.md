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
  - EVU state
  - Homey curve outdoor temperature and calculated heating target
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
- Run Homey-managed weather compensation:
  - Homey calculates a heating water target from its own two-point outdoor temperature curve
  - dry-run mode previews the calculated target without writing
  - write mode updates the heating target only in `Heat + hot water` mode
  - writes are clamped, deadbanded, and rate-limited
  - outdoor temperature can come from a manual setting or a Homey Flow action
- Use Homey Flow cards:
  - triggers for mode, hot water temperature, target temperature, Rapid, W-depend, Disinfect, and defrosting changes
  - triggers for EVU changes
  - triggers for polling failures, IP address changes, device unavailable transitions, and device available recovery
  - conditions for current mode, hot water thresholds, Rapid, W-depend, Disinfect, defrosting, and EVU state
  - conditions for device reachability
  - actions for changing mode, target temperatures, Rapid, Silence, W-depend, and Disinfect

## Requirements

- Homey Pro with app development enabled
- Node.js `22` or newer
- A Gree Versati heat pump connected to the same LAN as Homey
- UDP traffic to the heat pump on port `7000`
- Stable LAN access between Homey and the heat pump. The app matches the paired unit by MAC address and refreshes the stored IP address when rediscovery finds the same unit at a new address.

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

Probe read-only diagnostics candidates:

```bash
npm run probe:diagnostics -- --ip 192.168.1.50 --mac 001122334455
```

Probe likely weather-dependent heating curve fields while changing one curve setting externally:

```bash
npm run probe:weather-curve -- --ip 192.168.1.50 --mac 001122334455 --samples 2 --interval-ms 30000
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

## Privacy And Local Network

- The app talks directly to the heat pump over the local network using UDP port `7000`.
- No Gree cloud account is required by this app.
- The device key returned by local binding is stored in Homey device settings/store so the app can poll and send supported commands later.
- Do not publish real device keys, MAC addresses, live snapshots, or logs copied with `--no-redact`.
- CLI snapshot and live-test output redacts IP and MAC identifiers by default.

## Release Checklist

Before sharing a build outside local development:

1. Run `npm run validate`.
2. Optionally run `npm run test:live -- --ip <address> --mac <mac>` against a real unit.
3. Pair through both scan and manual pairing if the network setup allows it.
4. Verify mode, target temperature, and safe toggle controls in Homey.
5. Verify Flow triggers and actions, especially availability recovery.
6. Confirm README examples and copied logs do not include real device identifiers.

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
- raw `EVU`, `ModelType`, and `VersatiSeries`
- normalized mode

After a polling failure, the app attempts MAC-based rediscovery. If DHCP gave the heat pump a new IP address, the app rebinds, updates the stored endpoint, and triggers the `Gree Versati IP address changed` Flow card. After repeated unrecovered polling failures, the device is marked unavailable. It becomes available again after the next successful poll.

## Troubleshooting

- If no device appears during pairing, confirm Homey and the heat pump are on the same subnet.
- Confirm UDP port `7000` is not blocked between Homey and the heat pump.
- Some devices return encrypted discovery packets; this client supports both plain and encrypted discovery replies.
- If the mode shows as `other`, the device returned a mode code not yet mapped to a known read-only mode. The raw mode is still read safely, but no command assumptions are made.

## Homey Weather Curve

`W-depend` is only the heat pump's own weather-curve toggle. The curve itself is a simple two-point mapping inside the unit, and the Gree app does not expose enough control to make that useful from Homey.

The app can instead run a Homey-managed curve. It reads an outdoor temperature from the device settings or from a Homey Flow action, calculates a heating water target from two configured points, and optionally writes that target to the heat pump.

Default settings are conservative:

- control mode: `Dry run`
- outdoor source: `Manual temperature`
- `-20°C` outdoor maps to `40°C` heating target
- `10°C` outdoor maps to `25°C` heating target
- target clamp: `20-55°C`
- write deadband: `1°C`
- minimum write interval: `1800` seconds

Use `Dry run` first and watch `Curve outdoor temperature` and `Curve heating target`. To feed an outdoor sensor or weather value, set the outdoor source to `Flow-provided temperature` and create a Flow that calls `Set curve outdoor temperature`. Switch to `Write heating target` only after the calculated targets look sensible for your heating system. The controller writes only while the heat pump mode is `Heat + hot water`.

## Roadmap

Planned follow-up work, roughly in priority order:

1. Run the live integration harness against a real unit, especially with `--include-risky` when ready to verify W-depend and Disinfect because they may affect operating schedules.
2. Tune the Homey-managed weather curve against real heating behavior and consider adding Flow cards for curve skipped/write events if useful.
3. Finish mode mapping when safe to test cooling. Confirmed modes are `Hot water` (`Mod: 2`) and `Heat + hot water` (`Mod: 4`); `Cool` uses the upstream value `Mod: 1` but is intentionally untested on the live system.
4. Add more Flow cards only where they create practical automation value, especially for newly mapped telemetry fields.
5. Promote confirmed diagnostics probe fields to read-only Homey diagnostics or capabilities where useful.
6. Refine app artwork further if needed before distribution outside local development.

## Protocol Notes

The protocol boundary analysis is in [docs/protocol-boundaries.md](docs/protocol-boundaries.md).

The standalone TypeScript client lives in [src/lib/gree-versati-client.ts](src/lib/gree-versati-client.ts) and has no Homey runtime dependency.

## Credits

This project was started from protocol analysis of the original [roihuvaara/hacs_gree_versati](https://github.com/roihuvaara/hacs_gree_versati) Home Assistant integration. The Homey app and TypeScript client are separate implementations, but the original project provided the key reference point for understanding the Gree Versati LAN protocol.
