# Homey Gree Versati

Homey app for local monitoring and limited control of Gree Versati air-to-water heat pumps.

The app talks directly to the heat pump over the local network using UDP port `7000`. It currently supports discovery, binding, telemetry, target temperature control, mode control, and Homey Flow cards.

## Current Capabilities

- Discover Gree Versati devices on the local network
- Bind to a device and store its local encryption key in Homey device settings
- Poll read-only telemetry:
  - primary Homey temperature (`Water out`) for native mobile app graphs
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
  - cool (mapped from upstream protocol value and unit-tested, but not live-tested on this installation)
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
  - presets provide starting profiles for mild floor heating, radiators, and conservative tuning
  - dry-run mode previews the calculated target without writing
  - write mode updates the heating target only in `Heat + hot water` mode
  - temporary pause/resume controls can suspend Homey-managed curve writes without changing other heat pump settings
  - temporary boost offsets can raise or lower the calculated target without changing the base curve
  - separate boost safety limits clamp temporary boost targets
  - writes are clamped, deadbanded, and rate-limited
  - outdoor temperature can come from a manual setting or a Homey Flow action
- Use Homey Flow cards:
  - triggers for mode, hot water temperature, target temperature, Rapid, W-depend, Disinfect, and defrosting changes
  - triggers for EVU changes
  - triggers for Homey-managed weather-curve calculated values, skipped reasons, write events, and errors
  - triggers for weather-curve pause, resume, and write-blocked states
  - triggers for polling failures, IP address changes, device unavailable transitions, and device available recovery
  - conditions for current mode, hot water thresholds, Rapid, W-depend, Disinfect, defrosting, and EVU state
  - conditions for device reachability
  - conditions for weather-curve control mode, skip reason, write readiness, and graph history availability
  - actions for changing mode, target temperatures, Rapid, Silence, W-depend, Disinfect, weather-curve pause/resume, and temporary curve boost
- Use temperature Flow action fields with visible default placeholders for common heating and hot water targets.
- Track capability history in Homey Insights for the exposed temperatures, targets, operating states, EVU, and Homey-managed weather-curve values.
- Write explicit app-managed Homey Insights logs for the main Gree temperatures, targets, curve values, and boolean states.
- Use the `Refresh now` maintenance action in device settings to poll the heat pump immediately.
- Add the `Versati Weather Curve` Homey dashboard widget to inspect and adjust the Homey-managed curve visually.
- Add the `Versati Graphs` Homey dashboard widget to view recent in-app telemetry graphs without opening Homey Insights.
- Review recent Homey-managed weather-curve decisions in the curve widget and diagnostic export.
- Preview the next weather-curve write or skip reason in the curve widget before enabling writes.
- Export and import weather-curve profiles from the curve widget.

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

Probe cooling mode mappings while changing mode externally:

```bash
npm run probe:modes -- --ip 192.168.1.50 --mac 001122334455 --modes cool,cool_hot_water
```

The mode probe is read-only. It captures a baseline, prompts you to change modes in the official Gree app or indoor controller, captures the resulting raw status fields, then prompts you to restore the original mode. Add `--output tmp/cooling-modes.json` to keep a redacted confirmation report for mapping work.

Analyze a saved cooling mode report:

```bash
npm run probe:modes:analyze -- tmp/cooling-modes.json
```

The analyzer summarizes raw mode fields, restore cleanliness, and warnings. Treat its output as a review aid; do not add new command support until the raw mapping is clear.

When the analyzer reports a clean confirmation, generate a reviewed mapping artifact:

```bash
npm run probe:modes:analyze -- tmp/cooling-modes.json --write-mapping tmp/cooling-mode-mapping.json
```

The analyzer refuses to write the mapping artifact if the report has warnings.

Run the full interactive cooling confirmation workflow:

```bash
npm run probe:modes:confirm -- --mac 001122334455
```

This runs the guided `Cool` and `Cool + hot water` probe, writes `tmp/cooling-modes.json`, and analyzes it immediately after you restore the original mode.

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

The maintenance actions section includes `Refresh now`, which runs an immediate poll and updates the Homey capabilities used by device tiles, Flow cards, and Insights.

It also includes `Reset Insights logs`, which deletes and recreates the app-managed Gree Insights logs, then runs an immediate poll. Use this if a development install shows only Homey app CPU/memory in Insights after the app has polled successfully.

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

The Gree indoor controller can show `T-Outdoor`, but that value is not confirmed as exposed through the local Wi-Fi `status` fields used by this app. On the tested unit, the indoor controller showed `8.8°C`; candidate Wi-Fi fields did not return a matching direct value, tenths value, or split temperature pair. Keep using a manual value or a Flow-fed outdoor sensor/weather source until a matching field is confirmed.

Default settings are conservative:

