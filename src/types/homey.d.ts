declare module 'homey' {
  class App {
    log(...args: unknown[]): void;
    error(...args: unknown[]): void;
  }

  class Driver {
    log(...args: unknown[]): void;
    error(...args: unknown[]): void;
  }

  class Device {
    homey: {
      setInterval(callback: () => void, ms: number): NodeJS.Timeout;
      clearInterval(timer: NodeJS.Timeout): void;
    };
    log(...args: unknown[]): void;
    error(...args: unknown[]): void;
    getSettings(): Record<string, unknown>;
    hasCapability(capability: string): boolean;
    setAvailable(): Promise<void>;
    setCapabilityValue(capability: string, value: boolean | number | string): Promise<void>;
  }

  namespace Driver {
    interface PairSession {
      setHandler(name: string, handler: (...args: unknown[]) => Promise<unknown> | unknown): void;
    }
  }

  const Homey: {
    App: typeof App;
    Driver: typeof Driver;
    Device: typeof Device;
  };

  export default Homey;
}
