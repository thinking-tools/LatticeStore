import type {
  VaultId,
  VaultType,
  MemberId,
  Base64,
  Timestamp,
  Base64Encrypted,
  CollectionType,
  FileId,
  CollectionId,
} from '../shared/Consts';
import type { MemberEncryptedDetail, MemberInfoBasics, MemberSlot } from './Members';
import type { CollectionContent, CollectionMinimal } from './collections/Collection';
import type { AEADCryptoKey, RawAEADKey } from '../crypto/CryptoAEAD';
import type { LoginPayload, LoginRequest, ReauthPayload, ReauthRequest } from './ApiClient';

import { CryptoPQ } from '../crypto/CryptoPQ';
import { generateRandomUUID, sha256 } from '../crypto/CryptoUtils';
import {
  generateCanonicalJSON,
  now,
  uint8ArrayToBase64,
  base64ToUint8Array,
  fromUint8Array,
  toUint8Array,
} from '../shared/Helpers';
import { makeRequest } from './ApiClient';
import {
  isValidCollectionName,
  isValidCollectionType,
  isValidVaultManifest,
  isUniqueCollectionName,
} from '../shared/Validators';
import { VAULT_TYPE } from '../shared/Consts';
import { IS_MANAGER_ROLE } from '../shared/Consts';
import { getManagerKey, decryptMemberList, getCollectionsKey } from './Members';
import { CollectionController } from './collections/Collection';
import { AEAD } from '../crypto/CryptoAEAD';
import { getMemberFromMemberSlots } from '../shared/Validators';
import { ReactiveValue } from './ReactiveValue';
import { Tasker } from './Tasker';

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
  collectionsEncrypted?: Base64Encrypted<CollectionMinimal[]>; // Just pointers to collection channels, not collection state
  createdAt: Timestamp;
  updatedAt: Timestamp;
};

export type Vault = {
  payload: VaultRegistrationPayload;
  payloadHash: Base64<Uint8Array>;
  signerId: MemberId;
  signature: Base64<Uint8Array>;
};

