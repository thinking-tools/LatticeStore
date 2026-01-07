import type { NetMonitorReturnType } from './NetworkUtils';
import { VaultController } from './Vault';

const MAX_WORKERS = Math.min(2, navigator.hardwareConcurrency || 1);
const POLL_INTERVAL = 5_000;
type TaskerStatus = 'idle' | 'working' | 'paused:user' | 'paused:network';

type WatchQItem = {
  active: boolean;
  memberId: string;
  vaultId: string;
  // authToken: Function;
  files: Array<{ id: string; etag: string | Function }>;
  vaultRef: VaultController;
  cb: (result: boolean) => void;
};

type TaskQItem = {
  taskType: 'upload' | 'download' | 'delete' | 'stat' | 'watch' | 'abort' | 'pause' | 'resume';
  // fileId?: string;
  // data?: Uint8Array;
  // cb?: (result: boolean, data?: Uint8Array) => void;
};

export class Tasker {
  readonly #netMonitor: NetMonitorReturnType;
  readonly #endpoint: string;
  readonly #workers: Worker[];
  #userPaused = false;
  #status: TaskerStatus = 'idle' as TaskerStatus;
  #connected: boolean;
  #watchQ: Array<WatchQItem> = [];
  #taskQ: Array<TaskQItem> = [];
  #tickTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(netMonitor: NetMonitorReturnType, endpoint: string) {
    this.#netMonitor = netMonitor;
    this.#connected = this.#netMonitor.isOnline();
    this.#netMonitor.onChange(online => {
      this.#connected = online;
      this.#reconcileStatus();
    });

    this.#endpoint = endpoint;
    this.#workers = new Array(MAX_WORKERS).fill(null);
    this._initWorkers();
  }

  #reconcileStatus() {
    const prev = this.#status;

    if (this.#userPaused) {
      this.#status = 'paused:user';
      this.#clearTick();
    } else if (!this.#connected) {
      this.#status = 'paused:network';
      this.#clearTick();
    } else if (this.#watchQ.length || this.#taskQ.length) {
      this.#status = 'working';
      this.#scheduleTick(0);
    } else {
      this.#status = 'idle';
      this.#clearTick();
    }

    if (prev !== this.#status) {
      console.log(`Tasker: ${prev} → ${this.#status}`);
    }
  }
  #scheduleTick(delay: number) {
    if (this.#tickTimer) return; // already scheduled
    this.#tickTimer = setTimeout(() => {
      this.#tickTimer = null;
      this.#tick();
    }, delay);
  }

  #clearTick() {
    if (this.#tickTimer) {
      clearTimeout(this.#tickTimer);
      this.#tickTimer = null;
    }
  }

  #tick() {
    if (this.#status !== 'working' || !this.#watchQ.length) {
      this.#reconcileStatus();
      return;
    }

    // dispatch all watch items to worker 0
    for (const item of this.#watchQ) {
      if (!item.active) continue;
      this.#workers[0]?.postMessage({
        action: 'watch',
        memberId: item.memberId,
        vaultId: item.vaultId,
        authToken: item.vaultRef.getAuthToken(),
        files: item.files,
      });
    }

    this.#scheduleTick(POLL_INTERVAL);
  }

  destroy() {
    this.#userPaused = true;
    this.#connected = false;
    if (this.#tickTimer) clearTimeout(this.#tickTimer);
    for (const w of this.#workers) w?.terminate();
    this.#netMonitor.destroy();
  }

  private _initWorkers() {
    for (let i = 0; i < MAX_WORKERS; i++) {
      const worker = new Worker(new URL('./WebGrunt', import.meta.url), {
        type: 'module',
      });
      worker.onmessage = e => this.#handleWorkerMessage(i, e);
      worker.onerror = e => this.#handleWorkerError(i, e);
      worker.postMessage({
        action: 'init',
        endpoint: this.#endpoint,
      });
      this.#workers[i] = worker;
    }
  }

  // TODO: decrease complexity by moving these methods to VaultController or simplify otherwise
  async #handleWorkerMessage(workerIndex: number, event: MessageEvent) {
    console.log(`Worker ${workerIndex} message:`, event.data, ' connected:', this.#connected);
    const { type, vaultId, changed, error } = event.data;
    if (error) {
      console.error(`Worker ${workerIndex} reported error:`, error);
    }
    if (type === 'watch' && changed.length > 0) {
      const item = this.#watchQ.find(w => w.vaultId === vaultId);
      item?.cb(true);
    }
    if (type === 'auth-error') {
      this.pause();
      const item = this.#watchQ.find(w => w.vaultId === vaultId);
      const success = await item?.vaultRef.handleAuthError();
      if (success) {
        const newToken = item?.vaultRef.getAuthToken();
        if (newToken) {
          // TODO
          // for (const w of this.#watchQ) {
          //   if (w.vaultId === vaultId) {
          //     w.authToken() = newToken;
          //   }
          // }
        }
      } else {
        console.error('Failed to recover from auth error for vault:', vaultId);
        // TODO: remove all watch items for this vault
        this.#watchQ = this.#watchQ.filter(w => w.vaultId !== vaultId);
      }

      this.resume();
    }
  }

  #handleWorkerError(idx: number, event: ErrorEvent) {
    console.error(`Worker ${idx} error:`, event);
    this.#workers[idx]?.terminate();

    const worker = new Worker(new URL('./WebGrunt', import.meta.url), {
      type: 'module',
    });
    worker.onmessage = e => this.#handleWorkerMessage(idx, e);
    worker.onerror = e => this.#handleWorkerError(idx, e);
    worker.postMessage({ action: 'init', endpoint: this.#endpoint });
    this.#workers[idx] = worker;
  }

  hookVault(v: VaultController) {
    try {
      v.setPersistent(true);
      const creds = v.getVaultCredentials();
      console.log('Hooking vault to tasker:', creds.vault);
      this.#watchQ.push({
        active: true,
        memberId: creds.memberId,
        vaultId: creds.vaultId,
        files: [{ id: creds.vault.id, etag: creds.vault.etag }],
        vaultRef: v,
        cb: v.timeToUpdate,
      });
      this.#reconcileStatus();
    } catch (e) {
      console.error('Failed to hook vault to tasker:', e);
    }
  }

  pause() {
    this.#userPaused = true;
    this.#reconcileStatus();
  }

  resume() {
    this.#userPaused = false;
    this.#reconcileStatus();
  }

  disableVaultWatchById(vaultId: string): boolean {
    const item = this.#watchQ.find(w => w.vaultId === vaultId);
    if (item) {
      item.active = false;
      this.#reconcileStatus();
      return true;
    }
    return false;
  }

  enableVaultWatchById(vaultId: string): boolean {
    const item = this.#watchQ.find(w => w.vaultId === vaultId);
    if (item) {
      item.active = true;
      this.#reconcileStatus();
      return true;
    }
    return false;
  }

  _msgToWorkers(msg: any) {
    for (let i = 0; i < this.#workers.length; i++) {
      this.#workers[i]?.postMessage(msg);
    }
  }
}
