import Homey from 'homey';

class GreeVersatiApp extends Homey.App {
  async onInit(): Promise<void> {
    this.log('Gree Versati app initialized');
  }
}

module.exports = GreeVersatiApp;
