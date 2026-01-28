import type {
  VaultId,
  VaultType,
  MemberId,
  Base64,
  Base64Encrypted,
  CollectionType,
  FileId,
  CollectionId,
  Timestamp,
  ISOTimestamp,
  MemberRole,
} from '../shared/Consts';
import type { MemberEncryptedDetail, MemberInfoBasics, MemberSlot } from './Members';
import type { CollectionContent, CollectionMinimal } from './collections/Collection';
import type { AEADCryptoKey, RawAEADKey } from '../crypto/CryptoAEAD';
import type { LoginPayload, LoginRequest, ReauthPayload, ReauthRequest } from './ApiClient';

import { CryptoPQ } from '../crypto/CryptoPQ';
import { deriveKeyForRole, generateRandomUUID, getMemberIdFromPubkey, sha256 } from '../crypto/CryptoUtils';
import {
  generateCanonicalJSON,
  now,
  uint8ArrayToBase64,
  base64ToUint8Array,
  fromUint8Array,
  toUint8Array,
  isoNow,
} from '../shared/Helpers';
import { authRequest, makeRequest } from './ApiClient';
import {
  isValidCollectionName,
  isValidCollectionType,
  isValidVaultManifest,
  isUniqueCollectionName,
  validateAccountName,
} from '../shared/Validators';
import { MEMBER_STATUS, VAULT_TYPE } from '../shared/Consts';
import { IS_MANAGER_ROLE } from '../shared/Consts';
import { getManagerKey, decryptMemberList, getCollectionsKey, encryptMemberList } from './Members';
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
  createdAt: ISOTimestamp;
  updatedAt: ISOTimestamp;
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
  #vaultManifest: Vault;

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

  #reauthAttempts = 0;
  #lastReauthTime = 0;

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

  async #deriveKeys(): Promise<boolean> {
    const vault = this.#vaultManifest;
    const member = this.#activeMember;
    const memberSlot = getMemberFromMemberSlots(vault.payload.memberSlots, member.memberId);
    if (!memberSlot) return false;

    const cipherText = base64ToUint8Array(memberSlot.memberKemCiphertext);
    const sharedKeyRaw = CryptoPQ.decapsulate(cipherText, member.kemKeys.secretKey);
    const sharedKey = await AEAD.importAEADKey(sharedKeyRaw as RawAEADKey);
    const encryptedVaultKey = base64ToUint8Array(memberSlot.memberVaultKeyWrapped);
    const aeadMasterKeyRaw = await AEAD.decrypt(sharedKey, encryptedVaultKey);
    this.#aeadVaultKey = await AEAD.importAEADKey(aeadMasterKeyRaw as RawAEADKey);

    if (IS_MANAGER_ROLE(memberSlot.memberRole)) {
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
    return true;
  }

  async #decryptCollectionsList(): Promise<CollectionMinimal[]> {
    const encrypted = this.#vaultManifest.payload.collectionsEncrypted;
    if (!encrypted || encrypted.length === 0) return [];

    const decrypted = await AEAD.decrypt(this.#collectionsKey!, base64ToUint8Array(encrypted));
    return JSON.parse(fromUint8Array(decrypted)) as CollectionMinimal[];
  }

  #mergeCollections(incoming: CollectionMinimal[]): void {
    const current = this.collections$.value;
    const currentById = new Map(current.map(c => [c.getId(), c]));
    const incomingIds = new Set(incoming.map(c => c.colId));

    const merged: CollectionController[] = [];

    for (const col of incoming) {
      const existing = currentById.get(col.colId);
      if (existing) {
        existing.updateFromMinimal(col); // you'll need to add this method to CollectionController
        merged.push(existing);
      } else if (!this.#pendingCollections.has(col.colId)) {
        merged.push(new CollectionController(col, this));
      }
    }

    // Keep pending collections that aren't on server yet
    for (const c of current) {
      if (this.#pendingCollections.has(c.getId()) && !incomingIds.has(c.getId())) {
        merged.push(c);
      }
    }

    this.collections$.set(merged);
  }

  // Refactor existing method
  unlockAndSetupVault = async (): Promise<boolean> => {
    if (!(await this.#deriveKeys())) return false;

    const collections = await this.#decryptCollectionsList();
    this.collections$.set(collections.map(c => new CollectionController(c, this)));

    if (this.#isManagerMember && this.#managersArea) {
      this.members$.set(this.#managersArea.memberList);
    }
    return true;
  };

  async #fetchLatestManifest(): Promise<{ vault: Vault; etag: string } | null> {
    const headers = {
      'x-member-id': this.#activeMember.memberId,
      'x-vault-id': this.#vaultManifest.payload.id,
      'x-chunk-key': this.#vaultManifest.payload.id,
      'If-None-Match': this.#etag,
    };
    if (!this.#authToken) throw new Error('Auth token is missing');
    const response = await authRequest(`${this.#serviceUrl}/download`, 'GET', this.#authToken, headers);

    if (response.status === 304) return null; // not modified
    if (!response.ok) throw new Error(`Fetch vault failed: ${response.status}`);

    const newVault = await response.json();
    const newEtag = response.headers.get('etag') || '';

    return { vault: newVault, etag: newEtag };
  }

  // New update handler
  timeToFetchUpdate = async (): Promise<void> => {
    try {
      const result = await this.#fetchLatestManifest();
      if (!result) return;
      const { vault: newVault, etag: newEtag } = result;
      if (!isValidVaultManifest(newVault, VAULT_TYPE.account as VaultType)) {
        console.error('Invalid vault manifest received');
        return;
      }
      const oldEpoch = this.#vaultManifest.payload.keyEpoch;
      const newEpoch = newVault.payload.keyEpoch;

      // Update manifest reference first
      (this as any).#vaultManifest = newVault; // or make it non-readonly and add a setter
      this.#etag = newEtag;

      // Key rotation requires full re-derive
      if (newEpoch !== oldEpoch) {
        await this.#deriveKeys();
      }

      const incoming = await this.#decryptCollectionsList();
      this.#mergeCollections(incoming);

      // Update members if manager
      if (this.#isManagerMember && this.#managersArea) {
        this.#managersArea.memberList = await decryptMemberList(
          newVault.payload.managerOnlyMemberList,
          this.#managersArea.key,
        );
        this.members$.set(this.#managersArea.memberList);
      }
    } catch (err) {
      if ((err as Error).message.includes('401')) {
        await this.handleAuthError();
      } else {
        console.error('Vault update failed:', err);
      }
    }
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
    const nowTime = now();
    try {
      if (nowTime - this.#lastReauthTime < 5000) {
        this.#reauthAttempts++;
        if (this.#reauthAttempts > 3) {
          console.error('Reauth loop detected - likely concurrent session conflict');
          // Emit event or throw to notify UI
          return false;
        }
      } else {
        this.#reauthAttempts = 1;
      }
      this.#lastReauthTime = nowTime;
      const payload: ReauthPayload = {
        memberId: this.#activeMember.memberId,
        vaultId: this.#vaultManifest.payload.id,
        timestamp: nowTime,
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

  async removeCollectionById(tasker: Tasker, id: CollectionId): Promise<boolean> {
    if (!this.#authToken) throw new Error('Not authenticated');
    if (!this.isManagerMember() || this.#collectionsKey === null)
      throw new Error('Only manager members can remove collections in this vault');
    const collection = this.collections$.value.find(c => c.getId() === id);
    if (collection) {
      collection.dispose();
    }
    tasker.abortByFileId(id);
    const deleteResp = await authRequest(
      `${this.#serviceUrl}/delete`,
      'DELETE',
      this.#authToken,
      { fileKeys: [id] },
      {
        'x-member-id': this.#activeMember.memberId,
        'x-vault-id': this.#vaultManifest.payload.id,
      },
    );
    if (!deleteResp.ok && deleteResp.status !== 404) {
      const body = await deleteResp.json().catch(() => ({}));
      throw new Error(body.message || `Delete failed: ${deleteResp.status}`);
    }
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

  #saveUpdate = async (): Promise<void> => {
    console.warn('SAVE UPDATE VAULT DATA');
    const updatedPayload = {
      ...this.#vaultManifest.payload,
      updatedAt: isoNow(),
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

  async #rotateAndRewrapForMembers(
    newMemberSlots: MemberSlot[],
    newMemberDetails: MemberEncryptedDetail[],
  ): Promise<void> {
    if (!this.isManagerMember() || !this.#managersArea) {
      throw new Error('Only manager members can rotate vault keys');
    }
    // 1. Generate fresh root key
    const newVaultKeyRaw = AEAD.generateRawAEADKeyData();

    // 2. Derive new sub-keys
    const newManagerKey = await getManagerKey(newVaultKeyRaw);
    const newCollectionsKey = await getCollectionsKey(newVaultKeyRaw);

    for (const slot of newMemberSlots) {
      const detail = newMemberDetails.find(d => d.memberId === slot.memberId);
      if (!detail) throw new Error(`Missing detail for ${slot.memberId}`);

      const kemPubkey = base64ToUint8Array(detail.memberKemPubkey);
      const { cipherText, sharedSecret } = CryptoPQ.encapsulate(kemPubkey);
      const aeadSharedKey = await AEAD.importAEADKey(sharedSecret as RawAEADKey);
      sharedSecret.fill(0);

      const roleKey = deriveKeyForRole(slot.memberRole, newVaultKeyRaw);
      const wrappedKey = await AEAD.encrypt(aeadSharedKey, roleKey as Uint8Array<ArrayBuffer>);
      if (roleKey !== newVaultKeyRaw) roleKey.fill(0);

      slot.memberKemCiphertext = uint8ArrayToBase64(cipherText) as Base64<Uint8Array>;
      slot.memberVaultKeyWrapped = uint8ArrayToBase64(wrappedKey) as Base64<Uint8Array>;
      slot.updatedAt = now() as Timestamp;
    }
    this.#vaultManifest.payload.managerOnlyMemberList = await encryptMemberList(newMemberDetails, newManagerKey);
    const collectionsPlain = this.collections$.value.map(c => c.getColMinimalRef());
    const collectionsEncrypted = await AEAD.encrypt(
      newCollectionsKey,
      toUint8Array(JSON.stringify(collectionsPlain)) as Uint8Array<ArrayBuffer>,
    );
    this.#vaultManifest.payload.collectionsEncrypted = uint8ArrayToBase64(collectionsEncrypted) as Base64Encrypted<
      CollectionMinimal[]
    >;
    this.#aeadVaultKey = await AEAD.importAEADKey(newVaultKeyRaw as RawAEADKey);
    this.#managersArea = { key: newManagerKey, memberList: newMemberDetails };
    this.#collectionsKey = newCollectionsKey;
    this.#vaultManifest.payload.keyEpoch++;
    this.#vaultManifest.payload.memberSlots = newMemberSlots;

    newVaultKeyRaw.fill(0);
  }

  // Add to Vault.ts

  async addMemberByPublicKeys(
    kemPubkeyBase64: Base64<Uint8Array>,
    dsaPubkeyBase64: Base64<Uint8Array>,
    memberName: string,
    memberRole: MemberRole,
    privateNote?: string,
  ): Promise<MemberSlot> {
    // 1. Guards
    if (!this.#isManagerMember || !this.#managersArea) {
      throw new Error('Only manager members can add members');
    }

    // check if not reserved names (worth to check if member names are unique too?)
    if (!validateAccountName(memberName)) {
      throw new Error('Invalid member name');
    }

    // 2. Derive memberId from DSA pubkey (deterministic identity)
    const dsaPubkey = base64ToUint8Array(dsaPubkeyBase64);
    const memberId = getMemberIdFromPubkey(dsaPubkey) as MemberId;

    const timestamp = now() as Timestamp;

    // 4. Build new member's slot (ciphertext/wrapped will be set by rotate)
    const newSlot: MemberSlot = {
      memberId,
      memberRole,
      memberStatus: MEMBER_STATUS.ACTIVE,
      memberKemCiphertext: '' as Base64<Uint8Array>, // placeholder
      memberVaultKeyWrapped: '' as Base64<Uint8Array>, // placeholder
      memberDsaPubkey: dsaPubkeyBase64,
      createdAt: timestamp,
      updatedAt: timestamp,
    };

    // 5. Build new member's encrypted detail
    const newDetail: MemberEncryptedDetail = {
      memberId,
      memberName,
      memberKemPubkey: kemPubkeyBase64,
      memberAddedBy: this.#activeMember.memberId,
      memberAddedAt: timestamp,
      memberPrivateNote: privateNote,
    };

    // 6. Prepare updated arrays (immutable pattern)
    const updatedSlots = [...this.#vaultManifest.payload.memberSlots, newSlot];
    const updatedDetails = [...this.#managersArea.memberList, newDetail];

    // 7. Rotate keys and rewrap for ALL members (including new one)
    await this.#rotateAndRewrapForMembers(updatedSlots, updatedDetails);

    // 8. Persist to server
    await this.#saveUpdate();

    // 9. Update reactive state
    this.members$.set([...this.#managersArea.memberList]);

    // 10. Return the now-populated slot
    return this.#vaultManifest.payload.memberSlots.find(s => s.memberId === memberId)!;
  }

  // Add to Vault.ts

  async removeMember(memberId: MemberId): Promise<boolean> {
    // 1. Guards
    if (!this.#isManagerMember || !this.#managersArea) {
      throw new Error('Only manager members can remove members');
    }
    if (memberId === this.#activeMember.memberId) {
      throw new Error('Cannot remove yourself');
    }

    // 2. Verify member exists
    const slotIdx = this.#vaultManifest.payload.memberSlots.findIndex(s => s.memberId === memberId);
    if (slotIdx === -1) throw new Error('Member not found');

    // 3. Filter out from both arrays
    const updatedSlots = this.#vaultManifest.payload.memberSlots.filter(s => s.memberId !== memberId);
    const updatedDetails = this.#managersArea.memberList.filter(d => d.memberId !== memberId);

    // 4. Rotate keys and rewrap for remaining members
    await this.#rotateAndRewrapForMembers(updatedSlots, updatedDetails);

    // 5. Persist
    await this.#saveUpdate();

    // 6. Update reactive state
    this.members$.set([...this.#managersArea.memberList]);

    return true;
  }
}
