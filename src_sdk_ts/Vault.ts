import type { VaultId, VaultType, MemberId, Base64, Timestamp, Base64Encrypted } from './Consts';
import type { MemberEncryptedDetail, MemberInfoBasics, MemberSlot } from './Members';
import type { Collection } from './collections/Collection';
import type { AEADCryptoKey, RawAEADKey } from './CryptoAEAD';
import type { LoginPayload, LoginRequest } from './ApiClient';

import { CryptoPQ } from './CryptoPQ';
import { sha256 } from './CryptoUtils';
import { generateCanonicalJSON, now, uint8ArrayToBase64, base64ToUint8Array, fromUint8Array } from './Helpers';
import { makeRequest } from './ApiClient';
import { isValidVaultManifest } from './Validators';
import { VAULT_TYPE } from './Consts';
import { IS_MANAGER_ROLE } from './Consts';
import { getManagerKey, decryptMemberList, getCollectionKey } from './Members';
import { CollectionController } from './collections/Collection';
import { AEAD } from './CryptoAEAD';
import { getMemberFromMemberSlots } from './Validators';
import { ReactiveValue } from './ReactiveValue';

export type VaultRegistrationPayload = {
  version: number;
  name: string; // mutable, can be changed by owner/admin
  type: VaultType; // account or team(TBD) [TODO]
  id: VaultId; // redundant but useful for verification
  dsaPubkey: Base64<Uint8Array>; // for signature verification of manifests
  kemPubkey: Base64<Uint8Array>; // for key encapsulation
  memberSlots: MemberSlot[];
  managerOnlyMemberList: Base64Encrypted<MemberEncryptedDetail[]>; // managers only access
  managerOnlyArea: Base64Encrypted<Uint8Array>; // placeholder for future manager-only data
  keyEpoch: number; // increments when vault keys are rotated
  collectionsEncrypted?: Base64Encrypted<Collection[]>; // Just pointers to collection channels, not collection state
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
  #collectionKey: AEADCryptoKey | null = null;
  // #collections: CollectionController[] = [];

  readonly collections$ = new ReactiveValue<CollectionController[]>([]);
  readonly members$ = new ReactiveValue<MemberEncryptedDetail[]>([]);

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
    if (!isValidVaultManifest(vaultManifest, VAULT_TYPE.account) || vaultManifest.payload.name !== accountName) {
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
      this.#collectionKey = await getCollectionKey(aeadMasterKeyRaw as Uint8Array);
    } else {
      this.#isManagerMember = false;
      this.#collectionKey = this.#aeadVaultKey;
    }
    if (vault.payload.collectionsEncrypted && vault.payload.collectionsEncrypted.length > 0) {
      const collectionsDecrypted = await AEAD.decrypt(
        this.#collectionKey!,
        base64ToUint8Array(vault.payload.collectionsEncrypted),
      );
      const collections = JSON.parse(fromUint8Array(collectionsDecrypted)) as Collection[];
      this.collections$.set(collections.map(c => new CollectionController(c)));
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

  getAuthToken() {
    return this.#authToken;
  }

  handleAuthError(): Promise<boolean> {
    // TODO: implement token refresh logic
    console.warn('HANDLE AUTH ERROR IN VAULT CONTROLLER');
    return Promise.resolve(false);
  }

  getVaultCredentials() {
    return {
      vaultId: this.#vaultManifest.payload.id,
      memberId: this.#activeMember.memberId,
      vault: {
        id: this.#vaultManifest.payload.id,
        etag: this.#etag,
      },
    };
  }

  listCollections(type?: string): CollectionController[] {
    const all = this.collections$.value;
    return type ? all.filter(c => c.collection.collectionType === type) : all;
  }

  getCollectionById(collectionId: string): CollectionController | null {
    const col = this.collections$.value.find(c => c.collection.collectionId === collectionId);
    if (col) {
      return col;
    }
    return null;
  }

  getCollectionByName(name: string): CollectionController | null {
    const col = this.collections$.value.find(c => c.collection.collectionName === name);
    if (col) {
      return col;
    }
    return null;
  }
  addCollection(col: CollectionController) {
    this.collections$.update(arr => arr.push(col));
  }

  removeCollection(id: string) {
    this.collections$.set(this.collections$.value.filter(c => c.collection.collectionId !== id));
  }

  timeToUpdate = () => {
    console.warn('TIME TO UPDATE VAULT DATA');
  };

  isManagerMember(): boolean {
    return this.#isManagerMember;
  }
}
