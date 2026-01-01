import { createNetworkMonitor } from './NetworkUtils';
import { Tasker } from './Tasker';

import type { MemberRole, MemberStatus } from './Consts';

// import { MemberSlot } from './Members';
import { VaultController } from './Vault';
import { buildMember } from './Members';

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

  // const memberSlot = getMemberFromMemberSlots(vaultManifest.payload.memberSlots, loginPayload.memberId);

  // const unlocked = await vault.unlockMember(memberBasics);
  // if (!unlocked) {
  //   throw new Error('Failed to unlock member slot in vault');
  // }
  return new Account(serviceUrl, vault);
};

export class Account extends EventTarget {
  readonly #serviceUrl: string;
  readonly #personalVault: VaultController;
  // readonly #vaults: Map<string, VaultController> = new Map();
  readonly #tasker: Tasker;
  readonly #networkMonitor = createNetworkMonitor();

  constructor(serviceUrl: string, vault: VaultController) {
    super();
    this.#serviceUrl = serviceUrl;
    this.#tasker = new Tasker(this.#networkMonitor, serviceUrl);
    this.#personalVault = vault;
    if (this.#personalVault.isPersistent()) {
      this.#tasker.hookVault(this.#personalVault);
    }
  }

  getInfo(): any {
    return this.#personalVault.getAll();
  }

  getServiceUrl(): string {
    return this.#serviceUrl;
  }

  destroy(): void {
    this.#tasker.destroy();
    // this.#vault.destroy();
    this.#networkMonitor.destroy();
  }
}
