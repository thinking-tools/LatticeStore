import { S3mini } from 's3mini';
import { validateRegistrationRequest, validateLoginRequest, isValidReauthRequest } from './shared/Validators';
import { Accounts } from './server/Accounts';
import { Admin } from './server/admin/Admin';
import { Tokens } from './server/Tokens';
import { Chunks } from './server/Chunks';
import { VAULTS_NAMESPACE, CHUNKS_NAMESPACE, PERMISSIONS } from './shared/Consts';
import Keyv from 'keyv';

import type { S3Config } from 's3mini';
import type { KeyvStoreAdapter } from 'keyv';
import type {
  RegisterResponse,
  LoginRequest,
  LoginResponse,
  CheckRequest,
  CheckResponse,
  ReauthResponse,
  ReauthRequest,
  DeleteRequest,
  DeleteResponse,
} from './client/ApiClient';
import type { Vault, VaultUpdate } from './client/Vault';
import type { DownloadResult, UploadResult } from './server/Chunks';
import type { AuthResult, MemberId, VaultId } from './shared/Consts.js';
import { fromUint8Array } from './shared/Helpers';

export class LatticeStoreService {
  readonly #s3: S3mini;
  readonly #vaultRedis: Keyv;
  readonly #accounts: Accounts;
  readonly #tokens: Tokens;
  readonly #chunks: Chunks;

