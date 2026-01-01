# LatticeStore Encryption Architecture

## Overview

LatticeStore implements a post-quantum secure, multi-device encryption system where users maintain full sovereignty over their data. The system uses NIST-approved post-quantum cryptography (Kyber-1024/ML-KEM) combined with traditional symmetric encryption (AES-256-GCM) to protect user data across multiple devices.

## Core Components

### 1. Account Structure

- **One Account → Multiple Devices (1:N)**
- Each account has a unique `accountId` (256-bit hex)
- Username and metadata stored encrypted
- Shared data accessible across all authorized devices

### 2. Device Identity

Each device generates:

- **ML-KEM1024 (Kyber) keypair** from a 512-bit seed (randomBytes(64))
- **Device ID**: SHA-256 fingerprint of the public key
- **Device Name**: Human-readable identifier

## Encryption Flow

### Initial Account Creation

1. **Master Key Generation**

   ```
   masterKey = randomBytes(32)  // 256-bit AES key
   ```

2. **Device Enrollment**
   - Each device generates its own Kyber-1024 keypair
   - Public keys are encrypted within device envelopes
   - Private keys never leave the device
   - Service only sees Kyber ciphertext, not public keys
   - Two devices are generated on creation:
     - **Local Device A**: `deviceIdA`, `publicKeyA`, `secretKeyA`, `SeedA`
     - **Recovery Device**: `deviceIdB`, `publicKeyB`, `secretKeyB`, `SeedB(Recovery seed)`

3. **Master Key Encapsulation**

   ```
   For each device:
     - output = ml_kem1024.encapsulate(device.publicKey)
     - sharedSecret = output.sharedSecret
     - envelope = {
         deviceId: device.id,
         ciphertext: output.cipherText,  // Only this is visible to service
         encryptedMasterKey: AES-256-GCM(masterKey, sharedSecret)
     }
   ```

4. **Data Encryption Hierarchy**

   ```
   // Master key encrypts only:
   cipherDeviceList = AES-256-GCM(deviceList + publicKeys, masterKey)
   cipherRootFile = AES-256-GCM(rootFile + fileKeys, masterKey)

   // Individual files use unique keys:
   fileKey = randomBytes(32)  // Stored in rootFile
   cipherFile = AES-256-GCM(fileContent, fileKey)
   ```

### Device Access Flow

1. **Login**: Device provides `accountId:deviceId` token
2. **Envelope Retrieval**: Service returns the device's envelope
3. **Master Key Recovery**:
   ```
   sharedSecret = ml_kem1024.decapsulate(envelope.ciphertext, device.secretKey)
   masterKey = AES-256-GCM-Decrypt(envelope.encryptedMasterKey, sharedSecret)
   ```
4. **Data Decryption**:
   - Use master key to decrypt deviceList and rootFile
   - Extract individual file keys from rootFile
   - Decrypt files using their unique keys

### Key Rotation on Device Changes

When devices are added/removed:

1. **Generate new master key**
2. **Create new envelopes** for all authorized devices
3. **Re-encrypt only**:
   - Device list (contains public keys)
   - Root file (contains file keys)
4. **Individual files remain unchanged** (different keys)
5. **Revoked devices**:
   - Retain old envelopes but receive no updates
   - Cannot access new master key or new file keys

### Planned: Secure Device Addition Protocol

Off-chain verification via:

- **QR codes** for visual verification
- **Temporary codes** with short expiration
- **Existing device approval** required
- **No trust in service** during pairing

## Security Properties

### Strengths

1. **Post-Quantum Security**: Kyber-1024 protects against quantum attacks
2. **Zero-Knowledge Service**: Provider sees only ciphertext and Kyber encapsulation
3. **Minimal Key Reuse**: Master key only encrypts two objects
4. **Device Independence**: Each device has unique credentials
5. **Forward Secrecy**: File keys are independent; compromise limited
6. **Efficient Updates**: Only metadata re-encrypted on device changes

### Identified Weaknesses & Mitigations

#### 1. **Master Key as Gateway**

- **Risk**: Compromise exposes all file keys
- **Mitigation**: Minimal reuse, hardware security planned
- **Future**: Threshold encryption for critical operations

#### 2. **Device Revocation Granularity**

- **Risk**: Revoked devices retain access to old file versions
- **Current**: New master key prevents access to new files
- **Consider**: Time-based key expiration for files

#### 3. **No Public Key Authentication**

- **Risk**: Service could provide false envelopes
- **Mitigation**: Planned QR/temporary code verification
- **Future**: Device-to-device authentication protocol

#### 4. **Seed Management**

- **Current**: Seeds stored in browser storage (development only)
- **Production**: Will use device secure enclaves / passkeys?
- **Recovery**: Separate recovery seed requires secure offline storage

#### 5. **Trust on First Use (TOFU)**

- **Risk**: Initial device enrollment trusts service
- **Mitigation**: Planned out-of-band verification
- **Future**: Multi-party computation for enrollment

## Data Flow Diagram

```
┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│  Device A   │     │  Device B   │     │  Device C   │
│ (Kyber SK₁) │     │ (Kyber SK₂) │     │ (Kyber SK₃) │
└──────┬──────┘     └──────┬──────┘     └──────┬──────┘
       │                   │                   │
       │ (PK₁ encrypted)   │ (PK₂ encrypted)   │ (PK₃ encrypted)
       ▼                   ▼                   ▼
┌──────────────────────────────────────────────────────┐
│                  Service Storage                      │
│  ┌─────────┐      ┌─────────┐      ┌─────────┐      │
│  │Envelope₁│      │Envelope₂│      │Envelope₃│      │
│  │ CT₁ only│      │ CT₂ only│      │ CT₃ only│      │
│  └─────────┘      └─────────┘      └─────────┘      │
│   Service sees only Kyber ciphertext, not keys       │
└──────────────────────────────────────────────────────┘
                           │
                    Master Key (AES-256)
                    (Decrypted locally)
                           │
         ┌─────────────────┴─────────────────┐
         ▼                                   ▼
┌─────────────────┐                 ┌─────────────────┐
│ Device List     │                 │ Root File       │
│ • Public Keys   │                 │ • File Keys     │
│ • Device Names  │                 │ • Metadata      │
└─────────────────┘                 └────────┬────────┘
                                            │
                                    Individual File Keys
                                            │
                                            ▼
                                 ┌───────────────────┐
                                 │ Encrypted Files   │
                                 │ • Unique AES key  │
                                 │ • Per-file crypto │
                                 └───────────────────┘
```

## Cryptographic Summary

| Component         | Algorithm   | Key Size        | Purpose                         |
| ----------------- | ----------- | --------------- | ------------------------------- |
| Device Identity   | ML-KEM1024  | 3168/1568 bytes | Post-quantum key exchange       |
| Master Encryption | AES-256-GCM | 256 bits        | Encrypt device list & root file |
| File Encryption   | AES-256-GCM | 256 bits        | Per-file encryption             |
| Device ID         | SHA-256     | 256 bits        | Public key fingerprint          |
|                   |

## TODOs

1. **Implement secure device pairing protocol** with QR codes as planned
2. **Investigate hybrid approach** for master key management:
   - Use a hardware security module (HSM) or secure enclave for master key storage
   - Consider threshold encryption for critical operations
3. **Add secure audit logging** for all key operations
4. **Implement time-based key expiration** for files to enhance forward secrecy
5. **Implement use of passkeys** or secure hardware for seed management (?)

Next steps?
