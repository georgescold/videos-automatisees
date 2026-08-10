/**
 * Construit les props de montage a partir d'un script JSON.
 *
 *   node pipeline/build.mjs scripts/mon-script.json [options]
 *
 * Options :
 *   --format=short|long   9:16 (defaut) ou 16:9
 *   --media=photo|video   type de visuels Pexels (defaut: photo)
 *   --audio=chemin.mp3    utilise une voix deja enregistree au lieu d'ElevenLabs
 *   --music=nom.mp3       musique de fond dans public/music (defaut: 1re trouvee)
 *   --voice=<voiceId>     surcharge la voix ElevenLabs
 *   --model=<modelId>     modele de synthese. Defaut : eleven_v3, seul modele
 *                         qui comprend les balises d'intonation. Un autre
 *                         modele recoit le texte nu, sans direction de jeu.
 *   --no-media            saute Pexels (garde les visuels deja telecharges)
 *   --force-voice         re-synthetise meme si l'audio existe deja
 *   --force-align         relance le forced alignment meme s'il est en cache
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {env, requireEnv} from './lib/env.mjs';
import {forcedAlignment, speechToSpeech} from './lib/elevenlabs.mjs';
import {estimateCredits, synthesizeVoice, withKey} from './lib/elevenlabs-pool.mjs';
import {hasElevenLabsKey} from './lib/keys.mjs';
import {
  cleanVoiceover,
  resolveEmotions,
  stripTagsFromAlignment,
  TAGGED_MODEL_ID,
  taggedVoiceover,
} from './lib/emotions.mjs';
import {synthesizeToMp3} from './lib/piper.mjs';
import {synthesizeToMp3 as synthesizeWithXtts} from './lib/xtts.mjs';
import {alignKnownText, alignWithWhisper} from './lib/whisper.mjs';
import {downloadTrack, searchMusic} from './lib/music.mjs';
import {download, searchPhotos, searchVideos} from './lib/pexels.mjs';
import {
  buildPages,
  mapBeatsToTimeline,
  wordsFromCharacterAlignment,
  wordsFromForcedAlignment,
} from './lib/captions.mjs';
import {
  ensureDir,
  fail,
  log,
  p,
  parseArgs,
  readJson,
  progress,
  seeded,
  slugify,
  writeJson,
} from './lib/utils.mjs';

const FPS = 30;
const CROSSFADE_FRAMES = 18;
const TAIL_SECONDS = 1.4;
/** Une photo fixe lasse vite ; une video porte son propre mouvement. */
const SECONDS_PER_PHOTO = 4.5;
const SECONDS_PER_VIDEO = 6.5;
/** Les premieres frames d'un clip de banque sont souvent statiques. */
const CLIP_HEAD_SECONDS = 0.6;
const MIN_CLIP_SECONDS = 4;
const ACCENT = '#8B2D4A'; // Burgundy Compaatible, cf. DESIGN.md

const {positional, flags} = parseArgs(process.argv.slice(2));

if (positional.length === 0) {
  fail('Usage : node pipeline/build.mjs scripts/mon-script.json [--format=short]');
}

const scriptPath = path.isAbsolute(positional[0]) ? positional[0] : p(positional[0]);
if (!fs.existsSync(scriptPath)) fail(`Script introuvable : ${scriptPath}`);

const script = readJson(scriptPath);
const format = flags.format === 'long' ? 'long' : 'short';
// « mix » par defaut : video en priorite, photo en repli quand la banque ne
// rend rien d'exploitable pour la requete.
const mediaType = ['photo', 'video', 'mix'].includes(flags.media) ? flags.media : 'mix';
const orientation = format === 'long' ? 'landscape' : 'portrait';
const slug = script.slug ? slugify(script.slug) : slugify(script.title ?? 'video');

if (!Array.isArray(script.beats) || script.beats.length === 0) {
  fail('Le script doit contenir un tableau "beats" non vide.');
}
for (const [i, beat] of script.beats.entries()) {
  if (!beat.text || typeof beat.text !== 'string') {
    fail(`beats[${i}] : champ "text" manquant.`);
  }
  if (!beat.visual_query) {
    fail(`beats[${i}] : champ "visual_query" manquant.`);
  }
}

