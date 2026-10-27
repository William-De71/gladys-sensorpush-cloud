// -----------------------------------------------------------------------------
// Entry point of the SensorPush Cloud external integration.
//
// The sensors and gateways of a SensorPush account (HT1, HT.w, HTP.xw sensors
// relayed by a G1 WiFi Gateway), through the official SensorPush Gateway Cloud
// API (https://api.sensorpush.com), with the e-mail address and the password
// of the account, read only:
//   - devices: one per sensor (temperature, humidity, dew point, barometric
//     pressure, VPD) and one per gateway, offered on the Discovery screen
//     (src/device.js);
//   - scene triggers: outside / back inside the SensorPush alert range,
//     sensor silent / back, gateway disconnected / reconnected, access refused;
//   - scene actions: values of a sensor, history of a sensor;
//   - dashboard widgets: overview, one sensor.
//
// This file only wires the SDK client: the handlers are in src/app.js.
//
// Environment variables provided by the Gladys supervisor:
//   GLADYS_HOST_API_URL / GLADYS_INTEGRATION_TOKEN / GLADYS_INTEGRATION_SELECTOR
//   TZ (the timezone of Gladys: the times shown by the widgets)
// The SDK reads the first three: `new GladysIntegration()` is enough.
// -----------------------------------------------------------------------------

import { readFileSync } from 'node:fs';
import { GladysIntegration, logger } from '@gladysassistant/integration-sdk';
import { createApp } from './src/app.js';

const { version } = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'));

const gladys = new GladysIntegration();
createApp(gladys);

// --- Startup -----------------------------------------------------------------------
logger.info(`Starting the SensorPush Cloud integration ${version}...`);
gladys.connect().catch((err) => {
  logger.error('Initial connection failed', err);
  process.exit(1);
});
