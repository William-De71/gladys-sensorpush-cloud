// -----------------------------------------------------------------------------
// The answers of the SensorPush Gateway Cloud API, made safe, and the unit
// conversions.
//
// Shapes of the official Swagger definition (v1.0.20261017,
// https://api.sensorpush.com/api/v1/support/swagger/swagger-v1.json):
//   - devices/sensors   a map `id -> { active, address, alerts: { temperature:
//                       { enabled, min, max }, humidity: {…} }, battery_voltage,
//                       calibration, deviceId, id, name, rssi, tags, type }`;
//   - devices/gateways  a map `key -> { last_alert, last_seen, message, name,
//                       paired, tags, version }`;
//   - samples           `{ last_time, sensors: { id: [{ observed, temperature,
//                       humidity, dewpoint, barometric_pressure, vpd, altitude }] },
//                       status, total_samples, total_sensors, truncated }`.
// Units of the API: temperature and dew point in °F, humidity in %, pressure in
// inHg, VPD in kPa, altitude in feet (ignored). The integration keeps °C and
// hPa internally and converts back for US units.
// A missing or non-numeric value is null, never 0. The alert thresholds of a
// sensor are assumed in the units of the samples (°F, %): the documentation
// gives no unit for them.
// -----------------------------------------------------------------------------

const MEASURES = ['temperature', 'humidity', 'dewpoint', 'pressure', 'vpd'];
const ALERT_MEASURES = ['temperature', 'humidity'];
const HPA_PER_INHG = 33.8639;

/**
 * @description A finite number, else null.
 * @param {unknown} value - The value (a number or a numeric string).
 * @returns {number|null} The number.
 */
function numberOf(value) {
  if (value === null || value === undefined || value === '' || typeof value === 'boolean') {
    return null;
  }
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

/**
 * @description An instant (ms), else null.
 * @param {unknown} value - An ISO date.
 * @returns {number|null} The instant.
 */
function instantOf(value) {
  if (typeof value !== 'string' || !value.trim()) {
    return null;
  }
  const instant = Date.parse(value);
  return Number.isFinite(instant) ? instant : null;
}

const textOf = (value, max = 100) => (typeof value === 'string' ? value.trim().slice(0, max) : '');

const isObject = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value);

/**
 * @description °F to °C.
 * @param {number|null} fahrenheit - The temperature.
 * @returns {number|null} The temperature in °C.
 */
const toCelsius = (fahrenheit) =>
  Number.isFinite(fahrenheit) ? ((fahrenheit - 32) * 5) / 9 : null;

/**
 * @description °C to °F.
 * @param {number|null} celsius - The temperature.
 * @returns {number|null} The temperature in °F.
 */
const toFahrenheit = (celsius) => (Number.isFinite(celsius) ? (celsius * 9) / 5 + 32 : null);

/**
 * @description inHg to hPa.
 * @param {number|null} inHg - The pressure.
 * @returns {number|null} The pressure in hPa.
 */
const toHectopascal = (inHg) => (Number.isFinite(inHg) ? inHg * HPA_PER_INHG : null);

/**
 * @description hPa to inHg.
 * @param {number|null} hPa - The pressure.
 * @returns {number|null} The pressure in inHg.
 */
const toInchesOfMercury = (hPa) => (Number.isFinite(hPa) ? hPa / HPA_PER_INHG : null);

/**
 * @description The alert thresholds of a measure, in the units of the integration.
 * @param {object} raw - `{ enabled, min, max }`.
 * @param {string} measure - temperature or humidity.
 * @returns {{ enabled: boolean, min: number|null, max: number|null }|null} The alert.
 */
function parseAlert(raw, measure) {
  if (!isObject(raw)) {
    return null;
  }
  const convert = measure === 'temperature' ? toCelsius : (value) => value;
  return {
    enabled: raw.enabled === true,
    min: convert(numberOf(raw.min)),
    max: convert(numberOf(raw.max)),
  };
}

/**
 * @description The sensors of the account.
 * @param {unknown} body - The answer of devices/sensors.
 * @returns {object[]} `{ id, deviceId, name, type, address, active, batteryVoltage, rssi,
 * alerts: { temperature, humidity } }`, sorted by name.
 */
