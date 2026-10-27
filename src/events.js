// -----------------------------------------------------------------------------
// Scene triggers and the keys of the scene actions.
//
// Triggers, once per transition, never at the first reading of a sensor or a
// gateway, never because of a scene action (the detection runs on the timer
// only):
//   - `out_of_range`          the temperature or the humidity of a sensor goes
//                             outside the alert range set in the SensorPush
//                             app (an alert switched off watches nothing);
//   - `back_in_range`         it comes back inside;
//   - `sensor_silent`         no new sample for the delay of the configuration
//                             (30 minutes by default);
//   - `sensor_back`           samples arrive again after that;
//   - `gateway_disconnected`  a gateway has not checked in for 30 minutes;
//   - `gateway_reconnected`   it checks in again;
//   - `access_refused`        SensorPush refuses the e-mail, the password or
//                             the access token.
// A value to compare (>, <) is a feature of the device, not a trigger.
// -----------------------------------------------------------------------------

import { ALERT_MEASURES, alertSide } from './parse.js';
import { t } from './i18n.js';
import { convert, unitOf } from './units.js';

const TRIGGERS = {
  OUT_OF_RANGE: 'out_of_range',
  BACK_IN_RANGE: 'back_in_range',
  SENSOR_SILENT: 'sensor_silent',
  SENSOR_BACK: 'sensor_back',
  GATEWAY_DISCONNECTED: 'gateway_disconnected',
  GATEWAY_RECONNECTED: 'gateway_reconnected',
  ACCESS_REFUSED: 'access_refused',
};

const SCENE_ACTIONS = {
  GET_SENSOR: 'get_sensor',
  GET_HISTORY: 'get_history',
};

const SENSOR_OUTPUTS = [
  'sensor_name',
  'temperature',
  'humidity',
  'dewpoint',
  'pressure',
  'vpd',
  'battery_voltage',
  'signal',
  'minutes_since_sample',
  'is_silent',
  'temperature_unit',
  'summary',
];
const HISTORY_OUTPUTS = [
  'sensor_name',
  'sample_count',
  'temperature_min',
  'temperature_max',
  'temperature_avg',
  'humidity_min',
  'humidity_max',
  'humidity_avg',
  'temperature_unit',
  'truncated',
  'summary',
];
const ACCESS_REASONS = ['missing', 'refused', 'invalid_password', 'token'];
const SIDES = ['above', 'below'];
// A gateway that has not checked in for this long is disconnected (the
// documentation advises reading `last_seen` about every 15 minutes).
const GATEWAY_OFFLINE_MS = 30 * 60 * 1000;
const MINUTE_MS = 60 * 1000;

/**
 * @description Keep only the declared keys of an output object.
 * @param {object} values - The values.
 * @param {string[]} keys - The declared keys.
 * @returns {object} The outputs (null / undefined left out).
 */
function pick(values, keys) {
  return Object.fromEntries(
    keys
      .filter((key) => values[key] !== null && values[key] !== undefined)
      .map((key) => [key, values[key]]),
  );
}

/**
 * @description A number rounded for a scene, or null.
 * @param {number|null} value - The value.
 * @param {number} [decimals] - Decimals.
 * @returns {number|null} The value.
 */
