# Changelog

## 0.1.0

- Add local Gree Versati discovery and manual pairing.
- Add read-only telemetry for water temperatures, mode, hot water, heaters, defrosting, frost protection, W-depend, Rapid, Silence, and Disinfect.
- Add local commands for mode, heating target, hot water target, Rapid, Silence, W-depend, and Disinfect.
- Add Homey Flow triggers, conditions, and actions for telemetry, commands, and availability changes.
- Add read-only EVU capability and diagnostics for EVU, ModelType, and VersatiSeries.
- Fix Homey Pro Early 2019 development installs by using the implicit Node.js runtime manifest form.
- Add MAC-based endpoint rediscovery and an IP-change Flow trigger for DHCP address changes.
- Add a read-only weather-curve probe for mapping W-depend curve parameters.
- Add Homey-managed two-point weather compensation with dry-run and guarded write modes.
- Add linear, preset bend, and custom bend shapes for the Homey-managed weather curve.
- Document that the indoor controller's `T-Outdoor` value is not yet confirmed in the local Wi-Fi status API and expand diagnostics candidates for future probing.
- Add Homey Flow triggers for weather-curve calculated values, skipped reasons, write events, and errors.
- Add a `Refresh now` maintenance action for immediate polling from device settings.
- Add visible default placeholders for temperature Flow action and condition fields.
- Add weather-curve presets and a Homey dashboard widget for visual curve adjustment.
- Document runtime/energy probe status and add client test coverage for Cool and Hot water mode writes.
- Add a `Versati Graphs` dashboard widget backed by bounded local telemetry history.
- Add auto-refresh and range filters to the `Versati Graphs` widget.
- Add weather-curve safety status to the `Versati Weather Curve` widget.
- Add redacted diagnostic export from the `Versati Graphs` widget.
- Add Flow conditions for weather-curve state and local graph history.
- Add repair settings, diagnostics, live smoke-test scripts, and privacy-redacted script output.
