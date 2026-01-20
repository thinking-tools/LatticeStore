import type { CollectionId, CollectionType, MemberId, Timestamp } from '../../shared/Consts.js';

import { ReactiveValue } from '../ReactiveValue.js';
import type { RawAEADKey } from '../../crypto/CryptoAEAD';
import { KVContent } from './KV.js';
import { genId, now, toUint8Array, fromUint8Array } from '../../shared/Helpers.js';
import { generateRandomBytes } from '../../crypto/CryptoUtils.js';
import { VaultController } from '../Vault.js';
import { Tasker } from '../Tasker.js';
import type { TaskQHandle, UploadResult, DownloadResult } from '../Tasker.js';
// import { VaultController } from '../Vault.js';
// import { genId, now, uint8ArrayToBase64, uint8ArrayToHex } from '../Helpers.js';
// import { generateRandomBytes } from '../CryptoUtils.js';

import { SYNC_DEBOUNCE_MS } from '../../shared/Consts.js';

export interface CollectionContent<T = unknown> {
  readonly type: CollectionType;
  readonly data$: ReactiveValue<T>;
  serialize(): Uint8Array;
  getPendingChanges(): unknown | null;
  clearPending(): void;
}

export type CollectionMinimal = {
  colId: CollectionId;
  colType: CollectionType;
  colName: string;
  colEncKey: RawAEADKey; // encrypted with collectionsKey
};

export type CollectionMeta = {
  epoch: number;
  etag: string | null;
  createdAt: Timestamp;
  createdById: MemberId | null;
  modifiedAt: Timestamp;
  modifiedById: MemberId | null;
  archived: boolean;
  archivedAt: Timestamp | null;
  toDelete: boolean;
};

const defaultMeta = (memberId: MemberId | null): CollectionMeta => ({
  epoch: 0,
  etag: null,
  createdAt: now(),
  createdById: memberId,
  modifiedAt: now(),
  modifiedById: memberId,
  archived: false,
  archivedAt: null,
  toDelete: false,
});

type SyncState = 'idle' | 'pending' | 'syncing' | 'error';

export class CollectionController<T extends CollectionContent = CollectionContent> {
  readonly #minimal: CollectionMinimal;
  readonly #s3Key: string;
  readonly #vault: VaultController;
  #meta?: CollectionMeta | null;
  #metaBytesCache: Uint8Array<ArrayBuffer> | null = null;
  #metaDirty = true;
  #content: T | null = null;

  // Sync infrastructure
  #tasker: Tasker | null = null;
  #syncTimeout: ReturnType<typeof setTimeout> | null = null;
  #currentUpload: TaskQHandle<UploadResult> | null = null;
  #unsubscribe: (() => void) | null = null;

  // #vault: VaultController | null = null;
  // #syncTimeout: ReturnType<typeof setTimeout> | null = null;
  // #currentUpload: TaskQHandle<UploadResult> | null = null;
  // #unsubscribe: (() => void) | null = null;

  readonly syncState$ = new ReactiveValue<SyncState>('idle');
  readonly lastError$ = new ReactiveValue<Error | null>(null);

