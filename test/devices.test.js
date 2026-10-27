// The answers made safe, the unit conversions, and the discovered devices as
// the Gladys core expects them (the fake Gladys of the SDK does not check
// everything the core refuses: these tests do).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  DEVICE_FEATURE_CATEGORIES as C,
  DEVICE_FEATURE_TYPES as T,
  DEVICE_FEATURE_UNITS as U,
} from '@gladysassistant/integration-sdk';
import {
  parseSensors,
  parseGateways,
  parseSamples,
  parseSample,
  numberOf,
  toCelsius,
  toFahrenheit,
  toHectopascal,
  toInchesOfMercury,
  alertSide,
  measuresOf,
  MEASURES,
} from '../src/parse.js';
import {
  SENSOR_FEATURES,
  platformId,
  sensorOfExternalId,
  sensorName,
  buildSensorDevice,
  buildGatewayDevice,
  buildSensorStates,
  buildGatewayStates,
} from '../src/device.js';
import { convert, unitOf, decimalsOf } from '../src/units.js';
import { LANGUAGES } from '../src/i18n.js';

const fakeGladys = {
  externalIds: (type, id) => ({
    device: `ext:test-integration:${type}:${id}`,
    feature: (key) => `ext:test-integration:${type}:${id}:${key}`,
  }),
};
const account = JSON.parse(
  readFileSync(new URL('./fixtures/account.json', import.meta.url), 'utf8'),
);
const sensors = parseSensors(account.sensors);
const byType = (type) => sensors.find((sensor) => sensor.type === type);
const close = (actual, expected, digits = 2) =>
  assert.equal(Math.round(actual * 10 ** digits) / 10 ** digits, expected);

test('sensors: the active ones, by name, the key of the map as id, alerts in °C', () => {
  assert.deepEqual(
    sensors.map((sensor) => [sensor.name, sensor.id, sensor.type]),
    [
      ['Cave à vin', '16855.27453475893', 'HT.w'],
      ['Grenier', '9031.11223344', 'HT1'],
      ['Serre', '21422.4417761108', 'HTP.xw'],
    ],
  );
  const cellar = byType('HT.w');
  assert.equal(cellar.batteryVoltage, 2.91);
  assert.equal(cellar.rssi, -71);
  assert.deepEqual(cellar.alerts.temperature, { enabled: true, min: 10, max: 25 });
  assert.deepEqual(cellar.alerts.humidity, { enabled: true, min: 30, max: 60 });
  assert.deepEqual(byType('HT1').alerts, { temperature: null, humidity: null });
  assert.deepEqual(parseSensors(null), []);
  assert.deepEqual(parseSensors({ x: 'nope', y: null }), []);
});

test('gateways: dates read, paired as a boolean', () => {
  const [gateway] = parseGateways(account.gateways);
  assert.equal(gateway.key, 'Maison');
  assert.equal(gateway.lastSeen, Date.parse('2026-10-27T09:55:00.000Z'));
  assert.equal(gateway.paired, true);
  assert.equal(gateway.version, '1.1.3(17)');
  assert.equal(gateway.message, '');
  assert.deepEqual(parseGateways([]), []);
});

test('samples: °F -> °C, inHg -> hPa, the newest first, null never 0', () => {
  const { sensors: samples, truncated } = parseSamples({
    sensors: {
      a: [
        { observed: '2026-10-27T09:00:00Z', temperature: 32 },
        { observed: '2026-10-27T09:01:00Z', temperature: 212, humidity: '40' },
        { observed: 'nope', temperature: 50 },
      ],
      b: 'nope',
    },
    truncated: true,
  });
  assert.equal(truncated, true);
  assert.deepEqual(Object.keys(samples), ['a']);
  assert.equal(samples.a.length, 2);
  assert.equal(samples.a[0].temperature, 100);
  assert.equal(samples.a[0].humidity, 40);
  assert.equal(samples.a[1].temperature, 0);
  assert.equal(samples.a[1].humidity, null);
  const htp = parseSample(account.samples['21422.4417761108'][0]);
  close(htp.pressure, 1013.21);
  assert.equal(htp.vpd, 1.18);
  close(htp.dewpoint, 12.5);
  assert.deepEqual(measuresOf(htp), MEASURES);
  assert.deepEqual(measuresOf(parseSample(account.samples['9031.11223344'][0])), [
    'temperature',
    'humidity',
  ]);
  assert.equal(numberOf(''), null);
  assert.equal(numberOf(true), null);
  assert.equal(numberOf('1.5'), 1.5);
});

test('units: conversions both ways, the units of a user', () => {
  close(toCelsius(77), 25);
  close(toFahrenheit(25), 77);
  close(toInchesOfMercury(toHectopascal(29.92)), 29.92);
  assert.equal(convert('temperature', 20, 'metric'), 20);
  close(convert('dewpoint', 20, 'us'), 68);
  close(convert('pressure', 1013.21, 'us'), 29.92);
  assert.equal(convert('humidity', 40, 'us'), 40);
  assert.equal(convert('vpd', 1.2, 'us'), 1.2);
  assert.equal(convert('temperature', null, 'us'), null);
  assert.deepEqual(
    ['temperature', 'humidity', 'pressure', 'vpd'].map((m) => unitOf(m, 'us')),
    ['°F', '%', 'inHg', 'kPa'],
  );
  assert.deepEqual(
    ['temperature', 'humidity', 'pressure', 'vpd'].map((m) => decimalsOf(m, 'metric')),
    [1, 0, 0, 2],
  );
});

