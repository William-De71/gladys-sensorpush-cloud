// -----------------------------------------------------------------------------
// Dashboard widgets of the SensorPush Cloud integration.
//
//   - `overview`  every sensor at a glance: how many there are, outside their
//                 SensorPush alert range, silent; one card per sensor (the
//                 alerts and the silent ones first) with its temperature,
//                 humidity and the age of its last sample; the gateways and
//                 whether they check in;
//   - `sensor`    one sensor (a SensorPush device, the first one by default):
//                 its measures, the temperature (and dew point) of the last
//                 24 hours from the points the integration keeps (no extra
//                 request), the minimum and maximum of the day, its alert
//                 range, battery voltage and signal.
// Values follow the units of the requesting user (`metric` or `us`). Every
// text exists in the four languages (the content is cached per language and
// units). Content budget of a card: 8 components, 1 main one, 6 tiles, 2 texts
// (1 body), 1 status, 4 buttons.
// -----------------------------------------------------------------------------

import { WIDGET_COLORS } from '@gladysassistant/integration-sdk';
import { t, ago, formatNumber } from './i18n.js';
import { formatTime } from './time.js';
import { convert, unitOf, decimalsOf } from './units.js';
import { alertSide } from './parse.js';

const WIDGETS = { OVERVIEW: 'overview', SENSOR: 'sensor' };
const TTL_SECONDS = { overview: 60, sensor: 60, message: 120 };
const MAX_CARDS = 8;
const MAX_GATEWAYS = 10;
const TILE_MEASURES = [
  { measure: 'temperature', icon: 'thermometer' },
  { measure: 'humidity', icon: 'droplet' },
  { measure: 'dewpoint', icon: 'cloud-drizzle' },
  { measure: 'pressure', icon: 'wind' },
  { measure: 'vpd', icon: 'activity' },
];

/**
 * @description Truncate a text to a bound, with an ellipsis.
 * @param {string} value - The text.
 * @param {number} max - The bound.
 * @returns {string} The text.
 */
