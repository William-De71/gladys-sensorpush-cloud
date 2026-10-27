// -----------------------------------------------------------------------------
// The SensorPush Cloud integration: every handler, registered on a Gladys client.
//
// Brings the sensors and gateways of a SensorPush account into Gladys, through
// the official Gateway Cloud API, read only:
//   - devices (device.js): one per sensor (temperature, humidity, dew point,
//     barometric pressure, VPD) and one per gateway (connected or not,
//     software version);
//   - scene triggers (events.js): outside / back inside the SensorPush alert
//     range, sensor silent / back, gateway disconnected / reconnected, access
//     refused;
//   - scene actions: values of a sensor (no request), history of a sensor
//     (minimum, maximum and average over 1 to 72 hours: one request);
//   - dashboard widgets (widgets.js): overview, one sensor;
//   - configuration buttons: test the connection, diagnostic.
//
// SensorPush accepts one request a minute at most. The client
// (sensorpush-api.js) keeps the data requests 61 s apart; this module chooses
// what each free slot reads, on a 15-second timer: the sensors first, then
// the last samples at the interval of the configuration (every minute by
// default), the list of the sensors and the gateways again every 15 minutes
// (each takes the slot of a sample reading). A scene action asking for the
// history waits for the next slot. The scene triggers are worked out after
// each reading, never from a scene action.
//
// index.js only creates the SDK client; the tests drive this module with the
// fake Gladys of the SDK and a fake SensorPush (test/helpers/fake-sensorpush.js).
// -----------------------------------------------------------------------------

import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { logger as sdkLogger } from '@gladysassistant/integration-sdk';
import {
  normalizeConfig,
  readLanguage,
  guessLanguage,
  INTERNAL_KEYS,
  AUTO_LANGUAGE,
} from './config.js';
import { createSensorPushClient } from './sensorpush-api.js';
import { createStore } from './store.js';
import { parseSensors, parseGateways, parseSamples, measuresOf, MEASURES } from './parse.js';
import {
  sensorIds,
  gatewayIds,
  platformId,
  sensorOfExternalId,
  sensorName,
  sensorFeatureKeys,
  buildSensorDevice,
  buildGatewayDevice,
  buildSensorStates,
  buildGatewayStates,
} from './device.js';
import {
  TRIGGERS,
  SCENE_ACTIONS,
  SENSOR_OUTPUTS,
  HISTORY_OUTPUTS,
  pick,
  rounded,
  isFresh,
  isConnected,
  detectSensor,
  detectGateway,
  sensorEventData,
  gatewayEventData,
} from './events.js';
import {
  WIDGETS,
  messageContent,
  measureText,
  alertsOf,
  buildOverviewWidget,
  buildSensorWidget,
} from './widgets.js';
import { convert, unitOf } from './units.js';
import { MINUTE_MS, HOUR_MS, defaultTimeZone, usableTimeZone } from './time.js';
import { t, all, formatNumber, LANGUAGES } from './i18n.js';

const ACTIONS = {
  TEST_CONNECTION: 'test_connection',
  DIAGNOSTIC: 'diagnostic',
};
const TICK_MS = 15 * 1000;
const STARTUP_DELAY_MS = 5 * 1000;
// The list of the sensors and the gateways are read again this often.
const LIST_EVERY_MS = 15 * MINUTE_MS;
// A failed reading is tried again at the next free slot, one minute later at least.
const RETRY_MS = MINUTE_MS;
// A refused account is tried again this often.
const ACCESS_RETRY_MS = 30 * MINUTE_MS;
// A sample reading is due a few seconds early: the slots are 61 s apart.
const SAMPLE_EARLY_MS = 5 * 1000;
// Re-send unchanged values of a sensor still reporting, so that Gladys does
// not show them as outdated.
const HEARTBEAT_MS = 30 * MINUTE_MS;
// The chart of the sensor widget: one point every 10 minutes, 24 hours.
const HISTORY_STEP_MS = 10 * MINUTE_MS;
const HISTORY_SPAN_MS = 24 * HOUR_MS;
const MAX_HISTORY_HOURS = 72;
const DIAGNOSTIC_CHUNK = 3000;
const { version: VERSION } = JSON.parse(
  readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
);
const USER_AGENT = `gladys-sensorpush-cloud/${VERSION} (+https://github.com/William-De71/gladys-sensorpush-cloud)`;

/**
 * @description The account the readings belong to: a short SHA-256 of the e-mail.
 * @param {string} email - The e-mail address.
 * @returns {string|null} The fingerprint.
 */