function rounded(value, decimals = 1) {
  if (!Number.isFinite(value)) {
    return null;
  }
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

/**
 * @description Whether a sample is recent enough.
 * @param {object|null} sample - The newest sample.
 * @param {number} now - Now (ms).
 * @param {number} silentMs - The delay of the configuration.
 * @returns {boolean} True when fresh.
 */
const isFresh = (sample, now, silentMs) =>
  Number.isFinite(sample?.observed) && now - sample.observed <= silentMs;

/**
 * @description Whether a gateway checked in lately.
 * @param {object} gateway - parseGateways() entry.
 * @param {number} now - Now (ms).
 * @returns {boolean} True when connected.
 */
const isConnected = (gateway, now) =>
  Number.isFinite(gateway?.lastSeen) && now - gateway.lastSeen <= GATEWAY_OFFLINE_MS;

/**
 * @description The transitions of a sensor since what the triggers knew.
 * @param {object} seen - What the triggers knew (never changed).
 * @param {object} sensor - parseSensors() entry.
 * @param {object|null} sample - The newest sample.
 * @param {object} context - `{ now, silentMs }`.
 * @returns {{ events: Array<{ key: string, extra: object }>, next: object }} The events, the new knowledge.
 */
function detectSensor(seen = {}, sensor, sample, { now, silentMs }) {
  const first = !seen.known;
  const next = { ...seen, known: true, sides: { ...(seen.sides ?? {}) } };
  const events = [];
  const push = (key, extra = {}) => {
    if (!first) events.push({ key, extra });
  };
  if (!sample) {
    // Nothing read yet: wait for a first sample.
    return { events, next: seen };
  }

  const fresh = isFresh(sample, now, silentMs);
  if (!fresh && seen.silent === false) {
    push(TRIGGERS.SENSOR_SILENT);
  }
  if (fresh && seen.silent === true) {
    push(TRIGGERS.SENSOR_BACK, {
      silentSince: Number.isFinite(seen.silentSince) ? seen.silentSince : null,
    });
  }
  if (!fresh && seen.silent !== true) {
    next.silentSince = sample.observed;
  }
  next.silent = !fresh;

  // The alert ranges: only on a fresh sample (an old value says nothing new).
  if (fresh) {
    for (const measure of ALERT_MEASURES) {
      const alert = sensor.alerts?.[measure] ?? null;
      const side = alertSide(sample[measure], alert);
      const previous = seen.sides?.[measure];
      if (previous === undefined && !first) {
        // A measure watched since now: its state is learned, nothing announced.
        next.sides[measure] = side;
        continue;
      }
      if (side && side !== previous) {
        push(TRIGGERS.OUT_OF_RANGE, { measure, side });
        next.outSince = { ...(next.outSince ?? {}), [measure]: sample.observed };
      }
      if (!side && previous) {
        push(TRIGGERS.BACK_IN_RANGE, {
          measure,
          previous,
          outSince: seen.outSince?.[measure] ?? null,
        });
      }
      next.sides[measure] = side;
    }
  }
  return { events, next };
}

/**
 * @description The transitions of a gateway since what the triggers knew.
 * @param {object} seen - What the triggers knew.
 * @param {object} gateway - parseGateways() entry.
 * @param {number} now - Now (ms).
 * @returns {{ events: Array<{ key: string, extra: object }>, next: object }} The events, the new knowledge.
 */
function detectGateway(seen = {}, gateway, now) {
  const connected = isConnected(gateway, now);
  const events = [];
  if (seen.known && seen.connected === true && !connected) {
    events.push({ key: TRIGGERS.GATEWAY_DISCONNECTED, extra: {} });
  }
  if (seen.known && seen.connected === false && connected) {
    events.push({
      key: TRIGGERS.GATEWAY_RECONNECTED,
      extra: { offlineSince: seen.offlineSince ?? null },
    });
  }
  const next = { known: true, connected };
  if (!connected) {
    next.offlineSince =
      seen.connected === false && Number.isFinite(seen.offlineSince)
        ? seen.offlineSince
        : (gateway.lastSeen ?? now);
  }
  return { events, next };
}

/**
 * @description The data of an event of a sensor, flat (30 keys, scalars).
 * @param {object} view - `{ deviceId, name, sensor, sample }` (app.js).
 * @param {{ key: string, extra: object }} event - The event of detectSensor().
 * @param {object} context - `{ language, units, now }`.
 * @returns {object} The data.
 */
function sensorEventData(view, { key, extra }, { language, units, now }) {
  const data = {
    sensor: view.deviceId,
    sensor_name: String(view.name ?? '').slice(0, 1000),
    sensor_id: view.sensor.id,
  };
  const sample = view.sample;
  if (key === TRIGGERS.OUT_OF_RANGE || key === TRIGGERS.BACK_IN_RANGE) {
    const alert = view.sensor.alerts?.[extra.measure] ?? {};
    const decimals = extra.measure === 'temperature' ? 1 : 0;
    Object.assign(data, {
      measure: extra.measure,
      measure_label: t(`measure_${extra.measure}`, language),
      value: rounded(convert(extra.measure, sample?.[extra.measure], units), 1),
      unit: unitOf(extra.measure, units),
      alert_min: rounded(convert(extra.measure, alert.min, units), decimals),
      alert_max: rounded(convert(extra.measure, alert.max, units), decimals),
    });
    if (key === TRIGGERS.OUT_OF_RANGE) {
      Object.assign(data, { side: extra.side, side_label: t(`side_${extra.side}`, language) });
    } else {
      Object.assign(data, {
        previous_side: extra.previous,
        minutes_outside: Number.isFinite(extra.outSince)
          ? Math.max(0, Math.round((sample.observed - extra.outSince) / MINUTE_MS))
          : null,
      });
    }
  } else if (key === TRIGGERS.SENSOR_SILENT || key === TRIGGERS.SENSOR_BACK) {
    // Silent: since the last sample; back: the length of the gap.
    const since = key === TRIGGERS.SENSOR_SILENT ? sample?.observed : extra.silentSince;
    const until = key === TRIGGERS.SENSOR_SILENT ? now : (sample?.observed ?? now);
    Object.assign(data, {
      minutes_without_data: Number.isFinite(since)
        ? Math.max(0, Math.round((until - since) / MINUTE_MS))
        : null,
      last_sample_at: Number.isFinite(sample?.observed)
        ? new Date(sample.observed).toISOString()
        : null,
    });
  }
  return data;
}

/**
 * @description The data of an event of a gateway, flat.
 * @param {object} view - `{ deviceId, gateway }`.
 * @param {{ key: string, extra: object }} event - The event of detectGateway().
 * @param {number} now - Now (ms).
 * @returns {object} The data.
 */
function gatewayEventData(view, { key, extra }, now) {
  const { gateway } = view;
  const data = {
    gateway: view.deviceId,
    gateway_name: String(gateway.name ?? '').slice(0, 1000),
    last_seen_at: Number.isFinite(gateway.lastSeen)
      ? new Date(gateway.lastSeen).toISOString()
      : null,
  };
  if (key === TRIGGERS.GATEWAY_DISCONNECTED) {
    data.minutes_since_seen = Number.isFinite(gateway.lastSeen)
      ? Math.max(0, Math.round((now - gateway.lastSeen) / MINUTE_MS))
      : null;
  } else {
    data.minutes_offline = Number.isFinite(extra.offlineSince)
      ? Math.max(0, Math.round(((gateway.lastSeen ?? now) - extra.offlineSince) / MINUTE_MS))
      : null;
  }
  return data;
}

export {
  TRIGGERS,
  SCENE_ACTIONS,
  SENSOR_OUTPUTS,
  HISTORY_OUTPUTS,
  ACCESS_REASONS,
  SIDES,
  GATEWAY_OFFLINE_MS,
  pick,
  rounded,
  isFresh,
  isConnected,
  detectSensor,
  detectGateway,
  sensorEventData,
  gatewayEventData,
};
