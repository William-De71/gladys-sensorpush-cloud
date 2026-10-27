// -----------------------------------------------------------------------------
// Configuration of the SensorPush Cloud integration.
//
// Fields of the config_schema:
//   - `email`           the e-mail address of the SensorPush account;
//   - `password`        its password: a `secret`, never sent back to the UI,
//                       never logged, never written to /data; only sent to
//                       api.sensorpush.com to sign in;
//   - `sample_interval` minutes between two readings of the last samples
//                       (1, 2, 5 or 10; 1 by default): a gateway relays the
//                       sensors about once a minute, and SensorPush accepts
//                       one request a minute at most;
//   - `silent_after`    minutes without a new sample before a sensor is
//                       "silent" (trigger, widgets), 30 by default;
//   - `scene_units`     units of the scene action outputs and texts: metric
//                       (°C, hPa) or US (°F, inHg); the widgets follow the
//                       units of the Gladys user;
//   - `language`        language of the texts Gladys does not ask for in a
//                       language (feature names, gateway state, scene texts):
//                       `auto` follows the language of the last widget, or the
//                       timezone.
//
// Internal key, outside the config_schema (never shown in the UI):
//   - `last_language` language of the last widget request.
// -----------------------------------------------------------------------------

import { isLanguage } from './i18n.js';

const AUTO_LANGUAGE = 'auto';
const INTERNAL_KEYS = { language: 'last_language' };
const SAMPLE_INTERVALS = ['1', '2', '5', '10'];
const DEFAULT_SAMPLE_MINUTES = 1;
const SILENT_DELAYS = ['15', '30', '60', '120', '360'];
const DEFAULT_SILENT_MINUTES = 30;
const UNIT_SYSTEMS = ['metric', 'us'];

const readString = (raw) =>
  typeof raw === 'string' ? raw.trim() : typeof raw === 'number' ? String(raw) : '';

/**
 * @description A value of a select, else its default.
 * @param {unknown} raw - The value.
 * @param {string[]} options - The values of the select.
 * @param {number} fallback - The default.
 * @returns {number} The number.
 */
const readOption = (raw, options, fallback) => {
  const text = readString(raw);
  return options.includes(text) ? Number(text) : fallback;
};

/**
 * @description Normalize the raw config object from the host API.
 * @param {object} [rawConfig] - The raw config values.
 * @returns {object} `{ email, password, sampleMinutes, silentMinutes, units, language }`.
 * @example
 * normalizeConfig({ email: ' Me@Example.org ', password: 'x' }); // email 'Me@Example.org'
 */
function normalizeConfig(rawConfig = {}) {
  const config = rawConfig ?? {};
  // The password is kept as typed: a space can be part of it.
  const password = typeof config.password === 'string' ? config.password : '';
  const units = readString(config.scene_units);
  return {
    email: readString(config.email).slice(0, 320),
    password: password.trim() ? password : '',
    sampleMinutes: readOption(config.sample_interval, SAMPLE_INTERVALS, DEFAULT_SAMPLE_MINUTES),
    silentMinutes: readOption(config.silent_after, SILENT_DELAYS, DEFAULT_SILENT_MINUTES),
    units: UNIT_SYSTEMS.includes(units) ? units : 'metric',
    language: isLanguage(config.language) ? config.language : AUTO_LANGUAGE,
  };
}

// The timezones of the countries that speak the languages of the integration:
// the automatic language before any widget was shown.
const TIMEZONE_LANGUAGES = {
  fr: [
    'Europe/Paris',
    'Europe/Monaco',
    'Europe/Brussels',
    'Europe/Luxembourg',
    'Indian/Reunion',
    'Indian/Mayotte',
    'America/Guadeloupe',
    'America/Martinique',
    'America/Cayenne',
    'America/Miquelon',
    'Pacific/Noumea',
    'Pacific/Tahiti',
    'America/Montreal',
    'Africa/Abidjan',
    'Africa/Dakar',
    'Africa/Casablanca',
    'Africa/Algiers',
    'Africa/Tunis',
  ],
  de: ['Europe/Berlin', 'Europe/Busingen', 'Europe/Vienna', 'Europe/Zurich', 'Europe/Vaduz'],
  es: [
    'Europe/Madrid',
    'Atlantic/Canary',
    'Africa/Ceuta',
    'America/Mexico_City',
    'America/Bogota',
    'America/Lima',
    'America/Santiago',
    'America/Caracas',
    'America/Montevideo',
    'America/Asuncion',
    'America/La_Paz',
    'America/Guayaquil',
    'America/Havana',
    'America/Costa_Rica',
    'America/Panama',
  ],
};

/**
 * @description The language of the texts guessed from a timezone, before
 * any widget was shown.
 * @param {string} timezone - IANA timezone of Gladys.
 * @returns {string} en, fr, de or es.
 * @example
 * guessLanguage('Europe/Paris'); // -> 'fr'
 */
function guessLanguage(timezone) {
  const zone = String(timezone ?? '');
  if (zone.startsWith('America/Argentina/')) {
    return 'es';
  }
  const found = Object.entries(TIMEZONE_LANGUAGES).find(([, zones]) => zones.includes(zone));
  return found ? found[0] : 'en';
}

/**
 * @description Read the stored language of the last widget request.
 * @param {object} [rawConfig] - The raw config values.
 * @param {string} fallback - The language to keep when nothing valid is stored.
 * @returns {string} The language.
 */
function readLanguage(rawConfig, fallback) {
  const language = (rawConfig ?? {})[INTERNAL_KEYS.language];
  return isLanguage(language) ? language : fallback;
}

export {
  AUTO_LANGUAGE,
  INTERNAL_KEYS,
  SAMPLE_INTERVALS,
  DEFAULT_SAMPLE_MINUTES,
  SILENT_DELAYS,
  DEFAULT_SILENT_MINUTES,
  UNIT_SYSTEMS,
  normalizeConfig,
  guessLanguage,
  readLanguage,
};
