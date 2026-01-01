// import { aes256gcmEncryptToBase64, randomBytes } from './_crypto.js';
// import { uint8ArrayToHexString } from './_helpers.js';

// export class VirtualFileSystem {
//   constructor(rootFileKey, rootFileEtag, rootFileContent = [], encKey, connectionManager, options = {}) {
//     console.log('Initializing VirtualFileSystem with rootFile:', rootFileContent);
//     this.rootFile = {
//       objectKey: rootFileKey,
//       etag: rootFileEtag,
//       content: rootFileContent,
//       encKey: encKey,
//     };
//     this.connectionManager = connectionManager;
//   }

//   // rework!
//   ls(cwd = null, options = {}) {
//     // return this.rootFile.content.files.filter(file => file.parentId === cwd);
//   }

//   // rework!
//   lsDir(cwd = null, options = {}) {
//     // return this.rootFile.content.files.filter(file => file.parentId === cwd && file.isDirectory);
//   }

//   // rework!
//   // async addFile(fileName, parentId = null, type = 'text/plain', metadata = {}) {
//   //   let tempKey = type !== 'application/x-directory' ? randomBytes(32) : null;
//   //   const file = {
//   //     keyId: metadata.keyId || uint8ArrayToHexString(randomBytes(16)),
//   //     parentId: parentId || null,
//   //     name: fileName,
//   //     type,
//   //     isDirectory: type === 'application/x-directory',
//   //     createdAt: new Date().toISOString(),
//   //     updatedAt: new Date().toISOString(),
//   //     createdBy: metadata.createdBy || 'system',
//   //     updatedBy: metadata.createdBy || 'system',
//   //     tags: [],
//   //     key: type !== 'application/x-directory' ? uint8ArrayToHexString(tempKey) : null,
//   //     ...metadata,
//   //   };
//   //   this.indexContent.files.push(file);
//   //   if (this.connectionManager) {
//   //     const encKey =
//   //       type !== 'application/x-directory'
//   //         ? await CRYPTO_SUBTLE.importKey('raw', tempKey, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt'])
//   //         : this.encKey;
//   //     const encryptedContent = await aes256gcmEncryptToBase64(JSON.stringify(this.indexContent), encKey);

//   //     console.log('Encrypted index content:', encryptedContent);
//   //     // this.connectionManager.stopSSEConnection();
//   //     const resp = await this.connectionManager.uploadFile(this.indexKey, encryptedContent);
//   //     if (!resp || !resp.etag) {
//   //       throw new Error('Failed to upload index file after adding new file');
//   //     }
//   //     this.indexEtag = resp.etag;
//   //   }
//   //   this.connectionManager.updateObjectList({
//   //     key: this.indexKey,
//   //     etag: this.indexEtag,
//   //     callback: change => {
//   //       console.warn('!!! Index file updated:', change);
//   //     },
//   //   });
//   //   return file;
//   // }

//   async addDirectory(name, parentId = null, metadata = {}) {
//     return await this.addFile(name, parentId, 'application/x-directory', metadata);
//   }

//   getFiles() {
//     return this.indexContent.files;
//   }

//   // mkdir(parentId, name, metadata = {}) {
//   //   const nameKey = `${parentId || '/'}:${name}`;

//   //   // Check if already exists
//   //   if (this.nameIndex.has(nameKey)) {
//   //     throw new Error(`Directory '${name}' already exists in this location`);
//   //   }

//   //   const directory = {
//   //     keyId: metadata.keyId || randomBytes(16).toString('hex'),
//   //     parentId: parentId || null,
//   //     name,
//   //     type: 'directory',
//   //     isDirectory: true,
//   //     createdAt: new Date().toISOString(),
//   //     updatedAt: new Date().toISOString(),
//   //     createdBy: metadata.createdBy || 'system',
//   //     updatedBy: metadata.createdBy || 'system',
//   //     tags: [],
//   //     ...metadata,
//   //   };

//   //   this.addFile(directory);
//   //   return directory;
//   // }
// }
