import { Keyv } from 'keyv';
import { generateRandomBytes } from '../crypto/CryptoUtils';
import { uint8ArrayToHex } from '../shared/Helpers';
import { TOKEN_EXPIRATION_SECONDS, TOKEN_LENGTH_BYTES, TOKEN_NAMESPACE } from '../shared/Consts';

import type { KeyvStoreAdapter } from 'keyv';

const tokenKeyPrefix = (memberId: string, vaultId: string): string => {
  return `${memberId}::${vaultId}`;
};

export class Tokens {
  readonly #tokenKeyv: Keyv;

  constructor(keyvAdapter: KeyvStoreAdapter) {
    this.#tokenKeyv = new Keyv({
      store: keyvAdapter,
      useKeyPrefix: false,
      namespace: TOKEN_NAMESPACE,
      ttl: TOKEN_EXPIRATION_SECONDS,
    });
  }

  public async generateTokenForMemberAndVault(memberId: string, vaultId: string): Promise<string> {
    await this.revokeToken(memberId, vaultId); // Revoke any existing token
    const token = uint8ArrayToHex(generateRandomBytes(TOKEN_LENGTH_BYTES));
    await this.#tokenKeyv.set(tokenKeyPrefix(memberId, vaultId), token);
    return token;
  }

  public async isValidToken(memberId: string, vaultId: string, providedToken: string): Promise<boolean> {
    const storedToken = await this.#tokenKeyv.get(tokenKeyPrefix(memberId, vaultId));
    return storedToken === providedToken;
  }

  public async revokeToken(memberId: string, vaultId: string): Promise<boolean> {
    return await this.#tokenKeyv.delete(tokenKeyPrefix(memberId, vaultId));
  }

  public async revokeAllTokens(): Promise<void> {
    await this.#tokenKeyv.clear();
  }
}