// Le texte lu, sans direction de jeu : sous-titres, decoupage des beats,
// voix locales et forced alignment travaillent tous sur celui-la.
const voiceover = cleanVoiceover(script.beats);

// Intonation de chaque beat : celle du script, sinon celle deduite du texte.
// Aucun beat ne part sans intention, une lecture plate est le defaut a eviter.
const emotions = resolveEmotions(script.beats);
const voiceoverTagged = taggedVoiceover(script.beats, emotions);

log.step(`Video « ${script.title ?? slug} » — format ${format} / visuels ${mediaType}`);
log.info(`${script.beats.length} beats, ${voiceover.length} caracteres de voix off`);

const declarees = emotions.filter((e) => !e.devinee).length;
const deduites = emotions.length - declarees;
const palette = [...new Set(emotions.map((e) => e.emotion))].join(', ');
log.info(
  deduites === 0
    ? `Intonation : ${emotions.length} beats dictes par le script — ${palette}`
    : `Intonation : ${declarees} dicte(s) par le script, ${deduites} deduite(s) du texte — ${palette}`,
);

// ---------------------------------------------------------------------------
// 1. Voix off
// ---------------------------------------------------------------------------
const audioDir = ensureDir(p('public', 'audio'));
const audioFile = path.join(audioDir, `${slug}.mp3`);
let ttsAlignment = null;
let generatedLocally = false;
let voiceAttribution = null;

if (flags.audio) {
  // L'utilisateur fournit sa propre voix.
  const source = path.isAbsolute(flags.audio) ? flags.audio : p(flags.audio);
  if (!fs.existsSync(source)) fail(`Fichier audio introuvable : ${source}`);

  if (flags['sts-voice']) {
    // Speech-to-speech : on garde l'intonation, on plaque une autre voix.
    log.step('Speech-to-speech ElevenLabs');
    // Le cout suit la duree de l'audio, qui porte ce meme texte : les
    // caracteres du script en sont la meilleure estimation avant l'appel.
    let converted;
    try {
      converted = await withKey({
        needed: estimateCredits(voiceover),
        run: (apiKey) =>
          speechToSpeech({
            audioPath: source,
            voiceId: flags['sts-voice'],
            modelId: env.stsModelId,
            apiKey,
            removeBackgroundNoise: flags['sts-denoise'] !== false,
          }),
      });
    } catch (err) {
      fail(err.message);
    }
    fs.writeFileSync(audioFile, converted);
    log.ok(`Voix transformee ecrite : public/audio/${slug}.mp3`);
  } else if (path.resolve(source) !== path.resolve(audioFile)) {
    fs.copyFileSync(source, audioFile);
    log.ok(`Voix off fournie : ${path.basename(source)}`);
  } else {
    log.ok(`Voix off fournie : ${path.basename(source)}`);
  }
} else if (fs.existsSync(audioFile) && !flags['force-voice']) {
  log.ok(`Voix off deja generee (${path.basename(audioFile)}) — --force-voice pour refaire`);
} else {
  // Voix off generee. Trois moteurs : xtts (HD locale), piper (locale
  // commerciale), elevenlabs (cle). Defaut : elevenlabs si cle, sinon piper.
  const engine = ['xtts', 'piper', 'elevenlabs'].includes(flags.tts)
    ? flags.tts
    : hasElevenLabsKey()
      ? 'elevenlabs'
      : 'piper';

  if (engine === 'elevenlabs') {
    log.step('Synthese ElevenLabs');
    // Le quota de toutes les cles est verifie ici, AVANT le moindre appel
    // payant : soit la video passe en entier, soit rien n'est consomme.
    // Les balises d'intonation ne sont comprises que par eleven_v3. Le modele
    // du .env reste utilisable en le demandant explicitement (--model=), mais
    // il lirait les balises a voix haute : on lui envoie alors le texte nu.
    const modelId = flags.model || TAGGED_MODEL_ID;
    const tagged = modelId === TAGGED_MODEL_ID;

    let result;
    try {
      result = await synthesizeVoice({
        text: tagged ? voiceoverTagged : voiceover,
        voiceId: flags.voice || script.voice_id || env.voiceId,
        modelId,
        // v3 suit d'autant mieux les balises que la voix n'est pas verrouillee.
        voiceSettings: tagged
          ? {stability: Number(env.v3Stability), similarity_boost: 0.8}
          : undefined,
      });
    } catch (err) {
      // Quota insuffisant ou cle morte : message lisible, pas de trace.
      fail(err.message);
    }
    fs.writeFileSync(audioFile, result.audio);
    // Les balises figurent dans l'alignement renvoye : sans ce nettoyage,
    // « [sad] » deviendrait un mot de sous-titre.
    ttsAlignment = tagged ? stripTagsFromAlignment(result.alignment) : result.alignment;
    log.ok(`Voix off ecrite : public/audio/${slug}.mp3`);
  } else if (engine === 'xtts') {
    log.step('Synthese vocale locale HD (XTTS-v2, GPU)');
    // Clonage : --xtts-clone=<echantillon.wav|mp3> porte le chemin de reference.
    let cloneWav = null;
    if (typeof flags['xtts-clone'] === 'string' && flags['xtts-clone']) {
      cloneWav = path.isAbsolute(flags['xtts-clone'])
        ? flags['xtts-clone']
        : p(flags['xtts-clone']);
      if (!fs.existsSync(cloneWav)) fail(`Echantillon de voix introuvable : ${cloneWav}`);
    }
    const result = await synthesizeWithXtts({
      text: voiceover,
      speakerId: flags['tts-voice'] || env.xttsVoice,
      cloneWav,
      outMp3: audioFile,
    });
    generatedLocally = true;
    voiceAttribution = result.attribution;
    log.ok(`Voix off ecrite : public/audio/${slug}.mp3 (${result.license})`);
  } else {
    log.step('Synthese vocale locale (Piper, sans cle)');
    const result = await synthesizeToMp3({
      text: voiceover,
      voiceId: flags['tts-voice'] || env.piperVoice,
      outMp3: audioFile,
    });
    generatedLocally = true;
    voiceAttribution = result.attribution;
    log.ok(`Voix off ecrite : public/audio/${slug}.mp3 (${result.license})`);
  }
}

