const CHUNK_SIZE = 8 * 1024 * 1024;

// --- static maps -----------------------------------------------------------
const IOS_RESOLUTION_TO_MODEL = new Map([
  // width×height in *physical* pixels (portrait order) ➜ model(s)
  ['640x960', 'iPhone 4 / 4 S'],
  ['640x1136', 'iPhone 5 / 5 S / SE 1'],
  ['750x1334', 'iPhone 6 / 6 S / 7 / 8 / SE 2'],
  ['828x1792', 'iPhone 11 / XR'],
  ['1080x2340', 'iPhone 12 / 13 / 14 / 15'],
  ['1125x2436', 'iPhone X / XS / 11 Pro'],
  ['1170x2532', 'iPhone 12 / 13 Pro / 14'],
  ['1242x2688', 'iPhone XS Max / 11 Pro Max'],
  ['1284x2778', 'iPhone 12 Pro Max / 13 Pro Max / 14 Plus'],
  ['1290x2796', 'iPhone 15 Pro Max'],
  ['1668x2388', 'iPad (10.5″ / 11″)'],
  ['2048x2732', 'iPad Pro 12.9″'],
]);

const DESKTOP_PLATFORM_TO_NAME = new Map([
  ['Win32', 'Windows'],
  ['Linux', 'Linux'],
  ['MacIntel', 'macOS'],
]);

const BROWSER_REGEXES = [
  { name: 'Firefox', re: /Firefox\/([\d.]+)/ }, // group1 = version
  { name: 'Edge', re: /Edg\/([\d.]+)/ }, // Chromium Edge :contentReference[oaicite:2]{index=2}
  { name: 'Opera', re: /OPR\/([\d.]+)/ }, // Opera :contentReference[oaicite:3]{index=3}
  { name: 'Chrome', re: /Chrome\/([\d.]+)/ },
  // Safari uses 'Version/xx.xx Safari'
  { name: 'Safari', re: /Version\/([\d.]+).*Safari/ },
];
// --- helpers ---------------------------------------------------------------
const memo = { deviceName: null };

const normaliseResolution = () => {
  // Ensure portrait‑ordered physical‑pixel key, e.g. "750x1334"
  const dpr = Math.round(window.devicePixelRatio || 1);
  const w = Math.round(window.screen.width * dpr);
  const h = Math.round(window.screen.height * dpr);
  const [min, max] = w < h ? [w, h] : [h, w];
  return `${min}x${max}`;
};

const getIosDeviceName = () => {
  return IOS_RESOLUTION_TO_MODEL.get(normaliseResolution()) ?? 'iOS device';
};

const getAndroidDeviceName = () => {
  // Modern: UA‑CH exposes the exact model string (not in all browsers yet)
  if (navigator.userAgentData?.model) {
    return navigator.userAgentData.model;
  }
  // Fallback: parse the legacy UA string once
  const match = /Android[^;]*;\s*([^;)]+)/i.exec(navigator.userAgent);
  return match ? match[1].trim().split(' ')[0] : 'Android device';
};

const getDesktopDeviceName = () => {
  const platform = navigator.userAgentData?.platform || navigator.platform || 'Unknown';
  return DESKTOP_PLATFORM_TO_NAME.get(platform) ?? platform;
};
// --- browser + OS helpers ----------------------------------------------

/**
 * Best-effort browser detection.
 * (UA-CH first, UA string fallback.)
 */
const getBrowserInfo = () => {
  // 1  Prefer UA-CH if it’s there
  if (navigator.userAgentData?.brands?.length) {
    const brand =
      navigator.userAgentData.brands.find(b => b.brand !== 'Not A Brand') || navigator.userAgentData.brands[0];
    return `${brand.brand}${brand.version.split('.')[0]}`; // major only  :contentReference[oaicite:4]{index=4}
  }

  // 2  Legacy UA-string fallback
  const ua = navigator.userAgent;
  for (const { name, re } of BROWSER_REGEXES) {
    const m = re.exec(ua);
    if (m) return `${name}${m[1].split('.')[0]}`; // major only
  }
  return 'UnknownBrowser';
};

