# Chaîne YouTube « amour » — usine à vidéos

Script → voix **ElevenLabs** → visuels **Pexels** → montage **Remotion** → **MP4**.

Tout est piloté par l'audio : la durée de la vidéo, les coupes entre les plans et les sous-titres mot à mot sont calculés à partir de l'alignement renvoyé par ElevenLabs. Aucune durée n'est écrite à la main.

---

## Démarrage

Double-clique sur **`Lancer.bat`**. Il vérifie Node, installe les dépendances au premier lancement, crée le `.env` depuis le modèle si besoin, démarre le serveur et ouvre l'interface dans le navigateur. Laisse la fenêtre ouverte pendant que tu travailles.

En ligne de commande :

```bash
npm install
```

Copie `.env.example` vers `.env` et renseigne :

| Clé | Où l'obtenir | Sans elle |
|---|---|---|
| `ELEVENLABS_VOICE_ID` | https://elevenlabs.io/app/voice-library | voix par défaut |
| `PEXELS_API_KEY` | https://www.pexels.com/api/new/ | pas de visuels automatiques |

Les **clés ElevenLabs** ne se mettent plus dans le `.env` : elles vivent dans le trousseau, bouton **« Clés »** en haut de l'interface (voir plus bas). Une clé encore présente dans `ELEVENLABS_API_KEY` y est reprise automatiquement au premier démarrage.

### Trousseau ElevenLabs : plusieurs comptes, un seul quota

Un compte gratuit ElevenLabs donne **10 000 crédits par mois**, soit 10 000 caractères de voix off, c'est-à-dire environ 9 vidéos courtes. Le bouton **« Clés »** stocke autant de comptes que tu veux dans `.keys.json` (jamais versionné, jamais affiché en clair : seul un masque `sk_af45c…fa29` apparaît).

**Un compte payant prime toujours.** Le palier gratuit d'ElevenLabs n'accorde **aucune licence commerciale** : un son généré dessus ne peut pas partir sur une chaîne monétisée, et il n'ouvre que les 21 voix maison anglophones. Dès qu'une clé payante est dans le trousseau, la synthèse ne sort plus que de celle-là — les comptes gratuits ne servent plus qu'à l'alignement des sous-titres, qui ne produit aucun son et ne consomme aucun crédit. Le log le dit à chaque production.

Avant chaque synthèse, l'usine :

1. compte les caractères de la voix off du script ;
2. relève le quota **réel** de chaque clé auprès d'ElevenLabs ;
3. **refuse de commencer** si la somme ne couvre pas la vidéo — aucun crédit n'est consommé, pas de demi-vidéo ;
4. sinon répartit les morceaux, en prenant à chaque fois la clé au **plus petit reste suffisant** : les petits restes se vident, les gros quotas restent disponibles pour les longues vidéos ;
5. si une clé casse en cours de route (quota épuisé entre-temps, clé révoquée), le morceau repart sur la clé suivante.

Le verdict s'affiche en direct sous le moteur ElevenLabs (« Quota suffisant : 952 crédits pour cette vidéo, 10 000 disponibles ») et le bouton « Produire » reste bloqué tant que ça ne passe pas.

### La musique ne vient pas de Pexels

**L'API Pexels ne propose aucun endpoint audio**, uniquement photos et vidéos. Deux voies pour la musique :

| Source | Clé | Ce qu'elle apporte |
|---|---|---|
| **Openverse** (recherche intégrée) | aucune | agrégateur Creative Commons, marche dès l'ouverture |
| **Dépôt manuel** (bouton « Ajouter un fichier ») | aucune | n'importe quel mp3, wav, m4a ou aac à toi : Pixabay, achat, export perso |

Sur Openverse, seules les licences **CC0** et **CC-BY** sont retenues ; l'attribution est écrite à côté du fichier dans `public/music/`, reprise dans `out/<slug>.meta.json` et intégrée à la description prête à coller du bloc Publier. Pour un fichier déposé à la main, les droits relèvent de toi.

---

## Interface web

```bash
npm run ui
```

Ouvre <http://127.0.0.1:4400> — tout se pilote depuis la page, sans ligne de commande :