function clip(value, max) {
  const text = String(value ?? '');
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

/**
 * @description A widget content made of one message.
 * @param {string} message - The message.
 * @param {object} [options] - `{ heading, ttl }`.
 * @returns {object} The content.
 */
function messageContent(message, { heading, ttl = TTL_SECONDS.message } = {}) {
  const components = [];
  if (heading) {
    components.push({ type: 'text', variant: 'heading', text: clip(heading, 40) });
  }
  components.push({ type: 'text', variant: 'body', text: clip(message, 300) });
  return { ttl_seconds: ttl, components };
}

/**
 * @description A measure as text in the units of the user: "21.3 °C".
 * @param {string} measure - The measure.
 * @param {number|null} value - The value (°C, %, hPa, kPa).
 * @param {object} options - `{ language, units }`.
 * @returns {string} The text, "–" when unknown.
 */
function measureText(measure, value, { language, units }) {
  const shown = convert(measure, value, units);
  if (!Number.isFinite(shown)) {
    return '–';
  }
  const unit = unitOf(measure, units);
  return `${formatNumber(shown, language, decimalsOf(measure, units))}${unit === '%' ? ' %' : ` ${unit}`}`;
}

/**
 * @description The measures of a sensor outside their alert range.
 * @param {object} view - The view of the sensor (app.js).
 * @returns {Array<{ measure: string, side: string }>} The alerts.
 */
function alertsOf(view) {
  if (view.silent || !view.sample) {
    return [];
  }
  return ['temperature', 'humidity']
    .map((measure) => ({
      measure,
      side: alertSide(view.sample[measure], view.sensor.alerts?.[measure]),
    }))
    .filter(({ side }) => side);
}

/**
 * @description How urgent a sensor is, for the order of the cards.
 * @param {object} view - The view of the sensor.
 * @returns {number} 2 alert, 1 silent, 0 fine.
 */
const urgency = (view) => (alertsOf(view).length ? 2 : view.silent ? 1 : 0);

/**
 * @description The card of a sensor.
 * @param {object} view - The view of the sensor.
 * @param {object} options - `{ language, units, now }`.
 * @returns {object} A card-list item.
 */
function sensorCard(view, { language, units, now }) {
  const sample = view.sample;
  const alerts = alertsOf(view);
  const parts = [
    measureText('temperature', sample?.temperature, { language, units }),
    measureText('humidity', sample?.humidity, { language, units }),
    sample ? ago(sample.observed, now, language) : t('never', language),
  ];
  let badge;
  if (alerts.length) {
    badge = { text: t('badgeAlert', language), color: WIDGET_COLORS.DANGER };
  } else if (view.silent) {
    badge = { text: t('badgeSilent', language), color: WIDGET_COLORS.NEUTRAL };
  } else {
    badge = { text: t('badgeOk', language), color: WIDGET_COLORS.SUCCESS };
  }
  const card = {
    title: clip(view.name, 60),
    subtitle: clip(parts.join(' · '), 60),
    badge: { text: clip(badge.text, 16), color: badge.color },
  };
  if (alerts.length) {
    card.description = clip(
      alerts
        .map(({ measure, side }) => {
          const alert = view.sensor.alerts[measure];
          return t('cardAlert', language, {
            measure: t(`measure_${measure}`, language),
            side: t(`side_${side}`, language),
            value: measureText(measure, sample[measure], { language, units }),
            min: measureText(measure, alert.min, { language, units }),
            max: measureText(measure, alert.max, { language, units }),
          });
        })
        .join('\n'),
      2000,
    );
  }
  return card;
}

/**
 * @description The "overview" widget.
 * @param {object} options - Options.
 * @param {object[]} options.views - The views of the sensors (app.js).
 * @param {object[]} options.gateways - `{ gateway, connected }` per gateway.
 * @param {string} options.language - The user language.
 * @param {string} options.units - `metric` or `us`.
 * @param {number} options.now - Now (ms).
 * @returns {object} The content.
 */
function buildOverviewWidget({ views, gateways, language, units, now }) {
  const alerting = views.filter((view) => alertsOf(view).length).length;
  const silent = views.filter((view) => view.silent).length;
  const components = [
    {
      type: 'value',
      label: clip(t('tileSensors', language), 24),
      value: views.length,
      icon: 'thermometer',
      color: WIDGET_COLORS.PRIMARY,
    },
    {
      type: 'value',
      label: clip(t('tileAlerts', language), 24),
      value: alerting,
      icon: 'alert-triangle',
      color: alerting ? WIDGET_COLORS.DANGER : WIDGET_COLORS.SUCCESS,
    },
    {
      type: 'value',
      label: clip(t('tileSilent', language), 24),
      value: silent,
      icon: 'wifi-off',
      color: silent ? WIDGET_COLORS.WARNING : WIDGET_COLORS.NEUTRAL,
    },
  ];
  const sorted = [...views].sort(
    (a, b) => urgency(b) - urgency(a) || a.name.localeCompare(b.name, language),
  );
  if (sorted.length) {
    components.push({
      type: 'card-list',
      display: 'list',
      items: sorted.slice(0, MAX_CARDS).map((view) => sensorCard(view, { language, units, now })),
    });
  }
  if (sorted.length > MAX_CARDS) {
    components.push({
      type: 'text',
      variant: 'caption',
      text: clip(t('widgetMore', language, { count: sorted.length - MAX_CARDS }), 80),
    });
  }
  if (gateways.length) {
    components.push({
      type: 'status',
      items: gateways.slice(0, MAX_GATEWAYS).map(({ gateway, connected }) => ({
        label: clip(gateway.name, 40),
        value: clip(
          connected
            ? t('gatewayConnected', language)
            : t('rowDisconnected', language, { ago: ago(gateway.lastSeen ?? 0, now, language) }),
          40,
        ),
        icon: connected ? 'wifi' : 'wifi-off',
        color: connected ? WIDGET_COLORS.SUCCESS : WIDGET_COLORS.DANGER,
      })),
    });
  }
  return { ttl_seconds: TTL_SECONDS.overview, components };
}

/**
 * @description The lowest and highest of a series of values.
 * @param {number[]} values - The values (non-finite ones ignored).
 * @returns {{ min: number, max: number }|null} The range, null when empty.
 */
function rangeOf(values) {
  const finite = values.filter(Number.isFinite);
  return finite.length ? { min: Math.min(...finite), max: Math.max(...finite) } : null;
}

/**
 * @description The "sensor" widget.
 * @param {object} options - Options.
 * @param {object} options.view - The view of the sensor (app.js).
 * @param {Array<number[]>} options.history - `[observed, °C, %, dew point °C]` points.
 * @param {string} options.language - The user language.
 * @param {string} options.units - `metric` or `us`.
 * @param {number} options.now - Now (ms).
 * @param {string} options.timeZone - The timezone of Gladys.
 * @returns {object} The content.
 */
function buildSensorWidget({ view, history, language, units, now, timeZone }) {
  const sample = view.sample;
  const alerts = alertsOf(view);
  const components = [{ type: 'text', variant: 'heading', text: clip(view.name, 40) }];
  for (const { measure, icon } of TILE_MEASURES) {
    if (!view.measures.includes(measure)) {
      continue;
    }
    const shown = convert(measure, sample?.[measure], units);
    const alerting = alerts.some((alert) => alert.measure === measure);
    components.push({
      type: 'value',
      label: clip(t(`tile_${measure}`, language), 24),
      value: Number.isFinite(shown)
        ? clip(formatNumber(shown, language, decimalsOf(measure, units)), 12)
        : '–',
      ...(Number.isFinite(shown) ? { unit: unitOf(measure, units) } : {}),
      icon,
      color: alerting
        ? WIDGET_COLORS.DANGER
        : view.silent
          ? WIDGET_COLORS.NEUTRAL
          : WIDGET_COLORS.PRIMARY,
    });
  }
  const points = history.filter((point) => now - point[0] <= 24 * 3600 * 1000);
  const series = [
    {
      name: t('measure_temperature', language),
      points: points
        .filter((point) => Number.isFinite(point[1]))
        .map((point) => ({
          t: new Date(point[0]).toISOString(),
          v: Math.round(convert('temperature', point[1], units) * 10) / 10,
        })),
    },
    {
      name: t('measure_dewpoint', language),
      points: points
        .filter((point) => Number.isFinite(point[3]))
        .map((point) => ({
          t: new Date(point[0]).toISOString(),
          v: Math.round(convert('dewpoint', point[3], units) * 10) / 10,
        })),
    },
  ].filter((entry) => entry.points.length >= 2);
  if (series.length) {
    components.push({
      type: 'chart',
      chart_type: 'line',
      title: clip(t('chartTitle', language), 60),
      unit: unitOf('temperature', units),
      series,
    });
  }
  const rows = [
    {
      label: clip(t('rowLastSample', language), 40),
      value: sample
        ? clip(
            t('rowAgo', language, {
              time: formatTime(sample.observed, { language, timeZone, now }),
              ago: ago(sample.observed, now, language),
            }),
            40,
          )
        : clip(t('never', language), 40),
      color: view.silent ? WIDGET_COLORS.DANGER : WIDGET_COLORS.SUCCESS,
    },
  ];
  const temperatures = rangeOf(points.map((point) => point[1]));
  if (temperatures) {
    rows.push({
      label: clip(t('rowTemperature24h', language), 40),
      value: clip(
        `${measureText('temperature', temperatures.min, { language, units })} – ${measureText('temperature', temperatures.max, { language, units })}`,
        40,
      ),
      color: WIDGET_COLORS.INFO,
    });
  }
  const humidities = rangeOf(points.map((point) => point[2]));
  if (humidities) {
    rows.push({
      label: clip(t('rowHumidity24h', language), 40),
      value: clip(
        `${measureText('humidity', humidities.min, { language, units })} – ${measureText('humidity', humidities.max, { language, units })}`,
        40,
      ),
      color: WIDGET_COLORS.INFO,
    });
  }
  for (const measure of ['temperature', 'humidity']) {
    const alert = view.sensor.alerts?.[measure];
    if (!alert?.enabled) {
      continue;
    }
    const alerting = alerts.some((entry) => entry.measure === measure);
    rows.push({
      label: clip(t(`rowAlert_${measure}`, language), 40),
      value: clip(
        `${measureText(measure, alert.min, { language, units })} – ${measureText(measure, alert.max, { language, units })}`,
        40,
      ),
      color: alerting ? WIDGET_COLORS.DANGER : WIDGET_COLORS.SUCCESS,
    });
  }
  if (Number.isFinite(view.sensor.batteryVoltage)) {
    rows.push({
      label: clip(t('rowBattery', language), 40),
      value: `${formatNumber(view.sensor.batteryVoltage, language, 2)} V`,
      color: WIDGET_COLORS.NEUTRAL,
    });
  }
  if (Number.isFinite(view.sensor.rssi)) {
    rows.push({
      label: clip(t('rowSignal', language), 40),
      value: `${formatNumber(view.sensor.rssi, language, 0)} dBm`,
      color: WIDGET_COLORS.NEUTRAL,
    });
  }
  components.push({ type: 'status', items: rows.slice(0, 10) });
  return { ttl_seconds: TTL_SECONDS.sensor, components };
}

export {
  WIDGETS,
  TTL_SECONDS,
  MAX_CARDS,
  clip,
  messageContent,
  measureText,
  alertsOf,
  buildOverviewWidget,
  buildSensorWidget,
};