// La voix est le premier gros temps d'attente : la barre doit l'acter.
progress('build', 20);

// ---------------------------------------------------------------------------
// 2. Alignement mot a mot
// ---------------------------------------------------------------------------
const outDir = ensureDir(p('out'));
const alignmentCache = path.join(outDir, `${slug}.alignment.json`);

const md5 = (data) => crypto.createHash('md5').update(data).digest('hex');
// L'alignement n'est valable que pour un couple (audio, texte) donne.
const fingerprint = {
  audioHash: md5(fs.readFileSync(audioFile)),
  textHash: md5(Buffer.from(voiceover, 'utf8')),
};

let words;

if (ttsAlignment) {
  words = wordsFromCharacterAlignment(ttsAlignment);
  writeJson(alignmentCache, {source: 'tts', ...fingerprint, words});
  log.ok(`${words.length} mots alignes (timestamps ElevenLabs)`);
} else {
  const cached = fs.existsSync(alignmentCache) ? readJson(alignmentCache) : null;
  const stale =
    cached &&
    (cached.audioHash !== fingerprint.audioHash ||
      cached.textHash !== fingerprint.textHash);

  if (cached && !stale && !flags['force-align']) {
    words = cached.words;
    log.ok(`${words.length} mots alignes (cache) — --force-align pour relancer`);
  } else {
    if (stale) log.info('Audio ou texte modifie depuis le dernier alignement');

    // Deux methodes de calage des sous-titres sur une voix fournie :
    //   - whisper (defaut) : transcription locale, AUCUNE cle, gratuit.
    //   - elevenlabs : forced alignment sur le texte exact du script, cle requise.
    let method =
      flags.align === 'elevenlabs'
        ? 'elevenlabs'
        : flags.align === 'whisper'
          ? 'whisper'
          : hasElevenLabsKey()
            ? 'elevenlabs'
            : 'whisper';

    if (method === 'elevenlabs') {
      log.step('Forced alignment ElevenLabs');
      try {
        // L'alignement ne consomme pas de credits : n'importe quelle cle encore
        // vivante fait l'affaire, d'ou le besoin minimal.
        const json = await withKey({
          needed: 1,
          quiet: true,
          // Aucun son n'est produit ici : la licence commerciale n'entre pas en
          // jeu, n'importe quel compte fait l'affaire.
          licensed: false,
          run: (apiKey) => forcedAlignment({audioPath: audioFile, text: voiceover, apiKey}),
        });
        words = wordsFromForcedAlignment(json);
        writeJson(alignmentCache, {source: 'forced-alignment', loss: json.loss, ...fingerprint, words});
        log.ok(`${words.length} mots alignes sur l'audio fourni (ElevenLabs)`);
      } catch (err) {
        // Demande explicite : on ne substitue rien en douce.
        if (flags.align === 'elevenlabs') fail(err.message);
        // Sinon le calage local fait le meme travail, sans cle et sans credit.
        log.warn(`ElevenLabs indisponible pour l'alignement (${err.message.split('\n')[0]})`);
        method = 'whisper';
      }
    }

    if (method === 'whisper') {
      if (generatedLocally) {
        // On connait le texte exact : sous-titres = texte du script, timing Whisper.
        log.step('Calage local des sous-titres (whisper.cpp)');
        words = await alignKnownText({
          audioPath: audioFile,
          text: voiceover,
          model: flags['whisper-model'] || env.whisperModel,
          language: flags['whisper-lang'] || 'fr',
        });
        writeJson(alignmentCache, {source: 'whisper-known', ...fingerprint, words});
        log.ok(`${words.length} mots cales sur le texte du script`);
      } else {
        log.step('Transcription locale (whisper.cpp, sans cle)');
        words = await alignWithWhisper({
          audioPath: audioFile,
          model: flags['whisper-model'] || env.whisperModel,
          language: flags['whisper-lang'] || 'fr',
        });
        writeJson(alignmentCache, {source: 'whisper', ...fingerprint, words});
        log.ok(`${words.length} mots transcrits et alignes en local`);
      }
    }
  }
}

