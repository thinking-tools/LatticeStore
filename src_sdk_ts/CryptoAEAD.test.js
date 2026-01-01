import { describe, it, expect, beforeEach } from 'vitest';
import { AEAD, AEADError } from './CryptoAEAD';

describe('CryptoAEAD', () => {
  describe('generateRawAEADKeyData', () => {
    it('should generate a 32-byte key', () => {
      const key = AEAD.generateRawAEADKeyData();
      expect(key).toBeInstanceOf(Uint8Array);
      expect(key.length).toBe(32);
    });

    it('should generate different keys on each call', () => {
      const key1 = AEAD.generateRawAEADKeyData();
      const key2 = AEAD.generateRawAEADKeyData();
      expect(key1).not.toEqual(key2);
    });

    it('should generate non-zero keys', () => {
      const key = AEAD.generateRawAEADKeyData();
      const hasNonZero = Array.from(key).some(byte => byte !== 0);
      expect(hasNonZero).toBe(true);
    });
  });

  describe('importAEADKey', () => {
    it('should import a valid 32-byte key', async () => {
      const rawKey = AEAD.generateRawAEADKeyData();
      const key = await AEAD.importAEADKey(rawKey);
      expect(key).toBeInstanceOf(CryptoKey);
      expect(key.type).toBe('secret');
      expect(key.algorithm.name).toBe('AES-GCM');
    });

    it('should reject keys that are too short', async () => {
      const shortKey = new Uint8Array(16);
      await expect(AEAD.importAEADKey(shortKey)).rejects.toThrow(AEADError);
      await expect(AEAD.importAEADKey(shortKey)).rejects.toThrow('Invalid key length');
    });

    it('should reject keys that are too long', async () => {
      const longKey = new Uint8Array(64);
      await expect(AEAD.importAEADKey(longKey)).rejects.toThrow(AEADError);
      await expect(AEAD.importAEADKey(longKey)).rejects.toThrow('Invalid key length');
    });

    it('should reject empty keys', async () => {
      const emptyKey = new Uint8Array(0);
      await expect(AEAD.importAEADKey(emptyKey)).rejects.toThrow(AEADError);
    });

    it('should throw AEADError with correct code', async () => {
      const shortKey = new Uint8Array(16);
      try {
        await AEAD.importAEADKey(shortKey);
        expect.fail('Should have thrown');
      } catch (error) {
        expect(error).toBeInstanceOf(AEADError);
        expect(error.code).toBe('INVALID_KEY_LENGTH');
      }
    });
  });

  describe('encrypt', () => {
    let key;

    beforeEach(async () => {
      const rawKey = AEAD.generateRawAEADKeyData();
      key = await AEAD.importAEADKey(rawKey);
    });

    it('should encrypt plaintext data', async () => {
      const plaintext = new TextEncoder().encode('Hello, World!');
      const ciphertext = await AEAD.encrypt(key, plaintext);

      expect(ciphertext).toBeInstanceOf(Uint8Array);
      expect(ciphertext.length).toBeGreaterThan(plaintext.length);
      expect(ciphertext).not.toEqual(plaintext);
    });

    it('should prepend 12-byte IV to ciphertext', async () => {
      const plaintext = new TextEncoder().encode('Test');
      const ciphertext = await AEAD.encrypt(key, plaintext);

      // IV (12) + plaintext (4) + auth tag (16) = 32 bytes
      expect(ciphertext.length).toBe(32);
    });

    it('should produce different ciphertexts for same plaintext', async () => {
      const plaintext = new TextEncoder().encode('Same message');
      const ciphertext1 = await AEAD.encrypt(key, plaintext);
      const ciphertext2 = await AEAD.encrypt(key, plaintext);

      expect(ciphertext1).not.toEqual(ciphertext2); // Different IVs
    });

    it('should encrypt empty data', async () => {
      const plaintext = new Uint8Array(0);
      const ciphertext = await AEAD.encrypt(key, plaintext);

      // IV (12) + auth tag (16) = 28 bytes
      expect(ciphertext.length).toBe(28);
    });

    it('should encrypt large data', async () => {
      const plaintext = new Uint8Array(1024 * 1024); // 1MB
      // Fill in chunks due to crypto.getRandomValues 65KB limit
      for (let i = 0; i < plaintext.length; i += 65536) {
        const chunk = plaintext.subarray(i, Math.min(i + 65536, plaintext.length));
        crypto.getRandomValues(chunk);
      }
      const ciphertext = await AEAD.encrypt(key, plaintext);

      expect(ciphertext.length).toBe(plaintext.length + 28); // +IV +tag
    });
  });

  describe('decrypt', () => {
    let key;

    beforeEach(async () => {
      const rawKey = AEAD.generateRawAEADKeyData();
      key = await AEAD.importAEADKey(rawKey);
    });

    it('should decrypt valid ciphertext', async () => {
      const plaintext = new TextEncoder().encode('Secret message');
      const ciphertext = await AEAD.encrypt(key, plaintext);
      const decrypted = await AEAD.decrypt(key, ciphertext);

      expect(decrypted).toEqual(plaintext);
      expect(new TextDecoder().decode(decrypted)).toBe('Secret message');
    });

    it('should decrypt empty data', async () => {
      const plaintext = new Uint8Array(0);
      const ciphertext = await AEAD.encrypt(key, plaintext);
      const decrypted = await AEAD.decrypt(key, ciphertext);

      expect(decrypted).toEqual(plaintext);
      expect(decrypted.length).toBe(0);
    });

    it('should reject ciphertext shorter than IV', async () => {
      const shortCiphertext = new Uint8Array(10);
      await expect(AEAD.decrypt(key, shortCiphertext)).rejects.toThrow(AEADError);
      await expect(AEAD.decrypt(key, shortCiphertext)).rejects.toThrow('Ciphertext too short');
    });

    it('should reject corrupted ciphertext', async () => {
      const plaintext = new TextEncoder().encode('Message');
      const ciphertext = await AEAD.encrypt(key, plaintext);

      // Corrupt a byte in the encrypted data
      ciphertext[20] ^= 0xff;

      await expect(AEAD.decrypt(key, ciphertext)).rejects.toThrow(AEADError);
      await expect(AEAD.decrypt(key, ciphertext)).rejects.toThrow('authentication tag mismatch');
    });

    it('should reject ciphertext encrypted with different key', async () => {
      const plaintext = new TextEncoder().encode('Message');
      const ciphertext = await AEAD.encrypt(key, plaintext);

      const otherRawKey = AEAD.generateRawAEADKeyData();
      const otherKey = await AEAD.importAEADKey(otherRawKey);

      await expect(AEAD.decrypt(otherKey, ciphertext)).rejects.toThrow(AEADError);
    });

    it('should throw AEADError with correct code on corruption', async () => {
      const ciphertext = new Uint8Array(30);
      try {
        await AEAD.decrypt(key, ciphertext);
        expect.fail('Should have thrown');
      } catch (error) {
        expect(error).toBeInstanceOf(AEADError);
        expect(error.code).toBe('DECRYPTION_FAILED');
      }
    });
  });

  describe('Round-trip encryption/decryption', () => {
    let key;

    beforeEach(async () => {
      const rawKey = AEAD.generateRawAEADKeyData();
      key = await AEAD.importAEADKey(rawKey);
    });

    it('should round-trip simple text', async () => {
      const original = 'The quick brown fox jumps over the lazy dog';
      const plaintext = new TextEncoder().encode(original);

      const ciphertext = await AEAD.encrypt(key, plaintext);
      const decrypted = await AEAD.decrypt(key, ciphertext);

      expect(new TextDecoder().decode(decrypted)).toBe(original);
    });

    it('should round-trip binary data', async () => {
      const plaintext = new Uint8Array([0, 1, 2, 255, 254, 253]);

      const ciphertext = await AEAD.encrypt(key, plaintext);
      const decrypted = await AEAD.decrypt(key, ciphertext);

      expect(decrypted).toEqual(plaintext);
    });

    it('should round-trip Unicode text', async () => {
      const original = '你好世界 🌍 مرحبا العالم';
      const plaintext = new TextEncoder().encode(original);

      const ciphertext = await AEAD.encrypt(key, plaintext);
      const decrypted = await AEAD.decrypt(key, ciphertext);

      expect(new TextDecoder().decode(decrypted)).toBe(original);
    });
    it('should round-trip large data', async () => {
      const plaintext = new Uint8Array(512 * 1024); // 512KB instead of 10MB
      for (let i = 0; i < plaintext.length; i += 65536) {
        const chunk = plaintext.subarray(i, Math.min(i + 65536, plaintext.length));
        crypto.getRandomValues(chunk);
      }

      const ciphertext = await AEAD.encrypt(key, plaintext);
      const decrypted = await AEAD.decrypt(key, ciphertext);

      expect(decrypted).toEqual(plaintext);
    });
  });

  describe('AEADError', () => {
    it('should create error with message and code', () => {
      const error = new AEADError('Test error', 'TEST_CODE');
      expect(error).toBeInstanceOf(Error);
      expect(error).toBeInstanceOf(AEADError);
      expect(error.message).toBe('Test error');
      expect(error.code).toBe('TEST_CODE');
      expect(error.name).toBe('AEADError');
    });
  });
});