test('alert side: only for an enabled alert', () => {
  const alert = { enabled: true, min: 10, max: 25 };
  assert.equal(alertSide(26, alert), 'above');
  assert.equal(alertSide(9, alert), 'below');
  assert.equal(alertSide(20, alert), null);
  assert.equal(alertSide(30, { ...alert, enabled: false }), null);
  assert.equal(alertSide(null, alert), null);
  assert.equal(alertSide(5, null), null);
});

test('every feature: min, max, read_only, has_feedback, a pair the core knows', () => {
  // DEVICE_FEATURE_UNITS_BY_CATEGORY of the core (master, 2026-10-27).
  const allowed = {
    [C.TEMPERATURE_SENSOR]: [U.CELSIUS],
    [C.HUMIDITY_SENSOR]: [U.PERCENT],
    [C.PRESSURE_SENSOR]: [U.HECTO_PASCAL, U.KILO_PASCAL],
    [C.TEXT]: [null],
  };
  const devices = [
    buildSensorDevice(fakeGladys, byType('HTP.xw'), { seen: MEASURES }),
    buildGatewayDevice(fakeGladys, parseGateways(account.gateways)[0]),
  ];
  for (const device of devices) {
    assert.equal(device.should_poll, false, device.name);
    assert.equal(device.poll_frequency, undefined, 'own timer');
    for (const feature of device.features) {
      for (const key of ['min', 'max', 'read_only', 'has_feedback']) {
        assert.notEqual(feature[key], undefined, `${feature.external_id}.${key}`);
      }
      assert.equal(feature.read_only, true);
      assert.ok(allowed[feature.category]?.includes(feature.unit), feature.external_id);
      assert.ok(feature.min <= feature.max);
    }
  }
  const dewpoint = SENSOR_FEATURES.find((feature) => feature.key === 'dewpoint');
  assert.equal(dewpoint.type, T.TEMPERATURE_SENSOR.PROBE, 'kept out of the room average');
  assert.equal(T.TEMPERATURE_SENSOR.PROBE, 'probe');
});

test('a sensor: its features grow with the measures seen; ids without a dot', () => {
  const cellar = byType('HT.w');
  const basic = buildSensorDevice(fakeGladys, cellar);
  assert.equal(basic.external_id, 'ext:test-integration:sensor:16855-27453475893');
  assert.deepEqual(
    basic.features.map((feature) => feature.external_id.split(':').pop()),
    ['temperature', 'humidity'],
  );
  const full = buildSensorDevice(fakeGladys, cellar, { seen: ['dewpoint', 'vpd'] });
  assert.deepEqual(
    full.features.map((feature) => feature.external_id.split(':').pop()),
    ['temperature', 'humidity', 'dewpoint', 'vpd'],
  );
  assert.equal(full.model, 'SensorPush HT.w');
  assert.deepEqual(full.params, [
    { name: 'SENSORPUSH_SENSOR_ID', value: '16855.27453475893' },
    { name: 'SENSORPUSH_DEVICE_ID', value: '16855' },
  ]);
  assert.equal(sensorOfExternalId(full.external_id), '16855-27453475893');
  assert.equal(sensorOfExternalId(`${full.external_id}:humidity`), '16855-27453475893');
  assert.equal(sensorOfExternalId('nope'), null);
  assert.equal(platformId('a b:c.d'), 'a-b-c-d');
  assert.equal(sensorName({ id: '1.2', deviceId: '1' }), 'SensorPush 1');
  for (const language of LANGUAGES) {
    const device = buildSensorDevice(fakeGladys, cellar, { language, seen: MEASURES });
    const names = device.features.map((feature) => feature.name);
    assert.equal(new Set(names).size, names.length, `${language}: distinct names`);
  }
});

test('states: rounded, within bounds, the missing ones left out', () => {
  const greenhouse = byType('HTP.xw');
  const sample = parseSample(account.samples['21422.4417761108'][0]);
  assert.deepEqual(
    buildSensorStates(fakeGladys, greenhouse, sample, MEASURES).map((state) => [
      state.device_feature_external_id.split(':').pop(),
      state.state,
    ]),
    [
      ['temperature', 22],
      ['humidity', 55],
      ['dewpoint', 12.5],
      ['pressure', 1013.2],
      ['vpd', 1.18],
    ],
  );
  // Features not offered yet: no state for them.
  assert.equal(buildSensorStates(fakeGladys, greenhouse, sample, []).length, 2);
  assert.deepEqual(
    buildSensorStates(fakeGladys, greenhouse, { observed: 1, temperature: 500 }, []),
    [
      {
        device_feature_external_id: 'ext:test-integration:sensor:21422-4417761108:temperature',
        state: 70,
      },
    ],
  );
  const gateway = parseGateways(account.gateways)[0];
  assert.deepEqual(buildGatewayStates(fakeGladys, gateway, { connected: false, language: 'fr' }), [
    {
      device_feature_external_id: 'ext:test-integration:gateway:Maison:status',
      text: 'Déconnectée',
    },
    {
      device_feature_external_id: 'ext:test-integration:gateway:Maison:version',
      text: '1.1.3(17)',
    },
  ]);
});
