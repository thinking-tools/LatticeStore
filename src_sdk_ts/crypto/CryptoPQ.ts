import { ml_kem1024 } from '@noble/post-quantum/ml-kem.js';
import { ml_dsa87 as ml_dsa } from '@noble/post-quantum/ml-dsa.js';
import { generateRandomBytes } from './CryptoUtils.js';
import { toUint8Array } from '../shared/Helpers.js';

export type CryptoPQKeyPair = {
  secretKey: Uint8Array;
  publicKey: Uint8Array;
};

export type CryptoPQEncapsulated = {
  cipherText: Uint8Array;
  sharedSecret: Uint8Array;
};

export class CryptoPQError extends Error {
  constructor(message: string, public readonly code: string) {
    super(message);
    this.name = 'CryptoPQError';
  }
}

export const ML_DSA_SIGNATURE_SIZE = 4627; // Correct size for ML-DSA-87 signatures
export const ML_DSA_SECRET_KEY_SIZE = 4896; // Correct size for ML-DSA-87 secret keys
export const ML_DSA_PUBLIC_KEY_SIZE = 2592; // Correct size for ML-DSA-87 public keys

/**
 * Post-quantum cryptography using ML-KEM 1024
 * Source: https://github.com/paulmillr/noble-post-quantum?tab=readme-ov-file#ml-kem--kyber-shared-secrets
 * Reference FIPS-203:  https://nvlpubs.nist.gov/nistpubs/FIPS/NIST.FIPS.203.pdf
 */
export class CryptoPQ {
  /**
   * Generates a public/private key pair for ML-KEM 1024.
   * @param {Uint8Array} [seed=CryptoUtils.generateRandomBytes(64)] - Optional seed for key generation. If not provided, a random seed will be generated.
   * @returns {CryptoPQKeyPair} An object containing the secretKey and publicKey as Uint8Arrays.
   */
  static generateKemKeys = (seed: Uint8Array = generateRandomBytes(64)): CryptoPQKeyPair => {
    if (seed.length !== 64) throw new CryptoPQError('Seed must be 64 bytes', 'INVALID_SEED_LENGTH');
    return ml_kem1024.keygen(seed);
  };

  /**
   * Encapsulates a shared secret using the provided public key.
   * @param {Uint8Array} publicKey - The public key to use for encapsulation.
   * @returns {CryptoPQEncapsulated} An object containing the cipherText and sharedSecret as Uint8Arrays.
   */
  static encapsulate(publicKey: Uint8Array): CryptoPQEncapsulated {
    return ml_kem1024.encapsulate(publicKey);
  }

  /**
   * Decapsulates a shared secret using the provided ciphertext and secret key.
   * @param {Uint8Array} ciphertext - The ciphertext to decapsulate.
   * @param {Uint8Array} secretKey - The secret key to use for decapsulation.
   * @returns {Uint8Array} The shared secret as a Uint8Array.
   */
  static decapsulate(ciphertext: Uint8Array, secretKey: Uint8Array): Uint8Array {
    return ml_kem1024.decapsulate(ciphertext, secretKey);
  }

  /**
   * Generates a public/private key pair for ML-DSA 87.
   * @param {Uint8Array} [seed=CryptoUtils.generateRandomBytes(32)] - Optional seed for key generation. If not provided, a random seed will be generated.
   * @returns {CryptoPQKeyPair} An object containing the secretKey and publicKey as Uint8Arrays.
   */
  static generateDsaKeys = (seed: Uint8Array = generateRandomBytes(32)): CryptoPQKeyPair => {
    return ml_dsa.keygen(seed);
  };

  /**
   * Signs a message using the provided secret key.
   * @param {Uint8Array} secretKey - The secret key to use for signing.
   * @param {Uint8Array | string} message - The message to sign.
   * @returns {Uint8Array} The signature as a Uint8Array.
   */
  static sign(secretKey: Uint8Array, message: Uint8Array | string): Uint8Array {
    if (secretKey.length !== ML_DSA_SECRET_KEY_SIZE)
      throw new CryptoPQError('Invalid secret key length', 'INVALID_SECRET_KEY_LENGTH');
    const msg = typeof message === 'string' ? toUint8Array(message) : message;
    if (msg.length === 0) throw new CryptoPQError('Message cannot be empty', 'EMPTY_MESSAGE');
    return ml_dsa.sign(msg, secretKey);
  }

  /**
   * Verifies a signature using the provided public key and message.
   * @param {Uint8Array} publicKey - The public key to use for verification.
   * @param {Uint8Array} message - The message that was signed.
   * @param {Uint8Array} signature - The signature to verify.
   * @returns {boolean} True if the signature is valid, false otherwise.
   */
  static verifySignature(publicKey: Uint8Array, message: Uint8Array | string, signature: Uint8Array): boolean {
    if (signature.length !== ML_DSA_SIGNATURE_SIZE)
      throw new CryptoPQError('Invalid signature length', 'INVALID_SIGNATURE_LENGTH');
    if (publicKey.length !== ML_DSA_PUBLIC_KEY_SIZE)
      throw new CryptoPQError('Invalid public key length', 'INVALID_PUBLIC_KEY_LENGTH');
    const msg = typeof message === 'string' ? toUint8Array(message) : message;
    return ml_dsa.verify(signature, msg, publicKey);
  }
}
