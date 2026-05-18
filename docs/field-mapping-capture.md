# Field Mapping Capture Procedure

Use the official Gree app to change one thing at a time. Before and after each action, capture a read-only snapshot:

```bash
npm run snapshot -- --ip 192.168.1.50 --mac 001122334455
```

Use the diagnostics probe to search for additional read-only fields:

```bash
npm run probe:diagnostics -- --ip 192.168.1.50 --mac 001122334455
```

The diagnostics probe groups candidate fields by identity, errors, energy, runtime, grid/EVU, and extra temperatures. Output is redacted by default. Add `--groups identity,errors` to narrow the probe, or `--fields A,B,C` to test specific LAN property names.

Use the weather-curve probe when investigating W-depend curve parameters:

```bash
npm run probe:weather-curve -- --ip 192.168.1.50 --mac 001122334455 --samples 2 --interval-ms 30000
```

The weather-curve probe is read-only. It captures likely curve fields repeatedly and reports fields that changed between samples. Change exactly one weather-curve setting externally between samples, then record the official label and the probe output. Add `--fields A,B,C` for extra candidates or `--only-fields A,B,C` to narrow the probe.

Use the guided mode probe when investigating cooling modes:

```bash
npm run probe:modes -- --ip 192.168.1.50 --mac 001122334455 --modes cool,cool_hot_water
```

The mode probe is read-only. It prompts you to change modes externally in the official Gree app or indoor controller, captures normalized state and likely raw mode fields after each change, and reports the changed fields. Add `--output tmp/cooling-modes.json` to save a redacted report for review.

Analyze the saved report before changing command support:

```bash
npm run probe:modes:analyze -- tmp/cooling-modes.json
```

The analyzer checks raw `Pow`/`Mod`, normalized mode, changed fields, and restore cleanliness. It is intentionally conservative and should be treated as a mapping review aid, not automatic approval.

Record:

- the official app screen name
- the visible label/value before the action
- the exact action taken
- the visible label/value after the action
- the before and after snapshot timestamps

Official state parameter screen mappings:

- `T-water in PE` maps to `AllInWatTemHi` and `AllInWatTemLo`.
- `T-water out PE` maps to `AllOutWatTemHi` and `AllOutWatTemLo`.
- `T-optional water sen` maps to `HepOutWatTemHi` and `HepOutWatTemLo`.
- `T-water tank` maps to `WatBoxTemHi` and `WatBoxTemLo`.
- `Remote room temperature` maps to `RmoHomTemHi` and `RmoHomTemLo`.
- `Tank heater` maps to `WatBoxElcHeRunSta`.
- `System defrosting` maps to `SyAnFroRunSta`.
- `HP-heater 1` maps to `ElcHe1RunSta`.
- `HP-heater 2` maps to `ElcHe2RunSta`.
- `Automatic frost protection` maps to `AnFrzzRunSta`.
- `W-depend` maps to `SvSt` on the tested unit. It is only the device's built-in weather-curve toggle; the underlying curve is a simple two-point outdoor-temperature-to-heating-target mapping and is not useful enough by itself for Homey automation.
- `Disinfect` maps to `SwDisFct`.
- `EVU` maps to `EVU` and is exposed as a read-only Homey capability.
- `VersatiSeries` maps to `VersatiSeries` and is stored as diagnostics.
- `ModelType` maps to `ModelType` and is stored as diagnostics.
- `T-Outdoor` is visible on the indoor unit, but no confirmed Wi-Fi `status` column has been found yet. On the tested unit, the indoor unit showed `8.8°C`; candidate scans did not return `8.8`, `88`, `108`, or a split `108`/`8` pair. `AirOutTem` returned `0`, which does not match the indoor unit and must not be treated as outdoor temperature.

Weather-dependent curve mapping status:

- `W-depend` enable state is confirmed as `SvSt`.
- The built-in curve configuration fields are not confirmed yet, but Homey-managed weather compensation can bypass them by writing `HeWatOutTemSet` from Homey's own curve.
- The device's outdoor temperature is not confirmed as available through the local Wi-Fi status API. Until a matching field is found, feed Homey-managed weather compensation from a manual setting or a Homey Flow action backed by another outdoor sensor/weather source.
- Probe one visible curve parameter at a time, preferably with `W-depend` enabled and the unit in heating mode.
- Do not add write commands for curve fields until a read-only before/after mapping and restore behavior are confirmed.

Runtime and energy mapping status:

- A live probe on the tested unit did not return non-empty values for common compressor frequency, compressor runtime, pump, fan, power input, or energy counter candidates.
- Do not promote runtime counters to graphable Homey capabilities until a non-empty field is confirmed on real hardware.
- Keep runtime and energy candidates in the diagnostics probe so future firmware variants can be checked without changing the app.

Cooling mapping status:

- `Cool` uses upstream `Mod: 1` and is covered by the local UDP client tests, but it is not yet live-tested on this heating-only installation. Use `npm run probe:modes` to confirm it on real hardware without sending commands from this app.
- `Cool + hot water` is visible in the official app but is not mapped yet. Use `npm run probe:modes -- --modes cool_hot_water` to confirm the raw mode/property combination and restore behavior before adding a command.

Start with low-risk read/write changes:

1. Identify what the official app calls the current operating mode while raw `Mod` is `2`. Captured: `Mod: 2` means `Hot water`.
2. Identify heat mode mapping. Captured: `Mod: 4` means `Heat + hot water`.
3. Increase heating target by 1 degree, then set it back. Captured: heating target maps to `HeWatOutTemSet`.
4. Increase hot water target by 1 degree, then set it back. Captured: hot water target maps to `WatBoxTemSet`.
5. Toggle Rapid hot water if visible, then set it back. Captured: official `Rapid` maps to `FastHtWter`.
6. Toggle Silence if visible, then set it back. Captured: official `Silence` maps to `Quiet`.
7. Toggle power-save only if the official app exposes it clearly.

Avoid power off/on and mode switching until the basic target/flag mappings are confirmed.
