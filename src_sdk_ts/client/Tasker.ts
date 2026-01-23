import type { NetMonitorReturnType } from './NetworkUtils';
import type { VaultId, TaskId, MemberId, FileId, CollectionId, DataSource } from '../shared/Consts.js';
import type { RawAEADKey } from '../crypto/CryptoAEAD.js';
import { VaultController } from './Vault';
import { generateRandomUUID } from '../crypto/CryptoUtils.js';
import { CHUNK_SIZE } from '../shared/Consts.js';
import { ReactiveValue } from './ReactiveValue';
import { WATCH_POLL_INTERVAL } from '../shared/Consts.js';

const MAX_WORKERS = Math.min(2, navigator.hardwareConcurrency || 1);
const MAX_RETRIES = 3;
const STALL_TIMEOUT = 30_000;

type WorkerId = string;
type TaskerStatus = 'idle' | 'working' | 'paused:user' | 'paused:network';
type TaskStatus = 'pending' | 'paused' | 'in-progress' | 'completed' | 'failed';
// type TaskOp = 'upload' | 'download';

type TaskQItem = TaskQUploadItem | TaskQDownloadItem;

type TaskSummary = {
  taskId: TaskId;
  fileId: FileId | CollectionId;
  status: TaskStatus;
  totalBytes: number;
  bytesUploaded: number;
  totalChunks: number;
  completedChunks: number;
  progress: number; // 0-1
};

type ChunkResult = { chunkIndex: number; chunkKey: string; chunkEtag: string };
// type ChunkRef = { key: string; etag: string };

type ChunkAssignment = {
  workerId: WorkerId | null;
  startIndex: number;
  endIndex: number;
  status: TaskStatus;
  retries: number;
  startedAt: number | null;
};

export type UploadOptions = {
  /** If set, worker sends If-Match header — fails if server etag differs */
  expectedEtag?: string;
  /** If true, sends If-None-Match: * — fails if object exists */
  createOnly?: boolean;
  onProgress?: ((progress: UploadProgress) => void) | undefined;
};
export type DownloadOptions = {
  onProgress?: (progress: DownloadProgress) => void;
};

export type UploadProgress = {
  taskId: TaskId;
  fileId: FileId | CollectionId;
  chunkIndex: number;
  totalChunks: number;
  bytesUploaded: number;
  totalBytes: number;
};

export type UploadResult = {
  taskId: TaskId;
  fileId: FileId | CollectionId;
  chunks: ChunkResult[];
  totalBytes: number;
};

export type TaskQHandle<T> = {
  taskId: TaskId;
  fileId: FileId | CollectionId;
  promise: Promise<T>;
  abort: () => void;
  pause: () => void;
  resume: () => void;
  isPaused: () => boolean;
};

export type DownloadProgress = {
  taskId: TaskId;
  fileId: FileId | CollectionId;
  chunkIndex: number;
  totalChunks: number;
  etag: string;
  data: ArrayBuffer;
};

export type DownloadResult = {
  taskId: TaskId;
  fileId: FileId | CollectionId;
  etag: string;
  data: ArrayBuffer;
};

type TaskQUploadItem = {
  taskStatus: TaskStatus;
  taskOp: 'upload';
  taskId: TaskId;
  memberId: MemberId;
  vaultId: VaultId;
  fileId: FileId | CollectionId;
  encKey: RawAEADKey;
  vaultRef: VaultController;
  source: DataSource;
  totalBytes: number;
  totalChunks: number;
  assignments: ChunkAssignment[];
  results: Map<number, ChunkResult>;
  options: UploadOptions;
  resolve: (result: UploadResult) => void;
  reject: (error: Error) => void;
  aborted: boolean;
  paused: boolean;
};
type TaskQDownloadItem = {
  taskStatus: TaskStatus;
  taskOp: 'download';
  taskId: TaskId;
  memberId: MemberId;
  vaultId: VaultId;
  fileId: FileId | CollectionId;
  encKey: RawAEADKey;
  vaultRef: VaultController;
  options: DownloadOptions;
  resolve: (result: DownloadResult) => void;
  reject: (error: Error) => void;
  aborted: boolean;
  paused: boolean;
  workerId: WorkerId | null; // track assigned worker
  startedAt: number | null; // for stall detection
  retries: number; // retry count
};