- **Import** : colle un script brut, le découpage en beats se fait tout seul et l'aperçu se met à jour à la frappe. **L'aperçu n'enregistre rien** : il faut cliquer sur « Découper et créer » pour que le script existe et que la production devienne possible. Les paragraphes sont des frontières dures, les phrases ne sont jamais coupées en deux sauf au-delà de 30 mots, et chaque beat vise 8 à 26 mots. Une requête visuelle est proposée par thème (solitude, rupture, attente, jalousie, tendresse…) sans jamais répéter la même deux fois.
- **Écriture, deux vues** : **Texte** (par défaut) montre le script d'un seul tenant, tel qu'il sera lu, modifiable et copiable. **Beats** montre le détail : une image et une intonation par phrase, réordonnancement, suppression. Compteur de mots et durée estimée en direct dans les deux vues.
- **Réécrire en texte continu sans rien casser** : après modification dans la vue Texte, « Appliquer au découpage » **recale** le script sur les beats existants au lieu de tout redécouper. Les phrases inchangées gardent leur image et leur intonation ; seuls les passages réellement modifiés donnent de nouveaux beats. Corriger une phrase sur quatorze n'en refait qu'une, pas quatorze. Enregistrer est bloqué tant que le texte modifié n'a pas été appliqué, pour ne pas le perdre en silence.
- **Intonation** : sous chaque beat, la couleur que prendra la voix. Laissé sur « Automatique », le champ affiche ce que l'usine jouera de toute façon.
- **Voix** : bouton « Changer » dans la colonne Production. Il ouvre d'abord la **sélection amour** : 19 voix retenues pour raconter des histoires de couple, chacune avec une phrase disant ce qu'elle apporte (`pipeline/lib/voices-amour.mjs`). Une bascule donne accès au **catalogue entier** — les voix du compte plus la bibliothèque ElevenLabs, soit plus de 300 voix pour le français seul, filtrables par genre et par recherche libre ; les voix de la sélection y sont marquées d'une étoile. Le bouton ▸ joue l'extrait officiel, gratuitement ; « Sur mon script » fait lire les deux premiers beats de la vidéo ouverte, intonations comprises, pour une centaine de crédits. La voix retenue est enregistrée dans le script : **chaque vidéo a la sienne**.
- **Ta propre voix** : le fichier est déposé dans `public/audio/<slug>.mp3` et ElevenLabs n'est plus appelé que pour caler le texte dessus.
- **Musique** : recherche Openverse par ambiance ou mots-clés, dépôt d'un fichier à soi, écoute de la piste retenue, volume réglable au curseur de 0 à 40 %.
- **Production** : les logs du pipeline défilent en direct et le MP4 se lit dans la page une fois prêt.
- **Thème clair et sombre** : bascule en haut à droite, mémorisée, calée par défaut sur ta préférence système.
- **Clés ElevenLabs** : bouton « Clés » en haut à droite. Ajout d'une clé (vérifiée auprès d'ElevenLabs avant d'être rangée), retrait en deux clics, quota de chaque compte en barre et total disponible. Le quota du script ouvert est recalculé à l'ouverture, à l'enregistrement et après chaque production.
- **Garde-fous** : la bannière liste ce qui manque et le bouton reste bloqué tant que le script est incomplet ; les clés manquantes ou à court de quota sont signalées en haut et dans la bannière ; une seule production à la fois ; un script supprimé part dans `out/.trash/`.

Le serveur n'écoute que sur `127.0.0.1` et n'ajoute aucune dépendance. Port modifiable : `npm run ui -- --port=5000`.

## Fabriquer une vidéo

```bash
npm run make -- scripts/pourquoi-tu-attires-le-meme-type.json
```

Résultat : `out/<slug>.short.mp4`.

### Étape par étape

```bash
npm run build -- scripts/mon-script.json
```

```bash
npm run studio
```

```bash
npm run render -- mon-script
```

`npm run studio` ouvre Remotion Studio sur la dernière vidéo construite : tu peux scruber la timeline, régler les props dans le panneau de droite et vérifier le calage des sous-titres avant de payer un rendu.

---

## Options

| Option | Effet |
|---|---|
| `--format=long` | 1920×1080 au lieu de 1080×1920 |
| `--media=mix` | **défaut** : vidéo en priorité, photo en repli |
| `--media=video` | vidéo uniquement |
| `--media=photo` | photo uniquement |
| `--music-mood=romantique` | télécharge une musique (ambiances : romantique, melancolique, calme, piano, cinematique, espoir, tendu) |
| `--no-music` | aucun fond musical |
| `--audio=voix.mp3` | utilise ta propre voix off (forced alignment sur le texte du script) |
| `--music=nom.mp3` | choisit la musique dans `public/music` |
| `--music-volume=0.08` | volume de la musique sous la voix (défaut 0.1) |
| `--voice=<voiceId>` | surcharge la voix ElevenLabs |
| `--force-voice` | re-synthétise même si l'audio existe |
| `--force-align` | relance l'alignement même s'il est en cache |
| `--no-media` | saute Pexels et réutilise les visuels déjà téléchargés |
| `--concurrency=4` | threads de rendu |