- curve preset: `Custom`
- control mode: `Dry run`
- outdoor source: `Manual temperature`
- `-20°C` outdoor maps to `40°C` heating target
- `10°C` outdoor maps to `25°C` heating target
- curve shape: `Linear`
- target clamp: `20-55°C`
- write deadband: `1°C`
- minimum write interval: `1800` seconds

Use `Dry run` first and watch `Curve outdoor temperature` and `Curve heating target`. To feed an outdoor sensor or weather value, set the outdoor source to `Flow-provided temperature` and create a Flow that calls `Set curve outdoor temperature`. Switch to `Write heating target` only after the calculated targets look sensible for your heating system. The controller writes only while the heat pump mode is `Heat + hot water`.

Use the curve widget or Flow actions to pause Homey-managed curve writes for 1 hour, 6 hours, 24 hours, or until manually resumed. Pausing only stops automatic curve writes; telemetry, graphing, and manual Homey controls continue to work.

Use the curve widget or Flow actions to apply a temporary curve boost from `-5°C` to `+5°C`. The widget lets you choose the offset and duration, then shows the active offset and expiry. The boost offsets the calculated target for 1 hour, 6 hours, 24 hours, or until cleared, while leaving the saved curve points unchanged. Boost writes use separate boost min/max safety limits so a comfort offset cannot exceed the range you allow for boosted operation.

Curve shape controls how the target bends between the two configured points. `Linear` keeps the direct line. The bend presets lower the target earlier as outdoor temperature rises. `Custom bend` accepts `-100..100`; negative values keep a higher target for longer, while positive values lower the target earlier.

The `Versati Weather Curve` dashboard widget shows the current target, calculated target, outdoor input, write safety status, last skip reason, last write time, and curve shape. It can update the same curve settings as the device settings page. Widgets require Homey `12.3.0` or newer.

## Estimated COP

The app can calculate an estimated coefficient of performance from the measured heating water delta, a configured water flow rate, and a configured electrical input:

`estimated COP = estimated heat output / estimated electrical input`

`estimated heat output` uses water out minus water in, the configured liters per minute, and water's heat capacity. The estimate stays empty while the heat pump is off, defrosting, water out is not warmer than water in, or either COP setting is `0`.

Configure these device settings to enable the estimate:

- `COP electrical input source`: `Fixed estimate` or `Flow-provided input`
- `COP nominal heat output`: rated heat-pump output in kW; set to `0` to use manual flow instead
- `COP water flow`: manual heating circuit flow in liters per minute; used when nominal heat output is `0`
- `COP electrical input`: electrical input in kW
- `Low COP threshold`: optional Flow alert threshold

Nominal water flow uses `flow L/min = heat output kW * 60 / (4.186 * 5°C)`, so `10 kW` becomes about `28.7 L/min`. Use a measured or installer-provided flow rate when available; the nominal output field is only a rough COP estimate.

Use the `Set COP electrical input` Flow action when the source is `Flow-provided input`. Feed it from a smart meter, energy plug, or another Homey energy app in kW. The app stores the latest Flow-fed value and uses it on the next poll.

For the electrical input, the best source is whole heat-pump consumption: outdoor unit compressor/fans plus indoor unit pumps, controls, and backup/tank heaters. A meter covering both indoor and outdoor units, or the entire heat-pump supply, gives the least misleading estimate. Outdoor-unit-only consumption makes COP look too optimistic when indoor pumps or heaters are active. Indoor-unit-only consumption usually misses the compressor and is not enough for COP. Until a real meter is connected, use a conservative fixed kW estimate and treat `Estimated COP`, `Estimated heat output`, and `Estimated electrical input` as trend signals rather than lab-grade performance data. The `COP status` capability and widget field explain why the estimate is unavailable or whether it currently uses a fixed estimate.

Cooling mode writes are guarded by default. Enable `Allow cooling mode writes` in device settings only after confirming cooling operation is safe for your installation.

## Operating State And Alerts

The app derives an `Operating state` from the Gree mode, water delta, heater flags, defrosting, Rapid hot water, and frost protection. Possible states include `Heating`, `Hot water`, `Idle`, `Defrosting`, `Backup heater`, `Rapid hot water`, `Cooling`, `Frost protection`, `Off`, and `Unknown`.

Sustained abnormal-operation Flow triggers are available for:

- backup/tank heater active too long
- defrosting active too long
- low heating water delta for too long
- slow hot water recovery

Each alert has a device setting for the delay or threshold. Alerts trigger only after the condition stays active for the configured duration and reset when the condition clears.

## Homey Insights

The driver exposes Gree values as Homey capabilities and explicitly leaves Insights enabled for telemetry that is useful to graph over time:

- water out, water in, hot water, optional water sensor, and remote room temperatures
- heating, cooling, and hot water targets
- water delta, estimated heat output, estimated electrical input, and estimated COP
- operating state timelines for off, idle, heating, hot water, cooling, defrosting, backup heater, Rapid hot water, frost protection, and unknown
- power, mode, Rapid, Silence, W-depend, Disinfect, defrosting, heater, frost protection, and EVU states
- Homey-managed curve outdoor temperature and calculated heating target

