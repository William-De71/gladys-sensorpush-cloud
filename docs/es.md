# SensorPush Cloud

## Presentación

Esta integración lleva a Gladys los sensores y pasarelas de su cuenta SensorPush: la temperatura, la humedad, el punto de rocío, la presión atmosférica y el déficit de presión de vapor (VPD) de sus sensores **SensorPush** (HT1, HT.w, HTP.xw), retransmitidos a la nube por una **pasarela SensorPush** (G1 WiFi Gateway), a través de la [API oficial Gateway Cloud de SensorPush](https://www.sensorpush.com/gateway-cloud-api) con la dirección de correo y la contraseña de su cuenta. Solo lee. No está afiliada a SensorPush.

- Un dispositivo por sensor: temperatura, humedad, punto de rocío, presión atmosférica (solo HTP.xw) y VPD, según lo que da cada modelo.
- Un dispositivo por pasarela: si se comunica con la nube SensorPush, su versión de software.
- Dos widgets del panel: todos los sensores de un vistazo, las alertas primero; un sensor con una gráfica de 24 horas.
- Disparadores de escena: fuera del rango de alerta, de vuelta en el rango (los rangos configurados en la aplicación SensorPush), sensor sin señal, sensor de vuelta, pasarela desconectada, pasarela reconectada, acceso rechazado.
- Acciones de escena: los valores de un sensor, el historial de un sensor (mínimo, máximo, media de 1 a 72 horas).

Transporte: nube. La dirección de correo y la contraseña van a SensorPush (`api.sensorpush.com`) para iniciar sesión; las mediciones de sus sensores vienen de la nube SensorPush, que las recibe de su pasarela.

## Requisitos

- Gladys Assistant 5.3.0 o posterior.
- Una cuenta SensorPush con al menos un sensor y una **pasarela SensorPush**: sin pasarela, las mediciones se quedan en el teléfono y nunca llegan a la nube.
- **El acceso a la API de la cuenta debe estar activado**: conéctese una vez al [Gateway Cloud Dashboard](https://dashboard.sensorpush.com/) con la misma dirección de correo y contraseña, y acepte las condiciones de la API. Hasta entonces, SensorPush rechaza el inicio de sesión.
- La contraseña debe tener al menos 8 caracteres (una regla de SensorPush).

Actualidad de los datos: una pasarela retransmite los sensores aproximadamente una vez por minuto, y SensorPush acepta **como máximo una petición por minuto**. La integración nunca pide más: las últimas mediciones cada minuto por defecto, las listas de sensores y pasarelas cada 15 minutos, cada una en lugar de una lectura de mediciones.

## Configuración

| Campo                       | Significado                                                                                                                     |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| Dirección de correo         | El correo de su cuenta SensorPush                                                                                               |
| Contraseña                  | Su contraseña (un secreto: nunca se vuelve a mostrar, nunca se escribe en los registros ni en `/data`)                          |
| Lectura de las mediciones   | Cada 1 (por defecto), 2, 5 o 10 minutos: una sola petición para todos los sensores                                              |
| Sensor sin señal después de | 15, 30 (por defecto), 60, 120 o 360 minutos sin una nueva medición                                                              |
| Unidades de las escenas     | Métrico (°C, hPa, por defecto) o EE. UU. (°F, inHg) para los valores y textos de las escenas; los widgets siguen a cada usuario |
| Idioma de los textos        | Nombres de las funciones, estado de las pasarelas, textos de escenas y errores; automático sigue el último widget               |

Botones:

- **Probar la conexión** se conecta a SensorPush y enumera los sensores (puede esperar hasta un minuto, el ritmo de SensorPush).
- **Diagnóstico** escribe el estado de la integración en sus registros, sin la contraseña ni el token.

El token de acceso se queda en memoria: tras un reinicio, la integración vuelve a iniciar sesión.

## Uso

### Dispositivos

Tras la configuración, abra **Descubrimiento**: cada sensor se ofrece en cuanto se ha leído una primera medición, con su nombre en la aplicación SensorPush, y cada pasarela como «Pasarela SensorPush <nombre>». Añada los que quiera.

| Función                           | Categoría / tipo                 | Unidad |
| --------------------------------- | -------------------------------- | ------ |
| Temperatura                       | `temperature-sensor` / `decimal` | °C     |
| Humedad                           | `humidity-sensor` / `decimal`    | %      |
| Punto de rocío                    | `temperature-sensor` / `probe`   | °C     |
| Presión atmosférica (HTP.xw)      | `pressure-sensor` / `decimal`    | hPa    |
| Déficit de presión de vapor (VPD) | `pressure-sensor` / `decimal`    | kPa    |
| Conexión de la pasarela, versión  | `text` / `text`                  | —      |

SensorPush da °F e inHg: la integración los convierte, y Gladys los muestra en las unidades de cada usuario. El punto de rocío es una temperatura de «sonda» para no contar en la temperatura media de la habitación. Los sensores más antiguos no tienen punto de rocío ni VPD, y solo el HTP.xw tiene barómetro: una función aparece con su primer valor. La tensión de la pila y la señal no tienen una categoría adecuada en Gladys: el widget del sensor y la acción de escena las muestran.

### Widgets del panel

![Los dos widgets: todos los sensores, con la bodega fuera de su rango de humedad y un sensor del desván sin señal, y el invernadero con sus mediciones y las últimas 24 horas (ilustración generada, no una captura de pantalla)](https://raw.githubusercontent.com/William-De71/gladys-sensorpush-cloud/main/docs/assets/widgets.es.png)

- **Sensores SensorPush**: cuántos sensores, cuántos fuera de su rango de alerta, cuántos sin señal; una tarjeta por sensor (las alertas primero) con su temperatura, su humedad y la antigüedad de su última medición; las pasarelas y si se comunican.
- **Sensor SensorPush**: un sensor (elíjalo en los ajustes del widget; el primero por defecto): sus mediciones, la temperatura y el punto de rocío de las últimas 24 horas, el mínimo y el máximo del día, sus rangos de alerta, la tensión de la pila y la señal. La gráfica viene de las mediciones que guarda la integración, sin ninguna petición adicional.

### Escenas

Disparadores (una vez por cambio, nunca en la primera lectura, nunca por una acción de escena), filtrados por sensor o pasarela:

- **Fuera del rango de alerta**: la temperatura o la humedad sale del rango de alerta configurado en la aplicación SensorPush (filtros: medidas, lado). Una alerta desactivada en la aplicación no vigila nada.
- **De vuelta en el rango**: vuelve a entrar, con el tiempo que estuvo fuera.
- **Sensor sin señal** / **Sensor de vuelta**: ninguna medición nueva durante el plazo de la configuración, luego de nuevo mediciones.
- **Pasarela desconectada** / **Pasarela reconectada**: ninguna comunicación con la nube SensorPush durante 30 minutos, luego de nuevo una comunicación.
- **Acceso rechazado**: SensorPush rechaza la dirección de correo, la contraseña o el token de acceso.

Acciones:

- **Valores de un sensor**: temperatura, humedad, punto de rocío, presión, VPD, tensión de la pila, señal, minutos desde la última medición y una frase, de la última lectura (sin petición).
- **Historial de un sensor**: la temperatura y la humedad mínimas, máximas y medias de las últimas 1 a 72 horas, y una frase. Envía una petición en el siguiente minuto libre: la escena puede esperar hasta un minuto.

Ejemplos:

- Cuando **SensorPush: fuera del rango de alerta** en la bodega → enviar «{{triggerEvent.data.sensor_name}}: {{triggerEvent.data.measure_label}} {{triggerEvent.data.value}} {{triggerEvent.data.unit}}».
- Cada día a las 8:00 → **SensorPush: historial de un sensor** (invernadero, 24 h) → enviar su resumen.
- Cuando **SensorPush: pasarela desconectada** → enviar «La pasarela SensorPush {{triggerEvent.data.gateway_name}} está desconectada».

## Solución de problemas

- **«SensorPush rechazó el inicio de sesión»**: compruebe la dirección de correo y la contraseña en la aplicación SensorPush; una cuenta nueva debe conectarse primero una vez a dashboard.sensorpush.com y aceptar las condiciones de la API.
- **«al menos 8 caracteres»**: SensorPush rechaza las contraseñas más cortas: cámbiela en la aplicación SensorPush.
- **Ningún dispositivo ofrecido**: un sensor se ofrece en cuanto se ha leído una primera medición, unos dos minutos después de la configuración. Los sensores inactivos no se ofrecen.
- **Valores que no cambian, sensor sin señal**: las mediciones necesitan la pasarela; compruebe que está enchufada y conectada (su dispositivo, o el widget de los sensores).
- **La acción de historial es lenta**: SensorPush acepta una petición por minuto; la acción espera el siguiente minuto libre.
- Para una incidencia, indique las versiones de Gladys y de la integración, el mensaje de **Probar la conexión** y las líneas «SensorPush diagnostic» que escribe **Diagnóstico** en los registros de la integración. Nunca pegue su contraseña.