  constructor(collection: CollectionMinimal, vault: VaultController, meta?: CollectionMeta) {
    this.#minimal = collection;
    this.#vault = vault;
    this.#s3Key = `${collection.colId}`;
    // if meta do not initialize
    if (meta) {
      this.#meta = meta;
    }
    console.log('CollectionController created:', this.#vault.getId(), this.#s3Key);
  }

  public getColMinimalRef(): CollectionMinimal {
    return this.#minimal;
  }

  public getName(): string {
    return this.#minimal.colName;
  }
  public getId(): CollectionId {
    return this.#minimal.colId;
  }
  public getType(): CollectionType {
    return this.#minimal.colType;
  }
  public getEncKey(): RawAEADKey {
    return this.#minimal.colEncKey;
  }

  public setName(newName: string, memberId: MemberId | null): void {
    this.#minimal.colName = newName;
    if (this.#meta) {
      this.#meta.modifiedAt = now();
      this.#meta.modifiedById = memberId;
      this.#metaDirty = true;
    }
  }

  get content(): T {
    if (!this.#content) throw new Error('Not loaded');
    return this.#content;
  }

  // Collection.ts - complete the static factory
  static createNew(
    name: string,
    type: CollectionType,
    vault: VaultController,
    memberId: MemberId | null,
  ): CollectionController {
    const minimal: CollectionMinimal = {
      colId: `${genId()}` as CollectionId,
      colType: type,
      colName: name,
      colEncKey: generateRandomBytes(32) as RawAEADKey,
    };
    const col = new CollectionController(minimal, vault, defaultMeta(memberId));
    col.create(type); // init empty content
    return col;
  }

  #getMetaBytes(): Uint8Array<ArrayBuffer> {
    if (this.#metaDirty || !this.#metaBytesCache) {
      this.#metaBytesCache = toUint8Array(JSON.stringify(this.#meta)) as Uint8Array<ArrayBuffer>;
      this.#metaDirty = false;
    }
    return this.#metaBytesCache;
  }

  static parsePayload(buffer: ArrayBuffer): { meta: Uint8Array; content: Uint8Array } {
    const view = new DataView(buffer);
    const metaLen = view.getUint32(0, true); // little-endian
    const meta = new Uint8Array(buffer, 4, metaLen);
    const content = new Uint8Array(buffer, 4 + metaLen);
    return { meta, content };
  }

  serialize(): Blob {
    if (!this.#content) this.#content = this.create(this.#minimal.colType);

    const metaBytes = this.#getMetaBytes();
    const contentBytes = this.#content.serialize() as Uint8Array<ArrayBuffer>;

    const header = new Uint8Array(4) as Uint8Array<ArrayBuffer>;
    const len = metaBytes.length;
    header[0] = len;
    header[1] = len >> 8;
    header[2] = len >> 16;
    header[3] = len >> 24;

    return new Blob([header, metaBytes, contentBytes]);
  }

  async load(tasker: Tasker, autoSync = true): Promise<T> {
    this.#tasker = tasker;
    const download = this.#tasker.download(this.#vault, this.getId(), this.getEncKey());
    const downloadFinished = (await download.promise) as DownloadResult;
    console.warn('Collection downloaded:', this.getId(), downloadFinished);
    const { meta, content } = CollectionController.parsePayload(downloadFinished.data);
    this.#meta = JSON.parse(fromUint8Array(meta)) as CollectionMeta;
    this.#meta.etag = downloadFinished.etag;
    switch (this.getType()) {
      case 'KV' as CollectionType:
        this.#content = KVContent.deserialize(content) as unknown as T;
        break;
      default:
        throw new Error(`Unsupported collection type: ${this.#minimal.colType}`);
    }
    if (autoSync) {
      // auto upload on changes
      this.#hookContent();
      // register for watch remote changes
      // this.#registerWatch();
    }
    return this.#content as T;
  }

  #hookContent() {
    // Subscribe to data changes for auto-sync
    this.#unsubscribe?.();
    this.#unsubscribe = this.#content!.data$.subscribe(() => {
      if (this.#content!.getPendingChanges()) {
        this.#scheduleSave();
      }
    });
  }

  #scheduleSave() {
    if (this.#syncTimeout) clearTimeout(this.#syncTimeout);
    this.#syncTimeout = setTimeout(() => this.#save(), SYNC_DEBOUNCE_MS);
    this.syncState$.set('pending');
  }

  /** Create new empty collection */
  create(type: CollectionType): T {
    switch (type) {
      case 'KV' as CollectionType:
        this.#content = new KVContent() as unknown as T; // assign it
        return this.#content;
      default:
        throw new Error(`Unsupported collection type: ${this.#minimal.colType}`);
    }
  }

  async #save(): Promise<void> {
    if (!this.#tasker || !this.#content?.getPendingChanges()) return;

    // Abort any in-flight upload
    this.#currentUpload?.abort();
    this.syncState$.set('syncing');

    const etag = this.#meta?.etag;
    const blob = this.serialize();

    try {
      // Conditional upload with etag
      const handle = etag
        ? this.#tasker.update(this.#vault, this.getId(), blob, this.getEncKey(), etag)
        : this.#tasker.create(this.#vault, this.getId(), blob, this.getEncKey());

      this.#currentUpload = handle;
      const result = await handle.promise;

      // get etag from chunks[0]
      const uploadedEtag = result.chunks[0]?.chunkEtag;
      if (this.#meta) this.#meta.etag = uploadedEtag ?? this.#meta.etag;
      this.#content.clearPending();
      this.syncState$.set('idle');
      this.lastError$.set(null);
    } catch (err) {
      if ((err as Error).message.includes('Precondition failed')) {
        // Remote changed - need to pull and merge
        await this.#pullAndMerge();
      } else if (!(err as Error).message.includes('aborted')) {
        this.syncState$.set('error');
        this.lastError$.set(err as Error);
      }
    } finally {
      this.#currentUpload = null;
    }
  }

  async #pullAndMerge(): Promise<void> {
    if (!this.#tasker) return;

    const download = this.#tasker.download(this.#vault, this.getId(), this.getEncKey());
    const result = await download.promise;
    const { meta, content } = CollectionController.parsePayload(result.data);

    this.#meta = JSON.parse(fromUint8Array(meta)) as CollectionMeta;
    this.#meta.etag = result.etag;

    if (this.getType() === ('KV' as CollectionType) && this.#content) {
      const remote = KVContent.deserialize(content);
      (this.#content as unknown as KVContent).merge(remote);
    }

    // Re-save if we still have pending changes after merge
    if (this.#content?.getPendingChanges()) {
      this.#scheduleSave();
    } else {
      this.syncState$.set('idle');
    }
  }

  /** Check if there are unsaved changes */
  hasPending(): boolean {
    return this.#content?.getPendingChanges() !== null;
  }

  /** Clear pending changes after successful save */
  clearPending(): void {
    this.#content?.clearPending();
  }

  // updateEtag(etag: string): void {
  //   if ('collectionEtag' in this.#collection) {
  //     this.#collection.collectionEtag = etag;
  //   }
  // }
}
