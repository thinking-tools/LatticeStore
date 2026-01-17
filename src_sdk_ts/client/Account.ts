// import type { DataSource, UploadOptions } from './Tasker';
import type { MemberRole, MemberStatus, CollectionType } from '../shared/Consts'; // CollectionType

import { VaultController } from './Vault';
import { buildMember } from './Members';
import { createNetworkMonitor } from './NetworkUtils';
import { Tasker } from './Tasker';
import { CollectionController } from './collections/Collection';

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

  public getCollection(collectionId: string): CollectionController | null {
    return this.#accountVault.getCollectionById(collectionId);
  }

  public createNewCollection(collectionName: string, collectionType: CollectionType): void {
    this.#accountVault.createCollection(collectionName, collectionType, this.#tasker);
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
