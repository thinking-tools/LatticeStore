import type { VaultId, VaultType, MemberId, Base64, Timestamp, Base64Encrypted } from './Consts.js';
import type { MemberEncryptedDetail, MemberInfoBasics, MemberSlot } from './Members.js';
import type { Feature } from './features/Features';
import type { AEADCryptoKey, RawAEADKey } from './CryptoAEAD.js';
import type { LoginPayload, LoginRequest } from './ApiClient';

import { CryptoPQ } from './CryptoPQ';
import { sha256 } from './CryptoUtils';
import { generateCanonicalJSON, now, uint8ArrayToBase64 } from './Helpers';
import { makeRequest } from './ApiClient';
import { isValidVaultManifest } from './Validators';
import { VAULT_TYPE } from './Consts';
import { IS_MANAGER_ROLE } from './Consts.js';
import { getManagerKey, decryptMemberList, getFeaturesKey } from './Members.js';
import { FeatureController } from './features/Features.js';
import { AEAD } from './CryptoAEAD.js';
import { getMemberFromMemberSlots } from './Validators.js';
import { base64ToUint8Array, fromUint8Array } from './Helpers.js';

export type VaultRegistrationPayload = {
  version: number;
  name: string; // mutable, can be changed by owner/admin
  type: VaultType; // personal or team(TBD) [TODO]
  id: VaultId; // redundant but useful for verification
  dsaPubkey: Base64<Uint8Array>; // for signature verification of manifests
  kemPubkey: Base64<Uint8Array>; // for key encapsulation
  memberSlots: MemberSlot[];
  managerOnlyMemberList: Base64Encrypted<MemberEncryptedDetail[]>; // managers only access
  managerOnlyArea: Base64Encrypted<Uint8Array>; // placeholder for future manager-only data
  keyEpoch: number; // increments when vault keys are rotated
  featuresEncrypted?: Base64Encrypted<Feature[]>; // Just pointers to feature channels, not feature state
  createdAt: Timestamp;
  updatedAt: Timestamp;
};

export type Vault = {
  payload: VaultRegistrationPayload;
  payloadHash: Base64<Uint8Array>;
  signerId: MemberId;
  signature: Base64<Uint8Array>;
};

export class VaultController {
  #vaultManifest: Vault;
  #etag: string;
  #authToken: string | null = null;
  #activeMember: MemberInfoBasics;
  #persistent: boolean = false;

  #aeadVaultKey: AEADCryptoKey | null = null;
  #isManagerMember: boolean = false;
  #managersArea: { memberList: MemberEncryptedDetail[]; key: AEADCryptoKey } | null = null;
  #featuresKey: AEADCryptoKey | null = null;
  #features: FeatureController[] = [];