export type VaultUpdate = {
  prevEtag: string;
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
  #serviceUrl: string = ' ';
  // #collections: CollectionController[] = [];

  #pendingCollections = new Set<string>();

  readonly collections$ = new ReactiveValue<CollectionController[]>([]);
  readonly members$ = new ReactiveValue<MemberEncryptedDetail[]>([]);

  // #tasker: Tasker | null = null;
  constructor(
    vaultManifest: Vault,
    etag: string,
    authToken: string,
    member: MemberInfoBasics,
    serviceUrl: string,
    persistent: boolean,
  ) {
    this.#vaultManifest = vaultManifest;
    this.#etag = etag;
    this.#authToken = authToken;
    this.#activeMember = member;
    this.#serviceUrl = serviceUrl;
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

    let vault = new VaultController(
      vaultManifest,
      response.vaultEtag,
      response.authToken,
      member,
      serviceUrl,
      persistent,
    );

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
      const collections = JSON.parse(fromUint8Array(collectionsDecrypted)) as CollectionMinimal[];
      this.collections$.set(collections.map(c => new CollectionController(c, this)));
    }
    return true;
  };

  getId(): VaultId {
    return this.#vaultManifest.payload.id;
  }

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

  async handleAuthError(): Promise<boolean> {
    try {
      const payload: ReauthPayload = {
        memberId: this.#activeMember.memberId,
        vaultId: this.#vaultManifest.payload.id,
        timestamp: now(),
        reqId: generateRandomUUID(),
      };
      const payloadSha256uint8Array = (await sha256(generateCanonicalJSON(payload), 'uint8array')) as Uint8Array;
      const body: ReauthRequest = {
        payload,
        payloadHash: uint8ArrayToBase64(payloadSha256uint8Array) as Base64<Uint8Array>,
        signature: uint8ArrayToBase64(
          CryptoPQ.sign(this.#activeMember.dsaKeys.secretKey, payloadSha256uint8Array),
        ) as Base64<Uint8Array>,
      };
      const response = await makeRequest(`${this.#serviceUrl}/reauth`, 'POST', body);
      if (response.ok && response.authToken) {
        this.#authToken = response.authToken;
        return true;
      }
      return false;
    } catch (error) {
      console.error('Reauth failed:', error);
      return false;
    }
  }

  getEtag() {
    return this.#etag;
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
    return type ? all.filter(c => c.getType() === type) : all;
  }

  async getCollectionById(tasker: Tasker, collectionId: string): Promise<CollectionContent | null> {
    const col = this.collections$.value.find(c => c.getId() === collectionId);
    if (col) {
      return col.load(tasker, true);
    }
    return null;
  }

  async getCollectionByName(tasker: Tasker, name: string): Promise<CollectionContent | null> {
    const col = this.collections$.value.find(c => c.getName() === name);
    if (col) {
      return col.load(tasker, true);
      // return col;
    }
    return null;
  }
  async #encryptAndUpdateCollectionsList(): Promise<void> {
    if (!this.#collectionsKey) throw new Error('Collections key not available');

    const collectionsMinimal: CollectionMinimal[] = this.collections$.value.map(c => c.getColMinimalRef());
    const collectionsEncrypted = await AEAD.encrypt(
      this.#collectionsKey,
      toUint8Array(JSON.stringify(collectionsMinimal)) as Uint8Array<ArrayBuffer>,
    );
    this.#vaultManifest.payload.collectionsEncrypted = uint8ArrayToBase64(collectionsEncrypted) as Base64Encrypted<
      CollectionMinimal[]
    >;
  }

  async removeCollectionById(id: CollectionId): Promise<boolean> {
    this.collections$.set(this.collections$.value.filter(c => c.getId() !== id));
    await this.#encryptAndUpdateCollectionsList();
    await this.#saveUpdate();
    return true;
  }

  async renameCollectionById(id: CollectionId, newName: string): Promise<boolean> {
    const collection = this.collections$.value.find(c => c.getId() === id);
    if (!collection) throw new Error('Collection not found');
    collection.setName(newName, this.#activeMember.memberId);
    await this.#encryptAndUpdateCollectionsList();
    await this.#saveUpdate();
    return true;
  }

  async createCollection(name: string, type: CollectionType, tasker: Tasker): Promise<CollectionContent> {
    if (!isValidCollectionName(name)) throw new Error('Invalid collection name');
    if (!isValidCollectionType(type)) throw new Error('Invalid collection type');
    if (!isUniqueCollectionName(name, this.listCollections())) throw new Error('Collection name must be unique');
    if (!this.isManagerMember() || this.#collectionsKey === null)
      throw new Error('Only manager members can create collections in this vault');
    const collection = CollectionController.createNew(name, type, this, this.#activeMember.memberId);
    this.collections$.update(arr => arr.push(collection));
    this.#pendingCollections.add(collection.getId());
    const handle = tasker.upload(
      this,
      collection.getId() as unknown as FileId,
      collection.serialize(),
      collection.getEncKey(),
    );
    try {
      const resp = await handle.promise;
      console.warn('Collection upload successful:', resp);
      this.#pendingCollections.delete(collection.getId());
      await this.#encryptAndUpdateCollectionsList();
      await this.#saveUpdate();
    } catch (err) {
      // Upload failed - collection stays in pending, will retry on next sync
      console.error('Collection upload failed, queued for retry:', err);
    }
    return collection.content;
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

  timeToFetchUpdate = () => {
    console.warn('TIME TO FETCH VAULT DATA');
  };

  #saveUpdate = async (): Promise<void> => {
    console.warn('SAVE UPDATE VAULT DATA');
    const updatedPayload = {
      ...this.#vaultManifest.payload,
      updatedAt: now(),
    };
    const payloadSha256uint8Array = (await sha256(generateCanonicalJSON(updatedPayload), 'uint8array')) as Uint8Array;
    const updateVaultBody = {
      prevEtag: this.#etag,
      payload: updatedPayload,
      payloadHash: uint8ArrayToBase64(payloadSha256uint8Array),
      signerId: this.#activeMember.memberId,
      signature: uint8ArrayToBase64(CryptoPQ.sign(this.#activeMember.dsaKeys.secretKey, payloadSha256uint8Array)),
    } as VaultUpdate;
    const headers = {
      Authorization: `Bearer ${this.#authToken}`,
      'x-member-id': this.#activeMember.memberId,
      'x-vault-id': this.#vaultManifest.payload.id,
      'x-chunk-key': this.#vaultManifest.payload.id,
      'Content-Type': 'application/json',
    };
    const response = await makeRequest(`${this.#serviceUrl}/upload`, 'PUT', updateVaultBody, headers);
    if (!response.ok) {
      throw new Error(response.message || 'Update failed');
    }

    console.warn('Vault update successful:', response);
    this.#etag = response.etag;
  };

  isManagerMember(): boolean {
    return this.#isManagerMember;
  }

  // _updateVault() {
  //   console.warn('UPDATE VAULT MANIFEST');

  // }
}
