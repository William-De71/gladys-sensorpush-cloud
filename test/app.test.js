// The whole integration against the fake Gladys of the SDK
// (`@gladysassistant/integration-sdk/testing`), which checks the discovered
// devices, the states and the scene events like the host API does, and a fake
// SensorPush (test/helpers/fake-sensorpush.js), an in-memory fetch on a fake
// clock. No test touches the network.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import { validateWidgetContent } from '@gladysassistant/integration-sdk';

import { createApp, ACTIONS, ACCESS_RETRY_MS, LIST_EVERY_MS } from '../src/app.js';
import { WIDGETS } from '../src/widgets.js';
import { TRIGGERS, SCENE_ACTIONS, SENSOR_OUTPUTS, HISTORY_OUTPUTS } from '../src/events.js';
import { DATA_SPACING_MS } from '../src/sensorpush-api.js';
import { FILE } from '../src/store.js';
import { LANGUAGES } from '../src/i18n.js';
import {
  createFakeSensorPush,
  dataDir,
  recordingLogger,
  EMAIL,
  PASSWORD,
} from './helpers/fake-sensorpush.js';

const NOW = Date.parse('2026-10-27T10:00:00Z');
const SECOND = 1000;
const MINUTE = 60 * SECOND;
const CONFIG = { email: EMAIL, password: PASSWORD, language: 'en' };
const PREFIX = 'ext:test-integration';
const CELLAR = '16855.27453475893';
const GREENHOUSE = '21422.4417761108';
const ATTIC = '9031.11223344';
const sensorId = (id, feature) =>
  `${PREFIX}:sensor:${id.replace('.', '-')}${feature ? `:${feature}` : ''}`;

/**
 * @description The integration, connected to a fake Gladys and a fake SensorPush.
 * @param {object} t - The test context.
 * @param {object} [options] - `{ config, dir, clock, fake }`.
 * @returns {Promise<object>} `{ gladys, app, fake, clock, dir, logger }`.
 */
async function startApp(t, { config = CONFIG, dir = dataDir(), clock = { now: NOW }, fake } = {}) {
  fake ??= createFakeSensorPush({ clock });
  fake.clock = clock;
  const logger = recordingLogger();
  const gladys = createFakeGladys({ config });
  const app = createApp(gladys, {
    fetch: (url, init) => fake.fetch(url, init),
    baseUrl: fake.baseUrl,
    dataDir: dir,
    now: () => clock.now,
    sleep: async (ms) => {
      clock.now += ms;
    },
    timeZone: 'Europe/Paris',
    timers: false,
    logger,
  });
  await gladys.connect();
  await app.whenReady();
  t.after(async () => {
    await gladys.fake.shutdown().catch(() => {});
  });
  return { gladys, app, fake, clock, dir, logger };
}

/**
 * @description Run the timer like the real one (every 15 s) for a while.
 * @param {object} env - `{ app, clock }`.
 * @param {number} ms - How long.
 */
async function run({ app, clock }, ms) {
  const end = clock.now + ms;
  while (clock.now < end) {
    await app.tick();
    clock.now += 15 * SECOND;
  }
}

/**
 * @description Create every offered device, like the user would.
 * @param {object} gladys - The fake Gladys.
 */
async function createAll(gladys) {
  for (const device of gladys.fake.discoveredDevices) {
    await gladys.fake.deviceCreated(structuredClone(device));
  }
}
const widget = async (gladys, key, options) =>
  (await gladys.fake.widgetGet(key, options)).data.content;
const events = (gladys, key) => gladys.fake.sceneEvents.filter((event) => event.key === key);
const lastState = (gladys, id) =>
  gladys.fake.states.filter((state) => state.device_feature_external_id === id).at(-1);

