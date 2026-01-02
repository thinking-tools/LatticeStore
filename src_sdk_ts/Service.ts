import { S3mini } from 's3mini';
import { validateRegistrationRequest, validateLoginRequest } from './Validators';
import { Accounts } from './Accounts';
import { Admin } from './admin/Admin';
import { Tokens } from './Tokens';
import { VAULTS_NAMESPACE } from './Consts';
import Keyv from 'keyv';

import type { S3Config } from 's3mini';
import type { KeyvStoreAdapter } from 'keyv';
import type { RegisterResponse, LoginRequest, LoginResponse, CheckRequest, CheckResponse } from './ApiClient';
import type { Vault } from './Vault';

export class LatticeStoreService {
  readonly #s3: S3mini;
  readonly #vaultRedis: Keyv;
  readonly #accounts: Accounts;
  readonly #tokens: Tokens;

  constructor(S3config: S3Config, adapterFactory: () => KeyvStoreAdapter) {
    this.#s3 = new S3mini(S3config);
    this.#vaultRedis = new Keyv({
      store: adapterFactory(),
      useKeyPrefix: false,
      namespace: VAULTS_NAMESPACE,
      serialize: JSON.stringify,
      deserialize: JSON.parse,
    });
    this.#accounts = new Accounts(this.#s3, this.#vaultRedis);
    this.#tokens = new Tokens(adapterFactory());
  }

  public async register(body: Vault): Promise<RegisterResponse> {
    try {
      const [validated, existingId, existingName] = await Promise.all([
        validateRegistrationRequest(body),
        this.#accounts.existingId(body.payload.id),
        this.#accounts.existingName(body.payload.name),
      ]);
      if (!validated) {
        throw new Error('Invalid registration request format');
      }
      if (existingId || existingName) {
        throw new Error('Name or ID already exists!');
      }
      return {
        ok: await this.#accounts.createAccount(body),
        message: 'Registration successful',
        code: 200,
      };
    } catch (error) {
      return {
        ok: false,
        message: `Registration request failed: ${(error as Error).message}`,
        code: 400,
      };
    }
  }

  public async login(body: LoginRequest): Promise<LoginResponse> {
    try {
      const [vaultManifest, etag] = await this.#accounts.getPersonalVaultIdByName(body.payload.accountName);
      if (!vaultManifest || !etag) {
        throw new Error('Account does not exist! You are reported!');
      }

      const validated = await validateLoginRequest(body, vaultManifest);
      if (!validated) {
        throw new Error('Invalid login');
      }
      const token = await this.#tokens.generateTokenForMemberAndVault(body.payload.memberId, vaultManifest.payload.id);
      return {
        ok: true,
        accountVault: vaultManifest,
        vaultEtag: etag,
        authToken: token,
        message: 'Login successful',
        code: 200,
      };
    } catch (error) {
      return {
        ok: false,
        message: `Login request failed: ${(error as Error).message}`,
        code: 400,
      };
    }
  }

  public async checkUpdates(headers: Headers, body: CheckRequest): Promise<CheckResponse> {
    try {
      const authTokenBearer = headers.get('Authorization') || '';
      const providedAuthToken = authTokenBearer.split(' ')[1];
      const memberId = headers.get('x-member-id');
      const vaultId = headers.get('x-vault-id');
      if (!memberId || !vaultId || !providedAuthToken) {
        throw new Error('Missing authentication headers');
      }
      const isValidToken = await this.#tokens.isValidToken(memberId, vaultId, providedAuthToken);
      if (!isValidToken) {
        return {
          ok: false,
          message: 'Invalid or expired authentication token',
          code: 401,
          changed: [],
        };
      }
      return {
        ok: true,
        changed: await this.#accounts.getChanges(vaultId, body.checklist),
        message: 'Check completed successfully',
        code: 200,
      };
    } catch (error) {
      return {
        ok: false,
        message: `Check request failed: ${(error as Error).message}`,
        code: 400,
        changed: [],
      };
    }
  }

  // // ONLY FOR DEVELOPMENT AND TESTING PURPOSES
  // public async listAll(): Promise<{ accounts: AccountData[]; allS3File: string[] | null }> {
  //   const data = (await Admin.listAccounts(this._s3, this._redisConfig)) as {
  //     accounts: AccountData[];
  //     allS3File: string[] | null;
  //   };
  //   return data;
  // }

  public async deleteAll(): Promise<{ accounts: Record<string, any>[]; allS3File: string[] | null }> {
    await Admin.deleteAll(this.#s3, this.#vaultRedis);
    const data = (await Admin.listAccounts(this.#s3, this.#vaultRedis)) as {
      accounts: Record<string, any>[];
      allS3File: string[] | null;
    };
    return data;
  }
}
