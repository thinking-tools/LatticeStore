// server/Chunks.ts
import { S3mini, sanitizeETag } from 's3mini';
import { Keyv } from 'keyv';
import { CHUNK_TTL_SECONDS } from '../shared/Consts.js';

export type UploadResult = {
  ok: boolean;
  etag?: string;
  status: number;
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

    // Precondition checks
    if (ifMatch || ifNoneMatch) {
      const currentEtag = await this.#getEtag(vaultId, chunkKey);

      if (ifNoneMatch === '*' && currentEtag) {
        return { ok: false, status: 412, message: 'Object already exists' };
      }

      if (ifMatch && currentEtag && currentEtag !== ifMatch) {
        return { ok: false, status: 412, message: 'ETag mismatch' };
      }
    }
    const buffer = Buffer.from(data instanceof ArrayBuffer ? new Uint8Array(data) : data);
    const s3response = await this.#s3.putObject(s3Key, buffer, 'application/octet-stream');
    if (!s3response.ok) {
      return { ok: false, status: s3response.status, message: 'S3 upload failed' };
    }

    const etag = sanitizeETag(s3response.headers.get('etag') ?? '');
    // console.log('Storing etag in cache:', cacheKey, etag);
    await this.#cache.set(cacheKey, etag, CHUNK_TTL_SECONDS * 1000);

    return { ok: true, etag, status: 200 };
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

  // TODO: implement chunk deletion if needed
  //   async deleteChunks(vaultId: string, prefix: string): Promise<number> {
  //     const keys = await this.#s3.listObjects({ prefix: `${vaultId}/${prefix}` });
  //     if (!keys?.length) return 0;

  //     await Promise.all(keys.map(k => this.#s3.deleteObject(k.key)));
  //     return keys.length;
  //   }
}
