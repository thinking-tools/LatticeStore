import type {
  VaultId,
  VaultType,
  MemberId,
  Base64,
  Timestamp,
  Base64Encrypted,
  CollectionType,
} from '../shared/Consts';
import type { MemberEncryptedDetail, MemberInfoBasics, MemberSlot } from './Members';
import type { Collection } from './collections/Collection';
import type { AEADCryptoKey, RawAEADKey } from '../crypto/CryptoAEAD';
import type { LoginPayload, LoginRequest } from './ApiClient';

import { CryptoPQ } from '../crypto/CryptoPQ';
import { sha256 } from '../crypto/CryptoUtils';
import { generateCanonicalJSON, now, uint8ArrayToBase64, base64ToUint8Array, fromUint8Array } from '../shared/Helpers';
import { makeRequest } from './ApiClient';
import { isValidCollectionName, isValidCollectionType, isValidVaultManifest } from '../shared/Validators';
import { VAULT_TYPE } from '../shared/Consts';
import { IS_MANAGER_ROLE } from '../shared/Consts';
import { getManagerKey, decryptMemberList, getCollectionsKey } from './Members';
import { CollectionController } from './collections/Collection';
import { AEAD } from '../crypto/CryptoAEAD';
import { getMemberFromMemberSlots } from '../shared/Validators';
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
  readonly #vaultManifest: Vault;

  #etag: string;
  #authToken: string | null = null;
  #activeMember: MemberInfoBasics;
  #persistent: boolean = false;
  #aeadVaultKey: AEADCryptoKey | null = null;
  #isManagerMember: boolean = false;
  #managersArea: { memberList: MemberEncryptedDetail[]; key: AEADCryptoKey } | null = null;
  #collectionsKey: AEADCryptoKey | null = null;
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
    if (
      !isValidVaultManifest(vaultManifest, VAULT_TYPE.account as VaultType) ||
      vaultManifest.payload.name !== accountName
    ) {
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
      this.#collectionsKey = await getCollectionsKey(aeadMasterKeyRaw as Uint8Array);
    } else {
      this.#isManagerMember = false;
      this.#collectionsKey = this.#aeadVaultKey;
    }
    if (vault.payload.collectionsEncrypted && vault.payload.collectionsEncrypted.length > 0) {
      const collectionsDecrypted = await AEAD.decrypt(
        this.#collectionsKey!,
        base64ToUint8Array(vault.payload.collectionsEncrypted),
      );
      const collections = JSON.parse(fromUint8Array(collectionsDecrypted)) as Collection[];
      this.collections$.set(
        collections.map(
          c => new CollectionController(c, c.collectionKey as unknown as RawAEADKey, vault.payload.id as VaultId),
        ),
      );
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
      authToken: this.#authToken,
      vault: {
        id: this.#vaultManifest.payload.id,
        etag: this.#etag,
      },
    };
  }

  listCollections(type?: CollectionType): CollectionController[] {
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

  createCollection(name: string, type: CollectionType): void {
    if (!isValidCollectionName(name)) {
      throw new Error('Invalid collection name');
    }
    if (!isValidCollectionType(type)) {
      throw new Error('Invalid collection type');
    }
    if (this.isManagerMember() === false || this.#collectionsKey === null) {
      throw new Error('Only manager members can create collections in this vault');
    }
    // const newCollection = 'test';
    // this.addCollection(newCollection);
    // return newCollection;
  }

  // getCollectionOrCreateByName = async (name: string, type: string): Promise<CollectionController> => {
  //   let collection = this.getCollectionByName(name);
  //   if (collection) {
  //     return collection;
  //   }
  //   // create new collection
  //   const newCollection = CollectionController.createNewCollection(
  //     name,
  //     type,
  //     this.#vaultManifest.payload.id,
  //     this.#collectionKey as unknown as RawAEADKey,
  //   );
  //   this.addCollection(newCollection);
  //   return newCollection;
  // };

  timeToUpdate = () => {
    console.warn('TIME TO UPDATE VAULT DATA');
  };

  isManagerMember(): boolean {
    return this.#isManagerMember;
  }
}
