declare module 'homey' {
  interface FlowCard {
    registerRunListener(
      listener: (args: Record<string, unknown>, state?: Record<string, unknown>) => Promise<boolean | void> | boolean | void,
    ): void;
    trigger(): Promise<void>;
    trigger(tokens: Record<string, unknown>, state?: Record<string, unknown>): Promise<void>;
    trigger(device: Device, tokens?: Record<string, unknown>, state?: Record<string, unknown>): Promise<void>;
  }

  interface FlowManager {
    getActionCard(id: string): FlowCard;
    getConditionCard(id: string): FlowCard;
    getTriggerCard(id: string): FlowCard;
  }

  interface InsightsLog {
    createEntry(value: number | boolean): Promise<void>;
  }

  interface InsightsManager {
    createLog(id: string, options: {
      title: string;
      type: 'number' | 'boolean';
      units?: string;
      decimals?: number;
    }): Promise<InsightsLog>;
    getLog(id: string): Promise<InsightsLog>;
    deleteLog(log: InsightsLog): Promise<void>;
  }

  interface HomeyRuntime {
    flow: FlowManager;
    insights: InsightsManager;
    drivers: {
      getDriver(id: string): Driver & { getDevices(): Device[] };
    };
    setInterval(callback: () => void, ms: number): NodeJS.Timeout;
    clearInterval(timer: NodeJS.Timeout): void;
  }

  class App {
    homey: HomeyRuntime;
    log(...args: unknown[]): void;
    error(...args: unknown[]): void;
  }

  class Driver {
    homey: HomeyRuntime;
    log(...args: unknown[]): void;
    error(...args: unknown[]): void;
  }

  class Device {
    homey: HomeyRuntime;
    log(...args: unknown[]): void;
    error(...args: unknown[]): void;
    getSettings(): Record<string, unknown>;
    setSettings(settings: Record<string, unknown>): Promise<void>;
    getStore(): Record<string, unknown>;
    getData(): Record<string, unknown>;
    getName(): string;
    setStoreValue(key: string, value: unknown): Promise<void>;
    hasCapability(capability: string): boolean;
    getCapabilityValue(capability: string): boolean | number | string | null;
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
