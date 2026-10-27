# CLAUDE.md

Project rules for coding assistants (Claude Code reads this file) and for human
contributors.

## What this is

A Gladys Assistant **external integration** for **SensorPush** sensors (HT1,
HT.w, HTP.xw) and gateways (G1 WiFi Gateway): a Node.js service (Node 22+, ESM,
no build step) in its own sandboxed Docker container, talking to Gladys through
[`@gladysassistant/integration-sdk`](https://github.com/GladysAssistant/integration-sdk-js),
its only runtime dependency, and to the official SensorPush Gateway Cloud API
(<https://www.sensorpush.com/gateway-cloud-api>, Swagger definition
<https://api.sensorpush.com/api/v1/support/swagger/swagger-v1.json>, base
`https://api.sensorpush.com/api/v1`) with the e-mail address and the password of
the user's account. **Read only**: every call is a POST of a JSON body, but only
the two sign-in calls change anything (they issue tokens). `type: "device"`,
Gladys 5.3.0+, `transports: ["cloud"]`. Not affiliated with SensorPush.
**Never tested with a real account**: the shapes come from the Swagger
definition. Checked live on 2026-10-27: `oauth/authorize` answers 400
"Password must be at least 8 characters." for a short password and 403
`{"message":"invalid user"}` for an unknown account; `oauth/accesstoken` 412 for
an invalid authorization; a data call 400 `{"type":"UNAUTHORIZED"}` without a
token, 400 `{"type":"ACCESS_DENIED"}` with a wrong one.

## Commands

```bash
npm install
npm test                                  # node --test; a fake SensorPush (in-memory fetch, fake clock)
node --test test/app.test.js              # one file
UPDATE_BASELINE=1 npm test                # rewrite test/fixtures/discovery.baseline.json (on purpose only)
npm run lint                              # ESLint
npm run format:check                      # Prettier, as the CI runs it
npx github:GladysAssistant/integration-store . --skip-image-check   # store checks
scripts/build-cover.sh                    # cover.jpg from docs/assets/cover.svg
docs/illustrations/render.sh              # docs/assets/widgets.<lang>.png
node .github/scripts/release.mjs next     # the version the next release would get
```

## Architecture

```
index.js                 SDK wiring only (new GladysIntegration + createApp)
src/app.js               every handler; the timer (which reading takes the next free minute),
                         devices and states, scene events, scene actions, widgets,
                         configuration buttons, status
src/sensorpush-api.js    HTTP client: sign-in (authorize + accesstoken), the token in memory
                         until its JWT exp, one new sign-in for a refused token, data requests
                         61 s apart, pauses after 429 / 5xx / no answer
src/parse.js             the answers made safe (null is null, never 0), °F -> °C, inHg -> hPa,
                         alert ranges
src/units.js             metric / US units of the widgets and the scenes
src/device.js            one device per sensor, one per gateway, features and states
src/events.js            triggers (alert range, silence, gateway), keys, outputs
src/widgets.js           overview, one sensor
src/time.js              local times (Intl only)
src/store.js             /data/sensorpush.json (mode 0600; never the password nor the token)
src/config.js            e-mail, password, sample interval, silence delay, units, language
src/i18n.js              helpers; src/i18n-texts.js the runtime texts, en / fr / de / es
test/helpers/fake-sensorpush.js   the fake SensorPush (sign-in, tokens, refusals, samples)
test/fixtures/account.json        a made-up account on the documented shapes
.github/scripts/release.mjs       version, changelog, bump (tested in test/)
```

## Rules

- **External ids are forever**, and so is every key users store:
  `ext:<selector>:sensor:<id>` (the key of the sensor in `devices/sensors`, every
  character outside `[A-Za-z0-9_-]` replaced by `-`), features `…:<key>`
  (`temperature`, `humidity`, `dewpoint`, `pressure`, `vpd`);
  `ext:<selector>:gateway:<key>`, features `status`, `version`; feature
  `category` / `type` / `unit` / `min` / `max`, the keys of `config_schema` and
  `actions`, `last_language`, widgets and settings, triggers (fields, options,
  variables), scene actions (fields, outputs). `test/structure.test.js`
  compares them to `test/fixtures/discovery.baseline.json`: never update it to
  make a test pass without a documented migration.
- **Category pairs**: temperature-sensor / decimal (°C), humidity-sensor /
  decimal (%), temperature-sensor / **probe** for the dew point (kept out of the
  room average), pressure-sensor / decimal in hPa and in kPa (VPD), text / text
  for the gateway. No feature for the battery voltage nor the RSSI: no category
  of the core fits (battery is a percentage, signal a 0–5 quality).
- **The pace.** SensorPush allows one request a minute. Every data request goes
  through the client, which keeps them `DATA_SPACING_MS` (61 s) apart, counted
  from the start of the previous one. `nextJob()` decides what a free slot
  reads: the sensors first, then the samples (`limit: 1`, every sensor), the
  lists of the sensors and the gateways every 15 minutes, the samples at the
  interval of the configuration. The history scene action queues its request in
  the same client. The sign-in only when the token expires or is refused.
- **Freshness**: a sensor without a new sample for the delay of the
  configuration is silent; its values are not re-sent (no heartbeat), so Gladys
  shows them outdated. A fresh sensor's unchanged values are re-sent every 30
  minutes (`publishChangedStates` heartbeat). A gateway is disconnected after
  30 minutes without `last_seen`.
- **`should_poll` stays false**: the integration has its own timer.
- **Credentials**: the password is a `secret`, never logged, never in /data,
  sent to api.sensorpush.com only. The access token stays in memory, never
  logged. Test credentials never look real (`not-a-real-password`): the push
  protection of GitHub would block them.
- **Units**: the core keeps °C, %, hPa, kPa. Widgets follow the `units` of the
  request; scene outputs and texts follow `scene_units`. Alert thresholds are
  assumed in °F like the samples (the definition gives no unit).
- **Scene events** once per transition, never at the first reading, never
  from a scene action: the detection runs on the timer only (`detectEvents`).
- **The container rootfs is read-only.** Write only under `/data`.
- **Four languages.** Every user-facing text (manifest, `src/i18n-texts.js`,
  `docs/*.md`, README) exists in en, fr, de, es; `test/i18n.test.js` checks it.
  German says "du", Spanish "usted". Sensor and gateway names come from
  SensorPush, never translated.
- **Widget images.** After any change to a widget content, run
  `docs/illustrations/render.sh` again and look at the four PNG files.
- **Versions belong to the Release workflow**: never edit `version` in
  `package.json`, the lockfile or the manifest, nor the `docker_image` tag.
  Below 1.0.0 until the maintainer runs Release with `release-as: 1.0.0`.
- **Changelog.** Ne jamais éditer CHANGELOG.md à la main, il est généré à la
  release. Écris le titre de PR comme la ligne que l'utilisateur lira.
- **Commits and PR titles** follow Conventional Commits, in English.
- **Forum drafts** (`.github/forum-*.md`) are never committed.
- **Style.** Prettier formats, ESLint catches mistakes. Comments explain why,
  in English. Tests never touch the network.

## Pitfalls

- The key of the `devices/sensors` map is the id the samples use
  (`"16855.27453475893"`); `deviceId` is a short id, not unique enough.
- The `Authorization` header carries the access token as is (no `Bearer`), as
  in the official curl examples and the Home Assistant library.
- `samples` with `limit: 1` returns the newest sample of every sensor; with
  `sensors` and `startTime`, every sample since then, ~5 MB at most
  (`truncated`).
- Older sensors give no dew point nor VPD; only the HTP.xw gives
  `barometric_pressure`: a feature appears with its first value
  (`measuresSeen`), then stays.
- A new account must log in once to dashboard.sensorpush.com and accept the API
  terms; until then the sign-in is refused (403).
- `node --test` also runs `test/helpers/`: nothing starts on import.
- The validator of the Gladys core creates `gladys-development.duckdb` in the
  current folder: run it from elsewhere.
