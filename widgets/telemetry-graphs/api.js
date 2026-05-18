'use strict';

module.exports = {
  async getTelemetry({ homey, query }) {
    return homey.app.getTelemetryWidgetState(query.deviceId);
  },
};