const getOsInfo = () => {
  // UA-CH – major.minor.build
  if (navigator.userAgentData?.platform) {
    const name = navigator.userAgentData.platform;
    if (navigator.userAgentData.getHighEntropyValues) {
      try {
        const { platformVersion } = navigator.userAgentData.getHighEntropyValues
          ? /* eslint-disable-next-line no-await-in-loop */
            navigator.userAgentData.getHighEntropyValues(['platformVersion'])
          : { platformVersion: '' };
        if (platformVersion) {
          return `${name} ${platformVersion.split('.')[0]}`;
        }
      } catch {
        return name;
      }
    }
    return name;
  }

  const ua = navigator.userAgent;

  // macOS
  let m = /Mac OS X ([0-9_.]+)/.exec(ua);
  if (m) return `macOS${m[1].replace(/_/g, '.')}`;

  // Windows
  m = /Windows NT ([0-9.]+)/.exec(ua);
  if (m) {
    const map = { '10.0': '10', 6.3: '8.1', 6.2: '8', 6.1: '7' };
    return `Windows${map[m[1]] ?? m[1]}`;
  }

  // iOS
  m = /OS ([0-9_]+) like Mac OS X/.exec(ua);
  if (m) return `iOS${m[1].replace(/_/g, '.')}`;

  // Android
  m = /Android ([0-9.]+)/.exec(ua);
  if (m) return `Android${m[1]}`;

  // Linux/other :)
  return 'UnknownOS';
};

// --- public ----
export const getDeviceNameHelper = () => {
  if (memo.deviceName) return memo.deviceName;

  const isMobile = navigator.userAgentData ? navigator.userAgentData.mobile : /mobi|android/i.test(navigator.userAgent);

  const device = isMobile
    ? /android/i.test(navigator.userAgent)
      ? getAndroidDeviceName()
      : getIosDeviceName()
    : getDesktopDeviceName(); // e.g. "macOS" / "Windows"

  const osInfo = getOsInfo(); // "macOS 14.4"
  const browserInfo = getBrowserInfo(); // "Chrome 124"

  memo.deviceName = `${device === osInfo ? osInfo : device}_${browserInfo}`;
  // Example:  "macOS 14.4 – Chrome 124"
  //           "iPhone 15 Pro Max – Safari 17"

  return memo.deviceName;
};

export const openMultiFilePicker = callback => {
  const input = document.createElement('input');
  input.type = 'file';
  input.multiple = true;
  input.style.display = 'none';

  input.addEventListener('change', event => {
    const files = event.target.files;
    if (callback && typeof callback === 'function') {
      callback(files);
    }
    document.body.removeChild(input);
  });

  document.body.appendChild(input);
  input.click();
};

export function isValidDirName(name) {
  // Quick checks
  if (!name || name.length > 255) return false;

  // Non-printable characters (0x00-0x1F, 0x7F-0x9F)
  if (/[\x00-\x1F\x7F-\x9F]/.test(name)) return false;

  // Invalid characters for any OS
  if (/[<>:"|?*\/\\]/.test(name)) return false;

  // Windows: no trailing dots or spaces
  if (/[. ]$/.test(name)) return false;

  // Windows reserved names
  const upper = name.toUpperCase();
  if (/^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])$/.test(upper)) return false;

  return true;
}

export const generateJSONTree = ymap => {
  const nodes = {};
  ymap.forEach((value, key) => {
    nodes[key] = { ...value, children: [] };
  });

  const roots = [];

  Object.values(nodes).forEach(node => {
    if (node.parentId && nodes[node.parentId]) {
      nodes[node.parentId].children.push(node);
    } else {
      roots.push(node);
    }
  });

  function cleanNode(node) {
    const { objectId, parentId, children, ...rest } = node;
    const cleaned = {
      _id: objectId,
      ...rest,
    };

    if (node.type === 'directory' && children.length > 0) {
      cleaned.children = node.children.map(cleanNode);
    }
    return cleaned;
  }

  return roots.map(cleanNode);
};

