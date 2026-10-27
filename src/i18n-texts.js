// -----------------------------------------------------------------------------
// Texts of the SensorPush Cloud integration, in English, French, German and
// Spanish (English fallback).
//
// The manifest carries its own labels; these are the texts the code writes at
// runtime: feature names and the gateway state, widget contents, scene texts,
// errors, results of the configuration buttons. Vocabulary of the Gladys
// interface (appareil / Gerät / dispositivo, capteur / Sensor / sensor,
// passerelle / Gateway / pasarela). German says "du", Spanish "usted", like
// Gladys. Sensor and gateway names come from the SensorPush account, never
// translated.
// -----------------------------------------------------------------------------

const TEXTS = {
  // features (names shown by the dashboard when several share a type)
  feature_temperature: {
    en: 'Temperature',
    fr: 'Température',
    de: 'Temperatur',
    es: 'Temperatura',
  },
  feature_humidity: { en: 'Humidity', fr: 'Humidité', de: 'Luftfeuchtigkeit', es: 'Humedad' },
  feature_dewpoint: { en: 'Dew point', fr: 'Point de rosée', de: 'Taupunkt', es: 'Punto de rocío' },
  feature_pressure: {
    en: 'Barometric pressure',
    fr: 'Pression atmosphérique',
    de: 'Luftdruck',
    es: 'Presión atmosférica',
  },
  feature_vpd: {
    en: 'Vapour pressure deficit (VPD)',
    fr: 'Déficit de pression de vapeur (VPD)',
    de: 'Dampfdruckdefizit (VPD)',
    es: 'Déficit de presión de vapor (VPD)',
  },
  feature_gateway_status: {
    en: 'Gateway connection',
    fr: 'Connexion de la passerelle',
    de: 'Verbindung des Gateways',
    es: 'Conexión de la pasarela',
  },
  feature_gateway_version: {
    en: 'Gateway version',
    fr: 'Version de la passerelle',
    de: 'Version des Gateways',
    es: 'Versión de la pasarela',
  },
  gatewayName: {
    en: 'SensorPush gateway {name}',
    fr: 'Passerelle SensorPush {name}',
    de: 'SensorPush-Gateway {name}',
    es: 'Pasarela SensorPush {name}',
  },
  gatewayConnected: { en: 'Connected', fr: 'Connectée', de: 'Verbunden', es: 'Conectada' },
  gatewayDisconnected: {
    en: 'Disconnected',
    fr: 'Déconnectée',
    de: 'Getrennt',
    es: 'Desconectada',
  },

  // measures and sides of an alert range
  measure_temperature: {
    en: 'Temperature',
    fr: 'Température',
    de: 'Temperatur',
    es: 'Temperatura',
  },
  measure_humidity: { en: 'Humidity', fr: 'Humidité', de: 'Luftfeuchtigkeit', es: 'Humedad' },
  measure_dewpoint: { en: 'Dew point', fr: 'Point de rosée', de: 'Taupunkt', es: 'Punto de rocío' },
  side_above: {
    en: 'above the alert range',
    fr: 'au-dessus de la plage d’alerte',
    de: 'über dem Alarmbereich',
    es: 'por encima del rango de alerta',
  },
  side_below: {
    en: 'below the alert range',
    fr: 'en dessous de la plage d’alerte',
    de: 'unter dem Alarmbereich',
    es: 'por debajo del rango de alerta',
  },

  // times
  never: { en: 'never', fr: 'jamais', de: 'nie', es: 'nunca' },
  justNow: { en: 'just now', fr: 'à l’instant', de: 'gerade eben', es: 'ahora mismo' },
  minutesAgo: { en: '{n} min ago', fr: 'il y a {n} min', de: 'vor {n} Min.', es: 'hace {n} min' },
  hoursAgo: { en: '{n} h ago', fr: 'il y a {n} h', de: 'vor {n} Std.', es: 'hace {n} h' },
  daysAgo: { en: '{n} d ago', fr: 'il y a {n} j', de: 'vor {n} T.', es: 'hace {n} d' },

  // widgets
  tileSensors: { en: 'Sensors', fr: 'Capteurs', de: 'Sensoren', es: 'Sensores' },
  tileAlerts: { en: 'Out of range', fr: 'Hors plage', de: 'Außerhalb', es: 'Fuera de rango' },
  tileSilent: { en: 'Silent', fr: 'Muets', de: 'Stumm', es: 'Sin señal' },
  badgeAlert: { en: 'Alert', fr: 'Alerte', de: 'Alarm', es: 'Alerta' },
  badgeSilent: { en: 'Silent', fr: 'Muet', de: 'Stumm', es: 'Sin señal' },
  badgeOk: { en: 'OK', fr: 'OK', de: 'OK', es: 'OK' },
  cardAlert: {
    en: '{measure} {side}: {value} (range {min} – {max})',
    fr: '{measure} {side} : {value} (plage {min} – {max})',
    de: '{measure} {side}: {value} (Bereich {min} – {max})',
    es: '{measure} {side}: {value} (rango {min} – {max})',
  },
  widgetMore: {
    en: '+ {count} more sensor(s)',
    fr: '+ {count} autre(s) capteur(s)',
    de: '+ {count} weitere(r) Sensor(en)',
    es: '+ {count} sensor(es) más',
  },
  rowDisconnected: {
    en: 'Disconnected, {ago}',
    fr: 'Déconnectée, {ago}',
    de: 'Getrennt, {ago}',
    es: 'Desconectada, {ago}',
  },
  tile_temperature: { en: 'Temperature', fr: 'Température', de: 'Temperatur', es: 'Temperatura' },
  tile_humidity: { en: 'Humidity', fr: 'Humidité', de: 'Feuchte', es: 'Humedad' },
  tile_dewpoint: { en: 'Dew point', fr: 'Point de rosée', de: 'Taupunkt', es: 'Punto de rocío' },
  tile_pressure: { en: 'Pressure', fr: 'Pression', de: 'Luftdruck', es: 'Presión' },
  tile_vpd: { en: 'VPD', fr: 'VPD', de: 'VPD', es: 'VPD' },
  chartTitle: {
    en: 'Last 24 hours',
    fr: 'Dernières 24 heures',
    de: 'Letzte 24 Stunden',
    es: 'Últimas 24 horas',
  },
  rowLastSample: {
    en: 'Last sample',
    fr: 'Dernière mesure',
    de: 'Letzter Messwert',
    es: 'Última medición',
  },
  rowAgo: {
    en: '{time} ({ago})',
    fr: '{time} ({ago})',
    de: '{time} ({ago})',
    es: '{time} ({ago})',
  },
  rowTemperature24h: {
    en: 'Temperature, 24 h',
    fr: 'Température sur 24 h',
    de: 'Temperatur, 24 Std.',
    es: 'Temperatura, 24 h',
  },
  rowHumidity24h: {
    en: 'Humidity, 24 h',
    fr: 'Humidité sur 24 h',
    de: 'Feuchte, 24 Std.',
    es: 'Humedad, 24 h',
  },
  rowAlert_temperature: {
    en: 'Temperature alert',
    fr: 'Alerte de température',
    de: 'Temperaturalarm',
    es: 'Alerta de temperatura',
  },
  rowAlert_humidity: {
    en: 'Humidity alert',
    fr: 'Alerte d’humidité',
    de: 'Feuchtealarm',
    es: 'Alerta de humedad',
  },
  rowBattery: {
    en: 'Battery voltage',
    fr: 'Tension de la pile',
    de: 'Batteriespannung',
    es: 'Tensión de la pila',
  },
  rowSignal: { en: 'Signal', fr: 'Signal', de: 'Signal', es: 'Señal' },

  // status
  statusNoCredentials: {
    en: 'Enter the e-mail address and the password of your SensorPush account.',
    fr: 'Saisissez l’adresse e-mail et le mot de passe de votre compte SensorPush.',
    de: 'Gib die E-Mail-Adresse und das Passwort deines SensorPush-Kontos ein.',
    es: 'Introduzca la dirección de correo y la contraseña de su cuenta SensorPush.',
  },
  statusWaiting: {
    en: 'Reading the SensorPush account (one request a minute)…',
    fr: 'Lecture du compte SensorPush (une requête par minute)…',
    de: 'SensorPush-Konto wird gelesen (eine Anfrage pro Minute)…',
    es: 'Leyendo la cuenta SensorPush (una petición por minuto)…',
  },
  statusNoSensor: {
    en: 'No active sensor in this SensorPush account.',
    fr: 'Aucun capteur actif dans ce compte SensorPush.',
    de: 'Kein aktiver Sensor in diesem SensorPush-Konto.',
    es: 'Ningún sensor activo en esta cuenta SensorPush.',
  },
  statusOk: {
    en: 'Connected: {sensors} sensor(s), {gateways} gateway(s).',
    fr: 'Connecté : {sensors} capteur(s), {gateways} passerelle(s).',
    de: 'Verbunden: {sensors} Sensor(en), {gateways} Gateway(s).',
    es: 'Conectado: {sensors} sensor(es), {gateways} pasarela(s).',
  },
  statusPaused: {
    en: 'SensorPush answers with errors: paused for a while.',
    fr: 'SensorPush répond en erreur : pause pendant un moment.',
    de: 'SensorPush antwortet mit Fehlern: kurze Pause.',
    es: 'SensorPush responde con errores: pausa durante un rato.',
  },

  // errors
  errRefused: {
    en: 'SensorPush refused the sign-in: check the e-mail and the password. A new account must first log in once to dashboard.sensorpush.com and accept the API terms.',
    fr: 'SensorPush a refusé la connexion : vérifiez l’e-mail et le mot de passe. Un nouveau compte doit d’abord se connecter une fois à dashboard.sensorpush.com et accepter les conditions de l’API.',
    de: 'SensorPush hat die Anmeldung abgelehnt: Prüfe E-Mail und Passwort. Ein neues Konto muss sich zuerst einmal auf dashboard.sensorpush.com anmelden und die API-Bedingungen akzeptieren.',
    es: 'SensorPush rechazó el inicio de sesión: compruebe el correo y la contraseña. Una cuenta nueva debe conectarse primero una vez a dashboard.sensorpush.com y aceptar las condiciones de la API.',
  },
  errInvalidPassword: {
    en: 'SensorPush refused the password: it must have at least 8 characters.',
    fr: 'SensorPush a refusé le mot de passe : il doit compter au moins 8 caractères.',
    de: 'SensorPush hat das Passwort abgelehnt: Es braucht mindestens 8 Zeichen.',
    es: 'SensorPush rechazó la contraseña: debe tener al menos 8 caracteres.',
  },
  errToken: {
    en: 'SensorPush refused the access token after a new sign-in.',
    fr: 'SensorPush a refusé le jeton d’accès après une nouvelle connexion.',
    de: 'SensorPush hat das Zugriffstoken nach einer neuen Anmeldung abgelehnt.',
    es: 'SensorPush rechazó el token de acceso tras un nuevo inicio de sesión.',
  },
  errPaused: {
    en: 'SensorPush asked to wait or answered with errors: the readings resume in a few minutes.',
    fr: 'SensorPush a demandé d’attendre ou répond en erreur : les lectures reprennent dans quelques minutes.',
    de: 'SensorPush bat zu warten oder antwortete mit Fehlern: Die Abfragen laufen in einigen Minuten weiter.',
    es: 'SensorPush pidió esperar o responde con errores: las lecturas se reanudan en unos minutos.',
  },
  errServer: {
    en: 'The SensorPush service answers with an error: it will be tried again.',
    fr: 'Le service SensorPush répond en erreur : nouvel essai plus tard.',
    de: 'Der SensorPush-Dienst antwortet mit einem Fehler: Es wird erneut versucht.',
    es: 'El servicio SensorPush responde con un error: se volverá a intentar.',
  },
  errUnreachable: {
    en: 'SensorPush cannot be reached: check the Internet access of Gladys.',
    fr: 'SensorPush est injoignable : vérifiez l’accès à Internet de Gladys.',
    de: 'SensorPush ist nicht erreichbar: Prüfe den Internetzugang von Gladys.',
    es: 'No se puede acceder a SensorPush: compruebe el acceso a Internet de Gladys.',
  },
  errFailed: {
    en: 'SensorPush reading failed: {detail}',
    fr: 'Échec de la lecture SensorPush : {detail}',
    de: 'SensorPush-Abfrage fehlgeschlagen: {detail}',
    es: 'Error de lectura de SensorPush: {detail}',
  },
  errNoSensor: {
    en: 'No SensorPush sensor read yet.',
    fr: 'Aucun capteur SensorPush lu pour l’instant.',
    de: 'Noch kein SensorPush-Sensor gelesen.',
    es: 'Todavía no se ha leído ningún sensor SensorPush.',
  },

  // scene texts
  summarySensor: {
    en: '{name}: {temperature}, humidity {humidity}.',
    fr: '{name} : {temperature}, humidité {humidity}.',
    de: '{name}: {temperature}, Luftfeuchtigkeit {humidity}.',
    es: '{name}: {temperature}, humedad {humidity}.',
  },
  summaryAlert: {
    en: '{measure} {side}.',
    fr: '{measure} {side}.',
    de: '{measure} {side}.',
    es: '{measure} {side}.',
  },
  summarySilent: {
    en: 'No new sample for {minutes} min.',
    fr: 'Aucune nouvelle mesure depuis {minutes} min.',
    de: 'Kein neuer Messwert seit {minutes} Min.',
    es: 'Ninguna medición nueva desde hace {minutes} min.',
  },
  summaryHistory: {
    en: '{name}, last {hours} h: temperature {tmin} to {tmax} (average {tavg}), humidity {hmin} to {hmax}.',
    fr: '{name}, dernières {hours} h : température de {tmin} à {tmax} (moyenne {tavg}), humidité de {hmin} à {hmax}.',
    de: '{name}, letzte {hours} Std.: Temperatur {tmin} bis {tmax} (Mittel {tavg}), Luftfeuchtigkeit {hmin} bis {hmax}.',
    es: '{name}, últimas {hours} h: temperatura de {tmin} a {tmax} (media {tavg}), humedad de {hmin} a {hmax}.',
  },
  summaryNoHistory: {
    en: '{name}: no sample in the last {hours} h.',
    fr: '{name} : aucune mesure sur les dernières {hours} h.',
    de: '{name}: kein Messwert in den letzten {hours} Std.',
    es: '{name}: ninguna medición en las últimas {hours} h.',
  },

  // configuration buttons
  testOk: {
    en: 'Connected to SensorPush: {count} sensor(s){names}. The samples follow within a minute.',
    fr: 'Connecté à SensorPush : {count} capteur(s){names}. Les mesures suivent dans la minute.',
    de: 'Mit SensorPush verbunden: {count} Sensor(en){names}. Die Messwerte folgen innerhalb einer Minute.',
    es: 'Conectado a SensorPush: {count} sensor(es){names}. Las mediciones llegan en un minuto.',
  },
  diagnosticDone: {
    en: 'Diagnostic written to the logs of the integration ({count} line(s), no password, no token).',
    fr: 'Diagnostic écrit dans les journaux de l’intégration ({count} ligne(s), sans mot de passe ni jeton).',
    de: 'Diagnose in die Logs der Integration geschrieben ({count} Zeile(n), ohne Passwort und Token).',
    es: 'Diagnóstico escrito en los registros de la integración ({count} línea(s), sin contraseña ni token).',
  },
};

export { TEXTS };
