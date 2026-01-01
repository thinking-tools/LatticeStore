// File Worker - handles batch chunk uploads
const MAX_RETRIES = 3;
const RETRY_DELAYS = [500, 1000, 2000];

// Message handler
self.onmessage = async e => {
  const { action, ...params } = e.data;

  try {
    let result;
    switch (action) {
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
        console.log('Action:', action);
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
      error: error.message,
    });
  }
};

// ============= BATCH UPLOAD FUNCTIONS =============

// async function handleBatchUpload({ chunks, config }) {
//   const results = {};
//   // Process each chunk in the batch
//   for (const chunk of chunks) {
//     try {
//       const chunkBlob = chunk.file.slice(chunk.start, chunk.end);
//       const data = new Uint8Array(await chunkBlob.arrayBuffer());

//       // Encrypt if key provided
//       const processedData = await encryptData(data, chunk.keyData);

//       // Send progress update
//       self.postMessage({
//         type: 'progress',
//         fileName: chunk.fileName,
//         fileType: chunk.fileType,
//         chunkIndex: chunk.chunkIndex,
//         totalChunks: chunk.totalChunks,
//         status: 'uploading',
//       });

//       // Upload with retry logic
//       const uploadResult = await uploadWithRetry(processedData, config.endpoint, config.authToken, config.userId, {
//         fileId: chunk.fileId,
//         fileName: chunk.fileName,
//         fileType: chunk.fileType,
//         chunkIndex: chunk.chunkIndex,
//         totalChunks: chunk.totalChunks,
//       });

//       // Store result by fileId
//       if (!results[chunk.fileId]) {
//         results[chunk.fileId] = {
//           fileName: chunk.fileName,
//           fileType: chunk.fileType,
//           fileSize: chunk.fileSize,
//           totalChunks: chunk.totalChunks,
//           keyData: chunk.keyData,
//           chunks: [],
//         };
//       }
//       results[chunk.fileId].chunks[chunk.chunkIndex] = uploadResult;

//       // Send completion progress
//       self.postMessage({
//         type: 'progress',
//         fileName: chunk.fileName,
//         fileType: chunk.fileType,
//         chunkIndex: chunk.chunkIndex,
//         totalChunks: chunk.totalChunks,
//         status: 'completed',
//       });
//     } catch (error) {
//       // Store error for this chunk
//       if (!results[chunk.fileId]) {
//         results[chunk.fileId] = {
//           fileName: chunk.fileName,
//           fileType: chunk.fileType,
//           fileSize: chunk.fileSize,
//           totalChunks: chunk.totalChunks,
//           chunks: [],
//           errors: [],
//         };
//       }
//       if (!results[chunk.fileId].errors) results[chunk.fileId].errors = [];
//       results[chunk.fileId].errors.push({
//         chunkIndex: chunk.chunkIndex,
//         error: error.message,
//       });

//       self.postMessage({
//         type: 'progress',
//         fileName: chunk.fileName,
//         fileType: chunk.fileType,
//         chunkIndex: chunk.chunkIndex,
//         totalChunks: chunk.totalChunks,
//         status: 'failed',
//         error: error.message,
//       });
//     }
//   }

//   return results;
// }

// async function uploadWithRetry(data, endpoint, authToken, userId, metadata) {
//   for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
//     try {
//       const fileName =
//         typeof metadata.chunkIndex === 'undefined' ? metadata.fileId : `${metadata.fileId}_${metadata.chunkIndex}`;

//       const headers = {
//         Authorization: `Bearer ${authToken}`,
//         'X-User-Id': userId,
//         'Content-Type': 'application/octet-stream',
//         'Content-Disposition': `attachment; filename="${fileName}"`,
//       };

//       // Add If-Match header if etag exists
//       if (metadata.etag) {
//         headers['If-Match'] = metadata.etag;
//       }
//       const response = await fetch(`${endpoint}/upload`, {
//         method: 'POST',
//         headers,
//         body: data,
//       });

