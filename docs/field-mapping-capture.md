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
- `W-depend` maps to `SvSt` on the tested unit. Upstream labelled this as power save, but official app behavior indicates weather-dependent heating state.
- `Disinfect` maps to `SwDisFct`.
- `EVU` maps to `EVU` and is exposed as a read-only Homey capability.
- `VersatiSeries` maps to `VersatiSeries` and is stored as diagnostics.
- `ModelType` maps to `ModelType` and is stored as diagnostics.

Weather-dependent curve mapping status:

- `W-depend` enable state is confirmed as `SvSt`.
- Curve configuration fields are not confirmed yet.
- Probe one visible curve parameter at a time, preferably with `W-depend` enabled and the unit in heating mode.
- Do not add write commands for curve fields until a read-only before/after mapping and restore behavior are confirmed.

Start with low-risk read/write changes:

1. Identify what the official app calls the current operating mode while raw `Mod` is `2`. Captured: `Mod: 2` means `Hot water`.
2. Identify heat mode mapping. Captured: `Mod: 4` means `Heat + hot water`.
3. Increase heating target by 1 degree, then set it back. Captured: heating target maps to `HeWatOutTemSet`.
4. Increase hot water target by 1 degree, then set it back. Captured: hot water target maps to `WatBoxTemSet`.
5. Toggle Rapid hot water if visible, then set it back. Captured: official `Rapid` maps to `FastHtWter`.
6. Toggle Silence if visible, then set it back. Captured: official `Silence` maps to `Quiet`.
7. Toggle power-save only if the official app exposes it clearly.

Avoid power off/on and mode switching until the basic target/flag mappings are confirmed.
