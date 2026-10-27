// -----------------------------------------------------------------------------
// HTTP client of the SensorPush Gateway Cloud API (official Swagger definition
// v1.0.20261017: https://api.sensorpush.com/api/v1/support/swagger/swagger-v1.json,
// documentation https://www.sensorpush.com/gateway-cloud-api). Every call is a
// POST of a JSON body; read only apart from the sign-in:
//
//   POST oauth/authorize    { email, password } -> { authorization } (24 h)
//   POST oauth/accesstoken  { authorization } -> { accesstoken } (a JWT, sent
//                           as is in the `Authorization` header, like the
//                           official curl examples)
//   POST devices/sensors    {} -> the sensors of the account
//   POST devices/gateways   {} -> the gateways of the account
//   POST samples            { limit, sensors, startTime } -> samples per sensor
//
// Pace: "requests can be made no more than once per minute" (documentation).
// The data requests (sensors, gateways, samples) are therefore at least
// `dataSpacingMs` apart (61 s), counted from the start of the previous one;
// the two sign-in requests only when needed, a second apart. The access token
// is kept in memory until the `exp` of its JWT (1 h in the Swagger definition,
// 12 h on the documentation page), renewed 5 minutes before.
//
// Answers seen live (2026-10-27):
//   - authorize, password under 8 characters: 400 {"message":"Password must
//     be at least 8 characters."};
//   - authorize, unknown account: 403 {"message":"invalid user"};
//   - accesstoken, invalid authorization: 412 {"message":"invalid
//     authorization token"};
//   - data without a token: 400 {"type":"UNAUTHORIZED"}; with a wrong one:
//     400 {"type":"ACCESS_DENIED"}.
// A refused token gets one new sign-in. A 429, a 5xx or no answer pauses
// every request, 2 minutes doubling up to 30 minutes (or the Retry-After).
// -----------------------------------------------------------------------------

const BASE_URL = 'https://api.sensorpush.com/api/v1';
const TIMEOUT_MS = 30000;
const DATA_SPACING_MS = 61 * 1000;
const AUTH_SPACING_MS = 1000;
const MIN_PAUSE_MS = 2 * 60 * 1000;
const MAX_PAUSE_MS = 30 * 60 * 1000;
const RENEW_BEFORE_MS = 5 * 60 * 1000;
const DEFAULT_TOKEN_MS = 55 * 60 * 1000;
const TOKEN_TYPES = ['UNAUTHORIZED', 'ACCESS_DENIED'];

/**
 * @description An error of the SensorPush API.
 */
class SensorPushError extends Error {
  /**
   * @param {string} kind - `auth` (credentials refused), `token` (the access
   * token refused), `rate_limit`, `server`, `http`, `unreachable`, `failed`.
   * @param {string} message - What went wrong (never a credential).
   * @param {object} [extra] - `{ status, code, endpoint, retryAfter }`.
   */
  constructor(kind, message, extra = {}) {
    super(message);
    this.name = 'SensorPushError';
    this.kind = kind;
    Object.assign(this, extra);
  }
}

/**
 * @description The seconds of a Retry-After header (a number or an HTTP date).
 * @param {string|null} header - The header.
 * @param {number} now - Now (ms).
 * @returns {number|null} Seconds, null when absent or unreadable.
 */
function retryAfterSeconds(header, now) {
  if (header === null || header === undefined || header === '') {
    return null;
  }
  const seconds = Number(header);
  if (Number.isFinite(seconds)) {
    return Math.max(0, seconds);
  }
  const date = Date.parse(header);
  return Number.isFinite(date) ? Math.max(0, Math.round((date - now) / 1000)) : null;
}

/**
 * @description When a JWT expires, from its `exp` claim (never verified: only read).
 * @param {string} token - The JWT.
 * @returns {number|null} The instant (ms), null when unreadable.
 */
function jwtExpiry(token) {
  const payload = String(token ?? '').split('.')[1];
  if (!payload) {
    return null;
  }
  try {
    const claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    const exp = Number(claims?.exp);
    return Number.isFinite(exp) && exp > 0 ? exp * 1000 : null;
  } catch {
    return null;
  }
}

/**
 * @description The SensorPush client.
 * @param {object} options - Options.
 * @param {Function} options.getCredentials - `() => ({ email, password })`.
 * @param {string} options.userAgent - The User-Agent of every request.
 * @param {Function} [options.fetch] - The fetch implementation (tests).
 * @param {string} [options.baseUrl] - The API root (tests).
 * @param {number} [options.dataSpacingMs] - Minimum time between two data requests.
 * @param {Function} [options.now] - `() => number` in ms.
 * @param {Function} [options.sleep] - `(ms) => Promise` (tests).
 * @returns {object} The client.
 */
