// -----------------------------------------------------------------------------
// The devices of the integration, offered on the Discovery screen.
//
// One device per active SensorPush sensor (its long id, which SensorPush never
// reuses), named as in the SensorPush app, read-only, offered once a sample
// was read for it. Category / type / unit pairs from the Gladys core
// (DEVICE_FEATURE_UNITS_BY_CATEGORY, front i18n, master 2026-10-27):
//   - `temperature`  temperature-sensor / decimal, °C (converted from °F; the
//                    core converts again for the users in °F);
//   - `humidity`     humidity-sensor / decimal, %;
//   - `dewpoint`     temperature-sensor / probe, °C: a probe is kept out of the
//                    average temperature of the room, and a dew point is not
//                    the temperature of the room;
//   - `pressure`     pressure-sensor / decimal, hPa (HTP.xw: converted from inHg);
//   - `vpd`          pressure-sensor / decimal, kPa (vapour pressure deficit).
// The last three appear with the first sample that carries them (older
// sensors have no dew point or VPD, only the HTP.xw has a barometer), then
// stay. The battery voltage and the signal (dBm) have no fitting category
// (the battery is a percentage, the signal a 0-5 quality): the widgets and the
// scene action show them.
//
// One device per gateway (the key of devices/gateways):
//   - `status`       text / text: connected or disconnected (no check-in for
//                    30 minutes), in the language of the configuration;
//   - `version`      text / text: the software version of the gateway.
//
// External ids: `ext:<selector>:sensor:<id>` and `ext:<selector>:gateway:<key>`,
// the id or key with every character outside [A-Za-z0-9_-] replaced by "-"
// (a sensor id is "16855.27453475893"). `should_poll` stays false: the
// integration reads the cloud on its own timer.
// -----------------------------------------------------------------------------

import {
  DEVICE_FEATURE_CATEGORIES as C,
  DEVICE_FEATURE_TYPES as T,
  DEVICE_FEATURE_UNITS as U,
} from '@gladysassistant/integration-sdk';
import { t } from './i18n.js';

const SENSOR_TYPE = 'sensor';
const GATEWAY_TYPE = 'gateway';

const SENSOR_FEATURES = [
  {
    key: 'temperature',
    category: C.TEMPERATURE_SENSOR,
    type: T.SENSOR.DECIMAL,
    unit: U.CELSIUS,
    min: -40,
    max: 70,
    decimals: 1,
  },
  {
    key: 'humidity',
    category: C.HUMIDITY_SENSOR,
    type: T.SENSOR.DECIMAL,
    unit: U.PERCENT,
    min: 0,
    max: 100,
    decimals: 1,
  },
  {
    key: 'dewpoint',
    category: C.TEMPERATURE_SENSOR,
    type: T.TEMPERATURE_SENSOR.PROBE,
    unit: U.CELSIUS,
    min: -60,
    max: 70,
    decimals: 1,
    optional: true,
  },
  {
    key: 'pressure',
    category: C.PRESSURE_SENSOR,
    type: T.SENSOR.DECIMAL,
    unit: U.HECTO_PASCAL,
    min: 300,
    max: 1100,
    decimals: 1,
    optional: true,
  },
  {
    key: 'vpd',
    category: C.PRESSURE_SENSOR,
    type: T.SENSOR.DECIMAL,
    unit: U.KILO_PASCAL,
    min: 0,
    max: 10,
    decimals: 2,
    optional: true,
  },
];

const GATEWAY_FEATURES = ['status', 'version'];

/**
 * @description The platform id of a sensor id or a gateway key, safe for an external id.
 * @param {string} value - "16855.27453475893".
 * @returns {string} "16855-27453475893".
 */
const platformId = (value) =>
  String(value ?? '')
    .replace(/[^A-Za-z0-9_-]/g, '-')
    .slice(0, 64);

/**
 * @description The external ids of a sensor.
 * @param {object} gladys - The GladysIntegration instance.
 * @param {string} id - The id of the sensor.
 * @returns {{ device: string, feature: Function }} The ids.
 */
const sensorIds = (gladys, id) => gladys.externalIds(SENSOR_TYPE, platformId(id));

/**
 * @description The external ids of a gateway.
 * @param {object} gladys - The GladysIntegration instance.
 * @param {string} key - The key of the gateway.
 * @returns {{ device: string, feature: Function }} The ids.
 */
const gatewayIds = (gladys, key) => gladys.externalIds(GATEWAY_TYPE, platformId(key));

/**
 * @description The platform id of a sensor device external id (or of one of its features).
 * @param {unknown} externalId - `ext:…:sensor:16855-27453475893` (or `…:temperature`).
 * @returns {string|null} The platform id.
 */
function sensorOfExternalId(externalId) {
  const match = String(externalId ?? '').match(/:sensor:([A-Za-z0-9_-]+)(?::[a-z]+)?$/);
  return match ? match[1] : null;
}

/**
 * @description The name of a sensor: its name in the SensorPush app.
 * @param {object} sensor - parseSensors() entry.
 * @returns {string} The name.
 */
