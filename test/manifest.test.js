import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { TRIGGERS, SCENE_ACTIONS, SENSOR_OUTPUTS, HISTORY_OUTPUTS, SIDES } from '../src/events.js';
import { ACTIONS, MAX_HISTORY_HOURS } from '../src/app.js';
import { WIDGETS } from '../src/widgets.js';
import {
  AUTO_LANGUAGE,
  SAMPLE_INTERVALS,
  DEFAULT_SAMPLE_MINUTES,
  SILENT_DELAYS,
  DEFAULT_SILENT_MINUTES,
  UNIT_SYSTEMS,
  normalizeConfig,
} from '../src/config.js';
import { ALERT_MEASURES } from '../src/parse.js';
import { LANGUAGES } from '../src/i18n.js';

const read = (path) => JSON.parse(readFileSync(new URL(path, import.meta.url), 'utf8'));
const manifest = read('../gladys-assistant-integration.json');
const pkg = read('../package.json');
const byKey = (list) => new Map(list.map((entry) => [entry.key, entry]));
const values = (field) => field.options.map((option) => option.value);
const source = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');
const REPO = 'William-De71/gladys-sensorpush-cloud';

test('a device integration, in lockstep with package.json, at 0.x until 1.0.0 is decided', () => {
  assert.equal(manifest.type, 'device');
  assert.equal(manifest.name, 'SensorPush Cloud');
  assert.equal(manifest.version, pkg.version);
  assert.match(pkg.version, /^0\./);
  assert.equal(
    manifest.docker_image,
    `ghcr.io/william-de71/gladys-sensorpush-cloud:${pkg.version}`,
  );
  assert.equal(manifest.cover_image, `https://raw.githubusercontent.com/${REPO}/main/cover.jpg`);
  assert.equal(pkg.license, 'Apache-2.0');
  assert.equal(pkg.name, 'gladys-sensorpush-cloud');
});

test('declares the cloud transport: api.sensorpush.com only, every request through the client', () => {
  assert.deepEqual(manifest.transports, ['cloud']);
  const api = source('../src/sensorpush-api.js');
  assert.match(api, /https:\/\/api\.sensorpush\.com\/api\/v1/);
  for (const path of [
    'oauth/authorize',
    'oauth/accesstoken',
    'devices/sensors',
    'devices/gateways',
    'samples',
  ]) {
    assert.ok(api.includes(`'${path}'`), path);
  }
  assert.doesNotMatch(api, /'tags'|reports\//, 'never writes tags, never asks bulk reports');
  for (const file of [
    'app',
    'parse',
    'events',
    'widgets',
    'device',
    'store',
    'time',
    'config',
    'units',
  ]) {
    assert.doesNotMatch(
      source(`../src/${file}.js`),
      /fetch\(|node:https?|node:net|node:dgram/,
      file,
    );
  }
  // A single channel: no transport to publish per device.
  assert.doesNotMatch(source('../src/app.js'), /publishTransports|GLADYS_PREFER_LOCAL/);
});

test('Gladys 5.3.0 for the catalog keywords, worldwide, no permission', () => {
  assert.equal(manifest.gladys_version, '>=5.3.0');
  assert.deepEqual(manifest.categories, ['environment', 'climate']);
  assert.equal(manifest.countries, undefined, 'sold worldwide');
  assert.ok(manifest.keywords.length >= 1 && manifest.keywords.length <= 10);
  const lower = manifest.keywords.map((word) => word.toLowerCase());
  assert.equal(new Set(lower).size, lower.length, 'unique keywords');
  for (const word of manifest.keywords) {
    assert.ok(word.length >= 2 && word.length <= 30, word);
  }
  for (const key of [
    'location',
    'network_wake',
    'containers',
    'network_discovery',
    'webhooks',
    'messaging',
    'energy_contracts',
    'music',
  ]) {
    assert.equal(manifest[key], undefined, key);
  }
});

test('config_schema: the fields the code reads, with their defaults', () => {
  const config = byKey(manifest.config_schema);
  assert.equal(config.get('email').type, 'string');
  assert.equal(config.get('password').type, 'secret');
  assert.deepEqual(values(config.get('sample_interval')), SAMPLE_INTERVALS);
  assert.equal(config.get('sample_interval').default, String(DEFAULT_SAMPLE_MINUTES));
  assert.deepEqual(values(config.get('silent_after')), SILENT_DELAYS);
  assert.equal(config.get('silent_after').default, String(DEFAULT_SILENT_MINUTES));
  assert.deepEqual(values(config.get('scene_units')), UNIT_SYSTEMS);
  assert.deepEqual(values(config.get('language')), [AUTO_LANGUAGE, ...LANGUAGES]);
  for (const field of manifest.config_schema) {
    assert.ok(!['text', 'password'].includes(field.type), `${field.key}: string / secret only`);
  }
  assert.deepEqual(normalizeConfig(), {
    email: '',
    password: '',
    sampleMinutes: 1,
    silentMinutes: 30,
    units: 'metric',
    language: AUTO_LANGUAGE,
  });
  assert.equal(normalizeConfig({ sample_interval: '3', silent_after: 'x' }).sampleMinutes, 1);
  assert.equal(normalizeConfig({ password: '  secret ' }).password, '  secret ', 'kept as typed');
});

test('configuration actions, widgets, triggers and scene actions match the code', () => {
  assert.deepEqual(
    manifest.actions.map((action) => action.key),
    Object.values(ACTIONS),
  );
  assert.deepEqual(
    manifest.widgets.map((widget) => widget.key),
    Object.values(WIDGETS),
  );
  assert.deepEqual(
    manifest.scene_triggers.map((trigger) => trigger.key),
    Object.values(TRIGGERS),
  );
  assert.deepEqual(
    manifest.scene_actions.map((action) => action.key),
    Object.values(SCENE_ACTIONS),
  );
  const actions = byKey(manifest.scene_actions);
  assert.deepEqual(
    actions.get('get_sensor').outputs.map((o) => o.key),
    SENSOR_OUTPUTS,
  );
  assert.deepEqual(
    actions.get('get_history').outputs.map((o) => o.key),
    HISTORY_OUTPUTS,
  );
  const hours = byKey(actions.get('get_history').fields).get('hours');
  assert.equal(hours.max, MAX_HISTORY_HOURS);
  assert.equal(hours.required, false, 'a new field never breaks a saved scene');
  for (const action of manifest.scene_actions) {
    assert.ok(action.timeout_seconds >= 5 && action.timeout_seconds <= 120, action.key);
  }
  // The history may wait for the next free minute, then sign in and read.
  assert.equal(actions.get('get_history').timeout_seconds, 120);
  const triggers = byKey(manifest.scene_triggers);
  const out = byKey(triggers.get('out_of_range').fields);
  assert.deepEqual(values(out.get('measure')), ALERT_MEASURES);
  assert.deepEqual(values(out.get('side')), SIDES);
  for (const trigger of manifest.scene_triggers) {
    assert.ok((trigger.fields ?? []).length <= 10, trigger.key);
    assert.ok(trigger.variables.length <= 20, trigger.key);
  }
  assert.ok(manifest.scene_triggers.length <= 20);
  assert.ok(manifest.widgets.length >= 1 && manifest.widgets.length <= 5);
  for (const widget of manifest.widgets) {
    for (const setting of widget.settings ?? []) {
      assert.ok(!['secret', 'oauth2', 'account_link'].includes(setting.type), setting.key);
    }
  }
});