> **Temps de rendu** — compter environ 10 min pour un Short de 70 s en 1080×1920 sur un poste de bureau. `--concurrency=<n>` règle le nombre de threads ; par défaut Remotion s'adapte au nombre de cœurs.

Les appels payants sont mis en cache : `public/audio/<slug>.mp3` pour la voix, `out/<slug>.alignment.json` pour l'alignement. Relancer `build` ne recontacte ElevenLabs que si l'un des deux manque.

---

## Écrire les scripts

L'agent **`love-scriptwriter`** (`.claude/agents/love-scriptwriter.md`) porte la ligne éditoriale et produit le JSON. Dans Claude Code :

> écris-moi un script sur la jalousie
>
> fais-moi 5 scripts pour la semaine

Le skill **`love-video`** (`.claude/skills/love-video/SKILL.md`) enchaîne écriture, montage et rendu :

> fais-moi une vidéo sur pourquoi on revient toujours vers son ex

### Format d'un script

```jsonc
{
  "slug": "mon-sujet",              // nom de fichier et de la vidéo rendue
  "title": "Titre affiché en haut",
  "hook": "Phrase d'accroche",
  "beats": [
    {
      "text": "Une à deux phrases en français, écrites pour être dites.",
      "visual_query": "english pexels query"   // toujours en anglais
    }
  ],
  "youtube": {"title": "", "description": "", "tags": [], "thumbnail_text": ""}
}
```

La voix off est la **concaténation exacte** des `beats[].text`. Chaque beat reçoit un ou plusieurs plans, découpés proportionnellement à sa durée réelle (un visuel par ~4,5 s).

---

## Utiliser ta propre voix

Trois modes de voix off, choisis dans l'interface (bloc « Voix off ») ou en ligne de commande :

### 1. Voix générée

La voix est synthétisée depuis le texte des beats. Trois moteurs, du plus léger au meilleur :

- **Locale légère (Piper)** — **aucune clé**, licence **CC-BY** (commercial OK). Français correct, très rapide. Voix `siwis-f` (Léa, F) et `mls-m` (Antoine, M). Binaire + voix (~80 Mo) téléchargés une fois.
- **Locale HD (XTTS-v2)** — **la meilleure qualité locale**, accélérée par le GPU, et capable de **cloner ta voix**. **Licence non commerciale (CPML)** : à réserver à un usage perso/test sur une chaîne monétisée. Installation séparée (ci-dessous).
- **ElevenLabs** — qualité de référence, nécessite au moins une clé dans le trousseau (bouton « Clés »). Le quota est vérifié avant de lancer la synthèse et la rotation entre comptes est automatique.

```bash
npm run make -- scripts/mon-script.json --tts=xtts --tts-voice=daisy-f
npm run make -- scripts/mon-script.json --tts=piper --tts-voice=mls-m
```

Comme le texte est connu, les sous-titres affichent le **texte exact du script** (le timing vient de whisper.cpp, le texte reste celui des beats).

#### Installer la voix HD (XTTS-v2)

Nécessite Python 3.11 et, idéalement, un GPU NVIDIA. Environnement isolé, hors projet :

```bash
py -3.11 -m venv "%LOCALAPPDATA%\love-xtts\venv"
"%LOCALAPPDATA%\love-xtts\venv\Scripts\python" -m pip install torch --index-url https://download.pytorch.org/whl/cu121
"%LOCALAPPDATA%\love-xtts\venv\Scripts\python" -m pip install coqui-tts
```

Le modèle (~1,8 Go) se télécharge au premier usage. Le bouton **Locale HD** de l'interface s'active dès que l'installation est détectée.

**Cloner ta voix** : passe en mode « Ma voix », dépose 10 à 30 secondes de toi, puis reviens sur « Générée » → « Locale HD » et coche « Cloner ma voix ». XTTS génère tout le script avec ton timbre.

#### L'intonation, beat par beat

La voix off ne lit pas le script : elle le **joue**. Chaque beat porte un champ `emotion` qui devient une balise comprise par `eleven_v3`, le seul modèle ElevenLabs qui obéit à ces directives.

```json
{ "text": "Et le familier, c'est souvent ce qui t'a fait mal.", "visual_query": "old photograph on table", "emotion": "triste" }
```

