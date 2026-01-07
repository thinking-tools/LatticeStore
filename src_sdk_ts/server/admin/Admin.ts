import { S3mini } from 's3mini';
import { Keyv } from 'keyv';

interface ListObject {
  Key: string;
  Size: number;
  LastModified: Date;
  ETag: string;
  StorageClass: string;
}

// ONLY FOR DEVELOPMENT AND TESTING PURPOSES
export class Admin {
  public static async listAccounts(
    s3: S3mini,
    vaultRedis: Keyv,
  ): Promise<{ accounts: Record<string, any>[]; allS3File: string[] | null }> {
    const _accountsRedis = vaultRedis;
    console.log('_accountsRedis', _accountsRedis);
    const s3Files = (await s3.listObjects()) as string[] | null;
    const accounts: Record<string, any>[] = [];
    if (!(_accountsRedis && typeof _accountsRedis.iterator === 'function')) {
      return { accounts, allS3File: s3Files };
    }
    // @ts-ignore
    for await (const [key, value] of _accountsRedis.iterator()) {
      console.log('key', key);
      accounts.push(value as Record<string, any>);
    }
    return { accounts, allS3File: s3Files };
  }

  public static async deleteAll(s3: S3mini, vaultRedis: Keyv): Promise<void> {
    const _accountsRedis = vaultRedis;
    if (_accountsRedis && typeof _accountsRedis.clear === 'function') {
      await _accountsRedis.clear();
    }
    const allS3File = (await s3.listObjects()) as ListObject[] | null;
    if (allS3File && allS3File.length > 0) {
      // reduce allS3File to array of keys []
      await s3.deleteObjects(allS3File.map(obj => obj.Key));
    }
    return;
  }

  //   public static deleteAccount(accountId: string) {}

  //   public static deleteAllAccounts() {}
}