if (words.length === 0) fail("Aucun mot aligne — l'audio ou le texte est vide.");

progress('build', 33);

const lastEnd = words[words.length - 1].end;
const durationInFrames = Math.ceil((lastEnd + TAIL_SECONDS) * FPS);
log.info(`Duree : ${(lastEnd + TAIL_SECONDS).toFixed(1)}s (${durationInFrames} frames)`);

// ---------------------------------------------------------------------------
// 3. Decoupage des beats sur la timeline
// ---------------------------------------------------------------------------
const timeline = mapBeatsToTimeline(script.beats, words);

// ---------------------------------------------------------------------------
// 4. Visuels Pexels
// ---------------------------------------------------------------------------
const imageDir = ensureDir(p('public', 'images', slug));
const videoDir = ensureDir(p('public', 'videos', slug));
const usedIds = new Set();
const plan = [];

for (const [index, beat] of script.beats.entries()) {
  const {startMs, endMs} = timeline[index];
  plan.push({index, beat, startMs, endMs});
}

if (flags['no-media']) {
  log.warn('Pexels saute (--no-media) : reutilisation des fichiers deja presents');
} else {
  log.step(`Recherche Pexels (${mediaType}) pour ${plan.length} beats`);
  const apiKey = requireEnv('pexelsKey', 'PEXELS_API_KEY');

  // Marge au-dela du format video : le zoom Ken Burns ne doit jamais
  // reveler de bord ni faire apparaitre de pixellisation.
  const [photoWidth, photoHeight] = format === 'long' ? [2560, 1440] : [1440, 2560];
  const [videoWidth, videoHeight] = format === 'long' ? [1920, 1080] : [1080, 1920];

  let videoCount = 0;
  let photoCount = 0;

  for (const [rang, item] of plan.entries()) {
    const query = item.beat.visual_query;

    // En mode mixte la video prime : elle porte deja du mouvement, ce qui
    // rend le montage nettement plus vivant qu'un fondu de photos. On ne
    // retombe sur la photo que si la banque ne rend rien d'exploitable.
    //
    // Le premier beat est l'accroche : il doit arreter un pouce qui defile.
    // Une image fixe n'y suffit pas, on cherche donc toujours une video pour
    // lui, meme quand toute la video est montee en photos.
    const estAccroche = rang === 0;
    let candidates = [];
    if (mediaType !== 'photo' || estAccroche) {
      try {
        candidates = await searchVideos({
          query,
          orientation,
          apiKey,
          targetWidth: videoWidth,
          targetHeight: videoHeight,
          minDuration: MIN_CLIP_SECONDS,
        });
      } catch (err) {
        log.warn(`Recherche video impossible pour « ${query} » : ${err.message}`);
      }
    }

    if (candidates.length === 0 && mediaType !== 'video') {
      candidates = await searchPhotos({
        query,
        orientation,
        apiKey,
        targetWidth: photoWidth,
        targetHeight: photoHeight,
      });
    }

    if (candidates.length === 0) {
      log.warn(`Aucun resultat Pexels pour « ${query} »`);
      item.files = [];
      continue;
    }

    const isVideo = candidates[0].kind === 'video';

    // Une video tient plus longtemps a l'ecran qu'une photo fixe, mais un
    // plan ne peut pas depasser la duree du clip source : Remotion ne sait
    // pas boucler une video ici. On ajoute donc des plans au besoin.
    const perVisual = isVideo ? SECONDS_PER_VIDEO : SECONDS_PER_PHOTO;
    const shortest = isVideo
      ? Math.min(...candidates.slice(0, 6).map((c) => c.duration || perVisual))
      : perVisual;
    const usable = isVideo ? Math.max(shortest - CLIP_HEAD_SECONDS, 2) : perVisual;
    const seconds = Math.max((item.endMs - item.startMs) / 1000, 0.5);
    const count = Math.max(1, Math.ceil(seconds / Math.min(perVisual, usable)));

    const picked = [];
    for (const candidate of candidates) {
      if (picked.length >= count) break;
      if (usedIds.has(candidate.id)) continue;
      usedIds.add(candidate.id);
      picked.push(candidate);
    }
    // Si tout est deja pris, on autorise la reutilisation plutot que du vide.
    while (picked.length < count && candidates.length > 0) {
      picked.push(candidates[picked.length % candidates.length]);
    }

    item.files = [];
    for (const [i, candidate] of picked.entries()) {
      const ext = candidate.kind === 'video' ? 'mp4' : 'jpg';
      const name = `${String(item.index + 1).padStart(2, '0')}-${i + 1}-${candidate.id}.${ext}`;
      const dir = candidate.kind === 'video' ? videoDir : imageDir;
      await download(candidate.url, path.join(dir, name));
      item.files.push({
        name,
        kind: candidate.kind,
        credit: candidate.credit,
        duration: candidate.duration ?? 0,
      });
      if (candidate.kind === 'video') videoCount++;
      else photoCount++;
    }
    log.ok(
      `Beat ${item.index + 1} (${isVideo ? 'video' : 'photo'}) « ${query} » : ${item.files.length} plan(s)`,
    );
    // Les visuels sont le gros de la preparation : ils portent la barre.
    progress('build', 35 + (60 * (rang + 1)) / plan.length);
  }

  log.info(`Visuels retenus : ${videoCount} video(s), ${photoCount} photo(s)`);
}

