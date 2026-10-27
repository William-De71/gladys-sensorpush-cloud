# SensorPush Cloud

## Überblick

Diese Integration bringt die Sensoren und Gateways deines SensorPush-Kontos in Gladys: Temperatur, Luftfeuchtigkeit, Taupunkt, Luftdruck und Dampfdruckdefizit (VPD) deiner **SensorPush**-Sensoren (HT1, HT.w, HTP.xw), die ein **SensorPush-Gateway** (G1 WiFi Gateway) in die Cloud weiterleitet, über die offizielle [SensorPush Gateway Cloud API](https://www.sensorpush.com/gateway-cloud-api) mit der E-Mail-Adresse und dem Passwort deines Kontos. Sie liest nur. Sie ist nicht mit SensorPush verbunden.

- Ein Gerät pro Sensor: Temperatur, Luftfeuchtigkeit, Taupunkt, Luftdruck (nur HTP.xw) und VPD, je nachdem, was das Modell liefert.
- Ein Gerät pro Gateway: ob es sich bei der SensorPush-Cloud meldet, seine Softwareversion.
- Zwei Dashboard-Widgets: alle Sensoren auf einen Blick, Alarme zuerst; ein Sensor mit einem 24-Stunden-Diagramm.
- Szenenauslöser: außerhalb des Alarmbereichs, zurück im Alarmbereich (die in der SensorPush-App eingestellten Bereiche), Sensor stumm, Sensor wieder da, Gateway getrennt, Gateway wieder verbunden, Zugriff verweigert.
- Szenenaktionen: die Werte eines Sensors, der Verlauf eines Sensors (Minimum, Maximum, Mittel über 1 bis 72 Stunden).

Transport: Cloud. E-Mail-Adresse und Passwort gehen zur Anmeldung an SensorPush (`api.sensorpush.com`); die Messwerte deiner Sensoren kommen aus der SensorPush-Cloud, die sie von deinem Gateway erhält.

## Voraussetzungen

- Gladys Assistant 5.3.0 oder neuer.
- Ein SensorPush-Konto mit mindestens einem Sensor und einem **SensorPush-Gateway**: Ohne Gateway bleiben die Messwerte im Telefon und erreichen nie die Cloud.
- **Der API-Zugang des Kontos muss aktiviert sein**: Melde dich einmal mit derselben E-Mail-Adresse und demselben Passwort im [Gateway Cloud Dashboard](https://dashboard.sensorpush.com/) an und akzeptiere die API-Bedingungen. Bis dahin lehnt SensorPush die Anmeldung ab.
- Das Passwort braucht mindestens 8 Zeichen (eine Regel von SensorPush).

Aktualität der Daten: Ein Gateway leitet die Sensoren etwa einmal pro Minute weiter, und SensorPush akzeptiert **höchstens eine Anfrage pro Minute**. Die Integration fragt nie öfter: die letzten Messwerte standardmäßig jede Minute, die Listen der Sensoren und Gateways alle 15 Minuten, jeweils anstelle einer Messwertabfrage.

## Konfiguration

| Feld                  | Bedeutung                                                                                                         |
| --------------------- | ----------------------------------------------------------------------------------------------------------------- |
| E-Mail-Adresse        | Die E-Mail deines SensorPush-Kontos                                                                               |
| Passwort              | Sein Passwort (ein Geheimnis: nie wieder angezeigt, nie in die Logs oder nach `/data` geschrieben)                |
| Abfrage der Messwerte | Alle 1 (Standard), 2, 5 oder 10 Minuten: eine Anfrage für alle Sensoren                                           |
| Sensor stumm nach     | 15, 30 (Standard), 60, 120 oder 360 Minuten ohne neuen Messwert                                                   |
| Einheiten der Szenen  | Metrisch (°C, hPa, Standard) oder US (°F, inHg) für Werte und Texte der Szenen; die Widgets folgen jedem Benutzer |
| Sprache der Texte     | Namen der Funktionen, Gateway-Zustand, Szenentexte und Fehler; automatisch folgt dem letzten Widget               |

Schaltflächen:

- **Verbindung testen** meldet sich bei SensorPush an und listet die Sensoren auf (das kann bis zu einer Minute dauern, das Tempo von SensorPush).
- **Diagnose** schreibt den Zustand der Integration in ihre Logs, ohne Passwort und Token.

Das Zugriffstoken bleibt im Speicher: Nach einem Neustart meldet sich die Integration erneut an.

## Verwendung

### Geräte

Öffne nach der Konfiguration **Erkennung**: Jeder Sensor wird angeboten, sobald ein erster Messwert gelesen wurde, mit seinem Namen aus der SensorPush-App, und jedes Gateway als „SensorPush-Gateway <Name>“. Füge die gewünschten hinzu.

| Funktion                         | Kategorie / Typ                  | Einheit |
| -------------------------------- | -------------------------------- | ------- |
| Temperatur                       | `temperature-sensor` / `decimal` | °C      |
| Luftfeuchtigkeit                 | `humidity-sensor` / `decimal`    | %       |
| Taupunkt                         | `temperature-sensor` / `probe`   | °C      |
| Luftdruck (HTP.xw)               | `pressure-sensor` / `decimal`    | hPa     |
| Dampfdruckdefizit (VPD)          | `pressure-sensor` / `decimal`    | kPa     |
| Verbindung des Gateways, Version | `text` / `text`                  | —       |

SensorPush liefert °F und inHg: Die Integration rechnet sie um, und Gladys zeigt sie in den Einheiten jedes Benutzers. Der Taupunkt ist eine „Fühler“-Temperatur, damit er nicht in die Durchschnittstemperatur des Raums einfließt. Ältere Sensoren haben weder Taupunkt noch VPD, und nur der HTP.xw hat ein Barometer: Eine Funktion erscheint mit ihrem ersten Wert. Batteriespannung und Signal haben in Gladys keine passende Kategorie: Das Sensor-Widget und die Szenenaktion zeigen sie.

### Dashboard-Widgets

![Die beiden Widgets: alle Sensoren, mit dem Weinkeller außerhalb seines Feuchtebereichs und einem stummen Dachbodensensor, und das Gewächshaus mit seinen Messwerten und den letzten 24 Stunden (generierte Illustration, kein Screenshot)](https://raw.githubusercontent.com/William-De71/gladys-sensorpush-cloud/main/docs/assets/widgets.de.png)

- **SensorPush-Sensoren**: wie viele Sensoren, wie viele außerhalb ihres Alarmbereichs, wie viele stumm; eine Karte pro Sensor (Alarme zuerst) mit Temperatur, Luftfeuchtigkeit und dem Alter des letzten Messwerts; die Gateways und ob sie sich melden.
- **SensorPush-Sensor**: ein Sensor (in den Einstellungen des Widgets wählen; standardmäßig der erste): seine Messwerte, Temperatur und Taupunkt der letzten 24 Stunden, Minimum und Maximum des Tages, seine Alarmbereiche, Batteriespannung und Signal. Das Diagramm stammt aus den Messwerten, die die Integration aufbewahrt, ohne zusätzliche Anfrage.

### Szenen

Auslöser (einmal pro Änderung, nie beim ersten Lesen, nie wegen einer Szenenaktion), gefiltert nach Sensor oder Gateway:

- **Außerhalb des Alarmbereichs**: Temperatur oder Luftfeuchtigkeit verlässt den in der SensorPush-App eingestellten Alarmbereich (Filter: Messwerte, Seite). Ein in der App ausgeschalteter Alarm überwacht nichts.
- **Zurück im Alarmbereich**: Der Wert kehrt zurück, mit der Dauer außerhalb.
- **Sensor stumm** / **Sensor wieder da**: kein neuer Messwert während der eingestellten Zeit, dann wieder Messwerte.
- **Gateway getrennt** / **Gateway wieder verbunden**: 30 Minuten keine Meldung bei der SensorPush-Cloud, dann wieder eine Meldung.
- **Zugriff verweigert**: SensorPush lehnt E-Mail-Adresse, Passwort oder Zugriffstoken ab.

Aktionen:

- **Werte eines Sensors**: Temperatur, Luftfeuchtigkeit, Taupunkt, Luftdruck, VPD, Batteriespannung, Signal, Minuten seit dem letzten Messwert und ein Satz, aus der letzten Abfrage (ohne Anfrage).
- **Verlauf eines Sensors**: minimale, maximale und mittlere Temperatur und Luftfeuchtigkeit der letzten 1 bis 72 Stunden und ein Satz. Sie sendet eine Anfrage in der nächsten freien Minute: Die Szene kann bis zu einer Minute warten.

Beispiele:

- Wenn **SensorPush: außerhalb des Alarmbereichs** beim Weinkeller → „{{triggerEvent.data.sensor_name}}: {{triggerEvent.data.measure_label}} {{triggerEvent.data.value}} {{triggerEvent.data.unit}}“ senden.
- Jeden Tag um 8:00 → **SensorPush: Verlauf eines Sensors** (Gewächshaus, 24 Std.) → die Zusammenfassung senden.
- Wenn **SensorPush: Gateway getrennt** → „Das SensorPush-Gateway {{triggerEvent.data.gateway_name}} ist offline“ senden.

## Fehlerbehebung

- **„SensorPush hat die Anmeldung abgelehnt“**: Prüfe E-Mail-Adresse und Passwort in der SensorPush-App; ein neues Konto muss sich zuerst einmal auf dashboard.sensorpush.com anmelden und die API-Bedingungen akzeptieren.
- **„mindestens 8 Zeichen“**: SensorPush lehnt kürzere Passwörter ab: Ändere es in der SensorPush-App.
- **Kein Gerät angeboten**: Ein Sensor wird angeboten, sobald ein erster Messwert gelesen wurde, etwa zwei Minuten nach der Konfiguration. Inaktive Sensoren werden nicht angeboten.
- **Werte ändern sich nicht, Sensor stumm**: Die Messwerte brauchen das Gateway; prüfe, ob es eingesteckt und online ist (sein Gerät oder das Sensoren-Widget).
- **Die Verlaufsaktion ist langsam**: SensorPush akzeptiert eine Anfrage pro Minute; die Aktion wartet auf die nächste freie Minute.
- Für ein Issue gib die Versionen von Gladys und der Integration an, die Meldung von **Verbindung testen** und die Zeilen „SensorPush diagnostic“, die **Diagnose** in die Logs der Integration schreibt. Füge nie dein Passwort ein.
