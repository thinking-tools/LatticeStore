import type { CollectionId, CollectionType, MemberId, VaultId, Timestamp } from '../../shared/Consts.js';

import { ReactiveValue } from '../ReactiveValue.js';
import type { RawAEADKey } from '../../crypto/CryptoAEAD';
import { KVContent } from './KV.js';
import { genId, now, toUint8Array } from '../../shared/Helpers.js';
import { generateRandomBytes } from '../../crypto/CryptoUtils.js';
// import { Tasker, TaskQHandle, UploadResult } from '../Tasker.js';
// import { VaultController } from '../Vault.js';
// import { genId, now, uint8ArrayToBase64, uint8ArrayToHex } from '../Helpers.js';
// import { generateRandomBytes } from '../CryptoUtils.js';

// import { SYNC_DEBOUNCE_MS } from '../../shared/Consts.js';

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
  readonly #vaultId: VaultId;
  #meta?: CollectionMeta | null;
  #metaBytesCache: Uint8Array<ArrayBuffer> | null = null;
  #metaDirty = true;
  #content: T | null = null;

  // Sync infrastructure
  // #tasker: Tasker | null = null;
  // #vault: VaultController | null = null;
  // #syncTimeout: ReturnType<typeof setTimeout> | null = null;
  // #currentUpload: TaskQHandle<UploadResult> | null = null;
  // #unsubscribe: (() => void) | null = null;

  readonly syncState$ = new ReactiveValue<SyncState>('idle');
  readonly lastError$ = new ReactiveValue<Error | null>(null);

  constructor(collection: CollectionMinimal, vaultId: VaultId, meta?: CollectionMeta) {
    this.#minimal = collection;
    this.#s3Key = `${vaultId}/${collection.colId}`;
    this.#vaultId = vaultId;
    // if meta do not initialize
    if (meta) {
      this.#meta = meta;
    }
    console.log('CollectionController created:', this.#vaultId, this.#s3Key);
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
  get content(): T {
    if (!this.#content) throw new Error('Not loaded');
    return this.#content;
  }

  // Collection.ts - complete the static factory
  static createNew(
    name: string,
    type: CollectionType,
    vaultId: VaultId,
    memberId: MemberId | null,
  ): CollectionController {
    const minimal: CollectionMinimal = {
      colId: `col_${genId()}` as CollectionId,
      colType: type,
      colName: name,
      colEncKey: generateRandomBytes(32) as RawAEADKey,
    };
    const col = new CollectionController(minimal, vaultId, defaultMeta(memberId));
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

  /** Load and decrypt collection from S3 */
  // async load(encryptedBytes: Uint8Array): Promise<void> {
  //   const decrypted = await AEAD.decrypt(this.#encryptionKey, encryptedBytes);

  //   switch (this.#collection.collectionType) {
  //     case 'KV':
  //       this.#content = KVContent.deserialize(decrypted) as T;
  //       break;
  //     // case 'VFS':
  //     //   this.#content = VFSContent.deserialize(decrypted) as T;
  //     //   break;
  //     default:
  //       throw new Error(`Unsupported collection type: ${this.#collection.collectionType}`);
  //   }
  // }

  /** Create new empty collection */
  create(type: CollectionType): T {
    switch (type) {
      case 'KV' as CollectionType:
        return new KVContent() as unknown as T;
        break;
      default:
        throw new Error(`Unsupported collection type: ${this.#minimal.colType}`);
    }
  }

  /** Serialize and encrypt for S3 upload */
  // async save(): Promise<Uint8Array> {
  //   if (!this.#content) throw new Error('No content to save');
  //   const serialized = this.#content.serialize();
  //   return await AEAD.encrypt(this.#encryptionKey, serialized);
  // }

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
