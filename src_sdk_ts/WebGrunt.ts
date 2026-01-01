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
        break;
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
}): Promise<string[]> => {
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
    throw new Error(response.message || 'Check request failed');
  }
  console.warn('Check changed items:', response);
  return response.changed;
};
