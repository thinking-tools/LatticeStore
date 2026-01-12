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
  s3KeyPrefix: string;
  encKey: RawAEADKey;
  startIndex: number;
  endIndex: number;
  chunkSize: number;
  source: File | Blob | ArrayBuffer;
  expectedEtag?: string;
  createOnly?: boolean;
  totalBytes: number;
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

const handleUploadBatch = async (params: UploadBatchParams) => {
  const {
    taskId,
    fileId,
    memberId,
    vaultId,
    authToken,
    s3KeyPrefix,
    encKey,
    startIndex,
    endIndex,
    chunkSize,
    source,
    totalBytes,
    expectedEtag,
    createOnly,
  } = params;

  const aeadKey = await AEAD.importAEADKey(encKey);
  const results: ChunkResult[] = [];
  const inFlight = new Map<number, Promise<void>>();
  let lastCompletedIndex = startIndex - 1;
  let failed = false;
  let failError = '';
  console.log(`Worker upload batch: ${fileId} [${startIndex}-${endIndex}]`);

  const upload = async (i: number, encrypted: Uint8Array) => {
    if (failed) return;

    const chunkKey = `${s3KeyPrefix}_${i}`;
    const headers: Record<string, string> = {
      'x-member-id': memberId,
      'x-vault-id': vaultId,
      'x-chunk-key': chunkKey,
      'Content-Type': 'application/octet-stream',
    };

    if (i === startIndex) {
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
    const result = { chunkIndex: i, chunkKey, chunkEtag: etag };
    results.push(result);
    lastCompletedIndex = Math.max(lastCompletedIndex, i);
    self.postMessage({ type: 'chunk-progress', taskId, ...result });
  };

  try {
    for (let i = startIndex; i <= endIndex && !failed; i++) {
      // Sequential encryption (avoids WebCrypto contention)
      const start = i * chunkSize;
      const end = Math.min(start + chunkSize, totalBytes);
      const blob = source instanceof ArrayBuffer ? new Blob([source.slice(start, end)]) : source.slice(start, end);
      const chunkData = new Uint8Array(await blob.arrayBuffer());
      const encrypted = await AEAD.encrypt(aeadKey, chunkData);

      // Throttle: wait if too many in flight
      while (inFlight.size >= CONCURRENT_UPLOADS) {
        await Promise.race(inFlight.values());
      }

      if (failed) break;

      // Fire upload, don't await
      const p = upload(i, encrypted).finally(() => inFlight.delete(i));
      inFlight.set(i, p);
    }

    // Drain remaining
    await Promise.all(inFlight.values());

    if (failed) {
      self.postMessage({
        type: 'batch-error',
        taskId,
        startIndex,
        endIndex,
        lastCompletedIndex,
        error: failError,
      });
      return;
    }

    self.postMessage({
      type: 'batch-complete',
      taskId,
      startIndex,
      endIndex,
      results: results.sort((a, b) => a.chunkIndex - b.chunkIndex),
    });
  } catch (error) {
    self.postMessage({
      type: 'batch-error',
      taskId,
      startIndex,
      endIndex,
      lastCompletedIndex,
      error: (error as Error).message,
    });
  }
};