//       if (!response.ok) {
//         if (response.status === 401) {
//           throw new Error(`Upload failed: ${response.status} - Unauthorized`);
//         }
//         throw new Error(`Upload failed: ${response.status}`);
//       }

//       const result = await response.json();
//       return {
//         fileId: metadata.fileId,
//         chunkIndex: metadata.chunkIndex,
//         size: data.byteLength,
//         ok: true,
//         message: 'Chunk uploaded successfully',
//         newEtag: result.newEtag,
//         bytesUsed: result.newBytesUsed,
//         bytesLimit: result.bytesLimit,
//         percentageUsed: result.newPercentageUsed,
//         remainingBytes: result.newRemainingBytes,
//         limited: result.limited,
//       };
//     } catch (error) {
//       if (attempt < MAX_RETRIES - 1) {
//         await new Promise(r => setTimeout(r, RETRY_DELAYS[attempt]));
//       } else {
//         throw error;
//       }
//     }
//   }
// }

// async function handleSingleUpload({ data, keyData, config, metadata }) {
//   // Convert Map to Uint8Array if needed
//   const uint8Data = data instanceof Uint8Array ? data : new TextEncoder().encode(JSON.stringify([...data]));

//   // Encrypt
//   const encrypted = keyData ? await encryptData(uint8Data, keyData) : uint8Data;

//   // Upload using existing function
//   const result = await uploadWithRetry(encrypted, config.endpoint, config.authToken, config.userId, {
//     fileId: metadata.fileId,
//     fileName: metadata.fileName,
//     etag: metadata.etag,
//   });

//   return { ...result, encrypted: !!keyData };
// }

// // ============= DOWNLOAD FUNCTIONS =============

// async function handleDownload({ fileId, endpoint, authToken, userId, decryptionKey }) {
//   const { data, etag } = await downloadWithRetry(fileId, endpoint, authToken, userId);
//   const processedData = decryptionKey ? await decryptData(data, decryptionKey) : data;
//   const blob = new Blob([processedData]);

//   return {
//     blob,
//     size: processedData.byteLength,
//     decrypted: !!decryptionKey,
//     etag: etag,
//   };
// }

// async function downloadWithRetry(fileId, endpoint, authToken, userId) {
//   for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
//     try {
//       const response = await fetch(`${endpoint}/download/${fileId}`, {
//         method: 'GET',
//         headers: {
//           Authorization: `Bearer ${authToken}`,
//           'X-User-Id': userId,
//         },
//       });

//       if (!response.ok) {
//         throw new Error(`Download failed: ${response.status}`);
//       }

//       const arrayBuffer = await response.arrayBuffer();
//       return { data: new Uint8Array(arrayBuffer), etag: response.headers.get('ETag') };
//     } catch (error) {
//       if (attempt < MAX_RETRIES - 1) {
//         await new Promise(r => setTimeout(r, RETRY_DELAYS[attempt]));
//       } else {
//         throw error;
//       }
//     }
//   }
// }

// // ============= ENCRYPTION FUNCTIONS =============

// async function importKey(keyData) {
//   if (typeof keyData === 'string') {
//     const encoder = new TextEncoder();
//     const keyBuffer = await crypto.subtle.digest('SHA-256', encoder.encode(keyData));
//     return await crypto.subtle.importKey('raw', keyBuffer, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
//   }
//   return await crypto.subtle.importKey('raw', keyData, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
// }

// async function encryptData(data, key) {
//   const cryptoKey = await importKey(key);
//   const iv = crypto.getRandomValues(new Uint8Array(12));
//   const encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, cryptoKey, data);

//   const result = new Uint8Array(iv.length + encrypted.byteLength);
//   result.set(iv);
//   result.set(new Uint8Array(encrypted), iv.length);
//   return result;
// }

// async function decryptData(data, key) {
//   const cryptoKey = await importKey(key);
//   const iv = data.slice(0, 12);
//   const encrypted = data.slice(12);
//   const decrypted = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, cryptoKey, encrypted);
//   return new Uint8Array(decrypted);
// }
