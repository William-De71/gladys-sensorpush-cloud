// The scene triggers, worked out from what was read: once per transition,
// never at the first reading; flat payloads within the limits of the core.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  TRIGGERS,
  GATEWAY_OFFLINE_MS,
  detectSensor,
  detectGateway,
  sensorEventData,
  gatewayEventData,
  pick,
  rounded,
} from '../src/events.js';

const MINUTE = 60 * 1000;
const NOW = Date.parse('2026-10-27T10:00:00Z');
const manifest = JSON.parse(
  readFileSync(new URL('../gladys-assistant-integration.json', import.meta.url), 'utf8'),
);
const variables = (key) =>
  manifest.scene_triggers.find((trigger) => trigger.key === key).variables.map((v) => v.key);

const sensor = {
  id: '16855.27453475893',
  alerts: {
    temperature: { enabled: true, min: 10, max: 25 },
    humidity: { enabled: false, min: 30, max: 60 },
  },
};
const sample = (minutesAgo, temperature, humidity = 50) => ({
  observed: NOW - minutesAgo * MINUTE,
  temperature,
  humidity,
});
const context = (now = NOW) => ({ now, silentMs: 30 * MINUTE });
const keys = (found) => found.events.map((event) => event.key);

/**
 * @description Check a payload: flat, scalars, at most 30 keys, declared variables only.
 * @param {string} key - The trigger.
 * @param {object} data - The payload.
 */
function checkPayload(key, data) {
  assert.ok(Object.keys(data).length <= 30, key);
  for (const [name, value] of Object.entries(data)) {
    assert.ok(
      value === null || ['string', 'number', 'boolean'].includes(typeof value),
      `${key}.${name}`,
    );
    if (typeof value === 'string') assert.ok(value.length <= 1000);
    assert.ok(variables(key).includes(name), `${key}.${name} is declared`);
  }
}

test('nothing at the first reading, even outside the range or silent', () => {
  const found = detectSensor(undefined, sensor, sample(60, 30), context());
  assert.deepEqual(found.events, []);
  assert.equal(found.next.silent, true);
  assert.deepEqual(detectSensor(undefined, sensor, null, context()).events, []);
});

test('out of range, then back: once per transition, the side given', () => {
  let seen = detectSensor(undefined, sensor, sample(1, 20), context()).next;
  let found = detectSensor(seen, sensor, sample(0, 26), context());
  assert.deepEqual(found.events, [
    { key: TRIGGERS.OUT_OF_RANGE, extra: { measure: 'temperature', side: 'above' } },
  ]);
  seen = found.next;
  assert.deepEqual(detectSensor(seen, sensor, sample(0, 27), context()).events, [], 'still above');
  found = detectSensor(seen, sensor, sample(0, 5), context());
  assert.deepEqual(keys(found), [TRIGGERS.OUT_OF_RANGE], 'from above to below');
  assert.equal(found.events[0].extra.side, 'below');
  seen = found.next;
  found = detectSensor(
    seen,
    sensor,
    { ...sample(0, 15), observed: NOW + 20 * MINUTE },
    context(NOW + 20 * MINUTE),
  );
  assert.deepEqual(keys(found), [TRIGGERS.BACK_IN_RANGE]);
  assert.equal(found.events[0].extra.previous, 'below');
  // A disabled alert watches nothing.
  assert.deepEqual(detectSensor(found.next, sensor, sample(0, 15, 95), context()).events, []);
});

test('an old sample says nothing new about the range', () => {
  const seen = detectSensor(undefined, sensor, sample(1, 20), context()).next;
  const found = detectSensor(seen, sensor, sample(45, 30), context());
  assert.deepEqual(keys(found), [TRIGGERS.SENSOR_SILENT]);
});