  constructor(S3config: S3Config, adapterFactory: () => KeyvStoreAdapter) {
    this.#s3 = new S3mini(S3config);
    this.#vaultRedis = new Keyv({
      store: adapterFactory(),
      useKeyPrefix: false,
      namespace: VAULTS_NAMESPACE,
      serialize: JSON.stringify,
      deserialize: JSON.parse,
    });
    const chunkCache = new Keyv({
      store: adapterFactory(),
      useKeyPrefix: false,
      namespace: CHUNKS_NAMESPACE,
    });
    this.#accounts = new Accounts(this.#s3, this.#vaultRedis);
    this.#tokens = new Tokens(adapterFactory());
    this.#chunks = new Chunks(this.#s3, chunkCache);
  }

  // Public API methods without authentication - registration, login, reauth
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
        statusCode: 200,
      };
    } catch (error) {
      return {
        ok: false,
        message: `Registration request failed: ${(error as Error).message}`,
        statusCode: 400,
      };
    }
  }

  public async login(body: LoginRequest): Promise<LoginResponse> {
    try {
      const [vaultManifest, etag] = await this.#accounts.getAccountVaultIdByName(body.payload.accountName);
      if (!vaultManifest || !etag) {
        throw new Error('Account does not exist! You are reported!');
      }

      const validated = await validateLoginRequest(body, vaultManifest);
      if (!validated) {
        throw new Error('Invalid login');
      }
      const memberRole = this.#accounts.getMemberRole(body.payload.memberId, vaultManifest);
      if (!memberRole) {
        throw new Error('No permissions for this member');
      }
      const token = await this.#tokens.generateTokenForMemberAndVault(
        body.payload.memberId,
        vaultManifest.payload.id,
        memberRole,
      );
      return {
        ok: true,
        accountVault: vaultManifest,
        vaultEtag: etag,
        authToken: token,
        message: 'Login successful',
        statusCode: 200,
      };
    } catch (error) {
      return {
        ok: false,
        message: `Login request failed: ${(error as Error).message}`,
        statusCode: 400,
      };
    }
  }

  public async reauth(body: ReauthRequest): Promise<ReauthResponse> {
    try {
      const vaultManifest = await this.#accounts.getAccountVaultById(body.payload.vaultId);
      if (!vaultManifest) {
        throw new Error('Vault not found');
      }
      const valid = await isValidReauthRequest(body, vaultManifest);
      if (!valid) {
        throw new Error('Invalid or expired timestamp');
      }
      const memberRole = this.#accounts.getMemberRole(body.payload.memberId, vaultManifest);
      if (!memberRole) {
        throw new Error('No permissions for this member');
      }
      const token = await this.#tokens.regenerateToken(
        body.payload.memberId,
        body.payload.vaultId,
        memberRole,
        body.payload.reqId,
      );
      return {
        ok: true,
        authToken: token,
        message: 'Reauthentication successful',
        statusCode: 200,
      };
    } catch (error) {
      return {
        ok: false,
        message: `Reauthentication request failed: ${(error as Error).message}`,
        statusCode: 400,
      };
    }
  }

  async #authenticate(headers: Headers): Promise<AuthResult> {
    const authToken = headers.get('Authorization')?.split(' ')[1];
    const memberId = headers.get('x-member-id') as MemberId;
    const vaultId = headers.get('x-vault-id') as VaultId;
    if (!authToken || !memberId || !vaultId) {
      return { ok: false, statusCode: 400, message: 'Missing required headers' };
    }
    const role = await this.#tokens.validateTokenAndGetRole(memberId, vaultId, authToken);
    if (!role) {
      return { ok: false, statusCode: 401, message: 'Invalid or expired token' };
    }
    return { ok: true, auth: { authToken, memberId, vaultId, role } };
  }

  // Public API methods authenticated via headers
  public async checkUpdates(headers: Headers, body: CheckRequest): Promise<CheckResponse> {
    try {
      const auth = await this.#authenticate(headers);
      if (!auth.ok) return { ...auth };
      const { vaultId } = auth.auth;
      return {
        ok: true,
        changed: await this.#accounts.getChanges(vaultId, body.checklist),
        message: 'Check completed successfully',
        statusCode: 200,
      };
    } catch (error) {
      return {
        ok: false,
        message: `Check request failed: ${(error as Error).message}`,
        statusCode: 400,
        changed: [],
      };
    }
  }

  public async upload(headers: Headers, body: ArrayBuffer): Promise<UploadResult> {
    const auth = await this.#authenticate(headers);
    if (!auth.ok) return { ...auth };
    const { vaultId, memberId, role } = auth.auth;
    if (!PERMISSIONS[role].has('write')) {
      return { ok: false, statusCode: 403, message: 'Insufficient permissions' };
    }
    const chunkKey = headers.get('x-chunk-key');
    const contentType = headers.get('Content-Type');
    if (!chunkKey || !contentType) {
      return { ok: false, statusCode: 400, message: 'Missing required headers' };
    }
    if (chunkKey === vaultId && contentType === 'application/json') {
      try {
        if (!PERMISSIONS[role].has('manage')) {
          return { ok: false, statusCode: 403, message: 'Manifest updates require manage permission' };
        }
        const bodyVault = JSON.parse(fromUint8Array(body as unknown as Uint8Array)) as VaultUpdate;
        const resp = await this.#accounts.updateManifest(vaultId, memberId, bodyVault);
        return resp;
      } catch {
        return { ok: false, statusCode: 400, message: 'Invalid JSON' };
      }

      // return { ok: false, statusCode: 400, message: 'Chunk key cannot be the same as vault ID' };
    }
    let resp = await this.#chunks.upload(
      vaultId,
      chunkKey,
      body as ArrayBuffer,
      headers.get('If-Match') ?? undefined,
      headers.get('If-None-Match') ?? undefined,
    );
    return resp;
  }

  public async download(headers: Headers): Promise<DownloadResult> {
    const auth = await this.#authenticate(headers);
    if (!auth.ok) return { ...auth };
    const { vaultId } = auth.auth;
    const chunkKey = headers.get('x-chunk-key');
    const resp = await this.#chunks.download(vaultId, chunkKey!);
    if (!resp) {
      return { ok: false, statusCode: 404, message: 'Chunk not found' };
    }
    return { ok: true, data: resp.data, etag: resp.etag, key: resp.key, statusCode: 200 };
  }

  public async delete(headers: Headers, body: DeleteRequest): Promise<DeleteResponse> {
    const auth = await this.#authenticate(headers);
    if (!auth.ok) return { ...auth };
    const { vaultId, role } = auth.auth;
    if (!PERMISSIONS[role].has('manage')) {
      return { ok: false, statusCode: 403, message: 'Insufficient permissions' };
    }
    if (!Array.isArray(body?.fileKeys) || !body.fileKeys.length) {
      return { ok: false, statusCode: 400, message: 'Missing keys array' };
    }

    if (body.fileKeys.includes(vaultId)) {
      if (!PERMISSIONS[role].has('delete_vault')) {
        return { ok: false, statusCode: 403, message: 'Insufficient permissions' };
      }
      // TODO: delete entire vault
      // await this.#accounts.deleteAccount(vaultId);
    }
    return this.#chunks.delete(vaultId, body.fileKeys);
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
    await this.#chunks.clearCache();
    await this.#tokens.revokeAllTokens();

    const data = (await Admin.listAccounts(this.#s3, this.#vaultRedis)) as {
      accounts: Record<string, any>[];
      allS3File: string[] | null;
    };
    return data;
  }
}
