import { describe, it, expect, beforeEach } from 'vitest';
import { CryptoUtils, CryptoUtilsError } from './CryptoUtils';

describe('CryptoUtils', () => {
  describe('generateRandomBytes', () => {
    it('should generate bytes of specified length', () => {
      const bytes = CryptoUtils.generateRandomBytes(16);
      expect(bytes).toBeInstanceOf(Uint8Array);
      expect(bytes.length).toBe(16);
    });

    it('should generate 32 bytes by default', () => {
      const bytes = CryptoUtils.generateRandomBytes();
      expect(bytes.length).toBe(32);
    });

    it('should generate different values each call', () => {
      const bytes1 = CryptoUtils.generateRandomBytes(16);
      const bytes2 = CryptoUtils.generateRandomBytes(16);
      expect(bytes1).not.toEqual(bytes2);
    });

    it('should throw on zero length', () => {
      expect(() => CryptoUtils.generateRandomBytes(0)).toThrow(CryptoUtilsError);
    });

    it('should throw on negative length', () => {
      expect(() => CryptoUtils.generateRandomBytes(-5)).toThrow(CryptoUtilsError);
    });

    it('should throw with correct error code', () => {
      try {
        CryptoUtils.generateRandomBytes(0);
        expect.fail('Should have thrown');
      } catch (error) {
        expect(error).toBeInstanceOf(CryptoUtilsError);
        expect(error.code).toBe('INVALID_LENGTH');
      }
    });
  });

  describe('generateRandomUUID', () => {
    it('should generate valid UUID v4', () => {
      const uuid = CryptoUtils.generateRandomUUID();
      expect(uuid).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
    });
  });
  describe('sha256', () => {
    it('should hash string data to hex', async () => {
      const hash = await CryptoUtils.sha256('hello', 'hex');
      expect(typeof hash).toBe('string');
      expect(hash).toHaveLength(64); // 32 bytes = 64 hex chars
      expect(hash).toMatch(/^[0-9a-f]+$/);
      // Known SHA-256 of "hello"
      expect(hash).toBe('2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824');
    });

    it('should hash Uint8Array data to hex', async () => {
      const data = new TextEncoder().encode('hello');
      const hash = await CryptoUtils.sha256(data, 'hex');
      expect(hash).toBe('2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824');
    });

    it('should hash to base64', async () => {
      const hash = await CryptoUtils.sha256('hello', 'base64');
      expect(typeof hash).toBe('string');
      expect(hash).toMatch(/^[A-Za-z0-9+/]+=*$/);
    });

    it('should hash to arraybuffer', async () => {
      const hash = await CryptoUtils.sha256('hello', 'arraybuffer');
      expect(hash).toBeInstanceOf(ArrayBuffer);
      expect(hash.byteLength).toBe(32);
    });

    it('should hash to uint8array', async () => {
      const hash = await CryptoUtils.sha256('hello', 'uint8array');
      expect(hash).toBeInstanceOf(Uint8Array);
      expect(hash.length).toBe(32);
    });

    it('should use arraybuffer as default encoding', async () => {
      const hash = await CryptoUtils.sha256('hello');
      expect(hash).toBeInstanceOf(ArrayBuffer);
    });

    it('should hash empty string', async () => {
      const hash = await CryptoUtils.sha256('', 'hex');
      // Known SHA-256 of empty string
      expect(hash).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
    });

    it('should produce consistent hashes', async () => {
      const hash1 = await CryptoUtils.sha256('test', 'hex');
      const hash2 = await CryptoUtils.sha256('test', 'hex');
      expect(hash1).toBe(hash2);
    });

    it('should produce different hashes for different inputs', async () => {
      const hash1 = await CryptoUtils.sha256('test1', 'hex');
      const hash2 = await CryptoUtils.sha256('test2', 'hex');
      expect(hash1).not.toBe(hash2);
    });

    it('should hash large data', async () => {
      const largeData = 'x'.repeat(1024 * 1024); // 1MB
      const hash = await CryptoUtils.sha256(largeData, 'hex');
      expect(hash).toHaveLength(64);
    });

    it('should throw on unsupported encoding', async () => {
      await expect(CryptoUtils.sha256('test', 'invalid')).rejects.toThrow(CryptoUtilsError);
    });

    it('should handle Unicode in hashing', async () => {
      const hash1 = await CryptoUtils.sha256('café', 'hex');
      const hash2 = await CryptoUtils.sha256('café', 'hex');
      expect(hash1).toBe(hash2);
      expect(typeof hash1).toBe('string');
    });
  });
});