function parseSensors(body) {
  if (!isObject(body)) {
    return [];
  }
  return Object.entries(body)
    .filter(([key, raw]) => isObject(raw) && textOf(key, 64))
    .map(([key, raw]) => ({
      // The key of the map is the id the samples use.
      id: textOf(key, 64) || textOf(raw.id, 64),
      deviceId: textOf(raw.deviceId, 64),
      name: textOf(raw.name),
      type: textOf(raw.type, 40),
      address: textOf(raw.address, 40),
      active: raw.active !== false,
      batteryVoltage: numberOf(raw.battery_voltage),
      rssi: numberOf(raw.rssi),
      alerts: Object.fromEntries(
        ALERT_MEASURES.map((measure) => [measure, parseAlert(raw.alerts?.[measure], measure)]),
      ),
    }))
    .filter((sensor) => sensor.active)
    .sort((a, b) => (a.name || a.id).localeCompare(b.name || b.id) || a.id.localeCompare(b.id));
}

/**
 * @description The gateways of the account.
 * @param {unknown} body - The answer of devices/gateways.
 * @returns {object[]} `{ key, name, lastSeen, lastAlert, message, paired, version }`.
 */
function parseGateways(body) {
  if (!isObject(body)) {
    return [];
  }
  return Object.entries(body)
    .filter(([key, raw]) => isObject(raw) && textOf(key, 64))
    .map(([key, raw]) => ({
      key: textOf(key, 64),
      name: textOf(raw.name) || textOf(key, 64),
      lastSeen: instantOf(raw.last_seen),
      lastAlert: instantOf(raw.last_alert),
      message: textOf(raw.message, 200),
      paired: raw.paired === true || raw.paired === 'true',
      version: textOf(raw.version, 40),
    }))
    .sort((a, b) => a.name.localeCompare(b.name) || a.key.localeCompare(b.key));
}

/**
 * @description One sample, in °C, %, hPa and kPa.
 * @param {unknown} raw - A sample of the API.
 * @returns {object|null} `{ observed, temperature, humidity, dewpoint, pressure, vpd }`.
 */
function parseSample(raw) {
  if (!isObject(raw)) {
    return null;
  }
  const observed = instantOf(raw.observed);
  if (!observed) {
    return null;
  }
  return {
    observed,
    temperature: toCelsius(numberOf(raw.temperature)),
    humidity: numberOf(raw.humidity),
    dewpoint: toCelsius(numberOf(raw.dewpoint)),
    pressure: toHectopascal(numberOf(raw.barometric_pressure)),
    vpd: numberOf(raw.vpd),
  };
}

/**
 * @description The samples of an answer, per sensor, the newest first.
 * @param {unknown} body - The answer of samples.
 * @returns {{ sensors: Object<string, object[]>, truncated: boolean }} The samples.
 */
function parseSamples(body) {
  const sensors = {};
  const raw = isObject(body) && isObject(body.sensors) ? body.sensors : {};
  for (const [id, list] of Object.entries(raw)) {
    if (!Array.isArray(list)) {
      continue;
    }
    const samples = list
      .map(parseSample)
      .filter(Boolean)
      .sort((a, b) => b.observed - a.observed);
    if (samples.length) {
      sensors[textOf(id, 64)] = samples;
    }
  }
  return { sensors, truncated: isObject(body) && body.truncated === true };
}

/**
 * @description The measures a sample carries.
 * @param {object} sample - parseSample().
 * @returns {string[]} The keys of MEASURES with a value.
 */
const measuresOf = (sample) => MEASURES.filter((measure) => Number.isFinite(sample?.[measure]));

/**
 * @description Whether a value is outside the alert range of a measure.
 * @param {number|null} value - The value (°C or %).
 * @param {object|null} alert - parseAlert().
 * @returns {'above'|'below'|null} The side, null when inside or not watched.
 */
function alertSide(value, alert) {
  if (!alert?.enabled || !Number.isFinite(value)) {
    return null;
  }
  if (Number.isFinite(alert.max) && value > alert.max) return 'above';
  if (Number.isFinite(alert.min) && value < alert.min) return 'below';
  return null;
}

export {
  MEASURES,
  ALERT_MEASURES,
  HPA_PER_INHG,
  numberOf,
  instantOf,
  toCelsius,
  toFahrenheit,
  toHectopascal,
  toInchesOfMercury,
  parseAlert,
  parseSensors,
  parseGateways,
  parseSample,
  parseSamples,
  measuresOf,
  alertSide,
};
