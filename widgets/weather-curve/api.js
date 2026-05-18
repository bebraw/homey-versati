'use strict';

module.exports = {
  async getCurve({ homey, query }) {
    return homey.app.getWeatherCurveWidgetState(query.deviceId);
  },

  async updateCurve({ homey, query, body }) {
    return homey.app.updateWeatherCurveFromWidget(query.deviceId, body);
  },
};
