import { fromUint8Array } from '../shared/Helpers';

import type { Base64, MemberId } from '../shared/Consts';
import type { Vault } from './Vault';

// ===== TYPES =====
export type checkListItem = {
  id: string;
  etag: string;
};

export type CheckRequest = {
  checklist: checkListItem[];
};

export type CheckResponse = {
  ok: boolean;
  changed: Array<string>;
  message: string;
  code: number;
};

export type LoginRequest = {
  payload: LoginPayload;
  payloadHash: Base64<Uint8Array>;
  signerId: MemberId;
  signature: Base64<Uint8Array>;
};

export type LoginPayload = {
  accountName: string;
  memberId: MemberId;
  timestamp: number;
};

export type LoginResponse = {
  ok: boolean;
  accountVault?: Vault;
  vaultEtag?: string;
  authToken?: string;
  message: string;
  code: number;
};

export type RegisterResponse = {
  ok: boolean;
  message: string;
  code: number;
};

export type UploadObjectRequest = {
  fileKey: string;
  fileContent: string;
  deviceAuthToken: string;
};

export type GetObjectRequest = {
  deviceAuthToken: string;
  objectKey: string;
  etag?: string | null;
};

export type ObjectResult = {
  ok: boolean;
  objectKey: string;
  cipherContent?: string;
  etag?: string;
  status?: string;
  reason?: string;
};

// ===== AUTH CONFIGURATION =====

export type SignedAuth = {
  type: 'signed';
  signerId: string;
  secretSignKey: Uint8Array;
  payload: any;
};

export type BearerAuth = {
  type: 'bearer';
  token: string;
};

export type AuthConfig = SignedAuth | BearerAuth | undefined;

// ===== REQUEST OPTIONS =====

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'OPTIONS';
  body?: Vault | any;
  headers?: Record<string, string> | undefined;
  auth?: AuthConfig;
}

// ===== RESPONSE PARSERS =====

export class ResponseParser {
  readonly etag?: string;
  constructor(private response: Response) {}

  /**
   * Parse response as JSON
   */
  async json<T = any>(): Promise<T> {
    return this.response.json() as Promise<T>;
  }

  /**
   * Parse response as Uint8Array
   */
  async bytes(): Promise<Uint8Array> {
    const arrayBuffer = await this.response.arrayBuffer();
    return new Uint8Array(arrayBuffer);
  }

  /**
   * Parse response as text
   */
  async text(): Promise<string> {
    return this.response.text();
  }

  /**
   * Parse response as blob
   */
  async blob(): Promise<Blob> {
    return this.response.blob();
  }

  /**
   * Get raw response
   */
  raw(): Response {
    return this.response;
  }

  /**
   * Get response headers
   */
  get headers(): Headers {
    return this.response.headers;
  }

  /**
   * Get response status
   */
  get status(): number {
    return this.response.status;
  }

  /**
   * Get response ok status
   */
  get ok(): boolean {
    return this.response.ok;
  }
}
// ===== HELPER FUNCTIONS =====

/**
 * Prepare headers and body for signed authentication
 */
// const prepareSignedAuth = async (
//   signedAuth: SignedAuth,
//   headers: Record<string, string>,
// ): Promise<{ headers: Record<string, string>; body: string; requestId: string }> => {
//   const bodyJson = generateCanonicalJSON(signedAuth.payload);
//   const contentSha256 = await CryptoUtils.sha256(bodyJson, 'hex');
//   const timestamp = Date.now().toString();
//   const requestId = CryptoUtils.generateRandomUUID();

//   const stringToSign = [signedAuth.signerId, contentSha256, timestamp, requestId].join('\n');
//   const signature = uint8ArrayToBase64(CryptoPQ.sign(signedAuth.secretSignKey, stringToSign));

//   return {
//     headers: {
//       ...headers,
//       'Content-SHA256': contentSha256 as string,
//       'X-Timestamp': timestamp,
//       'X-Request-ID': requestId,
//       'X-Signer-ID': signedAuth.signerId,
//       'X-Signature': `Signature ${signature}`,
//       'Content-Type': 'application/json',
//     },
//     body: bodyJson,
//     requestId,
//   };
// };

/**
 * Prepare headers for bearer token authentication
 */
const prepareBearerAuth = (token: string, headers: Record<string, string>): { headers: Record<string, string> } => {
  return {
    headers: {
      ...headers,
      Authorization: `Bearer ${token}`,
    },
  };
};

/**
 * Serialize body to string based on type
 */
const serializeBody = (
  body: any,
  headers: Record<string, string>,
): { body: string; headers: Record<string, string> } => {
  if (body instanceof Uint8Array) {
    return {
      body: fromUint8Array(body),
      headers: {
        ...headers,
        'Content-Type': headers['Content-Type'] || 'application/octet-stream',
      },
    };
  }

  if (typeof body === 'string') {
    return {
      body,
      headers: {
        ...headers,
        'Content-Type': headers['Content-Type'] || 'text/plain',
      },
    };
  }

  return {
    body: JSON.stringify(body),
    headers: {
      ...headers,
      'Content-Type': headers['Content-Type'] || 'application/json',
    },
  };
};

