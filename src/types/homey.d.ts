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
    setSettings(settings: Record<string, unknown>): Promise<void>;
    getStore(): Record<string, unknown>;
    setStoreValue(key: string, value: unknown): Promise<void>;
    hasCapability(capability: string): boolean;
    registerCapabilityListener(
      capability: string,
      listener: (value: unknown, opts?: Record<string, unknown>) => Promise<void> | void,
    ): void;
    setAvailable(): Promise<void>;
    setUnavailable(message?: string): Promise<void>;
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
