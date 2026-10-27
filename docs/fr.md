# SensorPush Cloud

## Présentation

Cette intégration amène dans Gladys les capteurs et les passerelles de votre compte SensorPush : la température, l’humidité, le point de rosée, la pression atmosphérique et le déficit de pression de vapeur (VPD) de vos capteurs **SensorPush** (HT1, HT.w, HTP.xw), relayés vers le cloud par une **passerelle SensorPush** (G1 WiFi Gateway), via l’[API officielle Gateway Cloud de SensorPush](https://www.sensorpush.com/gateway-cloud-api) avec l’adresse e-mail et le mot de passe de votre compte. Elle ne fait que lire. Elle n’est pas affiliée à SensorPush.

- Un appareil par capteur : température, humidité, point de rosée, pression atmosphérique (HTP.xw seulement) et VPD, selon ce que donne chaque modèle.
- Un appareil par passerelle : si elle se signale au cloud SensorPush, sa version logicielle.
- Deux widgets de tableau de bord : tous les capteurs d’un coup d’œil, les alertes d’abord ; un capteur avec une courbe sur 24 heures.
- Déclencheurs de scène : hors plage d’alerte, retour dans la plage (les plages réglées dans l’application SensorPush), capteur muet, capteur de retour, passerelle déconnectée, passerelle reconnectée, accès refusé.
- Actions de scène : les valeurs d’un capteur, l’historique d’un capteur (minimum, maximum, moyenne sur 1 à 72 heures).

Transport : cloud. L’adresse e-mail et le mot de passe partent chez SensorPush (`api.sensorpush.com`) pour la connexion ; les mesures de vos capteurs viennent du cloud SensorPush, qui les reçoit de votre passerelle.

## Prérequis

- Gladys Assistant 5.3.0 ou plus récent.
- Un compte SensorPush avec au moins un capteur et une **passerelle SensorPush** : sans passerelle, les mesures restent dans le téléphone et n’arrivent jamais dans le cloud.
- **L’accès à l’API du compte doit être activé** : connectez-vous une fois au [Gateway Cloud Dashboard](https://dashboard.sensorpush.com/) avec la même adresse e-mail et le même mot de passe, et acceptez les conditions de l’API. D’ici là, SensorPush refuse la connexion.
- Le mot de passe doit compter au moins 8 caractères (une règle de SensorPush).

Fraîcheur des données : une passerelle relaie les capteurs environ une fois par minute, et SensorPush accepte **au plus une requête par minute**. L’intégration ne demande jamais plus : les dernières mesures toutes les minutes par défaut, les listes des capteurs et des passerelles toutes les 15 minutes, chacune à la place d’une lecture des mesures.

## Configuration

| Champ               | Signification                                                                                                                  |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| Adresse e-mail      | L’e-mail de votre compte SensorPush                                                                                            |
| Mot de passe        | Son mot de passe (un secret : jamais réaffiché, jamais écrit dans les journaux ni dans `/data`)                                |
| Lecture des mesures | Toutes les 1 (par défaut), 2, 5 ou 10 minutes : une seule requête pour tous les capteurs                                       |
| Capteur muet après  | 15, 30 (par défaut), 60, 120 ou 360 minutes sans nouvelle mesure                                                               |
| Unités des scènes   | Métrique (°C, hPa, par défaut) ou US (°F, inHg) pour les valeurs et textes des scènes ; les widgets suivent chaque utilisateur |
| Langue des textes   | Noms des fonctionnalités, état des passerelles, textes des scènes et erreurs ; automatique suit le dernier widget              |

Boutons :

- **Tester la connexion** se connecte à SensorPush et liste les capteurs (cela peut attendre jusqu’à une minute, le rythme de SensorPush).
- **Diagnostic** écrit l’état de l’intégration dans ses journaux, sans le mot de passe ni le jeton.

Le jeton d’accès reste en mémoire : après un redémarrage, l’intégration se reconnecte.

## Utilisation

### Appareils

Après la configuration, ouvrez **Découverte** : chaque capteur est proposé dès qu’une première mesure a été lue, avec son nom dans l’application SensorPush, et chaque passerelle sous le nom « Passerelle SensorPush <nom> ». Ajoutez ceux que vous voulez.

| Fonctionnalité                      | Catégorie / type                 | Unité |
| ----------------------------------- | -------------------------------- | ----- |
| Température                         | `temperature-sensor` / `decimal` | °C    |
| Humidité                            | `humidity-sensor` / `decimal`    | %     |
| Point de rosée                      | `temperature-sensor` / `probe`   | °C    |
| Pression atmosphérique (HTP.xw)     | `pressure-sensor` / `decimal`    | hPa   |
| Déficit de pression de vapeur (VPD) | `pressure-sensor` / `decimal`    | kPa   |
| Connexion de la passerelle, version | `text` / `text`                  | —     |

SensorPush donne des °F et des inHg : l’intégration les convertit, et Gladys les affiche dans les unités de chaque utilisateur. Le point de rosée est une température « sonde » pour ne pas compter dans la température moyenne de la pièce. Les capteurs plus anciens n’ont ni point de rosée ni VPD, et seul le HTP.xw a un baromètre : une fonctionnalité apparaît avec sa première valeur. La tension de la pile et le signal n’ont pas de catégorie adaptée dans Gladys : le widget du capteur et l’action de scène les montrent.

### Widgets du tableau de bord

![Les deux widgets : tous les capteurs, avec la cave à vin hors de sa plage d’humidité et un capteur du grenier muet, et la serre avec ses mesures et les dernières 24 heures (illustration générée, pas une capture d’écran)](https://raw.githubusercontent.com/William-De71/gladys-sensorpush-cloud/main/docs/assets/widgets.fr.png)

- **Capteurs SensorPush** : combien de capteurs, combien hors de leur plage d’alerte, combien muets ; une carte par capteur (les alertes d’abord) avec sa température, son humidité et l’âge de sa dernière mesure ; les passerelles et si elles se signalent.
- **Capteur SensorPush** : un capteur (à choisir dans les réglages du widget ; le premier par défaut) : ses mesures, la température et le point de rosée des dernières 24 heures, le minimum et le maximum du jour, ses plages d’alerte, la tension de la pile et le signal. La courbe vient des mesures que garde l’intégration, sans requête supplémentaire.

### Scènes

Déclencheurs (une fois par changement, jamais à la première lecture, jamais à cause d’une action de scène), filtrés par capteur ou passerelle :

- **Hors plage d’alerte** : la température ou l’humidité sort de la plage d’alerte réglée dans l’application SensorPush (filtres : mesures, côté). Une alerte désactivée dans l’application ne surveille rien.
- **Retour dans la plage** : elle y revient, avec la durée passée dehors.
- **Capteur muet** / **Capteur de retour** : aucune nouvelle mesure pendant le délai de la configuration, puis de nouveau des mesures.
- **Passerelle déconnectée** / **Passerelle reconnectée** : aucun signal au cloud SensorPush pendant 30 minutes, puis de nouveau un signal.
- **Accès refusé** : SensorPush refuse l’adresse e-mail, le mot de passe ou le jeton d’accès.

Actions :

- **Valeurs d’un capteur** : température, humidité, point de rosée, pression, VPD, tension de la pile, signal, minutes depuis la dernière mesure et une phrase, depuis la dernière lecture (sans requête).
- **Historique d’un capteur** : la température et l’humidité minimales, maximales et moyennes des dernières 1 à 72 heures, et une phrase. Elle envoie une requête dans la prochaine minute libre : la scène peut attendre jusqu’à une minute.

Exemples :

- Quand **SensorPush : hors plage d’alerte** sur la cave à vin → envoyer « {{triggerEvent.data.sensor_name}} : {{triggerEvent.data.measure_label}} {{triggerEvent.data.value}} {{triggerEvent.data.unit}} ».
- Chaque jour à 8 h → **SensorPush : historique d’un capteur** (serre, 24 h) → envoyer sa phrase de synthèse.
- Quand **SensorPush : passerelle déconnectée** → envoyer « La passerelle SensorPush {{triggerEvent.data.gateway_name}} est hors ligne ».

## Dépannage

- **« SensorPush a refusé la connexion »** : vérifiez l’adresse e-mail et le mot de passe dans l’application SensorPush ; un nouveau compte doit d’abord se connecter une fois à dashboard.sensorpush.com et accepter les conditions de l’API.
- **« au moins 8 caractères »** : SensorPush refuse les mots de passe plus courts : changez-le dans l’application SensorPush.
- **Aucun appareil proposé** : un capteur est proposé dès qu’une première mesure a été lue, environ deux minutes après la configuration. Les capteurs inactifs ne sont pas proposés.
- **Valeurs figées, capteur muet** : les mesures passent par la passerelle ; vérifiez qu’elle est branchée et en ligne (son appareil, ou le widget des capteurs).
- **L’action d’historique est lente** : SensorPush accepte une requête par minute ; l’action attend la prochaine minute libre.
- Pour un ticket, donnez les versions de Gladys et de l’intégration, le message de **Tester la connexion** et les lignes « SensorPush diagnostic » écrites par **Diagnostic** dans les journaux de l’intégration. Ne collez jamais votre mot de passe.