// Reprend ce qui est sur le disque si Pexels a ete saute ou a echoue.
for (const item of plan) {
  if (item.files && item.files.length > 0) continue;
  const prefix = `${String(item.index + 1).padStart(2, '0')}-`;
  const scan = (dir, kind) =>
    (fs.existsSync(dir) ? fs.readdirSync(dir) : [])
      .filter((f) => f.startsWith(prefix))
      .sort()
      .map((name) => ({name, kind, credit: undefined, duration: 0}));

  item.files = [...scan(videoDir, 'video'), ...scan(imageDir, 'photo')];
}

// ---------------------------------------------------------------------------
// 5. Scenes + mouvements de camera
// ---------------------------------------------------------------------------
const scenes = [];
const totalScenes = plan.reduce((sum, item) => sum + item.files.length, 0);
let sceneIndex = 0;

for (const item of plan) {
  if (item.files.length === 0) continue;

  const startFrame = Math.round((item.startMs / 1000) * FPS);
  const endFrame = Math.round((item.endMs / 1000) * FPS);
  const span = Math.max(endFrame - startFrame, FPS);
  const slot = span / item.files.length;

  for (const [i, file] of item.files.entries()) {
    const rand = seeded(sceneIndex + 1);

    // « Le courant » (motion-doctrine HyperFrames) : un film choisit UNE
    // direction dominante et s'y tient. Seule l'amplitude varie d'un plan a
    // l'autre — jamais la direction, sinon les plans alternent avant/arriere
    // et l'alternance se lit comme une erreur de montage.
    const isVideoScene = file.kind === 'video';

    // Une video bouge deja : un Ken Burns appuye par-dessus donne le mal de
    // mer. On garde le meme sens que les photos, mais discret.
    const amplitude = isVideoScene ? 0.03 + rand() * 0.03 : 0.08 + rand() * 0.08;
    const driftX = (isVideoScene ? 0.4 : 1.2) + rand() * (isVideoScene ? 0.4 : 1.0);
    const driftY = (isVideoScene ? 0.15 : 0.4) + rand() * (isVideoScene ? 0.25 : 0.6);
    const baseZoom = isVideoScene ? 1.04 : 1.1;

    // Vecteur reserve : le dernier plan recule au lieu d'avancer. Un
    // travelling arriere signifie « quelque chose de plus grand arrive » —
    // c'est exactement la chute du script.
    const isClosing = sceneIndex === totalScenes - 1;

    const rawFrom = Math.round(startFrame + i * slot);
    const isFirstScene = sceneIndex === 0;
    const from = isFirstScene ? 0 : Math.max(0, rawFrom - CROSSFADE_FRAMES);

    const folder = isVideoScene ? 'videos' : 'images';

    scenes.push({
      src: `${folder}/${slug}/${file.name}`.replace(/\\/g, '/'),
      type: isVideoScene ? 'video' : 'image',
      from,
      // Ajustee juste apres : chaque plan doit tenir jusqu'a ce que
      // le suivant soit entierement apparu.
      durationInFrames: 0,
      zoomFrom: isClosing ? baseZoom + amplitude : baseZoom,
      zoomTo: isClosing ? baseZoom : baseZoom + amplitude,
      panXFrom: driftX,
      panXTo: -driftX,
      panYFrom: driftY,
      panYTo: -driftY,
      // On saute le debut du clip, souvent fige, et on retient sa duree
      // pour borner le plan juste apres.
      trimBefore: isVideoScene ? Math.round(CLIP_HEAD_SECONDS * FPS) : 0,
      maxFrames: isVideoScene && file.duration
        ? Math.max(Math.floor((file.duration - CLIP_HEAD_SECONDS) * FPS), FPS)
        : Infinity,
      ...(file.credit ? {credit: file.credit} : {}),
    });
    sceneIndex++;
  }
}

