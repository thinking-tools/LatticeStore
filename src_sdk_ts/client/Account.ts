// import type { DataSource, UploadOptions } from './Tasker';
import type { MemberRole, MemberStatus, CollectionType, CollectionId } from '../shared/Consts'; // CollectionType

import { VaultController } from './Vault';
import { buildMember } from './Members';
import { createNetworkMonitor } from './NetworkUtils';
import { Tasker } from './Tasker';
import { CollectionContent, CollectionController } from './collections/Collection';

// import { Feature } from './features/Features';
// import type { FeatureType } from './features/Features';

export type AccountState = 'idle' | 'connecting' | 'syncing' | 'ready' | 'paused' | 'disconnected' | 'error';
// export type AccountEventMap = {
//   statechange: CustomEvent<{ state: AccountState; prev: AccountState }>;
//   sync: CustomEvent<{ accountId: string }>;
//   error: CustomEvent<{ error: Error }>;
// };

export interface MemberInfo {
  memberId: string;
  memberName: string;
  memberRole: MemberRole;
  memberStatus: MemberStatus;
  createdAt: string; // ISO date string
  updatedAt: string; // ISO date string
}

export const loginAccount = async (
  serviceUrl: string,
  accountName: string,
  memberSeed: Uint8Array,
  persistentLogin: boolean = true,
): Promise<Account | null> => {
  const memberBasics = buildMember(memberSeed);
  const vault = await VaultController.init(serviceUrl, accountName, memberBasics, persistentLogin);
  return new Account(serviceUrl, vault, persistentLogin);
};

export class Account extends EventTarget {
  readonly #serviceUrl: string;
  readonly #accountVault: VaultController;
  // readonly #vaults: Map<string, VaultController> = new Map();
  readonly #tasker: Tasker;
  readonly #networkMonitor = createNetworkMonitor();

  public get collections$() {
    return this.#accountVault.collections$;
  }
  public get devices$() {
    return this.#accountVault.members$;
  }

  public get tasks$() {
    return this.#tasker.tasks;
  }

  constructor(serviceUrl: string, vault: VaultController, keepAlive: boolean = false) {
    super();
    this.#serviceUrl = serviceUrl;
    this.#tasker = new Tasker(this.#networkMonitor, serviceUrl);
    this.#accountVault = vault;
    if (keepAlive) {
      // this.#accountVault.setPersistent(true);
      this.#tasker.hookVault(this.#accountVault);
    }
  }

  public getInfo(): any {
    return this.#accountVault.getAll();
  }

  public getServiceUrl(): string {
    return this.#serviceUrl;
  }

  public destroy(): void {
    this.#tasker.destroy();
    // this.#vault.destroy();
    this.#networkMonitor.destroy();
  }

  public isManagerMember(): boolean {
    return this.#accountVault.isManagerMember();
  }

  public listCollections(): CollectionController[] {
    return this.#accountVault.listCollections();
  }

  public listCollectionNames(): string[] {
    return this.#accountVault.listCollections().map(c => c.getName());
  }

  public listCollectionIds(): CollectionId[] {
    return this.#accountVault.listCollections().map(c => c.getId());
  }

  public async getCollection(
    collectionName: string,
    collectionType: CollectionType,
    autoCreate: boolean = false,
  ): Promise<CollectionContent | null> {
    const exists = this.collectionExists(collectionName);

    if (!exists && autoCreate) {
      return this.createNewCollection(collectionName, collectionType);
    }
    if (exists) {
      return this.#accountVault.getCollectionByName(this.#tasker, collectionName);
    }
    return null;
  }

  public async getCollectionById(collectionId: CollectionId): Promise<CollectionContent | null> {
    return this.#accountVault.getCollectionById(this.#tasker, collectionId);
  }

  public async getCollectionByName(collectionName: string): Promise<CollectionContent | null> {
    return this.#accountVault.getCollectionByName(this.#tasker, collectionName);
  }

  public collectionExists(collectionName: string): boolean {
    return this.listCollections().some(c => c.getName() === collectionName);
  }

  public async createNewCollection(collectionName: string, collectionType: CollectionType): Promise<CollectionContent> {
    return this.#accountVault.createCollection(collectionName, collectionType, this.#tasker);
  }

  public async removeCollection(collectionName: string): Promise<boolean> {
    const col = this.listCollections().find(c => c.getName() === collectionName);
    if (!col) throw new Error('Collection not found');
    return this.#accountVault.removeCollectionById(this.#tasker, col.getId());
  }

  public async renameCollection(oldName: string, newName: string): Promise<boolean> {
    const col = this.listCollections().find(c => c.getName() === oldName);
    if (!col) throw new Error('Collection not found');
    return this.#accountVault.renameCollectionById(col.getId(), newName);
  }

  // public upload(fileId: FileId, data: DataSource, encKey: RawAEADKey, options?: UploadOptions) {
  //   return this.#tasker.upload(this.#accountVault, fileId, data, encKey, options);
  // }

  // public download(fileId: FileId, encKey: RawAEADKey) {
  //   return this.#tasker.download(this.#accountVault, fileId, encKey);
  // }

  // public async addCollection(collectionName: string, collectionType: CollectionType): Promise<void> {
  //   if (!this.isManagerMember()) {
  //     throw new Error('Only manager members can add collections');
  //   }
  //   return;
  //   // const newVaultManifest = await this.#accountVault.addCollection(collectionName, collectionType);
  // }
}