function createSensorPushClient({
  getCredentials,
  userAgent,
  fetch: fetchFn = globalThis.fetch,
  baseUrl = BASE_URL,
  dataSpacingMs = DATA_SPACING_MS,
  now = () => Date.now(),
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
}) {
  let chain = Promise.resolve();
  let lastDataStart = -Infinity;
  let lastAuthEnd = -Infinity;
  let pausedUntil = 0;
  let failures = 0;
  let token = null;
  let requests = 0;
  let signIns = 0;
  const dataStarts = [];

  /**
   * @description Run a function in the queue: one request at a time.
   * @param {Function} run - `() => Promise`.
   * @returns {Promise<*>} Its result.
   */
  function queued(run) {
    const result = chain.then(run);
    chain = result.catch(() => {});
    return result;
  }

  /**
   * @description Wait until an instant.
   * @param {number} at - The instant (ms).
   * @returns {Promise<void>}
   */
  async function waitUntil(at) {
    const wait = at - now();
    if (wait > 0) {
      await sleep(wait);
    }
  }

  /**
   * @description Pause every request after a failure of the service.
   * @param {number|null} [retryAfter] - Seconds asked by the service.
   */
  function pause(retryAfter = null) {
    failures += 1;
    const backoff = MIN_PAUSE_MS * 2 ** Math.min(failures - 1, 5);
    const asked = Number.isFinite(retryAfter) ? retryAfter * 1000 : 0;
    pausedUntil = Math.max(
      pausedUntil,
      now() + Math.min(Math.max(backoff, asked, MIN_PAUSE_MS), MAX_PAUSE_MS),
    );
  }

  /**
   * @description POST a JSON body now.
   * @param {string} path - The path under the base.
   * @param {object} body - The body.
   * @param {object} [headers] - More headers.
   * @returns {Promise<{ response: Response, body: object|null }>} The answer.
   */
  async function post(path, body, headers = {}) {
    if (pausedUntil > now()) {
      throw new SensorPushError('rate_limit', 'SensorPush paused after errors', {
        endpoint: path,
        retryAfter: Math.ceil((pausedUntil - now()) / 1000),
      });
    }
    requests += 1;
    let response;
    try {
      response = await fetchFn(`${baseUrl}/${path}`, {
        method: 'POST',
        headers: {
          'user-agent': userAgent,
          accept: 'application/json',
          'content-type': 'application/json',
          ...headers,
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (err) {
      pause();
      throw new SensorPushError('unreachable', `SensorPush unreachable: ${err.message}`, {
        endpoint: path,
      });
    }
    const text = await response.text().catch(() => '');
    let json;
    try {
      const parsed = JSON.parse(text);
      json = parsed && typeof parsed === 'object' ? parsed : null;
    } catch {
      json = null;
    }
    if (response.status === 429) {
      pause(retryAfterSeconds(response.headers.get('retry-after'), now()));
      throw new SensorPushError('rate_limit', `HTTP 429 on ${path}`, {
        status: 429,
        endpoint: path,
      });
    }
    if (response.status >= 500) {
      pause();
      throw new SensorPushError('server', `HTTP ${response.status} on ${path}`, {
        status: response.status,
        endpoint: path,
      });
    }
    return { response, body: json };
  }

  /**
   * @description Sign in: authorize, then an access token.
   * @returns {Promise<object>} `{ accessToken, expiresAt }`.
   */
  async function signIn() {
    const { email, password } = getCredentials();
    if (!email || !password) {
      throw new SensorPushError('auth', 'No e-mail or password', {
        code: 'missing',
        endpoint: 'oauth/authorize',
      });
    }
    await waitUntil(lastAuthEnd + AUTH_SPACING_MS);
    signIns += 1;
    let authorization;
    try {
      const { response, body } = await post('oauth/authorize', { email, password });
      if (response.status === 400 || response.status === 401 || response.status === 403) {
        token = null;
        // 400: the password does not follow the rules of SensorPush (8
        // characters at least); 403 "invalid user": an unknown account, a
        // wrong password, or an account whose API access is not activated.
        const code = response.status === 400 ? 'invalid_password' : 'refused';
        throw new SensorPushError(
          'auth',
          `SensorPush refused the sign-in (HTTP ${response.status})`,
          {
            status: response.status,
            code,
            endpoint: 'oauth/authorize',
          },
        );
      }
      if (!response.ok) {
        throw new SensorPushError('http', `HTTP ${response.status} on oauth/authorize`, {
          status: response.status,
          endpoint: 'oauth/authorize',
        });
      }
      authorization = typeof body?.authorization === 'string' ? body.authorization.trim() : '';
      if (!authorization) {
        throw new SensorPushError('failed', 'The sign-in gave no authorization', {
          endpoint: 'oauth/authorize',
        });
      }
    } finally {
      lastAuthEnd = now();
    }
    await waitUntil(lastAuthEnd + AUTH_SPACING_MS);
    try {
      const { response, body } = await post('oauth/accesstoken', { authorization });
      if (!response.ok) {
        throw new SensorPushError('token', `HTTP ${response.status} on oauth/accesstoken`, {
          status: response.status,
          endpoint: 'oauth/accesstoken',
        });
      }
      const accessToken = typeof body?.accesstoken === 'string' ? body.accesstoken.trim() : '';
      if (!accessToken) {
        throw new SensorPushError('failed', 'The sign-in gave no access token', {
          endpoint: 'oauth/accesstoken',
        });
      }
      token = { accessToken, expiresAt: jwtExpiry(accessToken) ?? now() + DEFAULT_TOKEN_MS };
      failures = 0;
      return token;
    } finally {
      lastAuthEnd = now();
    }
  }

  /**
   * @description The access token: the one kept while valid, else a new sign-in.
   * @returns {Promise<string>} The token.
   */
  async function accessToken() {
    if (token && token.expiresAt - RENEW_BEFORE_MS > now()) {
      return token.accessToken;
    }
    return (await signIn()).accessToken;
  }

  /**
   * @description A data request: spaced from the previous one, with one new
   * sign-in when the token is refused.
   * @param {string} path - The path.
   * @param {object} body - The body.
   * @returns {Promise<object>} The JSON answer.
   */
  function data(path, body) {
    return queued(async () => {
      for (let attempt = 0; attempt < 2; attempt += 1) {
        const bearer = await accessToken();
        await waitUntil(lastDataStart + dataSpacingMs);
        lastDataStart = now();
        dataStarts.push(lastDataStart);
        if (dataStarts.length > 50) dataStarts.shift();
        const { response, body: answer } = await post(path, body, { authorization: bearer });
        const refused =
          response.status === 401 ||
          response.status === 403 ||
          (response.status === 400 && TOKEN_TYPES.includes(answer?.type));
        if (refused) {
          token = null;
          if (attempt === 0) {
            continue;
          }
          throw new SensorPushError(
            'token',
            `SensorPush refused the access token (HTTP ${response.status})`,
            {
              status: response.status,
              endpoint: path,
            },
          );
        }
        if (!response.ok) {
          throw new SensorPushError('http', `HTTP ${response.status} on ${path}`, {
            status: response.status,
            endpoint: path,
          });
        }
        if (!answer) {
          throw new SensorPushError('failed', `Unexpected answer of ${path}`, { endpoint: path });
        }
        failures = 0;
        return answer;
      }
      throw new SensorPushError('failed', `No answer of ${path}`, { endpoint: path });
    });
  }

  return {
    /**
     * @description Sign in now (the test button), whatever the token kept.
     * @returns {Promise<object>} `{ accessToken, expiresAt }`.
     */
    signIn: () =>
      queued(() => {
        token = null;
        return signIn();
      }),
    /**
     * @description The sensors of the account.
     * @returns {Promise<object>} The map of the sensors.
     */
    sensors: () => data('devices/sensors', {}),
    /**
     * @description The gateways of the account.
     * @returns {Promise<object>} The map of the gateways.
     */
    gateways: () => data('devices/gateways', {}),
    /**
     * @description Samples.
     * @param {object} query - `{ limit, sensors, startTime }`.
     * @returns {Promise<object>} The samples.
     */
    samples: (query) => data('samples', query),
    /**
     * @description Forget the access token (another account).
     */
    forgetToken() {
      token = null;
    },
    /**
     * @description When the next data request can start.
     * @returns {number} The instant (ms).
     */
    nextDataAt: () => Math.max(lastDataStart + dataSpacingMs, pausedUntil),
    /**
     * @description Until when the client pauses after errors (0: not paused).
     * @returns {number} The instant (ms).
     */
    pausedUntil: () => (pausedUntil > now() ? pausedUntil : 0),
    /**
     * @description When the access token expires (null: none kept).
     * @returns {number|null} The instant (ms).
     */
    tokenExpiresAt: () => token?.expiresAt ?? null,
    /**
     * @description The starts of the last data requests (tests, diagnostic).
     * @returns {number[]} The instants (ms).
     */
    dataStarts: () => [...dataStarts],
    /**
     * @description How many requests and sign-ins were sent since the start.
     * @returns {{ requests: number, signIns: number }} The counts.
     */
    counts: () => ({ requests, signIns }),
  };
}

export {
  BASE_URL,
  DATA_SPACING_MS,
  MIN_PAUSE_MS,
  MAX_PAUSE_MS,
  RENEW_BEFORE_MS,
  SensorPushError,
  retryAfterSeconds,
  jwtExpiry,
  createSensorPushClient,
};