type WatchQItem = {
  active: boolean;
  memberId: MemberId;
  vaultId: VaultId;
  files: Array<{ fileId: string; etag: string | Function; cb: () => void }>;
  vaultRef: VaultController;
};

type WorkerState = {
  worker: Worker;
  busy: boolean;
  currentTaskId: TaskId | null;
};

export class Tasker {
  readonly #netMonitor: NetMonitorReturnType;
  readonly #endpoint: string;
  readonly #workers = new Map<WorkerId, WorkerState>();
  readonly #watchQ = new Map<VaultId, WatchQItem>();
  readonly #taskQ = new Map<TaskId, TaskQItem>();
  readonly tasks = new ReactiveValue<TaskSummary[]>([]);

  #userPaused = false;
  #status: TaskerStatus = 'idle';
  #connected: boolean;
  #tickTimer: ReturnType<typeof setTimeout> | null = null;
  #workerIdCounter = 0;

  constructor(netMonitor: NetMonitorReturnType, endpoint: string) {
    this.#netMonitor = netMonitor;
    this.#endpoint = endpoint;
    this.#connected = netMonitor.isOnline();
    netMonitor.onChange(online => {
      this.#connected = online;
      this.#reconcile();
    });
    this.#initWorkers();
  }

  #initWorkers() {
    for (let i = 0; i < MAX_WORKERS; i++) {
      const id = String(++this.#workerIdCounter);
      const worker = new Worker(new URL('./WebGrunt.mjs', import.meta.url), { type: 'module' });
      worker.onmessage = e => this.#onWorkerMsg(id, e);
      worker.onerror = e => this.#onWorkerError(id, e);
      worker.postMessage({ action: 'init', endpoint: this.#endpoint, workerId: id });
      this.#workers.set(id, { worker, busy: false, currentTaskId: null });
    }
  }

  #updateTasksSummary() {
    const summaries: TaskSummary[] = [];
    for (const task of this.#taskQ.values()) {
      if (task.taskOp === 'upload') {
        const completedChunks = task.results.size;
        const bytesUploaded = Math.min(completedChunks * CHUNK_SIZE, task.totalBytes);
        summaries.push({
          taskId: task.taskId,
          fileId: task.fileId,
          status: task.taskStatus,
          totalBytes: task.totalBytes,
          bytesUploaded,
          totalChunks: task.totalChunks,
          completedChunks,
          progress: task.totalBytes > 0 ? bytesUploaded / task.totalBytes : 1,
        });
      }
    }
    this.tasks.set(summaries);
  }

  #reconcile() {
    const prev = this.#status;
    if (this.#userPaused) {
      this.#status = 'paused:user';
    } else if (!this.#connected) {
      this.#status = 'paused:network';
    } else if (this.#watchQ.size || this.#taskQ.size) {
      this.#status = 'working';
    } else {
      this.#status = 'idle';
    }

    if (this.#status === 'working') {
      this.#dispatch();
      this.#scheduleTick();
    } else {
      this.#clearTick();
    }

    if (prev !== this.#status) console.log(`Tasker: ${prev} → ${this.#status}`);
  }

  #scheduleTick() {
    this.#tickTimer ??= setTimeout(() => {
      this.#tickTimer = null;
      this.#tick();
    }, WATCH_POLL_INTERVAL);
  }

  #clearTick() {
    if (this.#tickTimer) {
      clearTimeout(this.#tickTimer);
      this.#tickTimer = null;
    }
  }

  #tick() {
    if (this.#status !== 'working') return;
    this.#checkStalledAssignments();
    // Find an idle worker for watch, or use first if all busy
    let watchWorker: WorkerState | undefined;
    for (const state of this.#workers.values()) {
      if (!state.busy) {
        watchWorker = state;
        break;
      }
    }
    watchWorker ??= this.#workers.values().next().value;

    if (watchWorker) {
      for (const item of this.#watchQ.values()) {
        if (!item.active) continue;
        watchWorker.worker.postMessage({
          action: 'watch',
          memberId: item.memberId,
          vaultId: item.vaultId,
          authToken: item.vaultRef.getAuthToken(), // <-- also refresh here
          files: item.files.map(f => ({
            fileId: f.fileId,
            etag: typeof f.etag === 'function' ? f.etag() : f.etag,
          })),
        });
      }
    }
    this.#scheduleTick();
  }

  #checkStalledAssignments() {
    const now = Date.now();
    for (const task of this.#taskQ.values()) {
      if (task.aborted || task.paused) continue;
      switch (task.taskOp) {
        case 'upload':
          for (const assignment of task.assignments) {
            if (
              assignment.status === 'in-progress' &&
              assignment.startedAt &&
              now - assignment.startedAt > STALL_TIMEOUT
            ) {
              console.warn(
                `Stalled upload: task=${task.taskId}, chunk=${assignment.startIndex}-${assignment.endIndex}`,
              );
              if (assignment.workerId) this.#markIdle(assignment.workerId);
              assignment.retries++;
              if (assignment.retries >= MAX_RETRIES) {
                this.#failTask(task, `Upload stalled after ${MAX_RETRIES} retries`);
              } else {
                assignment.status = 'pending';
                assignment.workerId = null;
                assignment.startedAt = null;
              }
            }
          }
          break;
        case 'download':
          if (task.startedAt && now - task.startedAt > STALL_TIMEOUT) {
            console.warn(`Stalled download: task=${task.taskId}`);
            if (task.workerId) this.#markIdle(task.workerId);
            task.retries++;
            if (task.retries >= MAX_RETRIES) {
              this.#failTask(task, `Download stalled after ${MAX_RETRIES} retries`);
            } else {
              task.workerId = null;
              task.startedAt = null;
              task.taskStatus = 'pending';
            }
          }
          break;
      }
    }
  }

  #dispatch() {
    if (this.#status !== 'working') return;

    for (const task of this.#taskQ.values()) {
      if (task.aborted || task.paused) continue;
      if (task.taskStatus !== 'pending' && task.taskStatus !== 'in-progress') continue;

      if (task.taskOp === 'upload') {
        for (const assignment of task.assignments) {
          if (assignment.status !== 'pending') continue;
          const workerId = this.#getIdleWorker();
          if (!workerId) return;

          assignment.status = 'in-progress';
          assignment.workerId = workerId;
          assignment.startedAt = Date.now();
          this.#markBusy(workerId, task.taskId);
          this.#sendChunkBatch(task, assignment, workerId);
        }
      } else if (task.taskOp === 'download') {
        if (task.workerId) continue; // already assigned
        const workerId = this.#getIdleWorker();
        if (!workerId) return;

        task.workerId = workerId;
        task.startedAt = Date.now();
        task.taskStatus = 'in-progress';
        this.#markBusy(workerId, task.taskId);
        this.#sendDownload(task, workerId);
      }
    }
  }

  #sendDownload(task: TaskQDownloadItem, workerId: WorkerId) {
    const freshToken = task.vaultRef.getAuthToken();
    if (task.aborted || task.paused) {
      task.workerId = null;
      task.startedAt = null;
      this.#markIdle(workerId);
      return;
    }

    this.#workers.get(workerId)!.worker.postMessage({
      action: 'download',
      taskId: task.taskId,
      fileId: task.fileId,
      memberId: task.memberId,
      vaultId: task.vaultId,
      authToken: freshToken,
      encKey: task.encKey,
    });
  }

  #getIdleWorker(): WorkerId | null {
    for (const [id, s] of this.#workers) if (!s.busy) return id;
    return null;
  }

  #markBusy(workerId: WorkerId, taskId: TaskId) {
    const s = this.#workers.get(workerId);
    if (s) {
      s.busy = true;
      s.currentTaskId = taskId;
    }
  }

  #markIdle(workerId: WorkerId) {
    const s = this.#workers.get(workerId);
    if (s) {
      s.busy = false;
      s.currentTaskId = null;
    }
    this.#dispatch();
  }

  async #sendChunkBatch(task: TaskQItem, assignment: ChunkAssignment, workerId: WorkerId) {
    const freshToken = task.vaultRef.getAuthToken();
    if (task.aborted || task.paused) {
      assignment.status = 'pending';
      assignment.workerId = null;
      assignment.startedAt = null;
      this.#markIdle(workerId);
      return;
    }

    task.taskStatus = 'in-progress';
    if (task.taskOp === 'upload') {
      this.#workers.get(workerId)!.worker.postMessage({
        action: 'uploadBatch',
        taskId: task.taskId,
        fileId: task.fileId,
        memberId: task.memberId,
        vaultId: task.vaultId,
        authToken: freshToken,
        encKey: task.encKey,
        startIndex: assignment.startIndex,
        endIndex: assignment.endIndex,
        totalChunks: task.totalChunks,
        chunkSize: CHUNK_SIZE,
        expectedEtag: task.options.expectedEtag,
        createOnly: task.options.createOnly,
        source: task.source,
        totalBytes: task.totalBytes,
      });
    }
  }

  #onWorkerMsg(workerId: WorkerId, { data }: MessageEvent) {
    const { type, taskId, vaultId, ...payload } = data;

    switch (type) {
      case 'init-ack':
        this.#markIdle(workerId);
        break;

      case 'chunk-progress':
        this.#onChunkProgress(taskId, payload);
        break;

      case 'batch-complete':
        this.#onBatchComplete(workerId, taskId, payload);
        break;

      case 'batch-error':
        this.#onBatchError(workerId, taskId, payload);
        break;

      case 'precondition-failed':
        this.#onPreconditionFailed(workerId, taskId, payload);
        break;

      case 'watch':
        if (payload.changed?.length) {
          const i = this.#watchQ.get(vaultId);
          if (i) {
            for (const fId of payload.changed) {
              const f = i.files.find(f => f.fileId === fId);
              f?.cb();
            }
          }
        }
        break;

      case 'download-complete':
        this.#onDownloadComplete(workerId, taskId, payload);
        break;

      case 'download-error':
        this.#onDownloadError(workerId, taskId, payload);
        break;

      case 'auth-error':
        this.#onAuthError(vaultId);
        break;
    }
  }

  #onChunkProgress(taskId: TaskId, { chunkIndex, chunkKey, chunkEtag }: ChunkResult) {
    const task = this.#taskQ.get(taskId);
    if (!task || task.aborted || task.taskOp !== 'upload') return;
    task.results.set(chunkIndex, { chunkIndex, chunkKey, chunkEtag });
    const completedCount = task.results.size;
    if (task.taskOp === 'upload') {
      task.options.onProgress?.({
        taskId,
        fileId: task.fileId,
        chunkIndex,
        totalChunks: task.totalChunks,
        bytesUploaded: Math.min(completedCount * CHUNK_SIZE, task.totalBytes),
        totalBytes: task.totalBytes,
      });
    }
    this.#updateTasksSummary();
  }

  #onBatchComplete(
    workerId: WorkerId,
    taskId: TaskId,
    payload: { startIndex: number; endIndex: number; results: ChunkResult[] },
  ) {
    const task = this.#taskQ.get(taskId);
    this.#markIdle(workerId);
    if (!task || task.taskOp !== 'upload') return;

    const assignment = task.assignments.find(
      a => a.startIndex === payload.startIndex && a.endIndex === payload.endIndex,
    );
    if (assignment) {
      assignment.status = 'completed';
      for (const r of payload.results) task.results.set(r.chunkIndex, r);
    }

    if (task.assignments.every(a => a.status === 'completed')) {
      task.taskStatus = 'completed';
      task.resolve({
        taskId,
        fileId: task.fileId,
        chunks: [...task.results.values()].sort((a, b) => a.chunkIndex - b.chunkIndex),
        totalBytes: task.totalBytes,
      });
      this.#taskQ.delete(taskId);
      this.#updateTasksSummary();
      this.#reconcile();
    }
  }

  #onBatchError(
    workerId: WorkerId,
    taskId: TaskId,
    payload: { startIndex: number; endIndex: number; error: string; lastCompletedIndex: number },
  ) {
    const task = this.#taskQ.get(taskId);
    this.#markIdle(workerId);
    if (!task || task.taskOp !== 'upload') return;

    const assignment = task.assignments.find(
      a => a.startIndex === payload.startIndex && a.endIndex === payload.endIndex,
    );
    if (!assignment) return;

    assignment.retries++;
    assignment.startedAt = null;
    assignment.workerId = null;

    if (assignment.retries >= MAX_RETRIES) {
      this.#failTask(task, `Upload failed after ${MAX_RETRIES} retries: ${payload.error}`);
    } else {
      assignment.startIndex = payload.lastCompletedIndex + 1;
      assignment.status = 'pending';
    }
  }

  #onPreconditionFailed(workerId: WorkerId, taskId: TaskId, payload: { message: string }) {
    const task = this.#taskQ.get(taskId);
    this.#markIdle(workerId);
    if (!task) return;
    this.#failTask(task, `Precondition failed: ${payload.message}`);
  }

  #failTask(task: TaskQItem, message: string) {
    task.taskStatus = 'failed';
    task.reject(new Error(message));
    this.#taskQ.delete(task.taskId);
    this.#updateTasksSummary();
    this.#reconcile();
  }

  async #onAuthError(vaultId: VaultId) {
    this.pause();
    const item = this.#watchQ.get(vaultId);
    if (item && !(await item.vaultRef.handleAuthError())) {
      this.#watchQ.delete(vaultId);
    }
    this.resume();
  }

  #onWorkerError(workerId: WorkerId, event: ErrorEvent) {
    console.error(`Worker ${workerId} error:`, event);
    const state = this.#workers.get(workerId);
    if (!state) return;

    const taskId = state.currentTaskId;
    state.worker.terminate();
    this.#workers.delete(workerId);

    // Respawn
    const newId = String(++this.#workerIdCounter);
    const worker = new Worker(new URL('./WebGrunt', import.meta.url), { type: 'module' });
    worker.onmessage = e => this.#onWorkerMsg(newId, e);
    worker.onerror = e => this.#onWorkerError(newId, e);
    worker.postMessage({ action: 'init', endpoint: this.#endpoint, workerId: newId });
    this.#workers.set(newId, { worker, busy: false, currentTaskId: null });

    // Re-queue failed task
    if (taskId) {
      const task = this.#taskQ.get(taskId);
      if (!task) return;

      if (task.taskOp === 'upload') {
        const assignment = task.assignments.find(a => a.workerId === workerId && a.status === 'in-progress');
        if (assignment) {
          assignment.status = 'pending';
          assignment.workerId = null;
          assignment.startedAt = null;
          assignment.retries++;
          if (assignment.retries >= MAX_RETRIES) {
            this.#failTask(task, `Upload failed after ${MAX_RETRIES} worker errors`);
          }
        }
      } else if (task.taskOp === 'download') {
        if (task.workerId === workerId) {
          task.workerId = null;
          task.startedAt = null;
          task.retries++;
          if (task.retries >= MAX_RETRIES) {
            this.#failTask(task, `Download failed after ${MAX_RETRIES} worker errors`);
          } else {
            task.taskStatus = 'pending';
          }
        }
      }
    }
    this.#dispatch();
  }

  #onDownloadComplete(workerId: WorkerId, taskId: TaskId, payload: { etag: string; data: ArrayBuffer }) {
    const task = this.#taskQ.get(taskId);
    this.#markIdle(workerId);
    if (!task || task.taskOp !== 'download') return;

    task.taskStatus = 'completed';
    task.resolve({
      taskId,
      fileId: task.fileId,
      etag: payload.etag,
      data: payload.data,
    });
    this.#taskQ.delete(taskId);
    this.#updateTasksSummary();
    this.#reconcile();
  }

  #onDownloadError(workerId: WorkerId, taskId: TaskId, payload: { error: string }) {
    const task = this.#taskQ.get(taskId);
    this.#markIdle(workerId);
    if (!task || task.taskOp !== 'download') return;

    task.retries++;
    task.workerId = null;
    task.startedAt = null;

    if (task.retries >= MAX_RETRIES) {
      this.#failTask(task, `Download failed after ${MAX_RETRIES} retries: ${payload.error}`);
    } else {
      task.taskStatus = 'pending';
      this.#dispatch();
    }
  }

  #pauseTask(taskId: TaskId) {
    const task = this.#taskQ.get(taskId);
    if (!task || task.aborted || task.taskStatus === 'completed' || task.taskStatus === 'failed') return;

    task.paused = true;
    task.taskStatus = 'paused';

    if (task.taskOp === 'upload') {
      for (const assignment of task.assignments) {
        if (assignment.status === 'in-progress') {
          assignment.status = 'pending';
          assignment.startedAt = null;
          if (assignment.workerId) {
            this.#markIdle(assignment.workerId);
            assignment.workerId = null;
          }
        }
      }
    } else if (task.taskOp === 'download') {
      if (task.workerId) {
        this.#markIdle(task.workerId);
        task.workerId = null;
      }
      task.startedAt = null;
    }
    this.#updateTasksSummary();
  }

  #resumeTask(taskId: TaskId) {
    const task = this.#taskQ.get(taskId);
    if (!task || task.aborted || !task.paused) return;
    task.paused = false;
    if (task.taskOp === 'download') {
      task.taskStatus = 'pending'; // was missing
      task.startedAt = null;
    } else if (task.taskOp === 'upload') {
      task.taskStatus = task.assignments.some(a => a.status === 'completed') ? 'in-progress' : 'pending';
    }
    this.#updateTasksSummary();
    this.#reconcile();
  }

  // ─── Public API ────────────────────────────────────────────────────────────

  upload(
    v: VaultController,
    fileId: FileId | CollectionId,
    data: DataSource,
    encKey: RawAEADKey,
    options: UploadOptions = {},
  ): TaskQHandle<UploadResult> {
    const taskId = generateRandomUUID() as TaskId;
    console.warn('Starting upload task:', taskId, 'fileId:', fileId, 'encKey:', encKey, typeof encKey);
    const creds = v.getVaultCredentials();
    const totalBytes = data instanceof ArrayBuffer ? data.byteLength : data.size;
    const totalChunks = Math.ceil(totalBytes / CHUNK_SIZE) || 1; // at least 1 for empty file
    const workerCount = Math.max(1, this.#workers.size);

    const assignments: ChunkAssignment[] = [];
    const chunksPerWorker = Math.ceil(totalChunks / workerCount);
    for (let i = 0; i * chunksPerWorker < totalChunks; i++) {
      assignments.push({
        workerId: null,
        startIndex: i * chunksPerWorker,
        endIndex: Math.min((i + 1) * chunksPerWorker - 1, totalChunks - 1),
        status: 'pending',
        retries: 0,
        startedAt: null,
      });
    }

    let resolve!: (r: UploadResult) => void;
    let reject!: (e: Error) => void;
    const promise = new Promise<UploadResult>((res, rej) => {
      resolve = res;
      reject = rej;
    });

    const task: TaskQUploadItem = {
      taskStatus: 'pending',
      taskOp: 'upload',
      taskId,
      memberId: creds.memberId,
      vaultId: creds.vaultId,
      fileId,
      encKey,
      vaultRef: v,
      source: data,
      totalBytes,
      totalChunks,
      assignments,
      results: new Map(),
      options,
      resolve,
      reject,
      aborted: false,
      paused: false,
    };

    this.#taskQ.set(taskId, task);
    this.#reconcile();

    return {
      taskId,
      fileId,
      promise,
      abort: () => {
        task.aborted = true;
        task.reject(new Error('Upload aborted'));
        this.#taskQ.delete(taskId);
        this.#updateTasksSummary();
        this.#reconcile();
      },
      pause: () => this.#pauseTask(taskId),
      resume: () => this.#resumeTask(taskId),
      isPaused: () => task.paused,
    };
  }

  /** Convenience: create-only upload (fails if exists) */
  create(
    v: VaultController,
    fileId: FileId | CollectionId,
    data: DataSource,
    encKey: RawAEADKey,
    onProgress?: UploadOptions['onProgress'],
  ) {
    return this.upload(v, fileId, data, encKey, { createOnly: true, onProgress });
  }

  /** Convenience: overwrite with etag check */
  update(
    v: VaultController,
    fileId: FileId | CollectionId,
    data: DataSource,
    encKey: RawAEADKey,
    expectedEtag: string,
    onProgress?: UploadOptions['onProgress'],
  ) {
    return this.upload(v, fileId, data, encKey, { expectedEtag, onProgress });
  }

  download(
    v: VaultController,
    fileId: FileId | CollectionId,
    encKey: RawAEADKey,
    options: DownloadOptions = {},
  ): TaskQHandle<DownloadResult> {
    const taskId = generateRandomUUID() as TaskId;
    const creds = v.getVaultCredentials();
    let resolve!: (r: DownloadResult) => void;
    let reject!: (e: Error) => void;
    const promise = new Promise<DownloadResult>((res, rej) => {
      resolve = res;
      reject = rej;
    });

    const task: TaskQDownloadItem = {
      taskStatus: 'pending',
      taskOp: 'download',
      taskId,
      memberId: creds.memberId,
      vaultId: creds.vaultId,
      fileId,
      encKey,
      vaultRef: v,
      options,
      resolve,
      reject,
      aborted: false,
      paused: false,
      workerId: null,
      startedAt: null,
      retries: 0,
    };

    this.#taskQ.set(taskId, task as any);
    this.#updateTasksSummary();
    this.#reconcile();

    return {
      taskId,
      fileId,
      promise,
      abort: () => {
        task.aborted = true;
        task.reject(new Error('Download aborted'));
        this.#taskQ.delete(taskId);
        this.#updateTasksSummary();
        this.#reconcile();
      },
      pause: () => this.#pauseTask(taskId),
      resume: () => this.#resumeTask(taskId),
      isPaused: () => task.paused,
    };
  }

  hookVault(v: VaultController) {
    try {
      v.setPersistent(true);
      const creds = v.getVaultCredentials();
      this.#watchQ.set(creds.vaultId, {
        active: true,
        memberId: creds.memberId,
        vaultId: creds.vaultId,
        files: [{ fileId: creds.vault.id, etag: () => v.getEtag(), cb: v.timeToFetchUpdate }],
        vaultRef: v,
      });
      this.#reconcile();
    } catch (e) {
      console.error('Failed to hook vault:', e);
    }
  }

  watchCollection(v: VaultController, colId: CollectionId, etag: string | (() => string), cb: () => void) {
    const item = this.#watchQ.get(v.getId());
    if (!item) {
      // Auto-hook vault if not already
      this.hookVault(v);
    }
    const watchItem = this.#watchQ.get(v.getId())!;

    // Add to files array for polling
    watchItem.files.push({
      fileId: colId,
      etag: typeof etag === 'function' ? etag : () => etag,
      cb: cb,
    });
    this.#reconcile();
  }

  unwatchCollection(vaultId: VaultId, colId: CollectionId) {
    const item = this.#watchQ.get(vaultId);
    if (!item) return;
    item.files = item.files.filter(f => f.fileId !== colId);
  }

  pause() {
    this.#userPaused = true;
    this.#reconcile();
  }
  resume() {
    this.#userPaused = false;
    this.#reconcile();
  }

  abortByFileId(fileId: FileId | CollectionId): void {
    for (const [taskId, task] of this.#taskQ) {
      if (task.fileId === fileId && !task.aborted) {
        task.aborted = true;
        task.reject(new Error('Task aborted: resource deleted'));
        this.#taskQ.delete(taskId);
      }
    }
    this.#updateTasksSummary();
  }

  disableVaultWatch(vaultId: VaultId) {
    const item = this.#watchQ.get(vaultId);
    if (item) {
      item.active = false;
      this.#reconcile();
      return true;
    }
    return false;
  }

  enableVaultWatch(vaultId: VaultId) {
    const item = this.#watchQ.get(vaultId);
    if (item) {
      item.active = true;
      this.#reconcile();
      return true;
    }
    return false;
  }

  pauseTask(taskId: TaskId) {
    this.#pauseTask(taskId);
  }

  resumeTask(taskId: TaskId) {
    this.#resumeTask(taskId);
  }

  destroy() {
    this.#userPaused = true;
    this.#clearTick();
    for (const { worker } of this.#workers.values()) worker.terminate();
    this.#netMonitor.destroy();
  }

  abortAll() {
    for (const task of this.#taskQ.values()) {
      task.aborted = true;
      task.reject(new Error('Upload aborted'));
    }
    this.#taskQ.clear();
    this.#updateTasksSummary();
    this.#reconcile();
  }
}
