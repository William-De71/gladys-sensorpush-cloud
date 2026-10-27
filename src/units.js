// -----------------------------------------------------------------------------
// Units shown to the user. The integration keeps °C, %, hPa and kPa; the
// widgets follow the units of the Gladys user (`metric` or `us`), the scene
// actions and events the `scene_units` of the configuration. US units: °F and
// inHg; the humidity and the VPD (kPa) stay.
// -----------------------------------------------------------------------------

import { toFahrenheit, toInchesOfMercury } from './parse.js';

const TEMPERATURES = ['temperature', 'dewpoint'];

/**
 * @description Whether a units value means US units.
 * @param {unknown} units - `metric`, `us` (or `imperial`).
 * @returns {boolean} True for US units.
 */
const isUs = (units) => units === 'us' || units === 'imperial';

/**
 * @description A value in the units of the user.
 * @param {string} measure - temperature, humidity, dewpoint, pressure, vpd.
 * @param {number|null} value - The value in °C, %, hPa or kPa.
 * @param {string} units - `metric` or `us`.
 * @returns {number|null} The value.
 */
function convert(measure, value, units) {
  if (!Number.isFinite(value)) {
    return null;
  }
  if (!isUs(units)) {
    return value;
  }
  if (TEMPERATURES.includes(measure)) {
    return toFahrenheit(value);
  }
  return measure === 'pressure' ? toInchesOfMercury(value) : value;
}

/**
 * @description The unit of a measure for the user.
 * @param {string} measure - temperature, humidity, dewpoint, pressure, vpd.
 * @param {string} units - `metric` or `us`.
 * @returns {string} "°C", "%", "hPa"…
 */
function unitOf(measure, units) {
  if (TEMPERATURES.includes(measure)) {
    return isUs(units) ? '°F' : '°C';
  }
  if (measure === 'pressure') {
    return isUs(units) ? 'inHg' : 'hPa';
  }
  return measure === 'vpd' ? 'kPa' : '%';
}

/**
 * @description The decimals a measure is shown with.
 * @param {string} measure - temperature, humidity, dewpoint, pressure, vpd.
 * @param {string} units - `metric` or `us`.
 * @returns {number} The decimals.
 */
function decimalsOf(measure, units) {
  if (measure === 'humidity') return 0;
  if (measure === 'vpd') return 2;
  if (measure === 'pressure') return isUs(units) ? 2 : 0;
  return 1;
}

export { TEMPERATURES, isUs, convert, unitOf, decimalsOf };