test('startup: sign-in and the sensors, then the samples, then the gateways; one data request a minute', async (t) => {
  const env = await startApp(t);
  const { gladys, fake } = env;
  assert.deepEqual(fake.calls, [], 'no request before the timer');
  assert.equal(gladys.fake.connectionStatus.connected, true);
  await run(env, 3 * MINUTE + 15 * SECOND);
  assert.deepEqual(
    fake.calls.map((call) => call.path),
    [
      '/oauth/authorize',
      '/oauth/accesstoken',
      '/devices/sensors',
      '/samples',
      '/devices/gateways',
      '/samples',
    ],
  );
  assert.deepEqual(fake.callsTo('/samples')[0].body, { limit: 1 });
  assert.deepEqual(
    gladys.fake.discoveredDevices.map((device) => [
      device.name,
      device.features.map((feature) => feature.external_id.split(':').pop()),
    ]),
    [
      ['Cave à vin', ['temperature', 'humidity', 'dewpoint', 'vpd']],
      ['Grenier', ['temperature', 'humidity']],
      ['Serre', ['temperature', 'humidity', 'dewpoint', 'pressure', 'vpd']],
      ['SensorPush gateway Maison', ['status', 'version']],
    ],
  );
  assert.deepEqual(gladys.fake.connectionStatus.message, {
    en: 'Connected: 3 sensor(s), 1 gateway(s).',
    fr: 'Connecté : 3 capteur(s), 1 passerelle(s).',
    de: 'Verbunden: 3 Sensor(en), 1 Gateway(s).',
    es: 'Conectado: 3 sensor(es), 1 pasarela(s).',
  });
  assert.deepEqual(gladys.fake.states, [], 'no state before the devices exist');
  assert.deepEqual(gladys.fake.sceneEvents, [], 'never at the first reading');
});

test('over an hour, never two data requests within a minute; the lists every 15 minutes', async (t) => {
  const env = await startApp(t);
  await run(env, 60 * MINUTE);
  const starts = env.fake.dataCalls().map((call) => call.at);
  for (let i = 1; i < starts.length; i += 1) {
    assert.ok(starts[i] - starts[i - 1] >= 60 * SECOND, `gap ${i}`);
  }
  assert.ok(starts.length >= 55 && starts.length <= 60, `${starts.length} requests`);
  assert.equal(env.fake.callsTo('/devices/sensors').length, 4);
  assert.equal(env.fake.callsTo('/devices/gateways').length, 4);
  // The token lasts an hour (its exp): renewed 5 minutes before.
  assert.equal(env.fake.callsTo('/oauth/authorize').length, 2);
  assert.deepEqual(env.app.api.dataStarts().slice(-1), [starts.at(-1)]);
});

test('the sample interval of the configuration is followed', async (t) => {
  const env = await startApp(t, { config: { ...CONFIG, sample_interval: '5' } });
  await run(env, 30 * MINUTE);
  const samples = env.fake.callsTo('/samples').map((call) => call.at);
  for (let i = 1; i < samples.length; i += 1) {
    assert.ok(samples[i] - samples[i - 1] >= 5 * MINUTE - 5 * SECOND, `gap ${i}`);
  }
  assert.ok(samples.length >= 5 && samples.length <= 7, `${samples.length}`);
});

test('states once the devices exist, °F converted, pressure in hPa; the gateway connected', async (t) => {
  const env = await startApp(t);
  const { gladys } = env;
  await run(env, 3 * MINUTE);
  await createAll(gladys);
  assert.equal(lastState(gladys, sensorId(CELLAR, 'temperature')).state, 13);
  assert.equal(lastState(gladys, sensorId(CELLAR, 'humidity')).state, 68.2);
  assert.equal(lastState(gladys, sensorId(GREENHOUSE, 'pressure')).state, 1013.2);
  assert.equal(lastState(gladys, sensorId(GREENHOUSE, 'vpd')).state, 1.18);
  assert.equal(lastState(gladys, sensorId(ATTIC, 'temperature')).state, 16);
  assert.equal(lastState(gladys, `${PREFIX}:gateway:Maison:status`).text, 'Connected');
  assert.equal(lastState(gladys, `${PREFIX}:gateway:Maison:version`).text, '1.1.3(17)');
  // A new sample: only what changed is sent.
  const before = gladys.fake.states.length;
  env.fake.addSample(CELLAR, {
    observed: new Date(env.clock.now).toISOString(),
    temperature: 59,
    humidity: 68.2,
    dewpoint: 45.1,
    vpd: 0.42,
  });
  await run(env, 2 * MINUTE);
  const sent = gladys.fake.states.slice(before).map((state) => state.device_feature_external_id);
  assert.deepEqual(sent, [sensorId(CELLAR, 'temperature')]);
  assert.equal(lastState(gladys, sensorId(CELLAR, 'temperature')).state, 15);
});

