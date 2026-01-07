import { CryptoPQ, CryptoPQKeyPair } from '../crypto/CryptoPQ';
import { deriveSeeds, deriveKeyForRole, getMemberIdFromPubkey, letscShake256 } from '../crypto/CryptoUtils';
import { AEAD, AEADCryptoKey, RawAEADKey } from '../crypto/CryptoAEAD';
import { uint8ArrayToBase64, now, toUint8Array, fromUint8Array, base64ToUint8Array } from '../shared/Helpers';
import {
  MEMBER_STATUS,
  CUSTOM_MANAGER_KEY_STRING,
  DEFAULT_AEAD_KEY_LENGTH_BYTES,
  CUSTOM_COLLECTION_LIST_STRING,
} from '../shared/Consts.js';

import type { MemberRole, MemberId, Base64, Base64Encrypted, Timestamp, MemberStatus } from '../shared/Consts.js';

export type MemberCredentials = {
  memberEncryptedDetail: MemberEncryptedDetail;
  memberSlot: MemberSlot;
  __secrets: MemberSecrets;
};

export type MemberSlot = {
  memberId: MemberId;
  memberRole: MemberRole;
  memberStatus: MemberStatus;
  memberKemCiphertext: Base64<Uint8Array>;
  memberVaultKeyWrapped: Base64<Uint8Array>; // appropriate vault key wrapped for this member on role
  memberDsaPubkey: Base64<Uint8Array>; // ML-DSA public key
  createdAt: Timestamp;
  updatedAt: Timestamp;
  memberPublicNote?: string;
};

export type MemberSlotExtended = MemberSlot & {
  memberName: string;
  memberPrivateNote?: string;
};

export type MemberEncryptedDetail = {
  memberId: MemberId;
  memberName: string;
  memberKemPubkey: Base64<Uint8Array>; // for re-keying (managers only)
  memberAddedBy: MemberId;
  memberAddedAt: Timestamp;
  memberPrivateNote?: string;
};

export type MemberSecrets = {
  memberId: MemberId;
  kemSecretKey: Uint8Array;
  dsaSecretKey: Uint8Array;
};

export type MemberInfoBasics = {
  memberId: string;
  memberSeed: Uint8Array;
  dsaKeys: CryptoPQKeyPair;
  kemKeys: CryptoPQKeyPair;
};

export const createNewCredentials = async (
  name: string,
  role: MemberRole,
  rootKey: Uint8Array,
  initSeed: Uint8Array,
): Promise<MemberCredentials> => {
  const { kemSeed, dsaSeed } = deriveSeeds(initSeed);

  const kemKeys = CryptoPQ.generateKemKeys(kemSeed);
  const { cipherText, sharedSecret } = CryptoPQ.encapsulate(kemKeys.publicKey);
  const aeadSharedKey = await AEAD.importAEADKey(sharedSecret as RawAEADKey);
  sharedSecret.fill(0); // Clear shared secret from memory

  const encryptedMasterKey = await AEAD.encrypt(
    aeadSharedKey,
    deriveKeyForRole(role, rootKey) as Uint8Array<ArrayBuffer>,
  );

  const dsaKeys = CryptoPQ.generateDsaKeys(dsaSeed);

  const memberId = getMemberIdFromPubkey(dsaKeys.publicKey) as MemberId;
  const timestamp = now() as Timestamp;

  // we return object with two parts: private (MemberEncryptedDetail) and public (MemberSlot) + credentials
  return {
    memberEncryptedDetail: {
      memberId,
      memberName: name,
      memberKemPubkey: uint8ArrayToBase64(kemKeys.publicKey) as Base64<Uint8Array>,
      memberAddedBy: memberId,
      memberAddedAt: timestamp,
    },
    memberSlot: {
      memberId,
      memberRole: role,
      memberStatus: MEMBER_STATUS.ACTIVE,
      memberKemCiphertext: uint8ArrayToBase64(cipherText) as Base64<Uint8Array>,
      memberVaultKeyWrapped: uint8ArrayToBase64(encryptedMasterKey) as Base64<Uint8Array>,
      memberDsaPubkey: uint8ArrayToBase64(dsaKeys.publicKey) as Base64<Uint8Array>,
      createdAt: timestamp,
      updatedAt: timestamp,
    },
    __secrets: {
      memberId,
      kemSecretKey: kemKeys.secretKey,
      dsaSecretKey: dsaKeys.secretKey,
    },
  };
};

export const getManagerKey = async (masterKeyRaw: Uint8Array): Promise<AEADCryptoKey> => {
  const managersKey = letscShake256(
    masterKeyRaw,
    toUint8Array(CUSTOM_MANAGER_KEY_STRING),
    DEFAULT_AEAD_KEY_LENGTH_BYTES,
  ) as RawAEADKey;
  return AEAD.importAEADKey(managersKey as RawAEADKey);
};

export const getCollectionKey = async (masterKeyRaw: Uint8Array): Promise<AEADCryptoKey> => {
  const collectionKey = letscShake256(
    masterKeyRaw,
    toUint8Array(CUSTOM_COLLECTION_LIST_STRING),
    DEFAULT_AEAD_KEY_LENGTH_BYTES,
  ) as RawAEADKey;
  return AEAD.importAEADKey(collectionKey as RawAEADKey);
};

export const encryptMemberList = async (
  memberDetails: MemberEncryptedDetail[],
  managersKey: AEADCryptoKey,
): Promise<Base64Encrypted<MemberEncryptedDetail[]>> => {
  const serialized = toUint8Array(JSON.stringify(memberDetails));
  const encrypted = await AEAD.encrypt(managersKey, serialized as Uint8Array<ArrayBuffer>);
  return uint8ArrayToBase64(encrypted) as Base64Encrypted<MemberEncryptedDetail[]>;
};

export const decryptMemberList = async (
  encryptedMemberList: Base64Encrypted<MemberEncryptedDetail[]>,
  managersKey: AEADCryptoKey,
): Promise<MemberEncryptedDetail[]> => {
  const encrypted = base64ToUint8Array(encryptedMemberList);
  const decrypted = await AEAD.decrypt(managersKey, encrypted as Uint8Array<ArrayBuffer>);
  return JSON.parse(fromUint8Array(decrypted as Uint8Array)) as MemberEncryptedDetail[];
};

export const buildMember = (seed: Uint8Array): MemberInfoBasics => {
  const { kemSeed, dsaSeed } = deriveSeeds(seed);
  const kemKeys = CryptoPQ.generateKemKeys(kemSeed);
  const dsaKeys = CryptoPQ.generateDsaKeys(dsaSeed);
  const memberId = getMemberIdFromPubkey(dsaKeys.publicKey) as MemberId;
  return Object.freeze({
    memberId,
    memberSeed: seed,
    dsaKeys,
    kemKeys,
  });
};