test('silent, then back with the length of the gap', () => {
  let seen = detectSensor(undefined, sensor, sample(0, 20), context()).next;
  const later = NOW + 40 * MINUTE;
  let found = detectSensor(seen, sensor, sample(0, 20), context(later));
  assert.deepEqual(keys(found), [TRIGGERS.SENSOR_SILENT]);
  seen = found.next;
  assert.deepEqual(detectSensor(seen, sensor, sample(0, 20), context(later + MINUTE)).events, []);
  const back = { observed: later + 2 * MINUTE, temperature: 20, humidity: 50 };
  found = detectSensor(seen, sensor, back, context(later + 2 * MINUTE));
  assert.deepEqual(keys(found), [TRIGGERS.SENSOR_BACK]);
  const data = sensorEventData(
    { deviceId: 'ext:x:sensor:1', name: 'Cave', sensor, sample: back },
    found.events[0],
    { language: 'fr', units: 'metric', now: later + 2 * MINUTE },
  );
  assert.equal(data.minutes_without_data, 42);
  checkPayload(TRIGGERS.SENSOR_BACK, data);
});

test('the payload of a range event, in the units of the scenes', () => {
  const view = { deviceId: 'ext:x:sensor:1', name: 'Cave', sensor, sample: sample(0, 26) };
  const data = sensorEventData(
    view,
    { key: TRIGGERS.OUT_OF_RANGE, extra: { measure: 'temperature', side: 'above' } },
    { language: 'en', units: 'us', now: NOW },
  );
  assert.deepEqual(data, {
    sensor: 'ext:x:sensor:1',
    sensor_name: 'Cave',
    sensor_id: sensor.id,
    measure: 'temperature',
    measure_label: 'Temperature',
    value: 78.8,
    unit: '°F',
    alert_min: 50,
    alert_max: 77,
    side: 'above',
    side_label: 'above the alert range',
  });
  checkPayload(TRIGGERS.OUT_OF_RANGE, data);
  const back = sensorEventData(
    view,
    {
      key: TRIGGERS.BACK_IN_RANGE,
      extra: { measure: 'temperature', previous: 'above', outSince: NOW - 10 * MINUTE },
    },
    { language: 'en', units: 'metric', now: NOW },
  );
  assert.equal(back.minutes_outside, 10);
  checkPayload(TRIGGERS.BACK_IN_RANGE, back);
});

test('a gateway: disconnected after 30 minutes without check-in, then reconnected', () => {
  const gateway = { key: 'Maison', name: 'Maison', lastSeen: NOW - 5 * MINUTE };
  let found = detectGateway(undefined, gateway, NOW);
  assert.deepEqual(found.events, []);
  const late = NOW + GATEWAY_OFFLINE_MS;
  found = detectGateway(found.next, gateway, late);
  assert.deepEqual(keys(found), [TRIGGERS.GATEWAY_DISCONNECTED]);
  const view = { gateway, deviceId: 'ext:x:gateway:Maison' };
  const down = gatewayEventData(view, found.events[0], late);
  assert.equal(down.minutes_since_seen, 35);
  checkPayload(TRIGGERS.GATEWAY_DISCONNECTED, down);
  assert.deepEqual(detectGateway(found.next, gateway, late + MINUTE).events, [], 'once');
  const back = { ...gateway, lastSeen: late + 10 * MINUTE };
  found = detectGateway(
    detectGateway(found.next, gateway, late + MINUTE).next,
    back,
    late + 10 * MINUTE,
  );
  assert.deepEqual(keys(found), [TRIGGERS.GATEWAY_RECONNECTED]);
  const up = gatewayEventData(
    { gateway: back, deviceId: view.deviceId },
    found.events[0],
    late + 10 * MINUTE,
  );
  assert.equal(up.minutes_offline, 45);
  checkPayload(TRIGGERS.GATEWAY_RECONNECTED, up);
});

test('helpers: pick keeps the declared, non-null outputs; rounded', () => {
  assert.deepEqual(pick({ a: 1, b: null, c: 3 }, ['a', 'b']), { a: 1 });
  assert.equal(rounded(1.256, 2), 1.26);
  assert.equal(rounded(NaN), null);
});
