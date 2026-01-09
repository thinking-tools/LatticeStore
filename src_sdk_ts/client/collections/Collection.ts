import type { CollectionId, CollectionType, MemberId, VaultId, Timestamp } from '../../shared/Consts.js';

import { ReactiveValue } from '../ReactiveValue.js';
import { AEAD } from '../../crypto/CryptoAEAD.js';
import type { AEADCryptoKey, RawAEADKey } from '../../crypto/CryptoAEAD';
// import { genId, now, uint8ArrayToBase64, uint8ArrayToHex } from '../Helpers.js';
// import { generateRandomBytes } from '../CryptoUtils.js';

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
  collectionKey: string;
  collectionEncryptionKeyMaterial?: string; // Base64Encrypted<Uint8Array>
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

// export const collectionFactory = (name: string, type: CollectionType): boolean => {};

export class CollectionController<T extends CollectionContent = CollectionContent> {
  #collection: Collection | CollectionMinimal;
  #content: T | null = null;
  #encryptionKey: Promise<AEADCryptoKey>;
  #s3KeyPath: string; // vaultId/collectionId

  constructor(collection: Collection | CollectionMinimal, encryptionKey: RawAEADKey, vaultId: VaultId) {
    this.#collection = collection;
    this.#encryptionKey = AEAD.importAEADKey(encryptionKey);
    this.#s3KeyPath = `${vaultId}/${collection.collectionId}`;
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

  get encryptionKey(): Promise<AEADCryptoKey> {
    return this.#encryptionKey;
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
  // create(): void {
  //   switch (this.#collection.collectionType) {
  //     case 'KV':
  //       this.#content = new KVContent() as T;
  //       break;
  //     default:
  //       throw new Error(`Unsupported collection type: ${this.#collection.collectionType}`);
  //   }
  // }

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