test('scene triggers: outside the SensorPush range and back, silent and back, gateway down and up', async (t) => {
  const env = await startApp(t);
  const { gladys, fake, clock } = env;
  await run(env, 3 * MINUTE);
  // Humidity 68.2 % is already above the 60 % of the cellar: learned, not announced.
  assert.deepEqual(gladys.fake.sceneEvents, []);
  const sample = (temperature, humidity) =>
    fake.addSample(CELLAR, {
      observed: new Date(clock.now).toISOString(),
      temperature,
      humidity,
      dewpoint: 45,
      vpd: 0.4,
    });
  sample(55, 50);
  await run(env, 2 * MINUTE);
  assert.equal(events(gladys, TRIGGERS.BACK_IN_RANGE).length, 1);
  assert.equal(events(gladys, TRIGGERS.BACK_IN_RANGE)[0].data.measure, 'humidity');
  sample(80, 50);
  await run(env, 2 * MINUTE);
  const out = events(gladys, TRIGGERS.OUT_OF_RANGE);
  assert.equal(out.length, 1);
  assert.equal(out[0].data.measure, 'temperature');
  assert.equal(out[0].data.side, 'above');
  assert.equal(out[0].data.sensor, sensorId(CELLAR));
  assert.equal(out[0].data.value, 26.7);
  assert.equal(out[0].data.unit, '°C');
  // 35 minutes without anything new: every sensor silent, the gateway down.
  await run(env, 35 * MINUTE);
  assert.equal(events(gladys, TRIGGERS.SENSOR_SILENT).length, 3);
  assert.equal(events(gladys, TRIGGERS.GATEWAY_DISCONNECTED).length, 1);
  fake.account.gateways.Maison.last_seen = new Date(clock.now).toISOString();
  sample(60, 50);
  await run(env, 16 * MINUTE);
  assert.equal(events(gladys, TRIGGERS.SENSOR_BACK).length, 1);
  assert.equal(events(gladys, TRIGGERS.GATEWAY_RECONNECTED).length, 1);
  assert.equal(events(gladys, TRIGGERS.BACK_IN_RANGE).length, 2, 'the temperature came back');
});

test('access refused: a clear status, the trigger once, a new try every 30 minutes', async (t) => {
  const env = await startApp(t, { config: { ...CONFIG, password: 'not-the-password' } });
  const { gladys, fake } = env;
  await run(env, 10 * MINUTE);
  assert.equal(gladys.fake.connectionStatus.connected, false);
  assert.match(gladys.fake.connectionStatus.message.en, /refused the sign-in/);
  assert.match(gladys.fake.connectionStatus.message.fr, /dashboard\.sensorpush\.com/);
  const refused = events(gladys, TRIGGERS.ACCESS_REFUSED);
  assert.equal(refused.length, 1);
  assert.equal(refused[0].data.reason, 'refused');
  assert.equal(fake.callsTo('/oauth/authorize').length, 1);
  await run(env, ACCESS_RETRY_MS);
  assert.equal(fake.callsTo('/oauth/authorize').length, 2);
  assert.equal(events(gladys, TRIGGERS.ACCESS_REFUSED).length, 1, 'once per refusal');
  // The right password: everything resumes.
  await gladys.fake.configUpdated({ ...CONFIG });
  await run(env, 2 * MINUTE);
  assert.equal(gladys.fake.connectionStatus.connected, true);
});

test('a short password: the rule of SensorPush in the status', async (t) => {
  const env = await startApp(t, { config: { ...CONFIG, password: 'short' } });
  await run(env, MINUTE);
  assert.match(env.gladys.fake.connectionStatus.message.en, /at least 8 characters/);
  const env2 = await startApp(t, { config: { language: 'en' } });
  await run(env2, MINUTE);
  assert.match(env2.gladys.fake.connectionStatus.message.en, /Enter the e-mail/);
  assert.deepEqual(env2.fake.calls, []);
});