// Chaque plan doit rester visible pendant tout le fondu du plan suivant,
// sinon le fond apparait une fraction de seconde entre les deux.
let clamped = 0;
for (const [i, scene] of scenes.entries()) {
  const next = scenes[i + 1];
  const end = next ? next.from + CROSSFADE_FRAMES : durationInFrames;
  let needed = Math.max(end - scene.from, FPS);

  // Un plan video ne peut pas depasser la duree de son clip source.
  if (Number.isFinite(scene.maxFrames) && needed > scene.maxFrames) {
    // On recupere d'abord les frames sautees en tete de clip.
    const recovered = Math.min(scene.trimBefore, needed - scene.maxFrames);
    scene.trimBefore -= recovered;
    scene.maxFrames += recovered;

    if (needed > scene.maxFrames) {
      needed = scene.maxFrames;
      clamped++;
    }
  }

  scene.durationInFrames = needed;
}

// `maxFrames` sert au calcul, ce n'est pas une propriete de composition.
for (const scene of scenes) delete scene.maxFrames;

if (clamped > 0) {
  log.warn(`${clamped} plan(s) video plus courts que leur creneau : clip source trop bref`);
}

const videoScenes = scenes.filter((s) => s.type === 'video').length;
log.ok(`${scenes.length} plans construits (${videoScenes} video, ${scenes.length - videoScenes} photo)`);

