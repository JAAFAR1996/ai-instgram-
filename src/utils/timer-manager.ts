/**
 * Centralized timer manager to track and cancel timers on shutdown.
 */
class TimerManager {
  private timers = new Set<NodeJS.Timeout>();

  register<T extends NodeJS.Timeout>(timer: T): T {
    this.timers.add(timer);
    return timer;
  }

  unregister(timer: NodeJS.Timeout): void {
    this.timers.delete(timer);
  }

  clearAll(): void {
    for (const timer of this.timers) {
      clearTimeout(timer);
      clearInterval(timer);
    }
    this.timers.clear();
  }
}

export const timerManager = new TimerManager();

/**
 * Patch global timer functions so every timer is registered.
 */
export function setupTimerManagement(): void {
  const originalSetTimeout = global.setTimeout;
  const originalSetInterval = global.setInterval;
  const originalClearTimeout = global.clearTimeout;
  const originalClearInterval = global.clearInterval;

  global.setTimeout = (
    (handler: (...a: any[]) => void, timeout?: number, ...args: any[]) => {
      const timer = originalSetTimeout(handler, timeout, ...args);
      timerManager.register(timer);
      timer.unref?.();
      return timer;
    }
  ) as typeof setTimeout;

  global.setInterval = (
    (handler: (...a: any[]) => void, timeout?: number, ...args: any[]) => {
      const timer = originalSetInterval(handler, timeout, ...args);
      timerManager.register(timer);
      timer.unref?.();
      return timer;
    }
  ) as typeof setInterval;

  global.clearTimeout = (
    (timer: Parameters<typeof clearTimeout>[0]) => {
      timerManager.unregister(timer as NodeJS.Timeout);
      return originalClearTimeout(timer);
    }
  ) as typeof clearTimeout;

  global.clearInterval = (
    (timer: Parameters<typeof clearInterval>[0]) => {
      timerManager.unregister(timer as NodeJS.Timeout);
      return originalClearInterval(timer);
    }
  ) as typeof clearInterval;
}