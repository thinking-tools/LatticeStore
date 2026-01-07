export type ConnectionCallback = (online: boolean) => void;

export type NetMonitorReturnType = {
  isOnline: () => boolean;
  onChange: (callback: ConnectionCallback) => () => void;
  destroy: () => void;
};

export const isOnline = (): boolean => navigator.onLine;

/**
 * Simple network monitor with real connectivity verification
 * Validates actual network access, not just connection status
 * Examples usage:
 *
 * const monitor = createNetworkMonitor();
 * console.log('Initial online status:', monitor.isOnline());
 * const unsubscribe = monitor.onChange((online) => {
 *   console.log('Network status changed. Online:', online);
 * });
 *
 * To stop monitoring:
 * unsubscribe();
 *
 * When done with the monitor entirely:
 * monitor.destroy();
 */

export const createNetworkMonitor = (): NetMonitorReturnType => {
  const callbacks = new Set<ConnectionCallback>();
  let verified = navigator.onLine;
  let timer: ReturnType<typeof setTimeout>;

  const notify = (online: boolean) => {
    for (const cb of callbacks) cb(online);
  };

  const verify = async (): Promise<boolean> => {
    if (!navigator.onLine) return false;
    try {
      await fetch('https://www.cloudflare.com/cdn-cgi/trace', {
        method: 'HEAD',
        cache: 'no-store',
        signal: AbortSignal.timeout(2000),
      });
      return true;
    } catch {
      return false;
    }
  };

  const update = async () => {
    const online = await verify();
    if (verified === online) return;
    verified = online;
    notify(online);
  };

  const handleOnline = () => {
    clearTimeout(timer);
    timer = setTimeout(update, 100);
  };

  const handleOffline = () => {
    verified = false;
    notify(false);
  };

  addEventListener('online', handleOnline);
  addEventListener('offline', handleOffline);

  return {
    isOnline: () => verified,
    onChange: (callback: ConnectionCallback) => {
      callbacks.add(callback);
      return () => callbacks.delete(callback);
    },
    destroy: () => {
      removeEventListener('online', handleOnline);
      removeEventListener('offline', handleOffline);
      clearTimeout(timer);
      callbacks.clear();
    },
  };
};