test('errors of the service pause the readings and show in the status', async (t) => {
  const env = await startApp(t);
  await run(env, 3 * MINUTE);
  env.fake.failures['/samples'] = { status: 502, body: { message: 'Bad gateway' }, times: 1 };
  await run(env, MINUTE);
  assert.match(env.gladys.fake.connectionStatus.message.en, /paused for a while/);
  const at = env.clock.now;
  await run(env, MINUTE);
  assert.ok(
    env.fake.dataCalls().filter((call) => call.at >= at).length === 0,
    'nothing during the pause',
  );
  await run(env, 5 * MINUTE);
  assert.doesNotMatch(env.gladys.fake.connectionStatus.message.en, /paused/);
});

test('the store: /data/sensorpush.json in mode 0600, never the password nor the token; kept across restarts', async (t) => {
  const dir = dataDir();
  const clock = { now: NOW };
  const first = await startApp(t, { dir, clock });
  await run(first, 3 * MINUTE);
  const path = join(dir, FILE);
  assert.equal(statSync(path).mode & 0o777, 0o600);
  const text = readFileSync(path, 'utf8');
  assert.ok(!text.includes(PASSWORD));
  assert.ok(!text.includes(EMAIL));
  assert.doesNotMatch(text, /\.sig\d/, 'no access token');
  for (const line of first.logger.lines) {
    assert.ok(!line.includes(PASSWORD), line);
    assert.doesNotMatch(line, /\.sig\d/, line);
  }
  // A restart offers the devices at once, from what was kept.
  const second = await startApp(t, { dir, clock });
  assert.equal(second.gladys.fake.discoveredDevices.length, 4);
});

test('another account: what was read is forgotten', async (t) => {
  const dir = dataDir();
  const clock = { now: NOW };
  const first = await startApp(t, { dir, clock });
  await run(first, 3 * MINUTE);
  await first.gladys.fake.configUpdated({ ...CONFIG, email: 'someone@example.org' });
  assert.deepEqual(first.app.store.data.sensors, []);
  assert.deepEqual(first.app.store.data.latest, {});
});

test('scene action get_sensor: the last values, no request, in the units of the scenes', async (t) => {
  const env = await startApp(t, { config: { ...CONFIG, scene_units: 'us' } });
  await run(env, 3 * MINUTE);
  const before = env.fake.calls.length;
  const result = (
    await env.gladys.fake.sceneAction(SCENE_ACTIONS.GET_SENSOR, {
      sensor: sensorId(GREENHOUSE),
    })
  ).data.outputs;
  assert.equal(env.fake.calls.length, before, 'no request');
  assert.deepEqual(
    Object.keys(result).filter((key) => !SENSOR_OUTPUTS.includes(key)),
    [],
  );
  assert.equal(result.sensor_name, 'Serre');
  assert.equal(result.temperature, 71.6);
  assert.equal(result.pressure, 29.92);
  assert.equal(result.temperature_unit, '°F');
  assert.equal(result.battery_voltage, 3.02);
  assert.equal(result.signal, -64);
  assert.equal(result.is_silent, false);
  assert.match(result.summary, /^Serre: 71\.6 °F, humidity 55 %\.$/);
  const attic = (
    await env.gladys.fake.sceneAction(SCENE_ACTIONS.GET_SENSOR, {
      sensor: sensorId(ATTIC),
    })
  ).data.outputs;
  assert.equal(attic.pressure, undefined, 'no barometer on an HT1');
  const first = (await env.gladys.fake.sceneAction(SCENE_ACTIONS.GET_SENSOR, {})).data.outputs;
  assert.equal(first.sensor_name, 'Cave à vin', 'the first sensor by default');
});