/**
 * Validate request/response ID match
 */
// const validateRequestId = (response: Response, expectedRequestId: string): void => {
//   const responseRequestId = response.headers.get('X-Request-ID');
//   if (responseRequestId !== expectedRequestId) {
//     throw new Error('Request ID mismatch');
//   }
// };

/**
 * Handle error response
 */
const handleErrorResponse = async (response: Response): Promise<never> => {
  const errorText = await response.text().catch(() => response.statusText);
  throw new Error(`HTTP ${response.status}: ${errorText}`);
};

// ===== CORE FETCH FUNCTION =====
const _fetchRequest = async (url: string, options: RequestOptions = {}): Promise<ResponseParser> => {
  const { method = 'GET', body, headers: customHeaders = {}, auth } = options;

  let headers = { ...customHeaders };
  let requestBody: string | undefined;
  // let requestId: string = '';

  // // Handle authentication
  // if (auth?.type === 'signed') {
  //   const prepared = await prepareSignedAuth(auth, headers);
  //   headers = prepared.headers;
  //   requestBody = prepared.body;
  //   requestId = prepared.requestId;
  // }

  if (auth?.type === 'bearer') {
    const prepared = prepareBearerAuth(auth.token, headers);
    headers = prepared.headers;
    // requestId = prepared.requestId;
  }

  // Handle body for non-signed requests
  if (body !== undefined && (!auth || auth.type === 'bearer')) {
    const serialized = serializeBody(body, headers);
    requestBody = serialized.body;
    headers = serialized.headers;
  }

  // Build fetch options
  const fetchOptions: RequestInit = { method, headers };
  if (requestBody !== undefined) {
    fetchOptions.body = requestBody;
  }

  const response = await fetch(url, fetchOptions);

  // validateRequestId(response, requestId);
  if (!response.ok) {
    await handleErrorResponse(response);
  }

  return new ResponseParser(response);
};

// ===== CONVENIENCE FUNCTIONS =====

/**
 * Make a signed request (for registration/login)
 */
// export const signedRequest = async <T = any>(
//   url: string,
//   payload: VaultRegistrationPayload | LoginRequest,
//   signer: MemberSecrets,
// ): Promise<T> => {
//   const parser = await _fetchRequest(url, {
//     method: 'POST',
//     auth: {
//       type: 'signed',
//       signerId: signer.memberId,
//       secretSignKey: signer.dsaSecretKey,
//       payload,
//     },
//   });
//   return parser.json<T>();
// };
export const makeRequest = async <T = any>(
  url: string,
  method: 'GET' | 'POST' | 'PUT' | 'DELETE',
  body?: LoginRequest | Vault | CheckRequest,
  headers?: Record<string, string>,
): Promise<T> => {
  const parser = await _fetchRequest(url, {
    method,
    body,
    headers,
    auth: undefined,
  });

  return parser.json<T>();
};

/**
 * Make an authenticated request with bearer token
 */
export const authRequest = async (
  url: string,
  method: 'GET' | 'POST' | 'PUT' | 'DELETE',
  authToken: string,
  body?: any,
  headers?: Record<string, string>,
): Promise<ResponseParser> => {
  return _fetchRequest(url, {
    method,
    body,
    headers,
    auth: {
      type: 'bearer',
      token: authToken,
    },
  } as RequestOptions);
};

/**
 * Simple GET request with auth token (returns JSON)
 */
export const get = async <T = any>(url: string, authToken: string, headers?: Record<string, string>): Promise<T> => {
  const parser = await authRequest(url, 'GET', authToken, undefined, headers);
  return parser.json<T>();
};

/**
 * Simple POST request with auth token (returns JSON)
 */
export const post = async <T = any>(
  url: string,
  authToken: string,
  body?: any,
  headers?: Record<string, string>,
): Promise<T> => {
  const parser = await authRequest(url, 'POST', authToken, body, headers);
  return parser.json<T>();
};

/**
 * Simple PUT request with auth token (returns JSON)
 */
export const put = async <T = any>(
  url: string,
  authToken: string,
  body?: any,
  headers?: Record<string, string>,
): Promise<T> => {
  const parser = await authRequest(url, 'PUT', authToken, body, headers);
  return parser.json<T>();
};

/**
 * Simple DELETE request with auth token (returns JSON)
 */
export const del = async <T = any>(url: string, authToken: string, headers?: Record<string, string>): Promise<T> => {
  const parser = await authRequest(url, 'DELETE', authToken, undefined, headers);
  return parser.json<T>();
};
