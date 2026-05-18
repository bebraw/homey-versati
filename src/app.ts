import Homey from 'homey';

interface WeatherCurveWidgetDevice {
  getData(): Record<string, unknown>;
  weatherCurveWidgetState(): Promise<unknown>;
  updateWeatherCurveFromWidget(input: Record<string, unknown>): Promise<unknown>;
}

class GreeVersatiApp extends Homey.App {
  async onInit(): Promise<void> {
    this.log('Gree Versati app initialized');
  }

  async getWeatherCurveWidgetState(deviceId?: string): Promise<unknown> {
    return this.weatherCurveWidgetDevice(deviceId).weatherCurveWidgetState();
  }

  async updateWeatherCurveFromWidget(deviceId: string | undefined, input: Record<string, unknown>): Promise<unknown> {
    return this.weatherCurveWidgetDevice(deviceId).updateWeatherCurveFromWidget(input);
  }

  private weatherCurveWidgetDevice(deviceId?: string): WeatherCurveWidgetDevice {
    const devices = this.homey.drivers.getDriver('versati').getDevices() as unknown as WeatherCurveWidgetDevice[];
    const device = deviceId
      ? devices.find((candidate) => candidate.getData().id === deviceId)
      : devices[0];
    if (!device) {
      throw new Error('No paired Gree Versati device is available for the weather curve widget');
    }
    return device;
  }
}

module.exports = GreeVersatiApp;
