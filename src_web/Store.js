import { sha256, encryptData } from './crypto.js';
import { uploadWithSharedQueue, downloadAndDecryptFile } from './helpers.js';
import { userLogin, userRegister, userLogout } from './user.js';
import { VirtualFileSystem } from './VFS.js';

const workerCount = navigator.hardwareConcurrency > 2 ? 2 : 1 || 1;
const CHUNK_SIZE = 8 * 1024 * 1024; // 8MB chunks
const RANDOM_WANNBE_SALT = 'fpNAqmCqJ23ggq6B2G9Dw1srlKZprhg3';

/**
 * LatStore class with integrated VirtualFileSystem for optimal performance
 * Handles user authentication and efficient file operations
 */
class Store {
  constructor() {
    // User session state
    this.deviceName = null;
    this.userId = null;
    this.email = null;
    this.authToken = null;
    this.isLoggedIn = false;
    this.masterKey = null;
    this.password = null;
    this.endpoint = null;

    // File system state
    this.vfs = new VirtualFileSystem();
    this.rootFileEtag = null;

    // Worker management
    this.workers = Array.from({ length: workerCount }, () => new Worker('public/worker.js'));
    this.abortController = null;
    this.listener = null;
  }

  /**
   * Register a new user account
   */
  async register(username, deviceName, password, endpoint) {
    try {
      // Create empty VFS structure
      // const emptyVfs = { nodes: {} };
      const uint8 = new TextEncoder().encode(JSON.stringify(emptyVfs));

      const [userId, filePwd, filePwdAB] = await Promise.all([
        sha256(username, 'hex'),
        sha256(password, 'hex'),
        sha256(password, 'arraybuffer'),
      ]);

      const keyBuffer = await crypto.subtle.digest('SHA-256', filePwdAB);
      const encryptedRootFile = await encryptData(uint8, keyBuffer);
      const userPasswordHash = await sha256(filePwd + RANDOM_WANNBE_SALT, 'hex');

      const registerResp = await userRegister(
        userId,
        userPasswordHash,
        deviceName,
        username,
        endpoint,
        btoa(String.fromCharCode(...encryptedRootFile)),
      );

      return registerResp;
    } catch (error) {
      console.error('Registration failed:', error);
      return { ok: false, message: 'Registration failed due to an error.' };
    }
  }

  /**
   * Login and initialize the virtual file system
   */
  async login(username, deviceName, password, endpoint) {
    try {
      const [userId, filePwd, filePwdAB] = await Promise.all([
        sha256(username, 'hex'),
        sha256(password, 'hex'),
        sha256(password, 'arraybuffer'),
      ]);

      const userPasswordHash = await sha256(filePwd + RANDOM_WANNBE_SALT, 'hex');
      const loginResp = await userLogin(userId, userPasswordHash, deviceName, username, endpoint);

      if (loginResp.ok && loginResp.token) {
        // Set session state
        this.userId = userId;
        this.email = username;
        this.deviceName = deviceName;
        this.authToken = loginResp.token;
        this.isLoggedIn = true;
        this.endpoint = endpoint;
        this.masterKey = await crypto.subtle.digest('SHA-256', filePwdAB);
        this.password = userPasswordHash;

        // Load and initialize VFS
        const { ok, error, data, etag } = await this.getRootFile();
        if (ok && data) {
          console.warn('Decrypted root file data:', data);
          console.log('Root file loaded with', Object.keys(data.nodes || {}).length, 'nodes');
          this.vfs.fromJSON(data);
          this.rootFileEtag = etag || null;
        } else {
          console.log('Initializing new VFS (root file not found or empty)');
          // Initialize with empty VFS if root file doesn't exist
          this.vfs.fromJSON({ nodes: {} });
          // rootFileEtag remains null for first save
        }
      } else {
        this.isLoggedIn = false;
        alert(loginResp.message);
      }
    } catch (error) {
      console.error('Login failed:', error);
    } finally {
      return this.isLoggedIn;
    }
  }

  /**
   * Logout and clean up
   */
  async logout() {
    if (!this.isLoggedIn) return true;

    if (this.userId && this.endpoint) {
      await userLogout(this.userId, this.endpoint);
    }

    // Clear session
    this.userId = '';
    this.authToken = '';
    this.isLoggedIn = false;

    // Clear VFS
    this.vfs = new VirtualFileSystem();
    this.rootFileEtag = null;

    // Cleanup
    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
    }
    this.listener = null;