  // #tasker: Tasker | null = null;
  constructor(vaultManifest: Vault, etag: string, authToken: string, member: MemberInfoBasics, persistent: boolean) {
    this.#vaultManifest = vaultManifest;
    this.#etag = etag;
    this.#authToken = authToken;
    this.#activeMember = member;
    this.#persistent = persistent;
    console.warn('VaultController instance created', this.#etag);
  }
  static async init(
    serviceUrl: string,
    accountName: string,
    member: MemberInfoBasics,
    persistent: boolean,
  ): Promise<VaultController> {
    const loginPayload = {
      accountName: accountName.trim(),
      memberId: member.memberId,
      timestamp: now(),
    } as LoginPayload;
    const payloadSha256uint8Array = (await sha256(generateCanonicalJSON(loginPayload), 'uint8array')) as Uint8Array;
    const loginBody = {
      payload: loginPayload,
      payloadHash: uint8ArrayToBase64(payloadSha256uint8Array),
      signerId: loginPayload.memberId,
      signature: uint8ArrayToBase64(CryptoPQ.sign(member.dsaKeys.secretKey, payloadSha256uint8Array)),
    } as LoginRequest;
    const response = await makeRequest(`${serviceUrl}/login`, 'POST', loginBody);
    if (!response.ok) {
      throw new Error(response.message || 'Login failed');
    }
    // validate vault payload and extract account info
    const vaultManifest = response.accountVault;
    if (!isValidVaultManifest(vaultManifest, VAULT_TYPE.personal) || vaultManifest.payload.name !== accountName) {
      throw new Error('Invalid vault manifest received from server');
    }

    let vault = new VaultController(vaultManifest, response.vaultEtag, response.authToken, member, persistent);

    await vault.unlockAndSetupVault();
    return vault;
  }

  unlockAndSetupVault = async (): Promise<boolean> => {
    const vault = this.#vaultManifest;
    const member = this.#activeMember!;
    const memberSlot = getMemberFromMemberSlots(vault.payload.memberSlots, member.memberId);
    if (!memberSlot) {
      // throw new Error('Member slot not found in vault manifest');
      return false;
    }
    const cipherText = base64ToUint8Array(memberSlot.memberKemCiphertext);
    const sharedKeyRaw = CryptoPQ.decapsulate(cipherText, member.kemKeys.secretKey);
    const sharedKey = await AEAD.importAEADKey(sharedKeyRaw as RawAEADKey);
    const encryptedVaultKey = base64ToUint8Array(memberSlot.memberVaultKeyWrapped);
    const aeadMasterKeyRaw = await AEAD.decrypt(sharedKey, encryptedVaultKey);
    this.#aeadVaultKey = await AEAD.importAEADKey(aeadMasterKeyRaw as RawAEADKey);
    if (IS_MANAGER_ROLE(memberSlot.memberRole)) {
      // decrypt member list area if manager
      const managersKey = await getManagerKey(aeadMasterKeyRaw as Uint8Array);
      this.#managersArea = {
        key: managersKey,
        memberList: await decryptMemberList(vault.payload.managerOnlyMemberList, managersKey),
      };
      this.#isManagerMember = true;
      this.#featuresKey = await getFeaturesKey(aeadMasterKeyRaw as Uint8Array);
    } else {
      this.#isManagerMember = false;
      this.#featuresKey = this.#aeadVaultKey;
    }
    if (vault.payload.featuresEncrypted && vault.payload.featuresEncrypted.length > 0) {
      const featuresDecrypted = await AEAD.decrypt(
        this.#featuresKey!,
        base64ToUint8Array(vault.payload.featuresEncrypted),
      );
      const featuresJson = fromUint8Array(featuresDecrypted);
      for (const feature of JSON.parse(featuresJson) as Feature[]) {
        this.#features.push(new FeatureController(feature));
      }
    }
    return true;
  };

  // addTasker(tasker: any) {
  //   this.#tasker = tasker;
  // }

  // TODO get rid of it later
  getAll() {
    return {
      etag: this.#etag,
      vault: this.#vaultManifest,
      vaultKey: this.#aeadVaultKey,
      isManagerMember: this.#isManagerMember,
      activeMember: this.#activeMember,
      managersArea: this.#managersArea,
      persistent: this.#persistent,
      // tasker: this.#tasker,
    };
  }

  setPersistent(p: boolean) {
    this.#persistent = p;
  }

  isPersistent() {
    return this.#persistent;
  }

  updateAuthToken(newToken: string) {
    this.#authToken = newToken;
  }

  // getAuthToken() {
  //   return this.#authToken;
  // }

  getVaultCredentials() {
    return {
      vaultId: this.#vaultManifest.payload.id,
      memberId: this.#activeMember.memberId,
      authToken: this.#authToken || '',
      vault: {
        id: this.#vaultManifest.payload.id,
        etag: this.#etag,
      },
    };
  }

  listFeatures(type?: string): FeatureController[] {
    if (type) {
      return this.#features.filter(feature => feature.feature.featureType === type);
    }
    return this.#features;
  }

  getFeatureById(featureId: string): FeatureController | null {
    for (const feature of this.#features) {
      if (feature.feature.featureId === featureId) {
        return feature;
      }
    }
    return null;
  }

  getFeatureByName(name: string): FeatureController | null {
    for (const feature of this.#features) {
      if (feature.feature.featureName === name) {
        return feature;
      }
    }
    return null;
  }

  timeToUpdate = () => {
    console.warn('TIME TO UPDATE VAULT DATA');
  };
}