// ---------------------------------------------------------------------------
// 6. Sous-titres
// ---------------------------------------------------------------------------
const pages = buildPages(
  words,
  format === 'long'
    ? {maxWords: 6, maxChars: 46, maxDurationMs: 2600}
    : {maxWords: 3, maxChars: 24, maxDurationMs: 1800},
);
log.ok(`${pages.length} pages de sous-titres`);

// ---------------------------------------------------------------------------
// 7. Musique
// ---------------------------------------------------------------------------
const musicDir = ensureDir(p('public', 'music'));
const localTracks = () =>
  fs.readdirSync(musicDir).filter((f) => /\.(mp3|wav|m4a|aac)$/i.test(f)).sort();

let musicSrc = null;
let musicAttribution = null;

if (flags.music === false || flags['no-music']) {
  log.info('Production sans fond musical (demande explicitement)');
} else if (flags.music) {
  if (!fs.existsSync(path.join(musicDir, flags.music))) {
    fail(`Musique introuvable dans public/music : ${flags.music}`);
  }
  musicSrc = `music/${flags.music}`;
} else if (flags['music-mood']) {
  // Pexels n'a pas d'API audio : la source automatique est Jamendo,
  // filtree sur les licences utilisables sur une chaine monetisee.
  log.step(`Recherche d'une musique « ${flags['music-mood']} »`);
  const provider = flags['music-provider'] === 'jamendo' ? 'jamendo' : 'openverse';
  const clientId = provider === 'jamendo' ? requireEnv('jamendoClientId', 'JAMENDO_CLIENT_ID') : '';
  const tracks = await searchMusic({provider, clientId, mood: flags['music-mood'], limit: 10});
  if (tracks.length === 0) {
    log.warn('Aucune piste trouvee pour cette ambiance');
  } else {
    const file = await downloadTrack(tracks[0], musicDir);
    musicSrc = `music/${path.basename(file)}`;
    musicAttribution = tracks[0].attribution;
    log.ok(`Musique : ${tracks[0].name} par ${tracks[0].artist} (${tracks[0].license})`);
  }
} else {
  const found = localTracks();
  if (found.length > 0) musicSrc = `music/${found[0]}`;
}

if (musicSrc) {
  // L'attribution des pistes deposees a la main est lue a cote du fichier.
  if (!musicAttribution) {
    const licenceFile = p('public', `${musicSrc}.licence.txt`);
    if (fs.existsSync(licenceFile)) {
      musicAttribution = fs.readFileSync(licenceFile, 'utf8').split('\n')[0].trim();
    }
  }
  log.ok(`Musique : ${musicSrc}`);
} else if (!flags['no-music'] && flags.music !== false) {
  log.warn('Aucune musique dans public/music : la video sortira sans fond musical');
}

// ---------------------------------------------------------------------------
// 8. Ecriture des props
// ---------------------------------------------------------------------------
const props = {
  title: script.title ?? slug,
  hook: script.hook ?? '',
  audioSrc: `audio/${slug}.mp3`,
  musicSrc,
  musicVolume: Number(flags['music-volume'] ?? script.music_volume ?? 0.1),
  voiceVolume: 1,
  captionPages: pages,
  scenes,
  accent: script.accent ?? ACCENT,
  showProgress: format === 'short',
  showTitle: script.show_title !== false,
  durationInFrames,
};

writeJson(p('src', 'props', 'current.json'), props);
writeJson(path.join(outDir, `${slug}.${format}.props.json`), props);

progress('build', 100);
log.step('Termine');
log.info(`Props   : out/${slug}.${format}.props.json`);
log.info(`Preview : npm run studio`);
log.info(`Rendu   : npm run render -- ${slug} --format=${format}`);

writeJson(path.join(outDir, `${slug}.meta.json`), {
  slug,
  format,
  mediaType,
  title: script.title,
  youtube: script.youtube ?? null,
  durationSeconds: Number((durationInFrames / FPS).toFixed(2)),
  shots: {
    total: scenes.length,
    video: videoScenes,
    photo: scenes.length - videoScenes,
  },
  credits: [...new Set(scenes.map((s) => s.credit).filter(Boolean))],
  // A coller en fin de description YouTube : les licences CC-BY l'exigent.
  musicAttribution,
  voiceAttribution,
});