Douze intonations : `curieux`, `pose`, `doux`, `tendre`, `intime`, `triste`, `melancolique`, `grave`, `espoir`, `complice`, `vif`, `soupir`. Elles se choisissent aussi à la souris, sur chaque beat, dans l'éditeur.

Trois choses à savoir :

- **Aucun beat ne reste plat.** Sans `emotion`, l'usine déduit l'intonation du texte : une question interpelle, une structure « ce n'est pas X, c'est Y » se fait grave, l'accroche accroche, la chute réconforte. La déduction est un filet de sécurité, pas un substitut : un script écrit avec l'intonation pensée sonnera toujours mieux. L'éditeur affiche ce qui sera joué, même quand tu ne choisis rien.
- **Les balises sont facturées** comme du texte ordinaire, environ 10 % de crédits en plus. Le contrôle de quota en tient compte.
- **Elles n'apparaissent jamais à l'écran.** ElevenLabs les renvoie dans l'alignement mot à mot ; le pipeline les retire, ainsi que leur durée, avant de construire les sous-titres et de découper les beats.

`ELEVENLABS_V3_STABILITY` règle l'obéissance aux balises : `0` très expressif mais instable, `0.5` naturel (défaut), `1` verrouillé et sourd aux directives.

### 2. Ta voix, telle quelle — **sans aucune clé**

```bash
npm run make -- scripts/mon-script.json --audio=C:\chemin\ma-voix.mp3
```

Ton enregistrement devient le son de la vidéo. Les sous-titres sont calés **en local par whisper.cpp** : transcription mot à mot sur ta machine, aucune clé, aucun envoi. Le modèle (~150 Mo) se télécharge tout seul au premier usage, une fois.

Les sous-titres affichent alors ce qui est **réellement dit** (transcription), pas le texte du script. Une lecture fidèle de ton script donne des sous-titres fidèles.

Si le trousseau contient une clé, le pipeline préfère le *forced alignment* ElevenLabs, qui cale le texte **exact** du script (et ne consomme aucun crédit). Si aucune clé ne répond, il retombe tout seul sur whisper.cpp. Forcer l'un ou l'autre : `--align=whisper` ou `--align=elevenlabs`.

### 3. Speech-to-speech : ton intonation, une autre voix

```bash
npm run make -- scripts/mon-script.json --audio=C:\chemin\ma-voix.mp3 --sts-voice=<voiceId>
```

ElevenLabs garde ton rythme et ton intonation mais plaque la voix cible par-dessus (*voice changer*). Nécessite une clé dans le trousseau ; le quota est vérifié avant l'appel, en estimant le coût sur la longueur du script. Dans l'interface, la voix cible se choisit dans une liste déroulante.

> **Non testé** : le speech-to-speech est écrit d'après la documentation ElevenLabs mais n'a jamais été exécuté faute de clé. Le premier run peut demander un ajustement.

### Moteurs locaux et espaces dans le chemin

Piper et whisper.cpp s'installent hors projet, sous `%LOCALAPPDATA%\love-piper` et `%LOCALAPPDATA%\love-whisper`. C'est volontaire : le script d'installation de whisper de Remotion construit une commande PowerShell non échappée qui casse sur l'espace de « Youtube automatisé ». L'installation hors projet contourne le problème et garde le dépôt léger.

### Qualité des voix : le compromis

Aucun moteur **local** n'atteint le niveau d'ElevenLabs. Classement réel :

1. **ElevenLabs** — référence, mais clé payante (palier gratuit pour tester).
2. **XTTS-v2** — meilleure qualité locale, clonage de voix, GPU. Licence **non commerciale**.
3. **Piper** — correct, très léger, licence **CC-BY** (commercial OK).

XTTS est fourni pour ceux qui acceptent sa licence non commerciale (usage perso/test). Pour une chaîne monétisée sans compromis de licence, reste sur Piper ou ElevenLabs.

---

## Design

[DESIGN.md](DESIGN.md) est la source de vérité, reprise du dépôt `Compaatible-affiliate`. L'interface et la vidéo suivent la même identité : burgundy `#8B2D4A` sur crème `#FBF9F7`, Playfair Display pour le display, Inter pour le corps, Cormorant Garamond pour les citations, cartes blanches à bordure hairline et ombre douce.

Deux règles du document valent pour tout ce que produit le projet, y compris les scripts écrits par l'agent :

- aucune couleur hors palette, les nuances se dérivent par opacité ;
- aucun tiret cadratin (`—`, `–`), considéré comme un marqueur d'écriture IA.

Dans la vidéo, le mot en cours de lecture reprend le motif du CTA de la marque : pastille burgundy, texte crème.

