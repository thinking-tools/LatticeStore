// WebGrunt.ts (Worker)
/// <reference lib="webworker" />
'use strict';

import { authRequest, type CheckRequest, type CheckResponse } from './ApiClient';
import { AEAD, type RawAEADKey } from '../crypto/CryptoAEAD.js';

declare const self: DedicatedWorkerGlobalScope;

const CONCURRENT_UPLOADS = 5;
let endpoint = '';

type UploadBatchParams = {
  taskId: string;
  fileId: string;
  memberId: string;
  vaultId: string;
  authToken: string;
  encKey: RawAEADKey;
  startIndex: number;
  endIndex: number;
  totalChunks: number;
  chunkSize: number;
  source: File | Blob | ArrayBuffer;
  expectedEtag?: string;
  createOnly?: boolean;
  totalBytes: number;
};

type DownloadParams = {
  taskId: string;
  fileId: string;
  memberId: string;
  vaultId: string;
  authToken: string;
  encKey: RawAEADKey;
};

type WatchParams = {
  memberId: string;
  vaultId: string;
  authToken: string;
  files: Array<{ s3Key: string; etag: string | Function }>;
};

type ChunkResult = { chunkIndex: number; chunkKey: string; chunkEtag: string };

self.onmessage = async e => {
  const { action, ...params } = e.data;

  try {
    switch (action) {
      case 'init':
        endpoint = params.endpoint;
        self.postMessage({ type: 'init-ack', workerId: params.workerId });
        break;

      case 'watch':
        await handleWatch(params as WatchParams);
        break;

      case 'uploadBatch':
        await handleUploadBatch(params as UploadBatchParams);
        break;

      case 'download':
        await handleDownload(params as DownloadParams);
        break;
    }
  } catch (error) {
    console.error('Worker unhandled error:', error);
  }
};

const handleWatch = async (params: WatchParams) => {
  const { memberId, vaultId, authToken, files } = params;
  const url = `${endpoint}/check-updates`;
  const headers = { 'x-member-id': memberId, 'x-vault-id': vaultId };

  const checklist = files.map(f => ({
    id: f.s3Key,
    etag: typeof f.etag === 'function' ? f.etag() : f.etag,
  }));

  const response = await authRequest(url, 'POST', authToken, { checklist } as CheckRequest, headers);
  const result = (await response.json()) as CheckResponse;

  if (!result.ok) {
    if (result.code === 401) {
      self.postMessage({ type: 'auth-error', vaultId });
      return;
    }
    throw new Error(result.message || 'Check request failed');
  }

  self.postMessage({ type: 'watch', vaultId, changed: result.changed });
};

const handleDownload = async (params: DownloadParams) => {
  const { taskId, fileId, memberId, vaultId, authToken, encKey } = params;

  try {
    const aeadKey = await AEAD.importAEADKey(encKey);
    encKey.fill(0);

    const headers: Record<string, string> = {
      'x-member-id': memberId,
      'x-vault-id': vaultId,
      'x-chunk-key': fileId,
    };

    const response = await authRequest(`${endpoint}/download`, 'GET', authToken, undefined, headers);

    if (!response.ok) {
      if (response.status === 401) {
        self.postMessage({ type: 'auth-error', vaultId });
        return;
      }
      throw new Error(`Download failed: ${response.status}`);
    }
    const buffer = await response.arrayBuffer();
    const etag = response.headers.get('etag') || '';
    const encrypted = new Uint8Array(buffer);
    const decrypted = await AEAD.decrypt(aeadKey, encrypted);

    self.postMessage(
      { type: 'download-complete', taskId, etag, data: decrypted.buffer },
      [decrypted.buffer], // transfer
    );
  } catch (error) {
    self.postMessage({
      type: 'download-error',
      taskId,
      error: (error as Error).message,
    });
  }
};

