# Field Mapping Capture Procedure

Use the official Gree app to change one thing at a time. Before and after each action, capture a read-only snapshot:

```bash
npm run snapshot -- --ip 192.168.1.50 --mac 001122334455
```

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
- `W-depend` is visible in the official app but its LAN property name is not identified yet. Likely related to weather-dependent heating curve state.

Start with low-risk read/write changes:

1. Identify what the official app calls the current operating mode while raw `Mod` is `2`. Captured: `Mod: 2` means `Hot water`.
2. Identify heat mode mapping. Captured: `Mod: 4` means `Heat + hot water`.
3. Increase heating target by 1 degree, then set it back. Captured: heating target maps to `HeWatOutTemSet`.
4. Increase hot water target by 1 degree, then set it back. Captured: hot water target maps to `WatBoxTemSet`.
5. Toggle Rapid hot water if visible, then set it back. Captured: official `Rapid` maps to `FastHtWter`.
6. Toggle Silence if visible, then set it back. Captured: official `Silence` maps to `Quiet`.
7. Toggle power-save only if the official app exposes it clearly.

Avoid power off/on and mode switching until the basic target/flag mappings are confirmed.