### Contraste

Tous les textes de l'interface passent le seuil WCAG AA (4,5:1) dans les deux thèmes, mesuré sur le rendu réel.

Deux écarts assumés au document, imposés par le contraste :

- Le `muted` `#8B7D85` ne monte qu'à **3,91:1** sur blanc. Il est dérivé vers l'encre à 85 % (`#7B6D74`, **4,91:1**) en gardant le même gris chaud.
- Sur fond sombre, le burgundy ne monte qu'à **2,1:1** contre `#0A0709`. Il n'y sert donc jamais de couleur de texte : il reste un aplat (CTA, pastilles, pastilles de numéro de beat) sur lequel le crème atteint **8,2:1**. Le texte courant passe en crème.

## Montage

Le montage suit l'audio et applique deux règles :

- **Vidéo d'abord.** Chaque beat cherche une vidéo Pexels ; la photo ne prend le relais que si rien d'exploitable ne sort. Une vidéo tient 6,5 s à l'écran contre 4,5 s pour une photo, démarre 0,6 s après le début du clip (les premières frames sont souvent figées) et ne dépasse jamais la durée réelle du clip source : au besoin le beat reçoit un plan de plus.
- **Ken Burns adapté.** Une photo reçoit un zoom de 8 à 16 %, une vidéo seulement 3 à 6 % : elle porte déjà son propre mouvement, et un zoom appuyé par-dessus donne le mal de mer.

## Personnaliser le montage

| Fichier | Rôle |
|---|---|
| `src/theme.ts` | polices, couleurs, durée du fondu enchaîné |
| `src/components/Captions.tsx` | style et animation des sous-titres |
| `src/components/Background.tsx` | effet Ken Burns et fondus |
| `src/components/Overlays.tsx` | grain, vignette, dégradé chaud, barre de progression |
| `src/components/TitleCard.tsx` | bandeau titre |
| `src/Root.tsx` | compositions `LoveShort` (9:16) et `LoveLong` (16:9) |
| `pipeline/build.mjs` | rythme des plans, amplitude du zoom, découpage des sous-titres |

---

## HyperFrames

Les skills HeyGen HyperFrames sont installés dans `.agents/skills/` (25 skills, liés dans `.claude/skills/`) :

```bash
npx skills add heygen-com/hyperframes
```

**Le montage n'a pas été porté sur HyperFrames**, pour trois raisons de fond :

- HyperFrames **invente ses visuels en HTML** (typographie, diagrammes, data-viz) et laisse `asset_candidates` vide par défaut — il n'a pas de source de photos, alors que la chaîne repose sur Pexels.
- Il source son audio et sa musique dans le **catalogue HeyGen**, avec un `npx hyperframes auth` obligatoire.
- Son workflow `faceless-explainer` dispatche **un sous-agent par frame** et impose trois validations manuelles par vidéo. C'est une chaîne de création à l'unité, pas une usine à publier en série.

En revanche la doctrine `motion-doctrine` a été appliquée au montage Remotion, et elle a corrigé un vrai défaut :

> Every film picks ONE dominant direction. Never run consecutive seams in opposing directions — ping-pong reads as an error.

Le Ken Burns tirait au sort le sens du zoom et du panoramique à chaque plan. Désormais tous les plans avancent dans le même sens, seule l'amplitude varie, et **le dernier plan recule** — le vecteur réservé qui signifie « quelque chose de plus grand arrive », soit exactement la chute du script.

Les autres skills restent disponibles si tu veux un autre genre de vidéo (`/hyperframes` est la porte d'entrée, `/slideshow`, `/music-to-video`, `/product-launch-video`…). Ils sont sans effet sur cette chaîne.

## Arborescence

```
ui/                interface web locale (serveur + page, sans build)
pipeline/          scripts Node du pipeline (build, render, make)
  lib/             ElevenLabs, Pexels, sous-titres, utilitaires
  lib/keys.mjs             trousseau des clés ElevenLabs (.keys.json)
  lib/elevenlabs-pool.mjs  contrôle du quota et rotation entre comptes
src/               composition Remotion (React)
  props/current.json   dernières props construites (rechargées par le studio)
scripts/           scripts de vidéos (JSON)
public/audio/      voix off générées ou fournies
public/images/     visuels Pexels par slug
public/music/      musiques d'ambiance (à fournir)
out/               MP4, props et métadonnées YouTube
```

`out/<slug>.meta.json` contient le titre, la description, les tags YouTube et les crédits Pexels à coller en fin de description.
