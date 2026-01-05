import { S3mini, sanitizeETag, runInBatches } from 's3mini';
import { Keyv } from 'keyv';
import { NAME_MAPPING, ETAG_TTL_SECONDS } from './Consts';
import { VAULT_TYPE } from './Consts';

import type { Vault } from './Vault';
import { checkListItem } from './ApiClient';

const _s3manifestKey = (vaultId: string) => `${vaultId}/${vaultId}-manifest.json`;
const _redisManifestKey = (vaultId: string) => `${vaultId}::manifest`;
const _redisManifestEtagKey = (vaultId: string) => `${vaultId}::manifest::etag`;
const _redisNameMappingKey = (vaultName: string) => `${NAME_MAPPING}::${vaultName}`;

export class Accounts {
  readonly #s3: S3mini;
  readonly #vaultRedis: Keyv;
  constructor(s3: S3mini, vaultRedis: Keyv) {
    this.#s3 = s3;
    this.#vaultRedis = vaultRedis;
  }

  public async existingId(vaultId: string): Promise<boolean> {
    const [cached, manifest] = await Promise.all([
      this.#vaultRedis.get(_redisManifestKey(vaultId)),
      this.#s3.getObject(_s3manifestKey(vaultId)),
    ]);
    const inRedis = cached !== undefined;
    const inS3 = manifest !== null;
    if (inS3 && !inRedis) {
      this.#vaultRedis.set(_redisManifestKey(vaultId), manifest);
    }
    if (inRedis && !inS3) {
      throw new Error(`Inconsistent state: vault ${vaultId} exists in Redis but not in S3 storage! Call the police!`);
    }

    return inRedis || inS3;
  }

  public async existingName(vaultName: string): Promise<boolean> {
    const cached = await this.#vaultRedis.get(_redisNameMappingKey(vaultName));
    return cached !== undefined;
  }

  public async getIdByName(vaultName: string): Promise<string | null> {
    const cached: string | undefined = await this.#vaultRedis.get(_redisNameMappingKey(vaultName));
    if (cached !== undefined) {
      return cached;
    }
    return null;
  }

  public async getAccountVaultIdByName(vaultName: string): Promise<[Vault | null, string | null]> {
    const cached = await this.#vaultRedis.get(_redisNameMappingKey(vaultName));
    if (cached !== undefined) {
      const [vault, etag] = await Promise.all([
        this.#vaultRedis.get(_redisManifestKey(cached)),
        this.#vaultRedis.get(_redisManifestEtagKey(cached)),
      ]);
      if (vault && vault.payload.type === VAULT_TYPE.account && etag) {
        return [vault, etag];
      } else {
        // s3 fallback
        const s3Object = await this.#s3.getObjectResponse(_s3manifestKey(cached));
        if (s3Object) {
          const etag = sanitizeETag(s3Object.headers.get('etag') as string);
          const s3vault: Vault = await s3Object.json();
          if (s3vault.payload.type === VAULT_TYPE.account) {
            await Promise.all([
              this.#vaultRedis.set(_redisManifestKey(cached), s3vault),
              this.#vaultRedis.set(_redisManifestEtagKey(cached), etag),
              this.#vaultRedis.set(_redisNameMappingKey(vaultName), cached),
            ]);
            return [s3vault, etag];
          }
        }
      }
    }
    return [null, null];
  }

  public async createAccount(body: Vault): Promise<boolean> {
    try {
      const manifestKey = _s3manifestKey(body.payload.id);
      const redisManifestKey = _redisManifestKey(body.payload.id);
      const redisNameMappingKey = _redisNameMappingKey(body.payload.name);
      const [s3PutResult] = await Promise.all([
        this.#s3.putObject(manifestKey, JSON.stringify(body)),
        this.#vaultRedis.set(redisManifestKey, body),
        this.#vaultRedis.set(redisNameMappingKey, body.payload.id),
      ]);
      console.log(`Account ${body.payload.id} with name ${body.payload.name} created successfully`, s3PutResult);
      return s3PutResult.status === 200;
    } catch (error) {
      throw new Error(`Failed to create account ${body.payload.id}: ${(error as Error).message}`);
    }
  }

