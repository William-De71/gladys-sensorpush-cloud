// The SensorPush client against the fake API (an in-memory fetch, a fake
// clock): sign-in, token, refusals, the pace of one data request a minute.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createSensorPushClient,
  jwtExpiry,
  retryAfterSeconds,
  DATA_SPACING_MS,
  MIN_PAUSE_MS,
  MAX_PAUSE_MS,
} from '../src/sensorpush-api.js';
import { createFakeSensorPush, fakeJwt, EMAIL, PASSWORD } from './helpers/fake-sensorpush.js';

const NOW = Date.parse('2026-10-27T10:00:00Z');

/**
 * @description A client on the fake API.
 * @param {object} [options] - `{ credentials, fake }`.
 * @returns {object} `{ client, fake, clock }`.
 */
function setup({ credentials = { email: EMAIL, password: PASSWORD }, fake } = {}) {
  const clock = { now: NOW };
  fake ??= createFakeSensorPush({ clock });
  fake.clock = clock;
  const client = createSensorPushClient({
    getCredentials: () => credentials,
    userAgent: 'gladys-sensorpush-cloud/test',
    fetch: (url, init) => fake.fetch(url, init),
    baseUrl: fake.baseUrl,
    now: () => clock.now,
    sleep: async (ms) => {
      clock.now += ms;
    },
  });
  return { client, fake, clock };
}

test('signs in (authorize, then accesstoken), then sends the token as is', async () => {
  const { client, fake } = setup();
  const sensors = await client.sensors();
  assert.ok(sensors['16855.27453475893']);
  assert.deepEqual(
    fake.calls.map((call) => call.path),
    ['/oauth/authorize', '/oauth/accesstoken', '/devices/sensors'],
  );
  assert.deepEqual(fake.calls[0].body, { email: EMAIL, password: PASSWORD });
  const data = fake.calls[2];
  assert.equal(data.method, 'POST');
  assert.match(data.headers.authorization, /^[\w-]+\.[\w-]+\.sig1$/, 'no "Bearer" prefix');
  assert.equal(data.headers['content-type'], 'application/json');
  assert.match(data.headers['user-agent'], /^gladys-sensorpush-cloud\//);
  assert.equal(client.counts().signIns, 1);
});

test('one data request a minute at most, counted from the start of the previous one', async () => {
  const { client, fake } = setup();
  await client.sensors();
  await client.samples({ limit: 1 });
  await client.gateways();
  await client.samples({ limit: 1 });
  const starts = fake.dataCalls().map((call) => call.at);
  assert.equal(starts.length, 4);
  for (let i = 1; i < starts.length; i += 1) {
    assert.ok(
      starts[i] - starts[i - 1] >= DATA_SPACING_MS,
      `gap ${i}: ${starts[i] - starts[i - 1]}`,
    );
  }
  assert.ok(DATA_SPACING_MS > 60 * 1000);
});

test('the token is kept until its exp, renewed before', async () => {
  const { client, fake, clock } = setup();
  await client.sensors();
  assert.equal(client.tokenExpiresAt(), NOW + 1000 + 3600 * 1000);
  clock.now += 30 * 60 * 1000;
  await client.samples({ limit: 1 });
  assert.equal(fake.callsTo('/oauth/authorize').length, 1, 'still valid');
  clock.now += 27 * 60 * 1000;
  await client.samples({ limit: 1 });
  assert.equal(fake.callsTo('/oauth/authorize').length, 2, 'renewed 5 minutes before exp');
});

test('a refused token (400 ACCESS_DENIED) gets one new sign-in', async () => {
  const { client, fake } = setup();
  await client.sensors();
  fake.revokeTokens();
  const answer = await client.gateways();
  assert.ok(answer.Maison);
  assert.deepEqual(
    fake.calls.map((call) => call.path),
    [
      '/oauth/authorize',
      '/oauth/accesstoken',
      '/devices/sensors',
      '/devices/gateways',
      '/oauth/authorize',
      '/oauth/accesstoken',
      '/devices/gateways',
    ],
  );
});

test('a token refused twice is a token error', async () => {
  const { client, fake } = setup();
  fake.failures['/samples'] = {
    status: 400,
    body: { message: 'Unauthorized', type: 'UNAUTHORIZED', statusCode: '400' },
    times: 2,
  };
  await assert.rejects(client.samples({ limit: 1 }), { kind: 'token' });
});

test('sign-in refusals: unknown account 403, short password 400, no credentials', async () => {
  await assert.rejects(
    setup({ credentials: { email: 'other@example.org', password: PASSWORD } }).client.sensors(),
    { kind: 'auth', code: 'refused', status: 403 },
  );
  await assert.rejects(
    setup({ credentials: { email: EMAIL, password: 'short' } }).client.sensors(),
    { kind: 'auth', code: 'invalid_password', status: 400 },
  );
  const { client, fake } = setup({ credentials: { email: '', password: '' } });
  await assert.rejects(client.sensors(), { kind: 'auth', code: 'missing' });
  assert.deepEqual(fake.calls, [], 'nothing sent');
});

test('an invalid authorization (412) is a token error', async () => {
  const { client, fake } = setup();
  fake.failures['/oauth/accesstoken'] = {
    status: 412,
    body: { message: 'invalid authorization token' },
  };
  await assert.rejects(client.sensors(), { kind: 'token', status: 412 });
});

test('a 429, a 5xx or no answer pauses every request, longer each time, 30 minutes at most', async () => {
  const { client, fake, clock } = setup();
  await client.sensors();
  fake.failures['/samples'] = { status: 503, body: { message: 'down' }, times: 1 };
  await assert.rejects(client.samples({ limit: 1 }), { kind: 'server' });
  assert.equal(client.pausedUntil() - clock.now, MIN_PAUSE_MS);
  await assert.rejects(client.samples({ limit: 1 }), { kind: 'rate_limit' });
  clock.now += MIN_PAUSE_MS;
  fake.failures['/samples'] = { throws: 'socket hang up', times: 1 };
  await assert.rejects(client.samples({ limit: 1 }), { kind: 'unreachable' });
  assert.equal(client.pausedUntil() - clock.now, 2 * MIN_PAUSE_MS, 'doubled');
  clock.now += 2 * MIN_PAUSE_MS;
  fake.failures['/samples'] = { status: 429, headers: { 'retry-after': '7200' }, times: 1 };
  await assert.rejects(client.samples({ limit: 1 }), { kind: 'rate_limit', status: 429 });
  assert.equal(client.pausedUntil() - clock.now, MAX_PAUSE_MS, 'capped');
  clock.now += MAX_PAUSE_MS;
  assert.ok(await client.samples({ limit: 1 }));
  assert.equal(client.pausedUntil(), 0);
});

test('helpers: the exp of a JWT, Retry-After', () => {
  assert.equal(jwtExpiry(fakeJwt(1, 1800000000)), 1800000000 * 1000);
  assert.equal(jwtExpiry('not-a-jwt'), null);
  assert.equal(jwtExpiry('a.!!!.b'), null);
  assert.equal(retryAfterSeconds('120', NOW), 120);
  assert.equal(retryAfterSeconds(new Date(NOW + 90000).toUTCString(), NOW), 90);
  assert.equal(retryAfterSeconds(null, NOW), null);
});