test('scene action get_history: one request in the next free slot, min / max / average', async (t) => {
  const env = await startApp(t);
  const { fake, clock } = env;
  await run(env, 3 * MINUTE);
  for (let minutes = 1; minutes <= 120; minutes += 10) {
    fake.addSample(ATTIC, {
      observed: new Date(clock.now - minutes * MINUTE).toISOString(),
      temperature: 50 + minutes / 10,
      humidity: 40 + minutes / 20,
    });
  }
  const lastData = env.app.api.dataStarts().at(-1);
  const result = (
    await env.gladys.fake.sceneAction(SCENE_ACTIONS.GET_HISTORY, {
      sensor: sensorId(ATTIC),
      hours: 1,
    })
  ).data.outputs;
  const call = fake.callsTo('/samples').at(-1);
  assert.deepEqual(call.body.sensors, [ATTIC]);
  assert.equal(call.body.limit, 120);
  assert.ok(call.at - lastData >= DATA_SPACING_MS, 'waited for the slot');
  assert.deepEqual(
    Object.keys(result).filter((key) => !HISTORY_OUTPUTS.includes(key)),
    [],
  );
  assert.equal(result.sensor_name, 'Grenier');
  assert.ok(result.sample_count >= 5);
  assert.ok(result.temperature_min < result.temperature_max);
  assert.equal(result.temperature_unit, '°C');
  assert.equal(result.truncated, false);
  assert.match(result.summary, /^Grenier, last 1 h: temperature/);
});

test('widgets: valid contents in every language and both unit systems', async (t) => {
  const env = await startApp(t);
  const { gladys } = env;
  const empty = await widget(gladys, WIDGETS.OVERVIEW, { language: 'fr', units: 'metric' });
  assert.match(empty.components[0].text, /Lecture du compte SensorPush/);
  await run(env, 3 * MINUTE);
  for (const language of LANGUAGES) {
    for (const units of ['metric', 'us']) {
      const overview = await widget(gladys, WIDGETS.OVERVIEW, { language, units });
      assert.deepEqual(validateWidgetContent(overview), [], `${language} ${units}`);
      const sensor = await widget(gladys, WIDGETS.SENSOR, {
        language,
        units,
        settings: { sensor: sensorId(GREENHOUSE) },
      });
      assert.deepEqual(validateWidgetContent(sensor), [], `${language} ${units}`);
    }
  }
  const overview = await widget(gladys, WIDGETS.OVERVIEW, { language: 'en', units: 'us' });
  const list = overview.components.find((component) => component.type === 'card-list');
  assert.equal(list.items[0].title, 'Cave à vin', 'the sensor outside its range first');
  assert.equal(list.items[0].badge.text, 'Alert');
  assert.match(list.items[0].subtitle, /°F/);
  const sensor = await widget(gladys, WIDGETS.SENSOR, {
    language: 'en',
    units: 'metric',
    settings: { sensor: sensorId(GREENHOUSE) },
  });
  const tiles = sensor.components.filter((component) => component.type === 'value');
  assert.deepEqual(
    tiles.map((tile) => tile.label),
    ['Temperature', 'Humidity', 'Dew point', 'Pressure', 'VPD'],
  );
});

test('configuration buttons: test the connection, diagnostic without secrets', async (t) => {
  const env = await startApp(t);
  const message = (await env.gladys.fake.action(ACTIONS.TEST_CONNECTION)).data.message;
  assert.match(
    message.en,
    /^Connected to SensorPush: 3 sensor\(s\) \(Cave à vin, Grenier, Serre\)/,
  );
  assert.equal(env.fake.callsTo('/oauth/authorize').length, 1);
  const done = (await env.gladys.fake.action(ACTIONS.DIAGNOSTIC)).data.message;
  assert.match(done.en, /Diagnostic written/);
  const lines = env.logger.lines.filter((line) => line.includes('SensorPush diagnostic'));
  assert.ok(lines.length >= 1);
  for (const line of lines) {
    assert.ok(!line.includes(PASSWORD));
    assert.ok(!line.includes(EMAIL));
  }
  const refused = await startApp(t, { config: { ...CONFIG, password: 'not-the-password' } });
  const answer = (await refused.gladys.fake.action(ACTIONS.TEST_CONNECTION)).data.message;
  assert.match(answer.en, /refused the sign-in/);
});

test('a scan with nothing to offer reads the sensors again; device creation re-sends the states', async (t) => {
  const env = await startApp(t);
  await env.gladys.fake.scanRequest();
  await run(env, 3 * MINUTE);
  const before = env.gladys.fake.states.length;
  await createAll(env.gladys);
  assert.ok(env.gladys.fake.states.length > before);
  assert.ok(LIST_EVERY_MS >= 15 * MINUTE);
});