  public async getChanges(vaultId: string, changeList: checkListItem[]): Promise<string[]> {
    const changedIds: string[] = [];

    const tasks = changeList.map(({ id, etag }) => async () => {
      const isManifest = vaultId === id;
      const redisKey = isManifest ? _redisManifestEtagKey(vaultId) : `${vaultId}::${id}::etag`;

      // Fast path: Redis hit
      const cachedEtag = await this.#vaultRedis.get(redisKey);
      if (cachedEtag) {
        if (cachedEtag !== etag) changedIds.push(id);
        return;
      }

      // Slow path: Redis miss → S3 fallback
      const s3Etag = await this.#s3.getEtag(isManifest ? _s3manifestKey(vaultId) : `${vaultId}/${id}`);

      if (!s3Etag || s3Etag !== etag) {
        changedIds.push(id);
      }

      // Populate cache on S3 hit (non-manifest only)
      if (s3Etag && !isManifest) {
        await this.#vaultRedis.set(redisKey, s3Etag, ETAG_TTL_SECONDS);
      }
    });

    if (tasks.length > 200) {
      await runInBatches(tasks, 100, 1_000);
    } else {
      await Promise.all(tasks.map(task => task()));
    }

    return changedIds;
  }

  // public async create(accountData: AccountData, envelopes: DeviceEnvelope[], deviceListFile: string): Promise<boolean> {
  //   try {
  //     // on account create, we need to store:
  //     // 1. account data (account informations) in redis and s3
  //     // 2. username to accountId mapping in redis and s3
  //     // 3. deviceId to accountId mapping in redis and s3
  //     // 4. each device envelope in redis and s3, with deviceListBase64 included
  //     const ops = [
  //       this._accountsRedis.set(accountData.accountId, accountData),
  //       this._s3.putObject(_getAccountInfoS3Key(accountData.accountId), JSON.stringify(accountData)),
  //       this._accountsRedis.set(_usernameToAccountId(accountData.username), accountData.accountId),
  //       this._s3.putObject(_usernameToAccountIdS3Key(accountData.username), accountData.accountId),
  //     ];
  //     for (const envelope of envelopes) {
  //       const extendedEnvelope = {
  //         ...envelope,
  //         deviceListBase64: deviceListFile,
  //       };
  //       ops.push(
  //         this._s3.putObject(
  //           _getDeviceEnvelopeS3Key(accountData.accountId, envelope.deviceId),
  //           JSON.stringify(extendedEnvelope),
  //         ),
  //       );
  //       ops.push(
  //         this._devicesRedis.set(
  //           _getDeviceEnvelopeRedisKey(accountData.accountId, envelope.deviceId),
  //           extendedEnvelope,
  //         ),
  //       );
  //       ops.push(this._devicesRedis.set(_deviceIdToAccountId(envelope.deviceId), accountData.accountId));
  //       ops.push(this._s3.putObject(_deviceIdToAccountIdS3Key(envelope.deviceId), accountData.accountId));
  //     }
  //     await Promise.all(ops);
  //     console.log(`Account ${accountData.accountId} created successfully`, ops.length);
  //     return true;
  //   } catch (error) {
  //     throw new Error(`Failed to create account ${accountData.accountId}: ${(error as Error).message}`);
  //   }
  // }

  // // public async getAccountIdByUsername(username: string): Promise<string | null> {
  // //   const accountId = await this._accountsRedis.get(_usernameToAccountId(username));
  // //   if (accountId !== undefined) {
  // //     return accountId;
  // //   }
  // //   // Fallback to S3 check
  // //   try {
  // //     const accountId = _usernameToAccountIdS3Key(username);
  // //     if (accountId !== undefined || accountId !== null) {
  // //       return accountId;
  // //     }
  // //   } catch (error) {
  // //     return null;
  // //   }
  // //   return null;
  // // }