    return true;
  }

  /**
   * Add a new directory to the file system
   */
  async addNewDir(parentId, name) {
    if (!this.isLoggedIn || !this.userId || !this.authToken) {
      console.error('Cannot add directory: User not logged in');
      return false;
    }

    const newDir = {
      id: crypto.randomUUID(),
      name: name,
      type: 'inode/directory',
      parent: parentId,
      metadata: {
        created: Date.now(),
        modified: Date.now(),
      },
    };

    this.vfs.addNode(newDir);
    return await this.updateRootFile();
  }

  /**
   * Add a new file entry to the file system
   */
  async addFile(parentId, name, type = 'application/octet-stream', metadata = {}) {
    if (!this.isLoggedIn || !this.userId || !this.authToken) {
      console.error('Cannot add file: User not logged in');
      return false;
    }

    const newFile = {
      id: crypto.randomUUID(),
      name: name,
      type: type,
      parent: parentId,
      metadata: {
        created: Date.now(),
        modified: Date.now(),
        ...metadata,
      },
    };

    this.vfs.addNode(newFile);
    return await this.updateRootFile();
  }

  /**
   * Delete a file or directory (and all its descendants)
   */
  async deleteFile(fileId) {
    if (!this.isLoggedIn || !this.userId || !this.authToken) {
      console.error('Cannot delete file: User not logged in');
      return false;
    }

    const success = this.vfs.deleteNode(fileId);
    if (success) {
      return await this.updateRootFile();
    }

    return false;
  }

  /**
   * Move a file or directory to a new parent
   */
  async moveFile(fileId, newParentId) {
    if (!this.isLoggedIn || !this.userId || !this.authToken) {
      console.error('Cannot move file: User not logged in');
      return false;
    }

    try {
      this.vfs.moveNode(fileId, newParentId);
      return await this.updateRootFile();
    } catch (error) {
      console.error('Move operation failed:', error);
      return false;
    }
  }

  /**
   * Rename a file or directory
   */
  async renameFile(fileId, newName) {
    if (!this.isLoggedIn || !this.userId || !this.authToken) {
      console.error('Cannot rename file: User not logged in');
      return false;
    }

    const node = this.vfs.nodes.get(fileId);
    if (!node) {
      console.error('File not found');
      return false;
    }

    node.name = newName;
    node.metadata = node.metadata || {};
    node.metadata.modified = Date.now();

    // Invalidate path cache for this node and descendants
    this.vfs.invalidatePathCacheBranch(fileId);

    return await this.updateRootFile();
  }

  /**
   * Delete multiple files in a single operation
   */
  async batchDelete(fileIds) {
    if (!this.isLoggedIn || !this.userId || !this.authToken) {
      console.error('Cannot delete files: User not logged in');
      return false;
    }

    const deletedCount = this.vfs.batchDelete(fileIds);
    if (deletedCount > 0) {
      return await this.updateRootFile();
    }

    return false;
  }

  /**
   * Get immediate children of a directory - O(1) operation
   */
  getFilesInDir(dirId) {
    return this.vfs.getChildren(dirId);
  }

  /**
   * Get the full path array for a file/directory with ID
   */
  getFullPathByIdArray(id) {
    if (!id) return [{ name: '/', id: null }];
    const path = this.vfs.getPath(id);
    return path.length > 0 ? [...path] : [{ name: '/', id: null }];
  }

  /**
   * Get the full path as a string
   */
  getFullPathString(id, separator = '/') {
    if (!id) return '/';
    return this.vfs.getPathString(id, separator);
  }

  /**
   * Find files by name
   */
  findFilesByName(name) {
    return this.vfs.findByName(name);
  }

  /**
   * Find all files of a specific type
   */
  findFilesByType(type) {
    return this.vfs.findByType(type);
  }

  /**
   * Get a specific node by ID
   */
  getNodeById(id) {
    return this.vfs.nodes.get(id);
  }

  /**
   * Check if a node exists
   */
  nodeExists(id) {
    return this.vfs.nodes.has(id);
  }

  /**
   * Get all root nodes (nodes without parents)
   */
  getRootNodes() {
    const roots = [];
    for (const [id, node] of this.vfs.nodes) {
      if (!node.parent) {
        roots.push(node);
      }
    }
    return roots;
  }

  /**
   * Traverse the file system tree
   * @param {string} rootId - Starting node (null for all roots)
   * @param {string} strategy - 'breadth-first' or 'depth-first'
   */
  *traverse(rootId = null, strategy = 'breadth-first') {
    yield* this.vfs.traverse(rootId, strategy);
  }

  /**
   * Get statistics about the file system
   */
  getStats() {
    return this.vfs.getStats();
  }

  /**
   * Update the root file on the server
   */
  async updateRootFile() {
    if (!this.isLoggedIn || !this.userId || !this.endpoint || !this.rootFileEtag || !this.authToken) {
      console.error('Cannot update root file: Missing required information');
      return false;
    }

    try {
      // Convert VFS to JSON and encrypt
      console.warn('Serializing VFS with', this.vfs.toJSON());
      const vfsJson = JSON.stringify(this.vfs.toJSON());
      const rootFileData = new TextEncoder().encode(vfsJson);
      console.log('Updating root file with', this.vfs.nodes.size, 'nodes');

      const worker = this.workers[0];

      return new Promise((resolve, reject) => {
        const messageHandler = e => {
          if (e.data.type === 'complete') {
            worker.removeEventListener('message', messageHandler);
            this.rootFileEtag = e.data.data.newEtag;
            console.log('Root file updated successfully', e.data.data);
            resolve(true);
          } else if (e.data.type === 'error') {
            worker.removeEventListener('message', messageHandler);
            console.error('Failed to update root file:', e.data.error);
            reject(new Error(e.data.error));
          }
        };

        worker.addEventListener('message', messageHandler);

        worker.postMessage({
          action: 'uploadSingle',
          data: rootFileData,
          keyData: this.masterKey,
          config: {
            endpoint: this.endpoint,
            authToken: this.authToken,
            userId: this.userId,
          },
          metadata: {
            fileId: `user:${this.userId}.rf`,
            fileName: `user:${this.userId}.rf`,
            etag: this.rootFileEtag,
          },
        });
      });
    } catch (error) {
      console.error('Error updating root file:', error);
      return false;
    }
  }

  /**
   * Get and decrypt the root file from server
   */
  async getRootFile() {
    if (!this.isLoggedIn || !this.userId || !this.endpoint || !this.authToken || !this.workers[0]) {
      console.error('Cannot get root file: Missing required information');
      return { ok: false, error: 'User not logged in or missing information' };
    }

    try {
      const { blob, etag } = await downloadAndDecryptFile(
        `user:${this.userId}.rf`,
        this.masterKey,
        { endpoint: this.endpoint, authToken: this.authToken, userId: this.userId },
        this.workers[0],
      );

      const data = JSON.parse(await blob.text());
      return { ok: true, data, etag };
    } catch (error) {
      console.error('Error fetching root file:', error);
      return { ok: false, error: error.message };
    }
  }

  /**
   * Upload multiple files to storage
   */
  async uploadFilelist(fileList, cwdId = null, onProgress = null) {
    let uploadPromise = await uploadWithSharedQueue(fileList, this.workers, {
      endpoint: this.endpoint,
      authToken: this.authToken,
      userId: this.userId,
      chunkSize: CHUNK_SIZE,
    });

    // Display results
    console.log('Upload Results:', uploadPromise);

    const successful = [];
    const failed = [];

    // Process results from each file
    for (const [fileId, fileData] of Object.entries(uploadPromise)) {
      if (fileData.errors && fileData.errors.length > 0) {
        failed.push({
          name: fileData.fileName,
          errors: fileData.errors,
        });
      } else {
        successful.push({
          id: fileId,
          name: fileData.fileName,
          type: fileData.fileType,
          size: fileData.fileSize,
          keyData: fileData.keyData,
          parent: cwdId,
          chunks: fileData.chunks,
          totalChunks: fileData.totalChunks,
          metadata: { created: Date.now(), modified: Date.now() },
        });
      }
    }

    if (successful.length === 0 && failed.length === 0) {
      return;
    }
    for (const file of successful) {
      this.vfs.addNode(file);
    }
    await this.updateRootFile();
    return { successful, failed };
  }

  async downloadFile(fileId, options) {
    if (!this.isLoggedIn || !this.userId || !this.endpoint || !this.authToken || !this.workers[0]) {
      console.error('Cannot download file: Missing required information');
      return { ok: false, error: 'User not logged in or missing information' };
    }

    const node = this.getNodeById(fileId);
    if (!node || !node.chunks || node.chunks.length === 0 || node.type === 'inode/directory') {
      console.error('File not found or has no chunks to download');
      return { ok: false, error: 'File not found or has no chunks to download' };
    }
    try {
      console.log('Downloading file:', node.name, 'with', node.chunks.length, 'chunks');
      // const { showProgress = true, onProgress = null } = options;
      // let receivedBytes = 0;
      // const totalBytes = node.size || 0;
      const fileKey = new Uint8Array(Object.values(node.keyData));
      const resultArray = await Promise.all(
        node.chunks.map((chunk, i) =>
          downloadAndDecryptFile(
            chunk.fileId + '_' + chunk.chunkIndex,
            fileKey,
            { endpoint: this.endpoint, authToken: this.authToken, userId: this.userId },
            this.workers[i % this.workers.length],
          ),
        ),
      );
      console.log('Downloaded and decrypted all chunks for file:', node.name, resultArray);
      // // Combine all blobs into one
      const blobs = resultArray.map(res => res.blob);
      const blob = new Blob(blobs, { type: node.type });

      // // Trigger file download in browser
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = node.name;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);

      return { ok: true };
    } catch (error) {
      console.error('Error downloading file:', error);
      return { ok: false, error: error.message };
    }
  }

  async startStream(fileId, videoElement) {
    if (!this.isLoggedIn || !this.userId || !this.endpoint || !this.authToken || !this.workers?.[0]) {
      console.error('Cannot start stream: Missing required information');
      return { ok: false, error: 'User not logged in or missing information' };
    }

    const node = this.getNodeById(fileId);
    if (!node || !node.chunks || node.chunks.length === 0 || node.type === 'inode/directory') {
      console.error('File not found or has no chunks to stream');
      return { ok: false, error: 'File not found or has no chunks to stream' };
    }

    try {
      const fileKey = new Uint8Array(Object.values(node.keyData));

      // First, check if the file is suitable for MSE
      const firstChunkInfo = node.chunks[0];
      const { blob: firstBlob } = await downloadAndDecryptFile(
        firstChunkInfo.fileId + '_' + firstChunkInfo.chunkIndex,
        fileKey,
        { endpoint: this.endpoint, authToken: this.authToken, userId: this.userId },
        this.workers[0],
      );

      const firstChunk = await firstBlob.arrayBuffer();
      const isFragmented = this.checkIfFragmentedMP4(firstChunk);

      if (!isFragmented) {
        console.log('File is not fragmented MP4, using blob approach');
        return this.streamWithBlob(node, videoElement, fileKey, firstChunk);
      }

      console.log('File is fragmented MP4, using MediaSource');
      const mediaSource = new MediaSource();
      videoElement.src = URL.createObjectURL(mediaSource);

      return new Promise((resolve, reject) => {
        mediaSource.addEventListener('sourceopen', async () => {
          try {
            // Try different codec strings
            const codecStrings = [
              'video/mp4; codecs="avc1.42E01E, mp4a.40.2"', // H.264 + AAC
              'video/mp4; codecs="avc1.4D401E, mp4a.40.2"', // H.264 Main + AAC
              'video/mp4; codecs="avc1.64001E, mp4a.40.2"', // H.264 High + AAC
              'video/mp4; codecs="avc1.42E01E"', // H.264 only
              'video/mp4; codecs="mp4a.40.2"', // AAC only
            ];

            let sourceBuffer = null;

            // Try to find supported codec
            for (const codec of codecStrings) {
              if (MediaSource.isTypeSupported(codec)) {
                console.log('Using codec:', codec);
                sourceBuffer = mediaSource.addSourceBuffer(codec);
                break;
              }
            }

            if (!sourceBuffer) {
              throw new Error('No supported codec found');
            }

            const queue = [];
            let isAppending = false;

            const processQueue = () => {
              if (!isAppending && !sourceBuffer.updating && queue.length > 0) {
                isAppending = true;
                const chunk = queue.shift();
                try {
                  sourceBuffer.appendBuffer(chunk);
                } catch (e) {
                  console.error('Failed to append buffer:', e);
                  isAppending = false;
                }
              }
            };

            sourceBuffer.addEventListener('updateend', () => {
              isAppending = false;
              processQueue();
            });

            // Append first chunk
            queue.push(new Uint8Array(firstChunk));
            processQueue();

            // Load remaining chunks
            for (let i = 1; i < node.chunks.length; i++) {
              const chunkInfo = node.chunks[i];
              console.log(`Loading chunk ${i + 1}/${node.chunks.length}`);

              const { blob } = await downloadAndDecryptFile(
                chunkInfo.fileId + '_' + chunkInfo.chunkIndex,
                fileKey,
                { endpoint: this.endpoint, authToken: this.authToken, userId: this.userId },
                this.workers[i % this.workers.length],
              );

              const arrayBuffer = await blob.arrayBuffer();
              queue.push(new Uint8Array(arrayBuffer));
              processQueue();

              // Start playback after a few chunks
              if (i === 2 && videoElement.paused) {
                videoElement.play().catch(e => console.log('Autoplay blocked:', e));
              }
            }

            // Wait for queue to empty
            while (queue.length > 0 || isAppending) {
              await new Promise(resolve => setTimeout(resolve, 100));
            }

            if (mediaSource.readyState === 'open') {
              mediaSource.endOfStream();
            }

            resolve({ ok: true });
          } catch (error) {
            console.error('MediaSource streaming failed:', error);
            mediaSource.endOfStream('network');
            reject(error);
          }
        });
      });
    } catch (error) {
      console.error('Error starting stream:', error);
      return { ok: false, error: error.message };
    }
  }

  // Check if MP4 is fragmented
  checkIfFragmentedMP4(arrayBuffer) {
    const view = new DataView(arrayBuffer);
    const decoder = new TextDecoder();

    // Look for MP4 box signatures
    let offset = 0;
    while (offset < Math.min(arrayBuffer.byteLength, 1024)) {
      if (offset + 8 > arrayBuffer.byteLength) break;

      const size = view.getUint32(offset);
      const type = decoder.decode(new Uint8Array(arrayBuffer, offset + 4, 4));

      console.log(`Found box: ${type} at offset ${offset}`);

      // Fragmented MP4s have moof (movie fragment) boxes
      if (type === 'moof' || type === 'mvex') {
        return true;
      }

      // Regular MP4s have mdat after moov
      if (type === 'mdat' && offset > 100) {
        return false;
      }

      offset += size || 8;
    }

    return false;
  }

  // Fallback blob streaming for non-fragmented MP4
  async streamWithBlob(node, videoElement, fileKey, firstChunk) {
    console.log('Starting simple progressive streaming');

    try {
      // Only load first 20MB (enough to start playback)
      const bytesPerChunk = firstChunk.byteLength;
      const chunksFor20MB = Math.ceil((20 * 1024 * 1024) / bytesPerChunk);
      const initialChunks = Math.min(chunksFor20MB, node.chunks.length);

      console.log(`Loading first ${initialChunks} chunks of ${node.chunks.length} total`);

      const chunks = [firstChunk];

      // Load initial chunks
      for (let i = 1; i < initialChunks; i++) {
        const chunkInfo = node.chunks[i];
        console.log(`Loading chunk ${i + 1}/${initialChunks}`);

        const { blob } = await downloadAndDecryptFile(
          chunkInfo.fileId + '_' + chunkInfo.chunkIndex,
          fileKey,
          { endpoint: this.endpoint, authToken: this.authToken, userId: this.userId },
          this.workers[i % this.workers.length],
        );

        chunks.push(await blob.arrayBuffer());
      }

      // Create blob and play
      const partialBlob = new Blob(chunks, { type: 'video/mp4' });
      const url = URL.createObjectURL(partialBlob);

      console.log(`Created partial blob with ${chunks.length} chunks, size: ${partialBlob.size} bytes`);

      videoElement.src = url;
      videoElement.controls = true;

      videoElement.addEventListener('loadedmetadata', () => {
        console.log('Metadata loaded, duration:', videoElement.duration);
        videoElement.play().catch(e => console.log('Click play button to start'));
      });

      videoElement.addEventListener('error', e => {
        const err = videoElement.error;
        if (err?.code === 3) {
          console.log('Note: This is a partial file, seeking beyond loaded content will fail');
        }
      });

      // Show a message to user
      console.warn(`⚠️ Only first ${initialChunks} chunks loaded. Full video has ${node.chunks.length} chunks.`);
      console.log('This is a preview. Implement full streaming for complete playback.');

      return { ok: true, partial: true };
    } catch (error) {
      console.error('Streaming failed:', error);
      return { ok: false, error: error.message };
    }
  }
}

export default Store;
export { Store };
