import type { CollectionId, CollectionType, MemberId, VaultId, Timestamp } from '../../shared/Consts.js';

import { ReactiveValue } from '../ReactiveValue.js';
import type { RawAEADKey } from '../../crypto/CryptoAEAD';
import { KVContent } from './KV.js';
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
  collectionId: CollectionId;
  collectionType: CollectionType;
  collectionName: string;
  collectionEncryptionKeyMaterial?: RawAEADKey; // Base64Encrypted<Uint8Array>
};

export type Collection = {
  collectionId: CollectionId;
  collectionType: CollectionType;
  collectionName: string;
  collectionEpoch: number;
  collectionKey: string;
  collectionEtag: string | null;
  collectionEncryptionKeyMaterial?: string; // Base64Encrypted<Uint8Array>
  collectionCreatedAt: Timestamp;
  collectionCreatedById: MemberId | null;
  collectionModifiedAt: Timestamp;
  collectionModifiedById: MemberId | null;
  collectionArchived: boolean;
  collectionArchivedAt: Timestamp | null;
  collectionToDelete: boolean;
};

type SyncState = 'idle' | 'pending' | 'syncing' | 'error';

export class CollectionController<T extends CollectionContent = CollectionContent> {
  readonly #collection: Collection | CollectionMinimal;
  // readonly #encryptionKeyRaw: RawAEADKey;
  readonly #s3KeyPath: string;
  // readonly #vaultId: VaultId;

  // #encryptionKey: AEADCryptoKey | null = null;
  #content: T | null = null;

  // Sync infrastructure
  // #tasker: Tasker | null = null;
  // #vault: VaultController | null = null;
  // #syncTimeout: ReturnType<typeof setTimeout> | null = null;
  // #currentUpload: TaskQHandle<UploadResult> | null = null;
  // #unsubscribe: (() => void) | null = null;

  readonly syncState$ = new ReactiveValue<SyncState>('idle');
  readonly lastError$ = new ReactiveValue<Error | null>(null);

  constructor(collection: Collection | CollectionMinimal, encryptionKey: RawAEADKey, vaultId: VaultId) {
    this.#collection = collection;
    // this.#encryptionKeyRaw = encryptionKey;
    this.#s3KeyPath = `${vaultId}/${collection.collectionId}`;
    console.warn(' instance created', encryptionKey);
    // this.#vaultId = vaultId;
  }

  get collection(): Collection | CollectionMinimal {
    return this.#collection;
  }

  get loaded(): boolean {
    return this.#content !== null;
  }

  get content(): T {
    if (!this.#content) throw new Error('Collection not loaded');
    return this.#content;
  }

  get s3Key(): string {
    return this.#s3KeyPath;
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
  create(): void {
    switch (this.#collection.collectionType) {
      case 'KV':
        this.#content = new KVContent() as unknown as T;
        break;
      default:
        throw new Error(`Unsupported collection type: ${this.#collection.collectionType}`);
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

  updateEtag(etag: string): void {
    if ('collectionEtag' in this.#collection) {
      this.#collection.collectionEtag = etag;
    }
  }
}
