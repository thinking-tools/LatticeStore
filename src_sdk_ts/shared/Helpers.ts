import { generateRandomBytes } from '../crypto/CryptoUtils';

import type { LoginPayload, ReauthPayload } from '../client/ApiClient';
import type { Timestamp, DataInput } from './Consts.js';
import type { VaultRegistrationPayload } from '../client/Vault';

export const encoder = new TextEncoder();
export const decoder = new TextDecoder();
const _isNode = typeof process !== 'undefined' && process.versions?.node !== undefined;

/** Converts a string to a Uint8Array using UTF-8 encoding. */
export const toUint8Array = (data: DataInput): Uint8Array | null => {
  if (typeof data === 'string') {
    return encoder.encode(data);
  }
  if (data instanceof ArrayBuffer) {
    return new Uint8Array(data);
  }
  if (data instanceof Uint8Array) {
    return data;
  }
  // Node Buffer
  if (typeof Buffer !== 'undefined' && Buffer.isBuffer(data)) {
    return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  }
  return null;
};

/** Converts a Uint8Array back to a string using UTF-8 decoding. */
export const fromUint8Array = (data: Uint8Array): string => {
  return decoder.decode(data);
};

/** Converts a Uint8Array to a hexadecimal string. */
export const uint8ArrayToHex = (uint8array: Uint8Array): string => {
  return [...uint8array].map(byte => byte.toString(16).padStart(2, '0')).join('');
};

/** Converts a hexadecimal string to a Uint8Array. */
export const hexToUint8Array = (hex: string): Uint8Array => {
  if (hex.length % 2 !== 0) {
    throw new Error('Invalid hex string');
  }
  const uint8array = new Uint8Array(hex.length / 2);
  for (let i = 0, j = 0; i < hex.length; i += 2, j++) {
    uint8array[j] = parseInt(hex.slice(i, i + 2), 16);
  }
  return uint8array;
};

export const uint8ArrayToBase64 = (uint8array: Uint8Array): string => {
  // Node.js: use Buffer (faster and works in all versions)
  if (_isNode) {
    return Buffer.from(uint8array).toString('base64');
  }

  // Browser: btoa with chunking for large arrays
  if (uint8array.length < 65536) {
    // Fast path for small arrays
    return btoa(String.fromCharCode(...uint8array));
  }

  // Chunked approach for large arrays (avoid stack overflow)
  let binary = '';
  const chunkSize = 32768;
  for (let i = 0; i < uint8array.length; i += chunkSize) {
    const chunk = uint8array.subarray(i, i + chunkSize);
    binary += String.fromCharCode(...chunk);
  }
  return btoa(binary);
};

export const base64ToUint8Array = (base64: string): Uint8Array => {
  // Node.js: use Buffer
  if (_isNode) {
    return new Uint8Array(Buffer.from(base64, 'base64'));
  }

  // Browser: atob
  const binary = atob(base64);
  const uint8array = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    uint8array[i] = binary.charCodeAt(i);
  }
  return uint8array;
};

export const base64ToBuffer = (base64: string): Buffer<ArrayBuffer> => {
  // Node.js: use Buffer
  if (_isNode) {
    return Buffer.from(base64, 'base64');
  }

  // Browser: atob
  const binary = atob(base64);
  const len = binary.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return Buffer.from(bytes);
};

const _canonicalize = (obj: any): any => {
  if (Array.isArray(obj)) {
    return obj.map(_canonicalize);
  }
  if (obj !== null && typeof obj === 'object') {
    const sorted: Record<string, any> = {};
    Object.keys(obj)
      .sort()
      .forEach(key => {
        sorted[key] = _canonicalize(obj[key]);
      });
    return sorted;
  }
  return obj;
};

export const generateCanonicalJSON = (payload: LoginPayload | VaultRegistrationPayload | ReauthPayload): string => {
  return JSON.stringify(_canonicalize(payload));
};

export const genId = (): string => {
  return uint8ArrayToHex(generateRandomBytes(32)).toLowerCase();
};

export const now = (): Timestamp => {
  return Date.now() as Timestamp;
};
