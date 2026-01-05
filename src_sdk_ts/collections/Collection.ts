import type { CollectionId, CollectionType, MemberId, Timestamp } from '../Consts.js';

import { ReactiveValue } from '../ReactiveValue';
// import { genId, now, uint8ArrayToBase64, uint8ArrayToHex } from '../Helpers.js';
// import { generateRandomBytes } from '../CryptoUtils.js';

export interface CollectionContent<T = unknown> {
  readonly type: CollectionType;
  readonly data$: ReactiveValue<T>;

  /** Serialize for encryption/storage */
  serialize(): Uint8Array;

  /** Apply remote changes (from sync) */
  // applyPatch(patch: unknown): void;

  /** Get pending changes for sync */
  getPendingChanges(): unknown | null;

  /** Clear pending after successful sync */
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

export const collectionFactory = (name: string, type: CollectionType): boolean => {};

export class CollectionController {
  #collection: Collection | CollectionMinimal;
  #loaded: boolean = false;
  constructor(collection: Collection) {
    this.#collection = collection;
  }

  get collection(): Collection | CollectionMinimal {
    return this.#collection;
  }

  get loaded(): boolean {
    return this.#loaded;
  }
}
