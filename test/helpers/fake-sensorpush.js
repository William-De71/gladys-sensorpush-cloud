// -----------------------------------------------------------------------------
// A fake SensorPush Gateway Cloud API for the tests: an in-memory `fetch` (no
// network), answering like the real API (official Swagger definition, and the
// refusals seen live on 2026-10-27):
//   - POST /oauth/authorize { email, password }: a password under 8
//     characters answers 400 {"message":"Password must be at least 8
//     characters."}, another account or password 403 {"message":"invalid user"};
//   - POST /oauth/accesstoken { authorization }: an unknown authorization
//     answers 412 {"message":"invalid authorization token"};
//   - POST /devices/sensors, /devices/gateways, /samples: the access token in
//     the `Authorization` header; none answers 400 {"type":"UNAUTHORIZED"}, an
//     unknown one 400 {"type":"ACCESS_DENIED"}.
// Every call is recorded with the time of the clock of the test.
// Nothing starts on import (node --test also runs test/helpers/).
// -----------------------------------------------------------------------------

import { readFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * @description A temporary folder standing for /data.
 * @returns {string} The path.
 */
const dataDir = () => mkdtempSync(join(tmpdir(), 'gladys-sensorpush-'));

/**
 * @description A logger that keeps every line (to check what is never logged).
 * @returns {object} The logger, with `lines`.
 */
function recordingLogger() {
  const lines = [];
  const keep =
    (level) =>
    (...args) =>
      lines.push(
        `${level} ${args.map((arg) => (arg instanceof Error ? arg.stack : String(arg))).join(' ')}`,
      );
  return {
    lines,
    debug: keep('debug'),
    info: keep('info'),
    warn: keep('warn'),
    error: keep('error'),
  };
}

const BASE = 'https://sensorpush.test/api/v1';
const EMAIL = 'grower@example.org';
const PASSWORD = 'not-a-real-password';
const fixture = () =>
  JSON.parse(readFileSync(new URL('../fixtures/account.json', import.meta.url), 'utf8'));

const json = (status, body, headers = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });

/**
 * @description A JWT-shaped access token (never a real one).
 * @param {number} n - Its number.
 * @param {number} exp - Its expiry (seconds).
 * @returns {string} The token.
 */
function fakeJwt(n, exp) {
  const part = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
  return `${part({ alg: 'none' })}.${part({ exp, sub: 'not-a-real-sensorpush-access-token' })}.sig${n}`;
}

/**
 * @description The fake SensorPush.
 * @param {object} [options] - `{ account, email, password, clock }`.
 * @returns {object} `{ fetch, baseUrl, account, calls, … }`.
 */
function createFakeSensorPush({
  account = fixture(),
  email = EMAIL,
  password = PASSWORD,
  clock = { now: Date.now() },
} = {}) {
  const authorizations = new Set();
  const tokens = new Set();
  let issued = 0;
  const fake = {
    baseUrl: BASE,
    account,
    email,
    password,
    clock,
    calls: [],
    // `{ '/samples': { status, body, headers, times } }`: the next answers forced.
    failures: {},
    // Lifetime of the access tokens (seconds).
    tokenSeconds: 3600,
    /**
     * @description Forget every token issued (they answer 400 ACCESS_DENIED from now on).
     */
    revokeTokens() {
      tokens.clear();
    },
    /**
     * @description The requests to a path.
     * @param {string} path - `/samples`, `/devices/sensors`, `/oauth/authorize`.
     * @returns {object[]} The calls.
     */
    callsTo(path) {
      return fake.calls.filter((call) => call.path === path);
    },
    /**
     * @description The data requests (sensors, gateways, samples), in order.
     * @returns {object[]} The calls.
     */
    dataCalls() {
      return fake.calls.filter((call) => !call.path.startsWith('/oauth/'));
    },
    /**
     * @description Give a sensor a new sample, in the units of the API.
     * @param {string} id - The sensor id.
     * @param {object} sample - `{ observed, temperature (°F), humidity, … }`.
     */
    addSample(id, sample) {
      fake.account.samples[id] = [sample, ...(fake.account.samples[id] ?? [])];
    },
    /**
     * @description The fetch of the fake.
     * @param {string} url - The URL.
     * @param {object} [init] - The options.
     * @returns {Promise<Response>} The answer.
     */
    async fetch(url, init = {}) {
      const path = url.startsWith(BASE) ? url.slice(BASE.length) : url;
      const body = init.body ? JSON.parse(init.body) : null;
      const headers = init.headers ?? {};
      fake.calls.push({ path, method: init.method, body, headers, at: clock.now });
      const failure = fake.failures[path];
      if (failure && (failure.times ?? 1) > 0) {
        failure.times = (failure.times ?? 1) - 1;
        if (failure.throws) {
          throw new Error(failure.throws);
        }
        return json(failure.status, failure.body ?? {}, failure.headers ?? {});
      }
      if (init.method !== 'POST') {
        return json(405, { message: 'Method not allowed' });
      }
      if (path === '/oauth/authorize') {
        if (String(body?.password ?? '').length < 8) {
          return json(400, { message: 'Password must be at least 8 characters.' });
        }
        if (body?.email !== fake.email || body?.password !== fake.password) {
          return json(403, { message: 'invalid user' });
        }
        const authorization = `not-a-real-authorization-${authorizations.size + 1}`;
        authorizations.add(authorization);
        return json(200, { authorization });
      }
      if (path === '/oauth/accesstoken') {
        if (!authorizations.has(body?.authorization)) {
          return json(412, { message: 'invalid authorization token' });
        }
        issued += 1;
        const token = fakeJwt(issued, Math.floor(clock.now / 1000) + fake.tokenSeconds);
        tokens.add(token);
        return json(200, { accesstoken: token });
      }
      const bearer = headers.authorization;
      if (!bearer) {
        return json(400, { message: 'Unauthorized', type: 'UNAUTHORIZED', statusCode: '400' });
      }
      if (!tokens.has(bearer)) {
        return json(400, {
          message:
            'User is not authorized to access this resource with an explicit deny in an identity-based policy',
          type: 'ACCESS_DENIED',
          statusCode: '400',
        });
      }
      if (path === '/devices/sensors') {
        return json(200, fake.account.sensors);
      }
      if (path === '/devices/gateways') {
        return json(200, fake.account.gateways);
      }
      if (path === '/samples') {
        const wanted = Array.isArray(body?.sensors) ? body.sensors : null;
        const start = body?.startTime ? Date.parse(body.startTime) : null;
        const sensors = {};
        let total = 0;
        for (const [id, samples] of Object.entries(fake.account.samples)) {
          if (wanted && !wanted.includes(id)) continue;
          let list = samples.filter(
            (sample) => start === null || Date.parse(sample.observed) >= start,
          );
          if (!start) list = list.slice(0, body?.limit ?? 1);
          else list = list.slice(0, body?.limit ?? list.length);
          if (list.length) {
            sensors[id] = list;
            total += list.length;
          }
        }
        return json(200, {
          last_time: new Date(clock.now).toISOString(),
          sensors,
          status: 'OK',
          total_samples: total,
          total_sensors: Object.keys(sensors).length,
          truncated: false,
        });
      }
      return json(404, { message: 'Not found' });
    },
  };
  return fake;
}

export { createFakeSensorPush, dataDir, recordingLogger, fakeJwt, BASE, EMAIL, PASSWORD };
