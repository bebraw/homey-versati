# Solar Surplus Flows for Gree Versati

This guide describes one practical Homey setup for using solar surplus with the
Gree Versati heat pump. The goal is to store excess PV production as heat while
keeping normal comfort and domestic hot water safety independent of sunshine.

The examples assume you have a solar inverter or energy meter in Homey that can
report live grid import/export. Prefer grid export over raw solar production:
export already accounts for house loads, so it is the real surplus available to
the heat pump.

## Required Signals

Add these devices or values to Homey before building the flows:

- Grid export or net grid power, ideally in W or kW
- Optional solar production, for dashboards only
- Gree Versati device from this app
- Optional electricity price signal
- Optional battery state of charge

From the Gree Versati app you will use these Flow actions:

- `Set hot water target`
- `Set heating target`
- `Set weather curve boost`
- `Clear weather curve boost`
- `Set Rapid hot water`
- `Set Disinfect`

## Suggested Defaults

Start conservative and tune after observing behavior for a week.

```text
Normal hot water target:          45-48 deg C
Solar hot water target:           52-55 deg C
Weekly disinfect target/state:    60 deg C or Disinfect enabled
Start surplus threshold:          export > 1500 W for 10-15 min
Stop surplus threshold:           import > 500 W for 5-10 min
Heating curve boost:              +2 deg C
Maximum heating curve boost:      +5 deg C
Minimum time between changes:     15-30 min
```

Do not make the weekly disinfect cycle depend on solar availability. Run it at a
solar-friendly time, but still run it if there is no solar surplus that week.

## Device Settings

1. Open the Gree Versati device in Homey.
2. Open Advanced Settings.
3. Set your normal hot water behavior first:
   - Use `Hot water target` around `45-48 deg C` if that is suitable for your
     installation.
   - Keep the pump's own safety/disinfection settings enabled if your installer
     configured them.
4. If you use Homey's weather curve control, set safe boost limits:
   - `Boost target minimum`: your normal lower safe heating target.
   - `Boost target maximum`: the highest heating target you are comfortable
     allowing during solar surplus.
5. Confirm that `Set hot water target`, `Set heating target`, and the weather
   curve boost actions work manually before automating them.

## Flow 1: Solar Hot Water Boost On

Use this flow to raise the hot water target when there is sustained surplus.

Trigger:

- Grid export becomes greater than `1500 W`

And:

- Grid export has stayed greater than `1500 W` for `10-15 min`
- Gree mode is `Heat + hot water` or `Hot water`
- Gree is not defrosting
- Hot water temperature is below the solar target, for example below `52 deg C`
- Optional: electricity price is not high
- Optional: battery state of charge is above your reserve threshold

Then:

- Set Gree hot water target to `52-55 deg C`
- Optional: Set Rapid hot water to `true` when export is strong, for example
  above `2500-3000 W`

Notes:

- Use a sustained condition or delay so passing clouds do not toggle the target.
- Prefer raising the target first. Use Rapid hot water only when you have enough
  surplus, because it may draw more power than a gentle target increase.

## Flow 2: Solar Space Heating Boost On

Use this flow after domestic hot water is already warm enough, or when you only
want to store surplus in the building.

Trigger:

- Grid export becomes greater than `1500 W`

And:

- Grid export has stayed greater than `1500 W` for `10-15 min`
- Gree mode is `Heat + hot water`
- Gree is not defrosting
- Hot water temperature is already near the solar target, for example above
  `50 deg C`
- Optional: outdoor temperature is low enough that extra heat is useful

Then, if you use Homey's weather curve control:

- Set weather curve boost to `+2 deg C` for `1 hour`

Then, if you do not use Homey's weather curve control:

- Set heating target to the current normal target plus `2 deg C`

Notes:

- A weather curve boost is preferred because it is temporary and bounded.
- Keep the first boost small. If the house remains comfortable and export stays
  high, you can increase to `+3 deg C` or `+5 deg C`.

## Flow 3: Solar Boost Off

Use this flow to restore normal targets when surplus disappears.

Trigger:

- Grid import becomes greater than `500 W`

And:

- Grid import has stayed greater than `500 W` for `5-10 min`

Then:

- Set Rapid hot water to `false`
- Set hot water target back to your normal target, for example `45-48 deg C`
- Clear weather curve boost
- If you manually changed heating target, set heating target back to your normal
  target or let the heat pump/Homey curve restore it on the next cycle

Notes:

- Use a stop threshold lower than the start threshold. This hysteresis prevents
  oscillation around zero export.
- Do not turn the heat pump off just because solar surplus ended. Let normal heat
  pump control handle comfort.

## Flow 4: Weekly Hot Water Disinfect

Use this flow for a regular high-temperature hot water cycle. Confirm the correct
temperature and method with your installer, especially if your system has mixing
valves or separate tank controls.

Trigger:

- Every Saturday at `12:00`

And:

- Optional: hot water temperature has not reached `60 deg C` in the last 7 days

Then:

- Set Disinfect to `true`

Alternative if Disinfect does not produce the desired tank temperature:

- Set hot water target to `60 deg C`
- After the target has been reached and held long enough for your installation,
  set hot water target back to normal

Notes:

- Schedule this during likely solar hours, but do not skip it only because solar
  is unavailable.
- `60 deg C` water can be a scalding hazard. Use appropriate mixing valves and
  follow local regulations and installer guidance.

## Flow 5: Watchdog Restore

Add one safety flow that restores normal behavior if a boost gets stuck.

Trigger:

- Every day at `22:00`

Then:

- Set Rapid hot water to `false`
- Clear weather curve boost
- Set hot water target to your normal value

Optional:

- If heating target is not managed by the Homey weather curve, set heating target
  back to your normal value.

## Tuning Checklist

After enabling the flows, check these for a few sunny days:

- Does grid import spike when Rapid hot water is enabled? If yes, raise the Rapid
  threshold or avoid Rapid.
- Does the house overshoot in temperature after a heating boost? If yes, lower
  the boost or shorten its duration.
- Does hot water reach the solar target too late in the day? If yes, lower the
  start threshold or start earlier.
- Does the system toggle often around passing clouds? If yes, increase the
  sustained start/stop delays.
- Does COP look worse during high target temperatures? That is expected; storing
  solar energy can still be useful even when COP is lower, but avoid excessive
  target temperatures.

## Recommended Starting Setup

For most installations, start with only these three automations:

1. Solar hot water boost on when export is above `1500 W` for `10-15 min`.
2. Solar boost off when importing above `500 W` for `5-10 min`.
3. Weekly Disinfect on Saturday at midday.

Add space-heating boosts only after hot water boosting behaves predictably.