const accountOf = (email) =>
  email
    ? createHash('sha256').update(String(email).toLowerCase(), 'utf8').digest('hex').slice(0, 16)
    : null;

/**
 * @description Register every handler of the integration on a Gladys client.
 * @param {object} gladys - A GladysIntegration (or the fake Gladys of the SDK).
 * @param {object} [options] - Options.
 * @param {Function} [options.fetch] - HTTP transport of SensorPush (tests).
 * @param {string} [options.baseUrl] - The API root (tests).
 * @param {string} [options.dataDir] - The writable folder (/data).
 * @param {Function} [options.now] - `() => number` in ms (tests).
 * @param {Function} [options.sleep] - `(ms) => Promise` (tests).
 * @param {string} [options.timeZone] - IANA timezone of Gladys (TZ by default).
 * @param {boolean} [options.timers] - Arm the reading timer (false in tests).
 * @param {number} [options.dataSpacingMs] - Time between two data requests.
 * @param {object} [options.logger] - Logger.
 * @returns {object} Handles for the tests.
 */
function createApp(
  gladys,
  {
    fetch: fetchFn,
    baseUrl,
    dataDir,
    now = () => Date.now(),
    sleep,
    timeZone: zone = defaultTimeZone(),
    timers = true,
    dataSpacingMs,
    logger = sdkLogger,
  } = {},
) {
  const timeZone = usableTimeZone(zone);
  let config = normalizeConfig();
  let language = guessLanguage(timeZone);
  let createdDevices = new Set();
  let lastStatus = null;
  let lastDiscovery = null;
  let lastAccessTry = 0;
  let timer = null;
  let startTimer = null;
  let running = null;
  let stopped = false;

  const store = createStore({ ...(dataDir ? { dir: dataDir } : {}), logger });
  const api = createSensorPushClient({
    getCredentials: () => ({ email: config.email, password: config.password }),
    userAgent: USER_AGENT,
    now,
    ...(sleep ? { sleep } : {}),
    ...(fetchFn ? { fetch: fetchFn } : {}),
    ...(baseUrl ? { baseUrl } : {}),
    ...(Number.isFinite(dataSpacingMs) ? { dataSpacingMs } : {}),
  });

  const hasCredentials = () => Boolean(config.email && config.password);
  const silentMs = () => config.silentMinutes * MINUTE_MS;
  const sampleMs = () => config.sampleMinutes * MINUTE_MS;

  /**
   * @description Remember the language of a widget request, and store it when it changed.
   * @param {string} next - The language.
   */
  function rememberLanguage(next) {
    if (!LANGUAGES.includes(next) || next === language) {
      return;
    }
    language = next;
    gladys
      .setConfig({ [INTERNAL_KEYS.language]: next })
      .catch((err) => logger.warn(`Unable to store the language: ${err.message}`));
  }

  /**
   * @description Language of the texts Gladys does not ask for in a language.
   * @returns {string} The language.
   */
  const textLanguage = () => (config.language === AUTO_LANGUAGE ? language : config.language);

  // --- What is known ----------------------------------------------------------------

  /**
   * @description The view of a sensor the widgets, the scenes and the states use.
   * @param {object} sensor - parseSensors() entry.
   * @returns {object} The view.
   */
  function viewOf(sensor) {
    const sample = store.data.latest[sensor.id] ?? null;
    const seen = store.data.measuresSeen[sensor.id] ?? [];
    return {
      sensor,
      deviceId: sensorIds(gladys, sensor.id).device,
      name: sensorName(sensor),
      sample,
      silent: !isFresh(sample, now(), silentMs()),
      measures: sensorFeatureKeys(seen),
    };
  }

  /**
   * @description The sensors with at least one sample (the ones offered as devices).
   * @returns {object[]} parseSensors() entries.
   */
  const readSensors = () => store.data.sensors.filter((sensor) => store.data.latest[sensor.id]);

  /**
   * @description The sensor a widget or a scene action targets.
   * @param {unknown} externalId - The `source: "devices"` value.
   * @returns {object|null} The sensor, the first one by default.
   */
  function target(externalId) {
    const id = sensorOfExternalId(externalId);
    const sensors = readSensors();
    return sensors.find((sensor) => platformId(sensor.id) === id) ?? sensors[0] ?? null;
  }

  // --- Errors and status -------------------------------------------------------------

  /**
   * @description The message of an error, for a user.
   * @param {object} err - The error (`kind`, `code`).
   * @param {string} lang - The language.
   * @returns {string} The message.
   */
  function errorText(err, lang) {
    if (err?.kind === 'auth') {
      if (err.code === 'missing') return t('statusNoCredentials', lang);
      return t(err.code === 'invalid_password' ? 'errInvalidPassword' : 'errRefused', lang);
    }
    const key = {
      token: 'errToken',
      rate_limit: 'errPaused',
      server: 'errServer',
      unreachable: 'errUnreachable',
    }[err?.kind];
    if (key) {
      return t(key, lang);
    }
    return t('errFailed', lang, { detail: String(err?.message ?? '').slice(0, 120) });
  }

  /**
   * @description Report the connection status, only when it changed.
   * @param {boolean} connected - Connected or not.
   * @param {object} message - The multi-language message.
   * @returns {Promise<void>}
   */
  async function reportStatus(connected, message) {
    const clipped = Object.fromEntries(
      Object.entries(message).map(([lang, text]) => [lang, text.slice(0, 200)]),
    );
    const signature = JSON.stringify([connected, clipped]);
    if (signature === lastStatus) {
      return;
    }
    lastStatus = signature;
    try {
      await gladys.setConnectionStatus(connected, clipped);
    } catch (err) {
      lastStatus = null;
      logger.error('Unable to report the connection status', err);
    }
  }

  /**
   * @description Work out the connection status.
   * @returns {Promise<void>}
   */
  async function refreshStatus() {
    if (!hasCredentials()) {
      await reportStatus(false, all('statusNoCredentials'));
      return;
    }
    if (store.data.accessRefused) {
      await reportStatus(
        false,
        all((lang) => errorText(store.data.accessRefused, lang)),
      );
      return;
    }
    if (!store.data.sensorsAt) {
      await reportStatus(true, all('statusWaiting'));
      return;
    }
    if (store.data.sensors.length === 0) {
      await reportStatus(false, all('statusNoSensor'));
      return;
    }
    const sensors = store.data.sensors.length;
    const gateways = store.data.gateways.length;
    await reportStatus(
      true,
      all((lang) =>
        [
          t('statusOk', lang, { sensors, gateways }),
          ...(api.pausedUntil() ? [t('statusPaused', lang)] : []),
        ].join(' '),
      ),
    );
  }

  /**
   * @description Refresh the list of the devices the user created.
   * @returns {Promise<void>}
   */
  async function refreshCreatedDevices() {
    try {
      const devices = await gladys.getDevices();
      createdDevices = new Set(devices.map((device) => device.external_id));
    } catch (err) {
      logger.warn(`Unable to read the devices: ${err.message}`);
    }
  }

  /**
   * @description Ask the open widgets to pull their content again.
   */
  function refreshWidgets() {
    for (const key of Object.values(WIDGETS)) {
      Promise.resolve(gladys.requestWidgetRefresh(key)).catch(() => {});
    }
  }

  /**
   * @description Publish scene events, one by one.
   * @param {Array<{ key: string, data: object }>} events - The events.
   * @returns {Promise<void>}
   */
  async function publishEvents(events) {
    for (const { key, data } of events) {
      logger.info(`SensorPush: ${key}${data.sensor_name ? ` (${data.sensor_name})` : ''}`);
      try {
        await gladys.publishSceneEvent(key, data);
      } catch (err) {
        logger.warn(`Unable to fire ${key}: ${err.message}`);
      }
    }
  }

  // --- Devices -----------------------------------------------------------------------

  /**
   * @description Offer the devices of the sensors and the gateways, when they changed.
   * @param {boolean} [force] - Publish even when unchanged.
   * @returns {Promise<number>} How many devices were offered.
   */
  async function publishDiscoveredDevices(force = false) {
    const lang = textLanguage();
    const devices = [
      ...readSensors().map((sensor) =>
        buildSensorDevice(gladys, sensor, {
          language: lang,
          seen: store.data.measuresSeen[sensor.id] ?? [],
        }),
      ),
      ...store.data.gateways.map((gateway) =>
        buildGatewayDevice(gladys, gateway, { language: lang }),
      ),
    ];
    const signature = JSON.stringify(devices);
    if (force || signature !== lastDiscovery) {
      await gladys.publishDiscoveredDevices(devices);
      lastDiscovery = signature;
    }
    return devices.length;
  }

  /**
   * @description Publish the states of every created device.
   * @returns {Promise<void>}
   */
  async function publishAllStates() {
    const lang = textLanguage();
    for (const sensor of readSensors()) {
      if (!createdDevices.has(sensorIds(gladys, sensor.id).device)) {
        continue;
      }
      const sample = store.data.latest[sensor.id];
      const states = buildSensorStates(
        gladys,
        sensor,
        sample,
        store.data.measuresSeen[sensor.id] ?? [],
      );
      // A silent sensor lets its values age: Gladys shows them as outdated.
      const options = isFresh(sample, now(), silentMs()) ? { heartbeat: HEARTBEAT_MS } : {};
      await gladys
        .publishChangedStates(states, options)
        .catch((err) =>
          logger.warn(`Unable to publish the states of ${sensor.id}: ${err.message}`),
        );
    }
    for (const gateway of store.data.gateways) {
      if (!createdDevices.has(gatewayIds(gladys, gateway.key).device)) {
        continue;
      }
      const states = buildGatewayStates(gladys, gateway, {
        connected: isConnected(gateway, now()),
        language: lang,
      });
      await gladys
        .publishChangedStates(states, { heartbeat: HEARTBEAT_MS })
        .catch((err) =>
          logger.warn(`Unable to publish the states of gateway ${gateway.key}: ${err.message}`),
        );
    }
  }

  // --- Reading -----------------------------------------------------------------------

  /**
   * @description Remember a refusal of the account (the trigger fires once, from the timer).
   * @param {object} err - The error.
   */
  function refused(err) {
    const code = err.kind === 'auth' ? (err.code ?? 'refused') : 'token';
    const signature = `${err.kind}:${code}`;
    const announced =
      store.data.accessRefused?.signature === signature && store.data.accessRefused.announced;
    store.data.accessRefused = { kind: err.kind, code, signature, announced: Boolean(announced) };
    lastAccessTry = now();
  }

  /**
   * @description Note the error of a reading.
   * @param {string} what - The reading.
   * @param {Error} err - The error.
   */
  function noteError(what, err) {
    const kind = err.kind ?? 'failed';
    logger.warn(`SensorPush ${what} (${kind}): ${err.message}`);
    store.data.lastError = { kind, message: String(err.message).slice(0, 200), at: now() };
  }

  /**
   * @description Keep the new samples: the newest per sensor, the measures
   * seen, a point of the 24-hour chart every 10 minutes.
   * @param {object} parsed - parseSamples().
   */
  function keepSamples(parsed) {
    for (const [id, samples] of Object.entries(parsed.sensors)) {
      const newest = samples[0];
      const previous = store.data.latest[id];
      if (!previous || newest.observed >= previous.observed) {
        store.data.latest[id] = newest;
      }
      const seen = new Set(store.data.measuresSeen[id] ?? []);
      for (const sample of samples) {
        measuresOf(sample).forEach((measure) => seen.add(measure));
      }
      store.data.measuresSeen[id] = MEASURES.filter((measure) => seen.has(measure));
      const history = (store.data.history[id] ?? []).filter(
        (point) => Array.isArray(point) && now() - point[0] <= HISTORY_SPAN_MS,
      );
      for (const sample of [...samples].reverse()) {
        const last = history[history.length - 1];
        if (!last || sample.observed - last[0] >= HISTORY_STEP_MS) {
          history.push([
            sample.observed,
            rounded(sample.temperature, 2),
            rounded(sample.humidity, 1),
            rounded(sample.dewpoint, 2),
          ]);
        }
      }
      store.data.history[id] = history.slice(-160);
    }
  }

  /**
   * @description What the next free slot reads.
   * @returns {string|null} `sensors`, `samples`, `gateways`, or null.
   */
  function nextJob() {
    const at = now();
    const data = store.data;
    const retried = (triedAt) => at - triedAt >= RETRY_MS;
    if (!data.sensorsAt) {
      return retried(data.sensorsTriedAt) ? 'sensors' : null;
    }
    if (!data.samplesAt && retried(data.samplesTriedAt)) {
      return 'samples';
    }
    if (at - data.sensorsAt >= LIST_EVERY_MS && retried(data.sensorsTriedAt)) {
      return 'sensors';
    }
    if (at - data.gatewaysAt >= LIST_EVERY_MS && retried(data.gatewaysTriedAt)) {
      return 'gateways';
    }
    if (at - data.samplesAt >= sampleMs() - SAMPLE_EARLY_MS && retried(data.samplesTriedAt)) {
      return 'samples';
    }
    return null;
  }

  /**
   * @description Read what the next free slot is due for (one data request at most).
   * @param {object} [options] - `{ job }`: force a reading.
   * @returns {Promise<{ job: string|null, error: object|null }>} What happened.
   */
  async function runReadings({ job: forced } = {}) {
    if (!hasCredentials()) {
      return { job: null, error: { kind: 'auth', code: 'missing' } };
    }
    if (!forced && store.data.accessRefused && now() - lastAccessTry < ACCESS_RETRY_MS) {
      return { job: null, error: store.data.accessRefused };
    }
    // A slot due before the next round is taken now: the client waits for it.
    if (!forced && api.nextDataAt() - now() > TICK_MS) {
      return { job: null, error: null };
    }
    const job = forced ?? nextJob();
    if (!job) {
      return { job: null, error: null };
    }
    const data = store.data;
    data[`${job}TriedAt`] = now();
    lastAccessTry = now();
    let error = null;
    try {
      if (job === 'sensors') {
        data.sensors = parseSensors(await api.sensors());
        data.sensorsAt = now();
        const ids = new Set(data.sensors.map((sensor) => sensor.id));
        for (const key of ['latest', 'measuresSeen', 'history']) {
          for (const id of Object.keys(data[key])) {
            if (!ids.has(id)) delete data[key][id];
          }
        }
        for (const id of Object.keys(data.seen.sensors)) {
          if (!ids.has(id)) delete data.seen.sensors[id];
        }
      } else if (job === 'gateways') {
        data.gateways = parseGateways(await api.gateways());
        data.gatewaysAt = now();
        const keys = new Set(data.gateways.map((gateway) => gateway.key));
        for (const key of Object.keys(data.seen.gateways)) {
          if (!keys.has(key)) delete data.seen.gateways[key];
        }
      } else {
        keepSamples(parseSamples(await api.samples({ limit: 1 })));
        data.samplesAt = now();
      }
      if (data.accessRefused) {
        logger.info('SensorPush accepts the account again');
        data.accessRefused = null;
      }
    } catch (err) {
      noteError(job, err);
      if (['auth', 'token'].includes(err.kind)) {
        refused(err);
      }
      error = err;
    }
    await store.save();
    await publishDiscoveredDevices().catch((err) =>
      logger.warn(`Unable to offer the devices: ${err.message}`),
    );
    await publishAllStates();
    refreshWidgets();
    return { job, error };
  }

  /**
   * @description Work out the scene events from what was read (timer only).
   * @returns {Promise<void>}
   */
  async function detectEvents() {
    const events = [];
    const lang = textLanguage();
    const refusal = store.data.accessRefused;
    if (refusal && !refusal.announced) {
      events.push({
        key: TRIGGERS.ACCESS_REFUSED,
        data: { reason: refusal.code, message: errorText(refusal, lang).slice(0, 1000) },
      });
      refusal.announced = true;
    }
    for (const sensor of readSensors()) {
      const view = viewOf(sensor);
      const found = detectSensor(store.data.seen.sensors[sensor.id], sensor, view.sample, {
        now: now(),
        silentMs: silentMs(),
      });
      store.data.seen.sensors[sensor.id] = found.next;
      for (const event of found.events) {
        events.push({
          key: event.key,
          data: sensorEventData(view, event, { language: lang, units: config.units, now: now() }),
        });
      }
    }
    if (store.data.gatewaysAt) {
      for (const gateway of store.data.gateways) {
        const found = detectGateway(store.data.seen.gateways[gateway.key], gateway, now());
        store.data.seen.gateways[gateway.key] = found.next;
        const view = { gateway, deviceId: gatewayIds(gladys, gateway.key).device };
        for (const event of found.events) {
          events.push({ key: event.key, data: gatewayEventData(view, event, now()) });
        }
      }
    }
    if (events.length) {
      await store.save();
      await publishEvents(events);
      refreshWidgets();
    }
  }

  /**
   * @description One round of the timer: the reading due, then the triggers.
   * @returns {Promise<void>}
   */
  function tick() {
    if (!running) {
      running = (async () => {
        const { job } = await runReadings();
        // Time passes for the silence and the gateways even without a reading.
        await detectEvents();
        if (!job) {
          await publishAllStates();
        }
        await refreshStatus();
      })()
        .catch((err) => logger.error('Readings', err))
        .finally(() => {
          running = null;
        });
    }
    return running;
  }

  /**
   * @description (Re)arm the reading timer.
   */
  function schedule() {
    clearInterval(timer);
    clearTimeout(startTimer);
    if (!timers || stopped) {
      return;
    }
    startTimer = setTimeout(tick, STARTUP_DELAY_MS);
    startTimer.unref?.();
    timer = setInterval(tick, TICK_MS);
    timer.unref?.();
  }

  /**
   * @description Offer the devices, publish what is known, arm the timer.
   * @returns {Promise<void>}
   */
  async function applyConfig() {
    await store.save();
    await publishDiscoveredDevices().catch((err) =>
      logger.warn(`Unable to offer the devices: ${err.message}`),
    );
    await publishAllStates();
    await refreshStatus();
    schedule();
  }

  // --- Dashboard widgets -------------------------------------------------------------

  /**
   * @description The message a widget shows when there is no sensor to show.
   * @param {string} lang - The language.
   * @returns {object|null} The content, null when there are sensors.
   */
  function widgetMessage(lang) {
    if (!hasCredentials()) {
      return messageContent(t('statusNoCredentials', lang));
    }
    if (store.data.accessRefused) {
      return messageContent(errorText(store.data.accessRefused, lang));
    }
    if (readSensors().length === 0) {
      return messageContent(
        t(store.data.sensorsAt && store.data.samplesAt ? 'statusNoSensor' : 'statusWaiting', lang),
      );
    }
    return null;
  }

  gladys.onWidgetGet(WIDGETS.OVERVIEW, async ({ language: lang, units } = {}) => {
    rememberLanguage(lang);
    return (
      widgetMessage(lang) ??
      buildOverviewWidget({
        views: readSensors().map(viewOf),
        gateways: store.data.gateways.map((gateway) => ({
          gateway,
          connected: isConnected(gateway, now()),
        })),
        language: lang,
        units,
        now: now(),
      })
    );
  });

  gladys.onWidgetGet(WIDGETS.SENSOR, async ({ settings = {}, language: lang, units } = {}) => {
    rememberLanguage(lang);
    const message = widgetMessage(lang);
    if (message) {
      return message;
    }
    const sensor = target(settings.sensor);
    return buildSensorWidget({
      view: viewOf(sensor),
      history: store.data.history[sensor.id] ?? [],
      language: lang,
      units,
      now: now(),
      timeZone,
    });
  });

  // --- Scene actions -----------------------------------------------------------------

  /**
   * @description The sensor of a scene action, checked.
   * @param {unknown} externalId - The `sensor` field.
   * @param {string} lang - The language.
   * @returns {object} The sensor.
   */
  function actionTarget(externalId, lang) {
    if (!hasCredentials()) {
      throw new Error(t('statusNoCredentials', lang));
    }
    const sensor = target(externalId);
    if (!sensor) {
      throw new Error(t('errNoSensor', lang));
    }
    return sensor;
  }

  // Answers from what the timer read: no request.
  gladys.onSceneAction(SCENE_ACTIONS.GET_SENSOR, async (fields = {}) => {
    const lang = textLanguage();
    const units = config.units;
    const view = viewOf(actionTarget(fields.sensor, lang));
    const sample = view.sample;
    const value = (measure, decimals) =>
      view.measures.includes(measure)
        ? rounded(convert(measure, sample?.[measure], units), decimals)
        : null;
    const minutes = sample ? Math.max(0, Math.round((now() - sample.observed) / MINUTE_MS)) : null;
    const shown = (measure) => measureText(measure, sample?.[measure], { language: lang, units });
    const alerts = alertsOf(view);
    const summary = [
      t('summarySensor', lang, {
        name: view.name,
        temperature: shown('temperature'),
        humidity: shown('humidity'),
      }),
      ...alerts.map(({ measure, side }) =>
        t('summaryAlert', lang, {
          measure: t(`measure_${measure}`, lang),
          side: t(`side_${side}`, lang),
        }),
      ),
      ...(view.silent
        ? [t('summarySilent', lang, { minutes: formatNumber(minutes ?? 0, lang, 0) })]
        : []),
    ].join(' ');
    return pick(
      {
        sensor_name: view.name,
        temperature: value('temperature', 1),
        humidity: value('humidity', 1),
        dewpoint: value('dewpoint', 1),
        pressure: value('pressure', units === 'us' ? 2 : 1),
        vpd: value('vpd', 2),
        battery_voltage: rounded(view.sensor.batteryVoltage, 2),
        signal: rounded(view.sensor.rssi, 0),
        minutes_since_sample: minutes,
        is_silent: view.silent,
        temperature_unit: unitOf('temperature', units),
        summary: summary.slice(0, 1000),
      },
      SENSOR_OUTPUTS,
    );
  });

  // One request (samples of one sensor since N hours), in the next free slot.
  gladys.onSceneAction(SCENE_ACTIONS.GET_HISTORY, async (fields = {}) => {
    const lang = textLanguage();
    const units = config.units;
    const sensor = actionTarget(fields.sensor, lang);
    const hours = Math.min(MAX_HISTORY_HOURS, Math.max(1, Math.round(Number(fields.hours) || 24)));
    let parsed;
    try {
      parsed = parseSamples(
        await api.samples({
          sensors: [sensor.id],
          startTime: new Date(now() - hours * HOUR_MS).toISOString(),
          limit: hours * 60 + 60,
        }),
      );
    } catch (err) {
      noteError('history', err);
      throw new Error(errorText(err, lang).slice(0, 500), { cause: err });
    }
    const samples = parsed.sensors[sensor.id] ?? [];
    const stats = (measure) => {
      const values = samples.map((sample) => sample[measure]).filter(Number.isFinite);
      if (!values.length) return { min: null, max: null, avg: null };
      const sum = values.reduce((total, value) => total + value, 0);
      const show = (value) => rounded(convert(measure, value, units), 1);
      return {
        min: show(Math.min(...values)),
        max: show(Math.max(...values)),
        avg: show(sum / values.length),
      };
    };
    const temperature = stats('temperature');
    const humidity = stats('humidity');
    const name = sensorName(sensor);
    const unit = unitOf('temperature', units);
    const number = (value) => formatNumber(value, lang, 1);
    const summary = samples.length
      ? t('summaryHistory', lang, {
          name,
          hours,
          tmin: `${number(temperature.min)} ${unit}`,
          tmax: `${number(temperature.max)} ${unit}`,
          tavg: `${number(temperature.avg)} ${unit}`,
          hmin: `${number(humidity.min)} %`,
          hmax: `${number(humidity.max)} %`,
        })
      : t('summaryNoHistory', lang, { name, hours });
    return pick(
      {
        sensor_name: name,
        sample_count: samples.length,
        temperature_min: temperature.min,
        temperature_max: temperature.max,
        temperature_avg: temperature.avg,
        humidity_min: humidity.min,
        humidity_max: humidity.max,
        humidity_avg: humidity.avg,
        temperature_unit: unit,
        truncated: parsed.truncated,
        summary: summary.slice(0, 1000),
      },
      HISTORY_OUTPUTS,
    );
  });

  // --- Configuration screen actions --------------------------------------------------

  gladys.onAction(ACTIONS.TEST_CONNECTION, async () => {
    if (!hasCredentials()) {
      return all('statusNoCredentials');
    }
    try {
      await api.signIn();
      store.data.accessRefused = null;
      const { error } = await runReadings({ job: 'sensors' });
      lastStatus = null;
      await refreshStatus();
      schedule();
      if (error) {
        return all((lang) => errorText(error, lang));
      }
      const names = store.data.sensors.map(sensorName).slice(0, 10).join(', ');
      return all((lang) =>
        t('testOk', lang, {
          count: store.data.sensors.length,
          names: names ? ` (${names})` : '',
        }).slice(0, 1000),
      );
    } catch (err) {
      if (['auth', 'token'].includes(err.kind)) {
        refused(err);
        await store.save();
        lastStatus = null;
        await refreshStatus();
      }
      return all((lang) => errorText(err, lang));
    }
  });

  gladys.onAction(ACTIONS.DIAGNOSTIC, async () => {
    const iso = (value) => (Number.isFinite(value) && value ? new Date(value).toISOString() : null);
    const data = store.data;
    const report = {
      version: VERSION,
      timeZone,
      email: config.email ? 'set' : 'missing',
      password: config.password ? 'set' : 'missing',
      token: api.tokenExpiresAt() ? { expiresAt: iso(api.tokenExpiresAt()) } : null,
      sampleMinutes: config.sampleMinutes,
      silentMinutes: config.silentMinutes,
      units: config.units,
      language: config.language,
      accessRefused: data.accessRefused,
      lastError: data.lastError,
      sensorsAt: iso(data.sensorsAt),
      gatewaysAt: iso(data.gatewaysAt),
      samplesAt: iso(data.samplesAt),
      api: {
        ...api.counts(),
        pausedUntil: iso(api.pausedUntil()),
        nextDataAt: iso(api.nextDataAt()),
      },
      sensors: data.sensors.map((sensor) => ({
        id: sensor.id,
        type: sensor.type,
        created: createdDevices.has(sensorIds(gladys, sensor.id).device),
        batteryVoltage: sensor.batteryVoltage,
        rssi: sensor.rssi,
        alerts: sensor.alerts,
        measuresSeen: data.measuresSeen[sensor.id] ?? [],
        latest: data.latest[sensor.id]
          ? { ...data.latest[sensor.id], observed: iso(data.latest[sensor.id].observed) }
          : null,
        historyPoints: (data.history[sensor.id] ?? []).length,
        seen: data.seen.sensors[sensor.id] ?? null,
      })),
      gateways: data.gateways.map((gateway) => ({
        key: gateway.key,
        version: gateway.version,
        lastSeen: iso(gateway.lastSeen),
        connected: isConnected(gateway, now()),
        created: createdDevices.has(gatewayIds(gladys, gateway.key).device),
      })),
    };
    const json = JSON.stringify(report);
    const count = Math.max(1, Math.ceil(json.length / DIAGNOSTIC_CHUNK));
    for (let chunk = 0; chunk < count; chunk += 1) {
      logger.info(
        `SensorPush diagnostic ${chunk + 1}/${count}: ${json.slice(chunk * DIAGNOSTIC_CHUNK, (chunk + 1) * DIAGNOSTIC_CHUNK)}`,
      );
    }
    return all('diagnosticDone', { count });
  });

  // --- Devices -----------------------------------------------------------------------
  gladys.onScanRequest(async () => {
    const count = await publishDiscoveredDevices(true);
    logger.info(`Scan: ${count} device(s) offered`);
    if (!count) {
      store.data.sensorsAt = 0;
      store.data.sensorsTriedAt = 0;
      tick();
    }
  });

  gladys.onDeviceCreated(async () => {
    await refreshCreatedDevices();
    // States sent before the device existed were dropped by Gladys, and the SDK
    // forgot what it sent for this device: send everything known again.
    await publishAllStates();
    refreshWidgets();
  });

  gladys.onDeviceDeleted(refreshCreatedDevices);

  // --- Configuration -----------------------------------------------------------------

  /**
   * @description Reload the whole config (internal keys included).
   * @param {object} [fallback] - Raw values to use when the read fails.
   * @returns {Promise<void>}
   */
  async function loadConfig(fallback) {
    try {
      const raw = await gladys.getConfig();
      config = normalizeConfig(raw);
      language = readLanguage(raw, language);
    } catch (err) {
      if (fallback) {
        config = normalizeConfig(fallback);
      }
      logger.error('Unable to read the configuration', err);
    }
  }

  /**
   * @description Forget what belongs to another account.
   */
  function checkAccount() {
    const account = accountOf(config.email);
    if (store.data.account && store.data.account !== account) {
      store.reset();
      api.forgetToken();
    }
    store.data.account = account;
  }

  gladys.onConfigUpdated(async (rawConfig) => {
    const previous = config;
    await loadConfig(rawConfig);
    logger.info('Configuration updated');
    lastStatus = null;
    lastDiscovery = null;
    checkAccount();
    if (previous.email !== config.email || previous.password !== config.password) {
      // New credentials: a new sign-in at the next slot.
      api.forgetToken();
      store.data.accessRefused = null;
      store.data.sensorsTriedAt = 0;
      store.data.samplesTriedAt = 0;
      store.data.gatewaysTriedAt = 0;
      lastAccessTry = 0;
    }
    await applyConfig();
  });

  // --- Connection lifecycle ----------------------------------------------------------
  // Each (re)connection resynchronizes; the promise lets the tests wait for it.
  let startup = Promise.resolve();
  gladys.on('connected', () => {
    startup = (async () => {
      await store.load();
      await loadConfig();
      checkAccount();
      await refreshCreatedDevices();
      lastStatus = null;
      lastDiscovery = null;
      await applyConfig();
    })().catch((err) => logger.error('Startup', err));
  });

  // --- Graceful shutdown -------------------------------------------------------------
  gladys.handleShutdown(async (signal) => {
    logger.info(`Received ${signal} -> graceful shutdown`);
    stopped = true;
    clearInterval(timer);
    clearTimeout(startTimer);
    await store.save();
  });

  return {
    store,
    api,
    tick,
    runReadings,
    detectEvents,
    nextJob,
    viewOf,
    readSensors,
    getConfig: () => config,
    whenReady: () => startup,
  };
}

export {
  createApp,
  ACTIONS,
  USER_AGENT,
  ACCESS_RETRY_MS,
  LIST_EVERY_MS,
  HEARTBEAT_MS,
  HISTORY_STEP_MS,
  MAX_HISTORY_HOURS,
};
