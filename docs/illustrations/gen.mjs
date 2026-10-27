// Widget contents for the generated illustrations, built by the real code of
// the integration: the app itself (src/app.js) wired to the fake Gladys of the
// SDK and the fake SensorPush of the tests (test/helpers/fake-sensorpush.js,
// the account of test/fixtures/account.json), run over a made-up day ending on
// Tuesday, 27 October 2026 at 11:00 in Paris: a greenhouse warming up in the
// afternoon, a wine cellar too humid, an attic sensor silent for two hours.
// The samples follow smooth made-up curves (no randomness): never real data.
// Written as JSON for render.js: node gen.mjs <repo> <out.json>

import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const [repo, out] = process.argv.slice(2);
const load = (file) => import(pathToFileURL(join(repo, file)).href);
const { createApp } = await load('src/app.js');
const { LANGUAGES } = await load('src/i18n.js');
const { createFakeGladys } = await import(
  pathToFileURL(join(repo, 'node_modules/@gladysassistant/integration-sdk/lib/testing.js')).href
);
const { createFakeSensorPush, dataDir, recordingLogger, EMAIL, PASSWORD } = await load(
  'test/helpers/fake-sensorpush.js',
);

const NOW = Date.parse('2026-10-27T10:00:00Z');
const MINUTE = 60 * 1000;
const STEP = MINUTE;
const manifest = JSON.parse(readFileSync(join(repo, 'gladys-assistant-integration.json'), 'utf8'));
const WIDGET_KEYS = ['overview', 'sensor'];
const GREENHOUSE = '21422.4417761108';
const CELLAR = '16855.27453475893';
const ATTIC = '9031.11223344';

/**
 * @description A smooth daily curve: its value at an instant.
 * @param {number} at - The instant (ms).
 * @param {number} mean - The mean.
 * @param {number} swing - Half the daily amplitude.
 * @param {number} peakHour - The UTC hour of the maximum.
 * @returns {number} The value.
 */
const daily = (at, mean, swing, peakHour) =>
  mean + swing * Math.cos(((at / 3600000 - peakHour) / 24) * 2 * Math.PI);
const round = (value, digits = 1) => Math.round(value * 10 ** digits) / 10 ** digits;
const toF = (celsius) => round((celsius * 9) / 5 + 32, 2);

/**
 * @description The samples of a made-up instant, in the units of the API.
 * @param {number} at - The instant (ms).
 * @returns {object} The samples per sensor.
 */
function samplesAt(at) {
  const observed = new Date(at).toISOString();
  const greenhouse = daily(at, 19, 5, 13);
  const samples = {
    [GREENHOUSE]: {
      observed,
      temperature: toF(greenhouse),
      humidity: round(daily(at, 62, 12, 4)),
      dewpoint: toF(greenhouse - 7.5),
      barometric_pressure: round(29.9 + 0.08 * Math.sin(at / 3e7), 3),
      vpd: round(0.4 + 0.5 * Math.max(0, (greenhouse - 15) / 10), 2),
    },
    [CELLAR]: {
      observed,
      temperature: toF(daily(at, 13.2, 0.4, 16)),
      humidity: round(daily(at, 67, 2, 2)),
      dewpoint: toF(7.2),
      vpd: 0.42,
    },
  };
  if (at <= NOW - 2 * 3600 * 1000) {
    samples[ATTIC] = {
      observed,
      temperature: toF(daily(at, 14, 3, 14)),
      humidity: round(daily(at, 52, 5, 5)),
    };
  }
  return samples;
}

/**
 * @description One language: the app run over a day, then the two widgets.
 * @param {string} language - Language.
 * @returns {Promise<object>} The widget contents.
 */
async function contents(language) {
  const clock = { now: NOW - 24 * 3600 * 1000 };
  const fake = createFakeSensorPush({ clock });
  fake.account.samples = {};
  const gladys = createFakeGladys({
    config: { email: EMAIL, password: PASSWORD, language },
  });
  const app = createApp(gladys, {
    fetch: (url, init) => fake.fetch(url, init),
    baseUrl: fake.baseUrl,
    dataDir: dataDir(),
    now: () => clock.now,
    sleep: async (ms) => {
      clock.now += ms;
    },
    timeZone: 'Europe/Paris',
    timers: false,
    logger: recordingLogger(),
  });
  await gladys.connect();
  await app.whenReady();
  while (clock.now < NOW) {
    for (const [id, sample] of Object.entries(samplesAt(clock.now))) {
      fake.account.samples[id] = [sample];
    }
    fake.account.gateways.Maison.last_seen = new Date(clock.now).toISOString();
    await app.tick();
    clock.now += STEP;
  }
  clock.now = NOW;
  const settings = { sensor: `ext:test-integration:sensor:${GREENHOUSE.replace('.', '-')}` };
  const result = {};
  for (const key of WIDGET_KEYS) {
    result[key] = (
      await gladys.fake.widgetGet(key, { settings, language, units: 'metric' })
    ).data.content;
  }
  await gladys.fake.shutdown();
  return result;
}

const all = {};
for (const language of LANGUAGES) {
  all[language] = await contents(language);
}

const card = (key) => {
  const widget = manifest.widgets.find((item) => item.key === key);
  return { icon: widget.icon, label: widget.label };
};
writeFileSync(
  out,
  JSON.stringify({
    contents: all,
    images: {},
    cards: Object.fromEntries(WIDGET_KEYS.map((key) => [key, card(key)])),
    now: NOW,
  }),
);
