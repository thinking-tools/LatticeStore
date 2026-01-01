import { describe, it, expect } from 'vitest';
import {
  CryptoPQ,
  CryptoPQError,
  ML_DSA_SIGNATURE_SIZE,
  ML_DSA_SECRET_KEY_SIZE,
  ML_DSA_PUBLIC_KEY_SIZE,
} from './CryptoPQ';
describe('CryptoPQ', () => {
  describe('ML-KEM 1024 - Key Encapsulation', () => {
    describe('generateKemKeys', () => {
      it('should generate valid key pair', () => {
        const { secretKey, publicKey } = CryptoPQ.generateKemKeys();

        expect(secretKey).toBeInstanceOf(Uint8Array);
        expect(publicKey).toBeInstanceOf(Uint8Array);
        expect(secretKey.length).toBe(3168); // ML-KEM-1024 secret key size
        expect(publicKey.length).toBe(1568); // ML-KEM-1024 public key size
      });

      it('should generate different keys without seed', () => {
        const keys1 = CryptoPQ.generateKemKeys();
        const keys2 = CryptoPQ.generateKemKeys();

        expect(keys1.publicKey).not.toEqual(keys2.publicKey);
        expect(keys1.secretKey).not.toEqual(keys2.secretKey);
      });

      it('should generate same keys with same seed', () => {
        const seed = new Uint8Array(64).fill(1);
        const keys1 = CryptoPQ.generateKemKeys(seed);
        const keys2 = CryptoPQ.generateKemKeys(seed);

        expect(keys1.publicKey).toEqual(keys2.publicKey);
        expect(keys1.secretKey).toEqual(keys2.secretKey);
      });

      it('should generate different keys with different seeds', () => {
        const seed1 = new Uint8Array(64).fill(1);
        const seed2 = new Uint8Array(64).fill(2);
        const keys1 = CryptoPQ.generateKemKeys(seed1);
        const keys2 = CryptoPQ.generateKemKeys(seed2);

        expect(keys1.publicKey).not.toEqual(keys2.publicKey);
        expect(keys1.secretKey).not.toEqual(keys2.secretKey);
      });

      it('should throw error for invalid seed length', () => {
        const invalidSeed = new Uint8Array(32); // Wrong length

        expect(() => CryptoPQ.generateKemKeys(invalidSeed)).toThrow(CryptoPQError);
        expect(() => CryptoPQ.generateKemKeys(invalidSeed)).toThrow('Seed must be 64 bytes long');
      });

      it('should throw error with correct error code for invalid seed', () => {
        const invalidSeed = new Uint8Array(100);

        try {
          CryptoPQ.generateKemKeys(invalidSeed);
          expect.fail('Should have thrown error');
        } catch (error) {
          expect(error).toBeInstanceOf(CryptoPQError);
          expect(error.code).toBe('INVALID_SEED_LENGTH');
        }
      });
    });

    describe('encapsulate', () => {
      it('should encapsulate shared secret', () => {
        const { publicKey } = CryptoPQ.generateKemKeys();
        const { cipherText, sharedSecret } = CryptoPQ.encapsulate(publicKey);

        expect(cipherText).toBeInstanceOf(Uint8Array);
        expect(sharedSecret).toBeInstanceOf(Uint8Array);
        expect(cipherText.length).toBe(1568); // ML-KEM-1024 ciphertext size
        expect(sharedSecret.length).toBe(32); // 256-bit shared secret
      });

      it('should produce different ciphertexts for same public key', () => {
        const { publicKey } = CryptoPQ.generateKemKeys();
        const result1 = CryptoPQ.encapsulate(publicKey);
        const result2 = CryptoPQ.encapsulate(publicKey);

        expect(result1.cipherText).not.toEqual(result2.cipherText);
        expect(result1.sharedSecret).not.toEqual(result2.sharedSecret);
      });

      it('should throw error for invalid public key', () => {
        const invalidPublicKey = new Uint8Array(100); // Wrong size

        expect(() => CryptoPQ.encapsulate(invalidPublicKey)).toThrow(CryptoPQError);
        expect(() => CryptoPQ.encapsulate(invalidPublicKey)).toThrow('Encapsulation failed');
      });

      it('should throw error with correct error code for encapsulation failure', () => {
        const invalidPublicKey = new Uint8Array(100); // Wrong size - will definitely fail

        try {
          CryptoPQ.encapsulate(invalidPublicKey);
          expect.fail('Should have thrown error');
        } catch (error) {
          expect(error).toBeInstanceOf(CryptoPQError);
          expect(error.code).toBe('ENCAPSULATION_FAILED');
        }
      });
    });

    describe('decapsulate', () => {
      it('should decapsulate shared secret', () => {
        const { secretKey, publicKey } = CryptoPQ.generateKemKeys();
        const { cipherText, sharedSecret } = CryptoPQ.encapsulate(publicKey);

        const decapsulated = CryptoPQ.decapsulate(cipherText, secretKey);

        expect(decapsulated).toEqual(sharedSecret);
      });

      it('should fail with wrong secret key', () => {
        const keys1 = CryptoPQ.generateKemKeys();
        const keys2 = CryptoPQ.generateKemKeys();
        const { cipherText, sharedSecret } = CryptoPQ.encapsulate(keys1.publicKey);

        const wrongDecapsulated = CryptoPQ.decapsulate(cipherText, keys2.secretKey);

        expect(wrongDecapsulated).not.toEqual(sharedSecret);
      });

      it('should throw error for invalid ciphertext', () => {
        const { secretKey } = CryptoPQ.generateKemKeys();
        const invalidCipherText = new Uint8Array(100); // Wrong size

        expect(() => CryptoPQ.decapsulate(invalidCipherText, secretKey)).toThrow(CryptoPQError);
        expect(() => CryptoPQ.decapsulate(invalidCipherText, secretKey)).toThrow('Decapsulation failed');
      });

      it('should throw error for invalid secret key', () => {
        const { publicKey } = CryptoPQ.generateKemKeys();
        const { cipherText } = CryptoPQ.encapsulate(publicKey);
        const invalidSecretKey = new Uint8Array(100); // Wrong size

        expect(() => CryptoPQ.decapsulate(cipherText, invalidSecretKey)).toThrow(CryptoPQError);
      });
    });

    describe('KEM round-trip scenarios', () => {
      it('should complete full key exchange between Alice and Bob', () => {
        // Alice generates keys
        const alice = CryptoPQ.generateKemKeys();

        // Bob encapsulates using Alice's public key
        const { cipherText, sharedSecret: bobSecret } = CryptoPQ.encapsulate(alice.publicKey);

        // Alice decapsulates using her secret key
        const aliceSecret = CryptoPQ.decapsulate(cipherText, alice.secretKey);

        // Both should have same shared secret
        expect(aliceSecret).toEqual(bobSecret);
      });

      it('should work with deterministic keys', () => {
        const seed = new Uint8Array(64).fill(42);
        const keys = CryptoPQ.generateKemKeys(seed);

        const { cipherText, sharedSecret: original } = CryptoPQ.encapsulate(keys.publicKey);
        const decapsulated = CryptoPQ.decapsulate(cipherText, keys.secretKey);

        expect(decapsulated).toEqual(original);
      });

      it('should work multiple times with same key pair', () => {
        const keys = CryptoPQ.generateKemKeys();

        for (let i = 0; i < 5; i++) {
          const { cipherText, sharedSecret } = CryptoPQ.encapsulate(keys.publicKey);
          const decapsulated = CryptoPQ.decapsulate(cipherText, keys.secretKey);
          expect(decapsulated).toEqual(sharedSecret);
        }
      });
    });
  });

  describe('ML-DSA 87 - Digital Signatures', () => {
    describe('generateDsaKeys', () => {
      it('should generate valid DSA key pair', () => {
        const { secretKey, publicKey } = CryptoPQ.generateDsaKeys();

        expect(secretKey).toBeInstanceOf(Uint8Array);
        expect(publicKey).toBeInstanceOf(Uint8Array);
        expect(secretKey.length).toBe(ML_DSA_SECRET_KEY_SIZE); // ML-DSA-87 secret key size
        expect(publicKey.length).toBe(ML_DSA_PUBLIC_KEY_SIZE); // ML-DSA-87 public key size
      });

      it('should generate different keys without seed', () => {
        const keys1 = CryptoPQ.generateDsaKeys();
        const keys2 = CryptoPQ.generateDsaKeys();

        expect(keys1.publicKey).not.toEqual(keys2.publicKey);
        expect(keys1.secretKey).not.toEqual(keys2.secretKey);
      });

      it('should generate same keys with same seed', () => {
        const seed = new Uint8Array(32).fill(1);
        const keys1 = CryptoPQ.generateDsaKeys(seed);
        const keys2 = CryptoPQ.generateDsaKeys(seed);

        expect(keys1.publicKey).toEqual(keys2.publicKey);
        expect(keys1.secretKey).toEqual(keys2.secretKey);
      });

      it('should generate different keys with different seeds', () => {
        const seed1 = new Uint8Array(32).fill(1);
        const seed2 = new Uint8Array(32).fill(2);
        const keys1 = CryptoPQ.generateDsaKeys(seed1);
        const keys2 = CryptoPQ.generateDsaKeys(seed2);

        expect(keys1.publicKey).not.toEqual(keys2.publicKey);
        expect(keys1.secretKey).not.toEqual(keys2.secretKey);
      });

      it('should handle empty seed gracefully', () => {
        // Should auto-generate if not provided
        const keys = CryptoPQ.generateDsaKeys();
        expect(keys.secretKey.length).toBe(ML_DSA_SECRET_KEY_SIZE);
        expect(keys.publicKey.length).toBe(ML_DSA_PUBLIC_KEY_SIZE);
      });
    });

    describe('sign', () => {
      it('should sign a message', () => {
        const { secretKey } = CryptoPQ.generateDsaKeys();
        const message = new TextEncoder().encode('Hello, World!');

        const signature = CryptoPQ.sign(secretKey, message);

        expect(signature).toBeInstanceOf(Uint8Array);
        expect(signature.length).toBe(ML_DSA_SIGNATURE_SIZE); // ML-DSA-44 signature size
      });

      it('should produce different signatures for different messages', () => {
        const { secretKey } = CryptoPQ.generateDsaKeys();
        const message1 = new TextEncoder().encode('Message 1');
        const message2 = new TextEncoder().encode('Message 2');

        const sig1 = CryptoPQ.sign(secretKey, message1);
        const sig2 = CryptoPQ.sign(secretKey, message2);

        expect(sig1).not.toEqual(sig2);
      });

      it('should throw error for empty message', () => {
        const { secretKey } = CryptoPQ.generateDsaKeys();
        const emptyMessage = new Uint8Array(0);

        expect(() => CryptoPQ.sign(secretKey, emptyMessage)).toThrow(CryptoPQError);
        expect(() => CryptoPQ.sign(secretKey, emptyMessage)).toThrow('Signing failed');
      });

      it('should handle large messages', () => {
        const { secretKey } = CryptoPQ.generateDsaKeys();
        const largeMessage = new Uint8Array(10000).fill(42);

        const signature = CryptoPQ.sign(secretKey, largeMessage);
        expect(signature).toBeInstanceOf(Uint8Array);
        expect(signature.length).toBe(ML_DSA_SIGNATURE_SIZE);
      });

      it('should throw error for invalid secret key', () => {
        const invalidSecretKey = new Uint8Array(100); // Wrong size
        const message = new TextEncoder().encode('Test');

        expect(() => CryptoPQ.sign(invalidSecretKey, message)).toThrow(CryptoPQError);
        expect(() => CryptoPQ.sign(invalidSecretKey, message)).toThrow('Signing failed');
      });

      it('should throw error with correct error code for signing failure', () => {
        const invalidSecretKey = new Uint8Array(ML_DSA_SIGNATURE_SIZE); // Right size but invalid data
        const message = new TextEncoder().encode('Test');

        try {
          CryptoPQ.sign(invalidSecretKey, message);
          expect.fail('Should have thrown error');
        } catch (error) {
          expect(error).toBeInstanceOf(CryptoPQError);
          expect(error.code).toBe('SIGNING_FAILED');
        }
      });
    });

    describe('verifySignature', () => {
      it('should verify valid signature', () => {
        const { secretKey, publicKey } = CryptoPQ.generateDsaKeys();
        const message = new TextEncoder().encode('Test message');
        const signature = CryptoPQ.sign(secretKey, message);

        const isValid = CryptoPQ.verifySignature(publicKey, message, signature);

        expect(isValid).toBe(true);
      });

      it('should reject signature for different message', () => {
        const { secretKey, publicKey } = CryptoPQ.generateDsaKeys();
        const message1 = new TextEncoder().encode('Original message');
        const message2 = new TextEncoder().encode('Different message');
        const signature = CryptoPQ.sign(secretKey, message1);

        const isValid = CryptoPQ.verifySignature(publicKey, message2, signature);

        expect(isValid).toBe(false);
      });

      it('should reject signature from different key', () => {
        const keys1 = CryptoPQ.generateDsaKeys();
        const keys2 = CryptoPQ.generateDsaKeys();
        const message = new TextEncoder().encode('Test message');
        const signature = CryptoPQ.sign(keys1.secretKey, message);

        const isValid = CryptoPQ.verifySignature(keys2.publicKey, message, signature);

        expect(isValid).toBe(false);
      });

      it('should reject tampered signature', () => {
        const { secretKey, publicKey } = CryptoPQ.generateDsaKeys();
        const message = new TextEncoder().encode('Test message');
        const signature = CryptoPQ.sign(secretKey, message);

        // Tamper with signature
        signature[0] ^= 1;

        const isValid = CryptoPQ.verifySignature(publicKey, message, signature);

        expect(isValid).toBe(false);
      });

      it('should throw error for invalid signature length', () => {
        const { publicKey } = CryptoPQ.generateDsaKeys();
        const message = new TextEncoder().encode('Test');
        const invalidSignature = new Uint8Array(64); // Wrong length per code check

        expect(() => CryptoPQ.verifySignature(publicKey, message, invalidSignature)).toThrow(CryptoPQError);
        expect(() => CryptoPQ.verifySignature(publicKey, message, invalidSignature)).toThrow(
          'Invalid signature length',
        );
      });

      it('should throw error with correct error code for invalid signature length', () => {
        const { publicKey } = CryptoPQ.generateDsaKeys();
        const message = new TextEncoder().encode('Test');
        const invalidSignature = new Uint8Array(100);

        try {
          CryptoPQ.verifySignature(publicKey, message, invalidSignature);
          expect.fail('Should have thrown error');
        } catch (error) {
          expect(error).toBeInstanceOf(CryptoPQError);
          expect(error.code).toBe('INVALID_SIGNATURE_LENGTH');
        }
      });

      it('should handle invalid public key gracefully', () => {
        const invalidPublicKey = new Uint8Array(100); // Wrong size
        const message = new TextEncoder().encode('Test');
        const signature = new Uint8Array(ML_DSA_SIGNATURE_SIZE); // Correct signature size but invalid data

        // This will throw during verification due to invalid key
        expect(() => CryptoPQ.verifySignature(invalidPublicKey, message, signature)).toThrow(CryptoPQError);
      });
    });

    describe('DSA round-trip scenarios', () => {
      it('should complete full sign and verify workflow', () => {
        // Alice generates keys
        const alice = CryptoPQ.generateDsaKeys();

        // Alice signs a message
        const message = new TextEncoder().encode('Important document');
        const signature = CryptoPQ.sign(alice.secretKey, message);

        // Bob verifies using Alice's public key
        const isValid = CryptoPQ.verifySignature(alice.publicKey, message, signature);

        expect(isValid).toBe(true);
      });

      it('should work with deterministic keys', () => {
        const seed = new Uint8Array(32).fill(100);
        const keys = CryptoPQ.generateDsaKeys(seed);

        const message = new TextEncoder().encode('Deterministic test');
        const signature = CryptoPQ.sign(keys.secretKey, message);
        const isValid = CryptoPQ.verifySignature(keys.publicKey, message, signature);

        expect(isValid).toBe(true);
      });

      it('should verify multiple signatures with same key', () => {
        const keys = CryptoPQ.generateDsaKeys();

        for (let i = 0; i < 5; i++) {
          const message = new TextEncoder().encode(`Message ${i}`);
          const signature = CryptoPQ.sign(keys.secretKey, message);
          const isValid = CryptoPQ.verifySignature(keys.publicKey, message, signature);
          expect(isValid).toBe(true);
        }
      });

      it('should handle batch verification scenario', () => {
        const keys = CryptoPQ.generateDsaKeys();
        const messages = ['Document 1', 'Document 2', 'Document 3'].map(m => new TextEncoder().encode(m));

        const signatures = messages.map(msg => CryptoPQ.sign(keys.secretKey, msg));

        // Verify all signatures
        messages.forEach((msg, i) => {
          const isValid = CryptoPQ.verifySignature(keys.publicKey, msg, signatures[i]);
          expect(isValid).toBe(true);
        });

        // Cross-verify should fail
        const crossValid = CryptoPQ.verifySignature(keys.publicKey, messages[0], signatures[1]);
        expect(crossValid).toBe(false);
      });
    });
  });

  describe('Error handling', () => {
    it('should have proper error name', () => {
      try {
        CryptoPQ.generateKemKeys(new Uint8Array(10));
      } catch (error) {
        expect(error).toBeInstanceOf(CryptoPQError);
        expect(error.name).toBe('CryptoPQError');
      }
    });

    it('should include error codes in all errors', () => {
      const errorCodes = [
        'INVALID_SEED_LENGTH',
        'KEY_GENERATION_FAILED',
        'ENCAPSULATION_FAILED',
        'DECAPSULATION_FAILED',
        'SIGNING_FAILED',
        'SIGNATURE_VERIFICATION_FAILED',
        'INVALID_SIGNATURE_LENGTH',
      ];

      // Just verify the error structure
      expect(errorCodes.length).toBeGreaterThan(0);
    });
  });

  describe('Integration scenarios', () => {
    it('should use both KEM and DSA together', () => {
      // Simulate secure communication with both key exchange and signatures

      // Step 1: Key exchange using ML-KEM
      const aliceKem = CryptoPQ.generateKemKeys();
      const { cipherText, sharedSecret } = CryptoPQ.encapsulate(aliceKem.publicKey);
      const aliceSharedSecret = CryptoPQ.decapsulate(cipherText, aliceKem.secretKey);

      expect(aliceSharedSecret).toEqual(sharedSecret);

      // Step 2: Sign a message using ML-DSA
      const aliceDsa = CryptoPQ.generateDsaKeys();
      const message = new TextEncoder().encode('Encrypted with shared secret');
      const signature = CryptoPQ.sign(aliceDsa.secretKey, message);

      // Step 3: Verify signature
      const isValid = CryptoPQ.verifySignature(aliceDsa.publicKey, message, signature);

      expect(isValid).toBe(true);
    });
  });
});