Open Homey Insights and select the paired Gree Versati device to view the graphs. Static diagnostics such as `ModelType`, `VersatiSeries`, IP address, MAC address, and device key stay in the device store/settings and are not exposed as graphable capabilities.

For quick checks inside Homey dashboards, add the `Versati Graphs` widget. The app keeps a bounded local history of the latest `480` successful polls and graphs water out temperature, hot water temperature, heating target, curve target, and estimated COP directly in the widget. The widget also shows poll health, redacted endpoint details, curve control state, and the latest curve decision. The widget refreshes every 30 seconds and can filter the view to `1h`, `6h`, `24h`, or all retained samples. This local widget history is separate from Homey Insights and starts filling after the updated app has run successfully.

Homey should automatically create device Insights for graphable capabilities. The app also creates explicit app-managed Insights logs as a fallback for the main Gree values. These logs appear under the Gree Versati app after the app has run long enough to poll at least once.

Use the `Insights` button in the `Versati Graphs` widget to check whether the app-managed Insights logs exist and whether entries have been written since the app started.

In the Homey mobile app, open the Gree Versati device and use the native graph views for `Water out`, water in, hot water, optional water, remote room, heating target, cooling target, hot water target, curve outdoor temperature, curve heating target, water delta, estimated heat output, estimated electrical input, and estimated COP. These are backed by Homey's standard graphable capabilities where possible and mirror the Gree-specific capability values.

The `Versati Weather Curve` widget also shows the latest curve control decisions. The audit history records whether Homey skipped, wrote, or failed a curve update, together with the outdoor input, calculated target, previous heating target, and reason.

The curve widget includes a forecast pill showing whether the next poll would write a heating target and which target it would choose. If it would skip, the pill shows the same reason used by the control loop.

Use the curve widget export/import buttons to save a weather-curve profile before experimenting. Profile exports include curve points, shape, deadband, write interval, outdoor source, and boost safety limits; they do not include endpoint credentials or device identifiers.

The `Versati Graphs` widget also has an `Export` button for a redacted diagnostic snapshot. It includes current capabilities, poll health, selected raw diagnostics, weather-curve status, and telemetry sample count. IP address and device key are not exported, and MAC addresses are masked.

## Roadmap

Planned follow-up work, roughly in priority order:

1. Run the live integration harness against a real unit, especially with `--include-risky` when ready to verify W-depend and Disinfect because they may affect operating schedules.
2. Add a settings sanity checker in the widget and diagnostic export for missing COP inputs, stale Flow-fed power, curve write enabled without a usable outdoor source, cooling writes enabled, disabled alert thresholds, and missing graph history.
3. Add rolling energy summary rollups for selected ranges: average/min/max COP, estimated heat output, water delta, and time spent in each operating state.
4. Add an operating timeline strip to `Versati Graphs` showing heating, hot water, defrosting, backup heater, idle, and cooling transitions over the selected range.
5. Document concrete Homey Flow recipes for feeding COP electrical input, feeding outdoor temperature, low-COP notifications, hot-water recovery alerts, and curve pause/boost.
6. Add a Homey-level live smoke script for non-risky surfaces: COP settings, operating state derivation, Insights values, alert thresholds, and widget diagnostic output.
7. Tune the Homey-managed weather curve against real heating behavior.
8. Finish `Cool + hot water` mode mapping when safe to test cooling. Confirmed modes are `Hot water` (`Mod: 2`) and `Heat + hot water` (`Mod: 4`); `Cool` uses the upstream value `Mod: 1` but is intentionally untested on the live system.
9. Continue outdoor-temperature field probing only if new Gree app or firmware evidence appears; do not use `AirOutTem` as it returned `0` while the indoor controller showed a warmer outdoor value.
10. Revisit runtime and energy counters only after diagnostics returns non-empty compressor, pump, fan, power, or energy fields on real hardware.
11. Add more Flow cards only where they create practical automation value, especially for newly mapped telemetry fields.
12. Promote confirmed diagnostics probe fields to read-only Homey diagnostics or capabilities where useful.
13. Refine app artwork further if needed before distribution outside local development.

## Protocol Notes

The protocol boundary analysis is in [docs/protocol-boundaries.md](docs/protocol-boundaries.md).

The standalone TypeScript client lives in [src/lib/gree-versati-client.ts](src/lib/gree-versati-client.ts) and has no Homey runtime dependency.

## Credits

This project was started from protocol analysis of the original [roihuvaara/hacs_gree_versati](https://github.com/roihuvaara/hacs_gree_versati) Home Assistant integration. The Homey app and TypeScript client are separate implementations, but the original project provided the key reference point for understanding the Gree Versati LAN protocol.