const handleUploadBatch = async (params: UploadBatchParams) => {
  const {
    taskId,
    fileId,
    memberId,
    vaultId,
    authToken,
    encKey,
    startIndex,
    endIndex,
    totalChunks,
    chunkSize,
    source,
    totalBytes,
    expectedEtag,
    createOnly,
  } = params;

  const aeadKey = await AEAD.importAEADKey(encKey);
  encKey.fill(0);

  const results = new Map<number, ChunkResult>();
  let lastContiguous = startIndex - 1;
  let failed = false;
  let failError = '';

  const getChunkKey = (i: number) => (totalChunks === 1 ? fileId : `${fileId}_${i}`);

  // Generator reads chunks on-demand, minimal memory
  async function* readChunks(): AsyncGenerator<{ idx: number; data: Uint8Array }> {
    for (let i = startIndex; i <= endIndex && !failed; i++) {
      const start = i * chunkSize;
      const end = Math.min(start + chunkSize, totalBytes);
      // ArrayBuffer: view (no copy). Blob/File: unavoidable read.
      const data =
        source instanceof ArrayBuffer
          ? new Uint8Array(source, start, end - start)
          : new Uint8Array(await source.slice(start, end).arrayBuffer());
      yield { idx: i, data };
    }
  }

  const processChunk = async (idx: number, data: Uint8Array): Promise<void> => {
    if (failed) return;
    const encrypted = await AEAD.encrypt(aeadKey, data as Uint8Array<ArrayBuffer>);
    if (failed) return;

    const chunkKey = getChunkKey(idx);
    const headers: Record<string, string> = {
      'x-member-id': memberId,
      'x-vault-id': vaultId,
      'x-chunk-key': chunkKey,
      'Content-Type': 'application/octet-stream',
    };

    if (idx === startIndex) {
      if (createOnly) headers['If-None-Match'] = '*';
      else if (expectedEtag) headers['If-Match'] = expectedEtag;
    }
    const response = await authRequest(`${endpoint}/upload`, 'PUT', authToken, encrypted, headers);
    if (!response.ok) {
      failed = true;
      if (response.status === 401) {
        self.postMessage({ type: 'auth-error', vaultId });
        failError = 'Auth error';
      } else if (response.status === 412) {
        self.postMessage({
          type: 'precondition-failed',
          taskId,
          message: createOnly ? 'File already exists' : 'Etag mismatch',
        });
        failError = 'Precondition failed';
      } else {
        failError = `Upload failed: ${response.status}`;
      }
      return;
    }

    const etag = (await response.json()).etag || '';
    const result: ChunkResult = { chunkIndex: idx, chunkKey, chunkEtag: etag };
    results.set(idx, result);
    while (results.has(lastContiguous + 1)) lastContiguous++;

    self.postMessage({ type: 'chunk-progress', taskId, ...result });
  };

  try {
    const active = new Map<number, Promise<void>>();

    for await (const { idx, data } of readChunks()) {
      // Wait if at concurrency limit
      while (active.size >= CONCURRENT_UPLOADS) {
        await Promise.race(active.values());
      }
      if (failed) break;

      // Fire off encrypt+upload, don't await
      const p = processChunk(idx, data).finally(() => active.delete(idx));
      active.set(idx, p);
    }

    await Promise.all(active.values());

    const sortedResults = [...results.values()].sort((a, b) => a.chunkIndex - b.chunkIndex);

    if (failed) {
      self.postMessage({
        type: 'batch-error',
        taskId,
        startIndex,
        endIndex,
        lastCompletedIndex: lastContiguous,
        error: failError,
      });
    } else {
      self.postMessage({
        type: 'batch-complete',
        taskId,
        startIndex,
        endIndex,
        results: sortedResults,
      });
    }
  } catch (error) {
    self.postMessage({
      type: 'batch-error',
      taskId,
      startIndex,
      endIndex,
      lastCompletedIndex: lastContiguous,
      error: (error as Error).message,
    });
  }
};
