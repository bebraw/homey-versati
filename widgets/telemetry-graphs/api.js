'use strict';

module.exports = {
  async getTelemetry({ homey, query }) {
    return homey.app.getTelemetryWidgetState(query.deviceId);
  },

  async getDiagnostics({ homey, query }) {
    return homey.app.getDiagnosticSnapshot(query.deviceId);
  },
};
