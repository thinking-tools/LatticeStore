// server/Chunks.ts
import { S3mini, sanitizeETag } from 's3mini';
import { Keyv } from 'keyv';
import { CHUNK_TTL_SECONDS } from '../shared/Consts.js';
import { DeleteResponse } from '../client/ApiClient.js';

export type UploadResult = {
  ok: boolean;
  etag?: string;
  statusCode: number;
  message?: string;
};

export type DownloadResult = {
  ok: boolean;
  data?: ArrayBuffer;
  key?: string;
  etag?: string;
  statusCode: number;
  message?: string;
};

export class Chunks {
  readonly #s3: S3mini;
  readonly #cache: Keyv;

  constructor(s3: S3mini, cache: Keyv) {
    this.#s3 = s3;
    this.#cache = cache;
  }

  async upload(
    vaultId: string,
    chunkKey: string,
    data: ArrayBuffer | Uint8Array,
    ifMatch?: string,
    ifNoneMatch?: string,
  ): Promise<UploadResult> {
    const s3Key = `${vaultId}/${chunkKey}`;
    const cacheKey = `${vaultId}::${chunkKey}::etag`;

    // Only fetch etag if preconditions exist
    if (ifMatch || ifNoneMatch) {
      const currentEtag = await this.#getEtag(vaultId, chunkKey);
      if (ifNoneMatch === '*' && currentEtag) {
        return { ok: false, statusCode: 412, message: 'Object already exists' };
      }
      if (ifMatch && currentEtag !== ifMatch) {
        return { ok: false, statusCode: 412, message: 'ETag mismatch' };
      }
    }
    const s3response = await this.#s3.putObject(s3Key, data, 'application/octet-stream');
    if (!s3response.ok) {
      return { ok: false, statusCode: s3response.status, message: 'S3 upload failed' };
    }
    let rawEtag = s3response.headers.get('etag');
    if (!rawEtag) {
      rawEtag = await this.#s3.getEtag(s3Key);
      if (!rawEtag) {
        return { ok: false, statusCode: 500, message: 'Failed to retrieve ETag after upload' };
      }
    }
    const etag = sanitizeETag(rawEtag);
    // console.log('Storing etag in cache:', cacheKey, etag);
    await this.#cache.set(cacheKey, etag, CHUNK_TTL_SECONDS * 1000);

    return { ok: true, etag, statusCode: 200 };
  }

  async download(vaultId: string, chunkKey: string): Promise<{ data: ArrayBuffer; etag: string; key: string } | null> {
    const s3Key = `${vaultId}/${chunkKey}`;
    const cacheKey = `${vaultId}::${chunkKey}::etag`;
    const response = await this.#s3.getObjectResponse(s3Key);
    if (!response) return null;

    const etag = sanitizeETag(response.headers.get('etag') ?? '');
    await this.#cache.set(cacheKey, etag, CHUNK_TTL_SECONDS * 1000);
    const data = await response.arrayBuffer();
    return { data, etag, key: chunkKey };
  }

  async delete(vaultId: string, chunkKeys: string[]): Promise<DeleteResponse> {
    if (!chunkKeys?.length) {
      return { ok: true, statusCode: 200, deleted: [], message: 'No chunks to delete' };
    }
    try {
      const [s3Results] = await Promise.all([
        this.#s3.deleteObjects(chunkKeys.map(k => `${vaultId}/${k}`)),
        this.#cache.deleteMany(chunkKeys.map(k => `${vaultId}::${k}::etag`)),
      ]);

      const deleted = chunkKeys.filter((_, i) => s3Results[i]);
      const failed = chunkKeys.filter((_, i) => !s3Results[i]).map(key => ({ key, error: 'S3 deletion failed' }));

      if (!deleted.length && failed.length) {
        return { ok: false, statusCode: 500, deleted: [], failed, message: 'Deletions failed' };
      }

      return {
        ok: true,
        statusCode: failed.length ? 207 : 200, // 207 Multi-Status for partial success
        message: 'Deletion completed, results may vary',
        deleted,
        ...(failed.length ? { failed } : {}),
      };
    } catch (err) {
      return { ok: false, statusCode: 500, message: (err as Error).message };
    }
  }

  async #getEtag(vaultId: string, chunkKey: string): Promise<string | null> {
    const cacheKey = `${vaultId}::${chunkKey}::etag`;
    const cached = await this.#cache.get(cacheKey);
    if (cached) return cached;

    const s3Key = `${vaultId}/${chunkKey}`;
    const etag = await this.#s3.getEtag(s3Key);
    if (etag) {
      await this.#cache.set(cacheKey, etag, CHUNK_TTL_SECONDS * 1000);
    }
    return etag;
  }

  async getChunk(vaultId: string, chunkKey: string): Promise<{ data: ArrayBuffer; etag: string } | null> {
    const s3Key = `${vaultId}/${chunkKey}`;
    const response = await this.#s3.getObjectResponse(s3Key);
    if (!response) return null;

    const etag = sanitizeETag(response.headers.get('etag') ?? '');
    const data = await response.arrayBuffer();
    return { data, etag };
  }

  async clearCache(): Promise<void> {
    await this.#cache.clear();
  }

  // TODO: implement chunk deletion if needed
  //   async deleteChunks(vaultId: string, prefix: string): Promise<number> {
  //     const keys = await this.#s3.listObjects({ prefix: `${vaultId}/${prefix}` });
  //     if (!keys?.length) return 0;

  //     await Promise.all(keys.map(k => this.#s3.deleteObject(k.key)));
  //     return keys.length;
  //   }
}
