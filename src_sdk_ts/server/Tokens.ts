import { Keyv } from 'keyv';
import { generateRandomBytes } from '../crypto/CryptoUtils';
import { uint8ArrayToHex } from '../shared/Helpers';
import {
  PERMISSIONS,
  TOKEN_EXPIRATION_MS,
  TOKEN_LENGTH_BYTES,
  TOKEN_NAMESPACE,
  REAUTH_NAMESPACE,
  TIMESTAMP_TOLERANCE_MS,
} from '../shared/Consts';

import type { VaultId, MemberId, MemberRole } from '../shared/Consts.js';
import type { KeyvStoreAdapter } from 'keyv';

const tokenKeyPrefix = (vaultId: VaultId, memberId: MemberId): string => {
  return `${vaultId}/${memberId}`;
};

const tokenValueEncodeWithRole = (role: MemberRole): string => {
  const combined = generateRandomBytes(TOKEN_LENGTH_BYTES + 1);
  combined[0] = Object.keys(PERMISSIONS).indexOf(role);
  return uint8ArrayToHex(combined);
};

const tokenValueDecodeRole = (token: string): MemberRole => {
  const byteArray = Buffer.from(token, 'hex');
  const roleIndex = byteArray[0];
  const roles = Object.keys(PERMISSIONS);
  if (!roleIndex || roleIndex < 0 || roleIndex >= roles.length) {
    throw new Error('Invalid token format: role index out of bounds');
  }
  return roles[roleIndex] as MemberRole;
};

export class Tokens {
  readonly #tokenKeyv: Keyv;
  readonly #reauthNonces: Keyv;

  constructor(keyvAdapter: KeyvStoreAdapter) {
    this.#tokenKeyv = new Keyv({
      store: keyvAdapter,
      useKeyPrefix: false,
      namespace: TOKEN_NAMESPACE,
      ttl: TOKEN_EXPIRATION_MS,
    });
    this.#reauthNonces = new Keyv({
      store: keyvAdapter,
      useKeyPrefix: false,
      namespace: REAUTH_NAMESPACE,
      ttl: TIMESTAMP_TOLERANCE_MS * 2,
    });
  }

  public async generateTokenForMemberAndVault(memberId: MemberId, vaultId: VaultId, role: MemberRole): Promise<string> {
    const token = tokenValueEncodeWithRole(role);
    await this.#tokenKeyv.set(tokenKeyPrefix(vaultId, memberId), token);
    return token;
  }

  public async regenerateToken(memberId: MemberId, vaultId: VaultId, role: MemberRole, reqId: string): Promise<string> {
    const nonceKey = `${vaultId}::${memberId}::${reqId}`;
    const existingNonce = await this.#reauthNonces.get(nonceKey);
    if (existingNonce) {
      throw new Error('Reauthentication request replay detected');
    }
    await this.#reauthNonces.set(nonceKey, 'used');
    const token = tokenValueEncodeWithRole(role);
    await this.#tokenKeyv.set(tokenKeyPrefix(vaultId, memberId), token);
    return token;
  }

  public async isValidToken(memberId: MemberId, vaultId: VaultId, providedToken: string): Promise<boolean> {
    const storedToken = await this.#tokenKeyv.get(tokenKeyPrefix(vaultId, memberId));
    return storedToken === providedToken;
  }

  // In Tokens.ts - add method
  public async validateTokenAndGetRole(
    memberId: MemberId,
    vaultId: VaultId,
    providedToken: string,
  ): Promise<MemberRole | null> {
    const storedToken = await this.#tokenKeyv.get(tokenKeyPrefix(vaultId, memberId));
    if (storedToken !== providedToken) return null;
    return tokenValueDecodeRole(storedToken);
  }

  // public async isValidTokenWriteAccess(memberId: MemberId, vaultId: VaultId, providedToken: string): Promise<boolean> {
  //   const storedToken = await this.#tokenKeyv.get(tokenKeyPrefix(vaultId, memberId));
  //   if (storedToken !== providedToken) {
  //     return false;
  //   }
  //   const role = tokenValueDecodeRole(storedToken);
  //   return PERMISSIONS[role].has('write') === true;
  // }

  // public async isValidTokenManageAccess(memberId: MemberId, vaultId: VaultId, providedToken: string): Promise<boolean> {
  //   const storedToken = await this.#tokenKeyv.get(tokenKeyPrefix(vaultId, memberId));
  //   if (storedToken !== providedToken) {
  //     return false;
  //   }
  //   const role = tokenValueDecodeRole(storedToken);
  //   return PERMISSIONS[role].has('manage') === true;
  // }

  public async revokeToken(memberId: MemberId, vaultId: VaultId): Promise<boolean> {
    return await this.#tokenKeyv.delete(tokenKeyPrefix(vaultId, memberId));
  }

  public async revokeAllTokens(): Promise<void> {
    return this.#tokenKeyv.clear();
  }

  public async revokeAllVaultTokens(vaultId: VaultId): Promise<void> {
    const results = await this.#tokenKeyv.getMany([`${vaultId}::*`]);
    for await (const { key } of results) {
      console.log(`Revoking token with key: ${key}`);
      await this.#tokenKeyv.delete(key);
    }
  }

  public async getAllTokensForVault(vaultId: VaultId): Promise<Array<{ memberId: MemberId; token: string }>> {
    const tokens: Array<{ memberId: MemberId; token: string }> = [];
    const results = await this.#tokenKeyv.getMany([`${vaultId}::*`]);
    for await (const { key, value } of results) {
      const [, memberId] = key.split('::');
      tokens.push({ memberId: memberId as MemberId, token: value as string });
    }
    return tokens;
  }
}
