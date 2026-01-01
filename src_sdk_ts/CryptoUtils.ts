import { cshake256 } from '@noble/hashes/sha3-addons.js';
import { toUint8Array, uint8ArrayToHex } from './Helpers.js';
import {
  KEM_KEY_LENGTH_BYTES,
  DSA_KEY_LENGTH_BYTES,
  CUSTOM_KEM_STRING,
  CUSTOM_DSA_STRING,
  DEFAULT_AEAD_KEY_LENGTH_BYTES,
  IS_MANAGER_ROLE,
  CUSTOM_FEATURES_LIST_STRING,
  MEMBER_ID_STRING,
} from './Consts.js';

import type { MemberRole } from './Consts.js';

export class CryptoUtilsError extends Error {
  constructor(message: string, public readonly code: string) {
    super(message);
    this.name = 'CryptoUtilsError';
  }
}

export const generateRandomUUID = (): string => crypto.randomUUID();

export const generateRandomBytes = (length = 32): Uint8Array => {
  if (length <= 0) throw new CryptoUtilsError('Length must be a positive integer', 'INVALID_LENGTH');
  return crypto.getRandomValues(new Uint8Array(length));
};

export const sha256 = async (
  data: Uint8Array | string,
  encoding: 'hex' | 'base64' | 'arraybuffer' | 'uint8array' = 'arraybuffer',
): Promise<string | ArrayBuffer | Uint8Array> => {
  const msgUint8 = typeof data === 'string' ? toUint8Array(data) : data;
  const hashBuffer = await crypto.subtle.digest('SHA-256', msgUint8 as Uint8Array<ArrayBuffer>);
  if (encoding === 'arraybuffer') return hashBuffer;
  const arr = new Uint8Array(hashBuffer);
  if (encoding === 'uint8array') return arr;
  if (encoding === 'hex') return uint8ArrayToHex(arr);
  if (encoding === 'base64') return btoa(String.fromCharCode(...arr));
  throw new CryptoUtilsError(`Unsupported encoding: ${encoding}`, 'UNSUPPORTED_ENCODING');
};

export const letscShake256 = (data: Uint8Array, customData: Uint8Array, outputLength: number): Uint8Array => {
  if (outputLength <= 0) throw new CryptoUtilsError('Output length must be positive', 'INVALID_OUTPUT_LENGTH');
  return cshake256(data, { personalization: customData, dkLen: outputLength });
};

export const deriveSeeds = (masterSeed: Uint8Array) => ({
  kemSeed: letscShake256(masterSeed, toUint8Array(CUSTOM_KEM_STRING), KEM_KEY_LENGTH_BYTES),
  dsaSeed: letscShake256(masterSeed, toUint8Array(CUSTOM_DSA_STRING), DSA_KEY_LENGTH_BYTES),
});

export const deriveKeyForRole = (role: MemberRole, rootKey: Uint8Array): Uint8Array =>
  IS_MANAGER_ROLE(role)
    ? rootKey
    : letscShake256(rootKey, toUint8Array(CUSTOM_FEATURES_LIST_STRING), DEFAULT_AEAD_KEY_LENGTH_BYTES);

export const getMemberIdFromPubkey = (dsaPublicKey: Uint8Array): string =>
  uint8ArrayToHex(letscShake256(dsaPublicKey, toUint8Array(MEMBER_ID_STRING), 32)).toLowerCase();
