# Changelog

All notable changes to this integration are documented in this file. The format
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions
follow [Semantic Versioning](https://semver.org/). This file is generated at
each release from the Conventional Commits: do not edit it by hand.

## [0.1.0] - 2026-10-27

### Added

- **sensors:** every active sensor of a SensorPush account (HT1, HT.w, HTP.xw), through the official SensorPush Gateway Cloud API with the e-mail address and the password of the account, read only; never more than one request a minute, the last samples every minute by default, the lists of the sensors and the gateways every 15 minutes
- **devices:** one device per sensor: temperature, humidity, dew point, barometric pressure (HTP.xw) and vapour pressure deficit, converted from °F and inHg; one device per gateway with its connection and software version
- **scenes:** triggers when the temperature or the humidity leaves or comes back to the alert range set in the SensorPush app, when a sensor goes silent or comes back, when a gateway disconnects or reconnects and when SensorPush refuses the account; actions to read the values of a sensor and the minimum, maximum and average of its last 1 to 72 hours
- **widgets:** every sensor at a glance with the alerts first and the gateways; one sensor with its measures, a 24-hour chart, its alert range, battery voltage and signal, in the units of each user
- **configuration:** e-mail address and password with a guide, sample interval, delay before a sensor is silent, units of the scenes, language, "Test the connection" and "Diagnostic" buttons
- **i18n:** English, French, German and Spanish for the manifest, the runtime texts, the documentation and the README

[0.1.0]: https://github.com/William-De71/gladys-sensorpush-cloud/releases/tag/v0.1.0