function sensorName(sensor) {
  const name = String(sensor?.name ?? '').trim();
  return (name || `SensorPush ${sensor?.deviceId || sensor?.id || ''}`.trim()).slice(0, 100);
}

/**
 * @description The keys of the features of a sensor.
 * @param {string[]} [seen] - The measures a sample ever carried.
 * @returns {string[]} The keys.
 */
const sensorFeatureKeys = (seen = []) =>
  SENSOR_FEATURES.filter((feature) => !feature.optional || seen.includes(feature.key)).map(
    (feature) => feature.key,
  );

/**
 * @description Build the device of a sensor.
 * @param {object} gladys - The GladysIntegration instance.
 * @param {object} sensor - parseSensors() entry.
 * @param {object} [options] - `{ language, seen }`.
 * @returns {object} The discovered device.
 */
function buildSensorDevice(gladys, sensor, { language = 'en', seen = [] } = {}) {
  const ids = sensorIds(gladys, sensor.id);
  const params = [{ name: 'SENSORPUSH_SENSOR_ID', value: sensor.id }];
  if (sensor.deviceId) {
    params.push({ name: 'SENSORPUSH_DEVICE_ID', value: sensor.deviceId });
  }
  return {
    name: sensorName(sensor),
    external_id: ids.device,
    model: sensor.type ? `SensorPush ${sensor.type}` : 'SensorPush',
    should_poll: false,
    params,
    features: sensorFeatureKeys(seen).map((key) => {
      const feature = SENSOR_FEATURES.find((entry) => entry.key === key);
      return {
        name: t(`feature_${key}`, language),
        external_id: ids.feature(key),
        category: feature.category,
        type: feature.type,
        unit: feature.unit,
        min: feature.min,
        max: feature.max,
        read_only: true,
        has_feedback: false,
        keep_history: true,
      };
    }),
  };
}

/**
 * @description Build the device of a gateway.
 * @param {object} gladys - The GladysIntegration instance.
 * @param {object} gateway - parseGateways() entry.
 * @param {object} [options] - `{ language }`.
 * @returns {object} The discovered device.
 */
function buildGatewayDevice(gladys, gateway, { language = 'en' } = {}) {
  const ids = gatewayIds(gladys, gateway.key);
  return {
    name: t('gatewayName', language, { name: gateway.name }).slice(0, 100),
    external_id: ids.device,
    model: 'SensorPush G1 WiFi Gateway',
    should_poll: false,
    params: [{ name: 'SENSORPUSH_GATEWAY', value: gateway.key }],
    features: GATEWAY_FEATURES.map((key) => ({
      name: t(`feature_gateway_${key}`, language),
      external_id: ids.feature(key),
      category: C.TEXT,
      type: T.TEXT.TEXT,
      unit: null,
      min: 0,
      max: 0,
      read_only: true,
      has_feedback: false,
      keep_history: key === 'status',
    })),
  };
}

/**
 * @description Round a value to the decimals of its feature, within its bounds.
 * @param {object} feature - The feature description.
 * @param {number} value - The value.
 * @returns {number} The value.
 */
function bounded(feature, value) {
  const factor = 10 ** feature.decimals;
  const rounded = Math.round(value * factor) / factor;
  return Math.min(feature.max, Math.max(feature.min, rounded));
}

/**
 * @description The states of a sensor: a value left out (null) is left untouched.
 * @param {object} gladys - The GladysIntegration instance.
 * @param {object} sensor - parseSensors() entry.
 * @param {object|null} sample - The newest sample (parseSample()).
 * @param {string[]} [seen] - The measures a sample ever carried.
 * @returns {object[]} `{ device_feature_external_id, state }`.
 */
function buildSensorStates(gladys, sensor, sample, seen = []) {
  const ids = sensorIds(gladys, sensor.id);
  const keys = sensorFeatureKeys(seen);
  return SENSOR_FEATURES.filter(
    (feature) => keys.includes(feature.key) && Number.isFinite(sample?.[feature.key]),
  ).map((feature) => ({
    device_feature_external_id: ids.feature(feature.key),
    state: bounded(feature, sample[feature.key]),
  }));
}

/**
 * @description The states of a gateway.
 * @param {object} gladys - The GladysIntegration instance.
 * @param {object} gateway - parseGateways() entry.
 * @param {object} options - `{ connected, language }`.
 * @returns {object[]} `{ device_feature_external_id, text }`.
 */
function buildGatewayStates(gladys, gateway, { connected, language = 'en' }) {
  const ids = gatewayIds(gladys, gateway.key);
  const states = [
    {
      device_feature_external_id: ids.feature('status'),
      text: t(connected ? 'gatewayConnected' : 'gatewayDisconnected', language),
    },
  ];
  if (gateway.version) {
    states.push({ device_feature_external_id: ids.feature('version'), text: gateway.version });
  }
  return states;
}

export {
  SENSOR_TYPE,
  GATEWAY_TYPE,
  SENSOR_FEATURES,
  GATEWAY_FEATURES,
  platformId,
  sensorIds,
  gatewayIds,
  sensorOfExternalId,
  sensorName,
  sensorFeatureKeys,
  buildSensorDevice,
  buildGatewayDevice,
  buildSensorStates,
  buildGatewayStates,
};