  // // public async getAccountIdByDeviceId(deviceId: string): Promise<string | null> {
  // //   const accountId = await this._devicesRedis.get(_deviceIdToAccountId(deviceId));
  // //   if (accountId !== undefined) {
  // //     return accountId;
  // //   }
  // //   // Fallback to S3 check
  // //   try {
  // //     const accountId = _deviceIdToAccountIdS3Key(deviceId);
  // //     if (accountId !== undefined || accountId !== null) {
  // //       this._devicesRedis.set(_deviceIdToAccountId(deviceId), accountId);
  // //       return accountId;
  // //     }
  // //   } catch (error) {
  // //     return null;
  // //   }
  // //   return null;
  // // }

  // public async getAccountByUsernamePlusDeviceId(
  //   username: string,
  //   deviceId: string,
  // ): Promise<{ accountId: string | null; deviceEnvelope: ExtendedDeviceEnvelope | null }> {
  //   let accountId = await this._accountsRedis.get(_usernameToAccountId(username));
  //   if (!accountId) {
  //     accountId = _usernameToAccountIdS3Key(username);
  //     if (accountId !== undefined || accountId !== null) {
  //       this._devicesRedis.set(_deviceIdToAccountId(deviceId), accountId);
  //       return accountId;
  //     } else {
  //       return { accountId: null, deviceEnvelope: null };
  //     }
  //   }
  //   const deviceEnvelope = await this.getDeviceEnvelope(accountId, deviceId);
  //   if (!deviceEnvelope) {
  //     return { accountId: null, deviceEnvelope: null };
  //   }
  //   return { accountId, deviceEnvelope };
  // }

  // public async getDeviceEnvelope(accountId: string, deviceId: string): Promise<ExtendedDeviceEnvelope | null> {
  //   const envelope: ExtendedDeviceEnvelope | undefined = await this._devicesRedis.get(
  //     _getDeviceEnvelopeRedisKey(accountId, deviceId),
  //   );
  //   if (envelope !== undefined) {
  //     return envelope;
  //   }
  //   // Fallback to S3 check
  //   try {
  //     const key = _getDeviceEnvelopeS3Key(accountId, deviceId);
  //     const s3Object = await this._s3.getObject(key);
  //     if (s3Object) {
  //       return JSON.parse(s3Object);
  //     }
  //   } catch (error) {
  //     return null;
  //   }
  //   return null;
  // }

  // public async getDevicePublicKey(accountId: string, deviceId: string): Promise<string | null> {
  //   const envelope: DeviceEnvelope | undefined = await this._devicesRedis.get(
  //     _getDeviceEnvelopeRedisKey(accountId, deviceId),
  //   );
  //   if (envelope !== undefined) {
  //     return envelope.dsaPublicKeyBase64;
  //   }
  //   // Fallback to S3 check
  //   try {
  //     const key = _getDeviceEnvelopeS3Key(accountId, deviceId);
  //     const s3Object = await this._s3.getObject(key);
  //     if (s3Object) {
  //       const envelope: DeviceEnvelope = JSON.parse(s3Object);
  //       return envelope.dsaPublicKeyBase64;
  //     }
  //   } catch (error) {
  //     return null;
  //   }
  //   return null;
  // }

  // public async getAccountData(accountId: string): Promise<AccountData | null> {
  //   const accountData: AccountData | undefined = await this._accountsRedis.get(accountId);
  //   if (accountData !== undefined) {
  //     return accountData;
  //   }
  //   // Fallback to S3 check
  //   try {
  //     const key = _getAccountInfoS3Key(accountId);
  //     const s3Object = await this._s3.getObject(key);
  //     if (s3Object) {
  //       return JSON.parse(s3Object);
  //     }
  //   } catch (error) {
  //     return null;
  //   }
  //   return null;
  // }

  // public async getFeaturesList(accountId: string): Promise<string | null> {
  //   const featuresList: string | undefined = await this._accountsRedis.get(_accountFeaturesListRedisKey(accountId));
  //   if (featuresList !== undefined) {
  //     return featuresList;
  //   }
  //   try {
  //     const key = _accountFeaturesListS3Key(accountId);
  //     const s3Object = await this._s3.getObject(key);
  //     if (s3Object) {
  //       return s3Object;
  //     }
  //   } catch (error) {
  //     return null;
  //   }
  //   return null;
  // }
}