export async function downloadAndDecryptFile(fileKey, keyData, config, worker) {
  // console.warn('Downloading file with key:', fileKey, keyData, config);
  const { endpoint, authToken, userId } = config;
  return new Promise((resolve, reject) => {
    const messageHandler = e => {
      if (e.data.type === 'complete') {
        worker.removeEventListener('message', messageHandler);
        if (e.data.success) {
          resolve(e.data.data);
        } else {
          reject(new Error(e.data.error));
        }
      } else if (e.data.type === 'error') {
        worker.removeEventListener('message', messageHandler);
        reject(new Error(e.data.error));
      } else if (e.data.type === 'progress') {
        // Update progress UI
        console.log('Download progress:', e.data);
      }
    };

    worker.addEventListener('message', messageHandler);

    worker.postMessage({
      action: 'download',
      fileId: fileKey,
      endpoint,
      authToken,
      userId,
      decryptionKey: keyData,
    });
  });
}
function* generateAllChunks(files, chunkSize) {
  for (const file of files) {
    const fileId = crypto.randomUUID();
    const keyData = crypto.getRandomValues(new Uint8Array(32));
    const totalChunks = Math.ceil(file.size / chunkSize);

    for (let i = 0; i < totalChunks; i++) {
      const start = i * chunkSize;
      const end = Math.min(start + chunkSize, file.size);

      yield {
        fileId,
        keyData,
        file, // Include file object for slicing
        fileName: file.name,
        fileType: file.type,
        fileSize: file.size,
        chunkIndex: i,
        totalChunks,
        start,
        end,
        size: end - start,
      };
    }
    console.log('Generated', totalChunks, 'chunks for file', file.name);
  }
}

export async function uploadWithSharedQueue(files, workers, config, onProgress) {
  const allChunks = [...generateAllChunks(files, config.chunkSize || CHUNK_SIZE)];
  const totalChunks = allChunks.length;
  const chunksPerWorker = Math.ceil(totalChunks / workers.length);
  // Split chunks among workers
  const workerBatches = [];
  for (let i = 0; i < workers.length; i++) {
    const start = i * chunksPerWorker;
    const end = Math.min(start + chunksPerWorker, totalChunks);
    if (start < totalChunks) {
      workerBatches.push({
        worker: workers[i],
        chunks: allChunks.slice(start, end),
      });
    }
  }

  // Process all batches in parallel
  const batchResults = await Promise.all(
    workerBatches.map(batch => processBatch(batch.worker, batch.chunks, config, onProgress)),
  );

  // Merge results from all workers
  const mergedResults = {};
  for (const workerResult of batchResults) {
    for (const [fileId, fileData] of Object.entries(workerResult)) {
      if (!mergedResults[fileId]) {
        mergedResults[fileId] = fileData;
      } else {
        // Merge chunks from different workers
        fileData.chunks.forEach((chunk, index) => {
          if (chunk) mergedResults[fileId].chunks[index] = chunk;
        });
        // Merge errors if any
        if (fileData.errors) {
          if (!mergedResults[fileId].errors) mergedResults[fileId].errors = [];
          mergedResults[fileId].errors.push(...fileData.errors);
        }
      }
    }
  }

  return mergedResults;
}

export async function processBatch(worker, chunks, config, onProgress) {
  return new Promise((resolve, reject) => {
    const messageHandler = e => {
      if (e.data.type === 'progress' && onProgress) {
        onProgress({
          fileName: e.data.fileName,
          chunkIndex: e.data.chunkIndex,
          totalChunks: e.data.totalChunks,
          status: e.data.status,
          error: e.data.error,
        });
      } else if (e.data.type === 'complete') {
        worker.removeEventListener('message', messageHandler);
        if (e.data.success) {
          resolve(e.data.data);
        } else {
          reject(new Error(e.data.error));
        }
      } else if (e.data.type === 'error') {
        worker.removeEventListener('message', messageHandler);
        reject(new Error(e.data.error));
      } else if (e.data.type === 'progress') {
        // Update progress UI
        console.log(e.data.fileName, e.data);
      }
    };

    worker.addEventListener('message', messageHandler);

    // Send entire batch to worker
    worker.postMessage({
      action: 'uploadBatch',
      chunks: chunks,
      config: {
        endpoint: config.endpoint,
        authToken: config.authToken,
        userId: config.userId,
      },
    });
  });
}
