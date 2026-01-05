import type { CollectionId, CollectionType, MemberId, Timestamp } from '../Consts.js';
// import { genId, now, uint8ArrayToBase64, uint8ArrayToHex } from '../Helpers.js';
// import { generateRandomBytes } from '../CryptoUtils.js';

// const getNewcollection = (name: string, type: collectionType, memberId: MemberId): collectionController => {
//   return new collectionController({
//     collectionId: genId() as collectionId,
//     collectionType: type,
//     collectionName: name,
//     collectionEpoch: 1 as number,
//     collectionKey: uint8ArrayToHex(generateRandomBytes(32)),
//     collectionEtag: null,
//     collectionEncryptionKeyMaterial: uint8ArrayToBase64(generateRandomBytes(32)), // Base64Encrypted<Uint8Array>
//     collectionCreatedAt: now() as Timestamp,
//     collectionCreatedById: memberId,
//     collectionModifiedAt: now() as Timestamp,
//     collectionModifiedById: memberId,
//     collectionArchived: false,
//     collectionArchivedAt: null,
//     collectionToDelete: false,
//   });
// };

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
