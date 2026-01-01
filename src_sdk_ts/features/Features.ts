import type { FeatureId, FeatureType, MemberId, Timestamp } from '../Consts.js';
// import { genId, now, uint8ArrayToBase64, uint8ArrayToHex } from '../Helpers.js';
// import { generateRandomBytes } from '../CryptoUtils.js';

// const getNewFeature = (name: string, type: FeatureType, memberId: MemberId): FeatureController => {
//   return new FeatureController({
//     featureId: genId() as FeatureId,
//     featureType: type,
//     featureName: name,
//     featureEpoch: 1 as number,
//     featureKey: uint8ArrayToHex(generateRandomBytes(32)),
//     featureEtag: null,
//     featureEncryptionKeyMaterial: uint8ArrayToBase64(generateRandomBytes(32)), // Base64Encrypted<Uint8Array>
//     featureCreatedAt: now() as Timestamp,
//     featureCreatedById: memberId,
//     featureModifiedAt: now() as Timestamp,
//     featureModifiedById: memberId,
//     featureArchived: false,
//     featureArchivedAt: null,
//     featureToDelete: false,
//   });
// };

export type FeatureMinimal = {
  featureId: FeatureId;
  featureType: FeatureType;
  featureName: string;
  featureKey: string;
  featureEncryptionKeyMaterial?: string; // Base64Encrypted<Uint8Array>
};

export type Feature = {
  featureId: FeatureId;
  featureType: FeatureType;
  featureName: string;
  featureEpoch: number;
  featureKey: string;
  featureEtag: string | null;
  featureEncryptionKeyMaterial?: string; // Base64Encrypted<Uint8Array>
  featureCreatedAt: Timestamp;
  featureCreatedById: MemberId | null;
  featureModifiedAt: Timestamp;
  featureModifiedById: MemberId | null;
  featureArchived: boolean;
  featureArchivedAt: Timestamp | null;
  featureToDelete: boolean;
};

export class FeatureController {
  #feature: Feature | FeatureMinimal;
  #loaded: boolean = false;
  constructor(feature: Feature) {
    this.#feature = feature;
  }

  get feature(): Feature | FeatureMinimal {
    return this.#feature;
  }

  get loaded(): boolean {
    return this.#loaded;
  }
}
