// WebGrunt.ts (Worker)
/// <reference lib="webworker" />
'use strict';

import { authRequest, type CheckRequest, type CheckResponse } from './ApiClient';
import { AEAD, type RawAEADKey } from '../crypto/CryptoAEAD.js';

declare const self: DedicatedWorkerGlobalScope;

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
  data: ArrayBuffer;
  expectedEtag?: string;
  createOnly?: boolean;
};

type WatchParams = {
  memberId: string;
  vaultId: string;
  authToken: string;
  files: Array<{ s3Key: string; etag: string | Function }>;
};

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
    data,
    expectedEtag,
    createOnly,
  } = params;
  console.log(`Worker upload batch for file ${fileId}: chunks ${startIndex} to ${endIndex} fileid ${fileId}`);
  let aeadKey = await AEAD.importAEADKey(encKey);
  let results: Array<{ chunkIndex: number; chunkKey: string; chunkEtag: string }> = [];
  let lastCompletedIndex = startIndex - 1;

  try {
    for (let i = startIndex; i <= endIndex; i++) {
      const localOffset = (i - startIndex) * chunkSize;
      const localEnd = Math.min(localOffset + chunkSize, data.byteLength);
      const chunkData = new Uint8Array(data.slice(localOffset, localEnd));

      const encrypted = await AEAD.encrypt(aeadKey, chunkData);

      const chunkKey = `${s3KeyPrefix}_${i}`;
      const url = `${endpoint}/upload`;
      const headers: Record<string, string> = {
        'x-member-id': memberId,
        'x-vault-id': vaultId,
        'x-chunk-key': chunkKey,
        'Content-Type': 'application/octet-stream',
      };

      if (i === startIndex) {
        if (createOnly) {
          headers['If-None-Match'] = '*';
        } else if (expectedEtag) {
          headers['If-Match'] = expectedEtag;
        }
      }

      const response = await authRequest(url, 'PUT', authToken, encrypted, headers);

      if (!response.ok) {
        if (response.status === 401) {
          self.postMessage({ type: 'auth-error', vaultId });
          throw new Error('Auth error');
        }

        if (response.status === 412) {
          self.postMessage({
            type: 'precondition-failed',
            taskId,
            message: createOnly ? 'File already exists' : 'File was modified (etag mismatch)',
          });
          return;
        }

        throw new Error(`Upload failed: ${response.status}`);
      }

      const etag = (await response.json()).etag || '';

      const result = { chunkIndex: i, chunkKey, chunkEtag: etag };
      results.push(result);
      lastCompletedIndex = i;

      self.postMessage({ type: 'chunk-progress', taskId, ...result });
    }

    self.postMessage({
      type: 'batch-complete',
      taskId,
      startIndex,
      endIndex,
      results,
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
