/// <reference lib="webworker" />
'use strict';

import { authRequest, type CheckRequest, type CheckResponse } from './ApiClient';

declare const self: DedicatedWorkerGlobalScope;

let endpoint = '';

self.onmessage = async e => {
  const { action, ...params } = e.data;

  try {
    let result;
    switch (action) {
      case 'init':
        endpoint = params.endpoint;
        self.postMessage({ type: 'init-ack' });
        break;
      case 'watch':
        result = await handleWatchCheck(params);
        if (result.authError) {
          self.postMessage({ type: 'auth-error', vaultId: params.vaultId });
        } else {
          self.postMessage({ type: 'watch', vaultId: params.vaultId, changed: result.changed });
        }
        break;
      // case 'update-token':
      //   // Workers don't cache tokens - they receive fresh ones each tick
      //   self.postMessage({ type: 'token-updated' });
      //   break;
      // case 'uploadBatch':
      //   result = await handleBatchUpload(params);
      //   break;
      // case 'uploadSingle':
      //   result = await handleSingleUpload(params);
      //   break;
      // case 'download':
      //   result = await handleDownload(params);
      //   break;
      default:
        console.log('Action:', action, ' paramas : ', params);
    }

    self.postMessage({
      type: 'complete',
      success: true,
      data: result,
    });
  } catch (error) {
    self.postMessage({
      type: 'error',
      success: false,
      error: (error as Error).message || 'Unknown error',
    });
  }
};

const handleWatchCheck = async (params: {
  memberId: string;
  vaultId: string;
  authToken: string;
  files: Array<{ id: string; etag: string }>;
}): Promise<{ changed: string[]; authError?: boolean }> => {
  // const results = [] as string[];
  const { memberId, vaultId, authToken, files } = params;
  const url = `${endpoint}/check-updates`;
  const headers = {
    'x-member-id': memberId,
    'x-vault-id': vaultId,
  };
  const request = await authRequest(url, 'POST', authToken, { checklist: files } as CheckRequest, headers);
  const response = (await request.json()) as CheckResponse;
  if (!response.ok) {
    const isAuthError = response.code === 401;
    if (isAuthError) {
      return { changed: [], authError: true };
    }
    throw new Error(response.message || 'Check request failed');
  }
  console.warn('Check changed items:', response);
  return { changed: response.changed, authError: false };
};
