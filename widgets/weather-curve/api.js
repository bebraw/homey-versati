'use strict';

module.exports = {
  async getCurve({ homey, query }) {
    return homey.app.getWeatherCurveWidgetState(query.deviceId);
  },

  async updateCurve({ homey, query, body }) {
    return homey.app.updateWeatherCurveFromWidget(query.deviceId, body);
  },

  async pauseCurve({ homey, query, body }) {
    return homey.app.pauseWeatherCurveFromWidget(query.deviceId, body);
  },

  async resumeCurve({ homey, query }) {
    return homey.app.resumeWeatherCurveFromWidget(query.deviceId);
  },

  async setBoost({ homey, query, body }) {
    return homey.app.setWeatherCurveBoostFromWidget(query.deviceId, body);
  },

  async clearBoost({ homey, query }) {
    return homey.app.clearWeatherCurveBoostFromWidget(query.deviceId);
  },
};
