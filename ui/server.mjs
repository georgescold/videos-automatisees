/**
 * Interface web locale de la chaine.
 *
 *   npm run ui            (http://127.0.0.1:4400)
 *   npm run ui -- --port=5000
 *
 * Serveur HTTP natif : aucune dependance en plus de celles de Remotion.
 * N'ecoute que sur la boucle locale.
 */
import {spawn} from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import {RenderInternals} from '@remotion/renderer';
import {downloadTrack, MOODS, PROVIDERS, searchMusic} from '../pipeline/lib/music.mjs';
import {
  addElevenLabsKey,
  elevenLabsKeys,
  hasElevenLabsKey,
  publicKeys,
  removeElevenLabsKey,
  renameElevenLabsKey,
  setEnvKey,
} from '../pipeline/lib/keys.mjs';
import {getQuota} from '../pipeline/lib/elevenlabs.mjs';
import {
  EMOTIONS,
  resolveEmotions,
  TAGGED_MODEL_ID,
  taggedVoiceover,
} from '../pipeline/lib/emotions.mjs';
import {checkQuota, estimateCredits, quotaSnapshot, withKey} from '../pipeline/lib/elevenlabs-pool.mjs';
import {curatedInfo, CURATED_IDS, CURATED_VOICES} from '../pipeline/lib/voices-amour.mjs';
import {remapBeats, segmentScript} from '../pipeline/lib/segment.mjs';
import {ensureDir, p, parseArgs, readJson, slugify} from '../pipeline/lib/utils.mjs';
import {isWhisperInstalled} from '../pipeline/lib/whisper.mjs';
import {VOICES as PIPER_VOICES} from '../pipeline/lib/piper.mjs';
import {isXttsInstalled, XTTS_SPEAKERS} from '../pipeline/lib/xtts.mjs';

const whisperReady = () => {
  try {
    return isWhisperInstalled('base');
  } catch {
    return false;
  }
};

const piperVoiceList = () =>
  Object.entries(PIPER_VOICES).map(([id, v]) => ({
    id,
    label: v.label,
    gender: v.gender,
    license: v.license,
  }));

const xttsReady = () => {
  try {
    return isXttsInstalled();
  } catch {
    return false;
  }
};

const xttsVoiceList = () =>
  Object.entries(XTTS_SPEAKERS).map(([id, v]) => ({id, label: v.label, gender: v.gender}));

const {flags} = parseArgs(process.argv.slice(2));
const PORT = Number(flags.port ?? 4400);
const UI_DIR = p('ui');

const AUDIO_EXTS = ['mp3', 'wav', 'm4a', 'aac', 'ogg', 'webm'];

/** Fichiers bruts possibles pour la voix d'un slug (extensions variees). */
const rawVoiceCandidates = (slug) =>
  AUDIO_EXTS.map((ext) => p('public', 'audio', `${slug}.src.${ext}`));

const rawVoiceFile = (slug) => rawVoiceCandidates(slug).find((f) => fs.existsSync(f)) ?? null;

const ffmpegPath = () =>
  RenderInternals.getExecutablePath({
    indent: false,
    logLevel: 'error',
    type: 'ffmpeg',
    binariesDirectory: null,
  });

/** Normalise n'importe quel audio fourni en mp3, via le ffmpeg de Remotion. */
const transcodeToMp3 = (input, output) =>
  new Promise((resolve, reject) => {
    const child = spawn(
      ffmpegPath(),
      ['-y', '-i', input, '-codec:a', 'libmp3lame', '-q:a', '4', output],
      {windowsHide: true},
    );
    let err = '';
    child.stderr.on('data', (d) => (err += d.toString()));
    child.on('error', reject);
    child.on('close', (code) =>
      code === 0 ? resolve(output) : reject(new Error(`Conversion audio echouee : ${err.slice(-200)}`)),
    );
  });

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.mp4': 'video/mp4',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.m4a': 'audio/mp4',
  '.aac': 'audio/aac',
  '.svg': 'image/svg+xml',
};

const ANSI = /\[[0-9;]*m/g;
const SLUG_OK = /^[a-z0-9-]{1,70}$/;

const json = (res, code, data) => {
  const body = JSON.stringify(data);
  res.writeHead(code, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
  });
  res.end(body);
};

const readBody = (req) =>
  new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      // Garde-fou : un upload audio raisonnable depasse rarement 200 Mo.
      if (size > 200 * 1024 * 1024) {
        reject(new Error('Fichier trop volumineux (200 Mo maximum)'));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });

// ---------------------------------------------------------------------------
// Etat des jobs de production
// ---------------------------------------------------------------------------
const jobs = new Map();
let jobSeq = 0;

const broadcast = (job, event) => {
  job.lines.push(event);
  for (const client of job.clients) {
    client.write(`data: ${JSON.stringify(event)}\n\n`);
  }
};

const runStep = (job, script, args) =>
  new Promise((resolve) => {
    const child = spawn(process.execPath, [p('pipeline', script), ...args], {
      cwd: p('.'),
      windowsHide: true,
    });
    job.child = child;

    const emit = (buf) => {
      for (const line of buf.toString('utf8').split(/\r?\n/)) {
        const clean = line.replace(ANSI, '').trimEnd();
        if (clean.length === 0) continue;

        // Ligne de progression : destinee a la barre, jamais a la console.
        const mesure = clean.match(/^##progress (build|render) (\d+)$/);
        if (mesure) {
          job.progress = {phase: mesure[1], percent: Number(mesure[2])};
          broadcast(job, {type: 'progress', ...job.progress});
          continue;
        }

        broadcast(job, {type: 'log', text: clean});
      }
    };

    child.stdout.on('data', emit);
    child.stderr.on('data', emit);
    child.on('error', (err) => {
      broadcast(job, {type: 'log', text: `Echec du lancement : ${err.message}`});
      resolve(1);
    });
    child.on('close', (code) => {
      job.child = null;
      resolve(code ?? 1);
    });
  });

const startJob = async (job) => {
  const buildArgs = [
    `scripts/${job.slug}.json`,
    `--format=${job.format}`,
    `--media=${job.mediaType}`,
    `--music-volume=${job.musicVolume}`,
  ];
  if (job.music) buildArgs.push(`--music=${job.music}`);
  else buildArgs.push('--no-music');
  // Moteur de voix off generee : Piper / XTTS (local) ou ElevenLabs.
  if (job.ttsEngine === 'piper') {
    buildArgs.push('--tts=piper');
    if (job.ttsVoice) buildArgs.push(`--tts-voice=${job.ttsVoice}`);
  } else if (job.ttsEngine === 'xtts') {
    buildArgs.push('--tts=xtts');
    if (job.ttsVoice) buildArgs.push(`--tts-voice=${job.ttsVoice}`);
    // Clonage : l'echantillon de voix depose sert de reference (chemin en valeur).
    if (job.xttsClone) {
      const raw = rawVoiceFile(job.slug);
      if (raw) buildArgs.push(`--xtts-clone=${raw}`);
    }
  } else if (job.ttsEngine === 'elevenlabs') {
    buildArgs.push('--tts=elevenlabs');
    if (job.voiceId) buildArgs.push(`--voice=${job.voiceId}`);
  }
  if (job.forceVoice) buildArgs.push('--force-voice');
  if (job.noMedia) buildArgs.push('--no-media');
  if (job.align) buildArgs.push(`--align=${job.align}`);

  // Speech-to-speech : on repart du fichier brut de l'utilisateur pour rester
  // rejouable, et build.mjs ecrit la voix transformee dans <slug>.mp3.
  if (job.stsVoice) {
    const raw = rawVoiceFile(job.slug);
    if (raw) {
      buildArgs.push(`--audio=${raw}`, `--sts-voice=${job.stsVoice}`);
    }
  }

  broadcast(job, {type: 'phase', phase: 'build'});
  const buildCode = await runStep(job, 'build.mjs', buildArgs);

  if (job.stopped) {
    job.status = 'stopped';
    broadcast(job, {type: 'end', status: 'stopped'});
    return;
  }
  if (buildCode !== 0) {
    job.status = 'error';
    broadcast(job, {type: 'end', status: 'error', step: 'build'});
    return;
  }

  if (job.buildOnly) {
    job.status = 'done';
    broadcast(job, {type: 'end', status: 'done', buildOnly: true});
    return;
  }

  broadcast(job, {type: 'phase', phase: 'render'});
  const renderCode = await runStep(job, 'render.mjs', [
    job.slug,
    `--format=${job.format}`,
  ]);

  if (job.stopped) {
    job.status = 'stopped';
    broadcast(job, {type: 'end', status: 'stopped'});
    return;
  }
  if (renderCode !== 0) {
    job.status = 'error';
    broadcast(job, {type: 'end', status: 'error', step: 'render'});
    return;
  }

  job.status = 'done';
  job.output = `${job.slug}.${job.format}.mp4`;
  broadcast(job, {type: 'end', status: 'done', output: job.output});
};

// ---------------------------------------------------------------------------
// Lecture de l'etat du projet
// ---------------------------------------------------------------------------
const listScripts = () => {
  const dir = ensureDir(p('scripts'));
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .map((f) => {
      const slug = f.replace(/\.json$/, '');
      try {
        const data = readJson(path.join(dir, f));
        const beats = Array.isArray(data.beats) ? data.beats : [];
        const words = beats
          .map((b) => String(b.text ?? '').trim())
          .join(' ')
          .split(/\s+/)
          .filter(Boolean).length;
        return {
          slug,
          title: data.title ?? slug,
          beats: beats.length,
          words,
          estimatedSeconds: Math.round(words / 2.5),
          hasAudio: fs.existsSync(p('public', 'audio', `${slug}.mp3`)),
          hasRawVoice: Boolean(rawVoiceFile(slug)),
          renders: ['short', 'long']
            .filter((f2) => fs.existsSync(p('out', `${slug}.${f2}.mp4`)))
            .map((f2) => `${slug}.${f2}.mp4`),
        };
      } catch (err) {
        return {slug, title: slug, error: `JSON invalide : ${err.message}`};
      }
    })
    .sort((a, b) => a.slug.localeCompare(b.slug));
};

const projectStatus = () => {
  const envFile = p('.env');
  const env = {};
  if (fs.existsSync(envFile)) {
    for (const line of fs.readFileSync(envFile, 'utf8').split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Z_]+)\s*=\s*(.*)$/);
      if (m) env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '');
    }
  }
  const musicDir = ensureDir(p('public', 'music'));
  const music = fs
    .readdirSync(musicDir)
    .filter((f) => /\.(mp3|wav|m4a|aac)$/i.test(f))
    .sort()
    .map((file) => {
      const licence = path.join(musicDir, `${file}.licence.txt`);
      return {
        file,
        attribution: fs.existsSync(licence)
          ? fs.readFileSync(licence, 'utf8').split('\n')[0].trim()
          : null,
      };
    });

  return {
    envFile: fs.existsSync(envFile),
    // Les cles ElevenLabs vivent dans le trousseau (.keys.json), pas dans .env :
    // plusieurs comptes gratuits = plusieurs quotas, cf. pipeline/lib/keys.mjs.
    elevenLabs: hasElevenLabsKey(),
    elevenLabsKeys: publicKeys().length,
    // Un compte payant ouvre toute la bibliotheque de voix et accorde la
    // licence commerciale : l'interface n'a plus a barrer quoi que ce soit.
    elevenLabsPaid: publicKeys().some((k) => k.quota?.tier && k.quota.tier !== 'free'),
    pexels: Boolean(env.PEXELS_API_KEY),
    // Openverse ne demande aucune cle : la musique marche toujours.
    jamendo: Boolean(env.JAMENDO_CLIENT_ID),
    // Alignement local des sous-titres : aucune cle. Le modele se telecharge
    // au premier usage si besoin.
    whisper: whisperReady(),
    // Voix off generee en local (Piper) : marche sans cle. Voix CC-BY.
    piperVoices: piperVoiceList(),
    // Voix off HD locale (XTTS-v2, GPU). Licence non commerciale.
    xtts: xttsReady(),
    xttsVoices: xttsVoiceList(),
    voiceId: env.ELEVENLABS_VOICE_ID ?? '',
    // Vocabulaire d'intonation propose beat par beat dans l'editeur.
    emotions: Object.entries(EMOTIONS).map(([id, e]) => ({id, label: e.label, tag: e.tag})),
    music,
    moods: Object.keys(MOODS),
    providers: Object.entries(PROVIDERS).map(([id, meta]) => ({
      id,
      label: meta.label,
      available: !meta.needsKey || Boolean(env.JAMENDO_CLIENT_ID),
    })),
    busy: [...jobs.values()].some((j) => j.status === 'running'),
  };
};

/**
 * Le trousseau vu par l'interface : jamais la cle en clair, seulement son
 * masque, son quota et l'erreur eventuelle. `refresh` interroge ElevenLabs ;
 * sans lui, on rend le dernier quota connu (affichage instantane).
 */
const keysPayload = async ({refresh = false} = {}) => {
  const stored = publicKeys();
  let entries = stored.map(({quota, ...rest}) => ({
    ...rest,
    remaining: quota?.remaining ?? null,
    limit: quota?.limit ?? null,
    used: quota?.used ?? null,
    tier: quota?.tier ?? null,
    resetUnix: quota?.resetUnix ?? null,
    checkedAt: quota?.checkedAt ?? null,
    error: null,
  }));

  if (refresh && entries.length > 0) {
    const snapshot = await quotaSnapshot();
    entries = entries.map((entry) => {
      const live = snapshot.find((s) => s.id === entry.id);
      return live ? {...entry, ...live, checkedAt: new Date().toISOString()} : entry;
    });
  }

  return {
    keys: entries,
    total: entries.reduce((sum, e) => sum + (e.error ? 0 : (e.remaining ?? 0)), 0),
    checked: refresh,
  };
};

// ---------------------------------------------------------------------------
// Catalogue de voix
// ---------------------------------------------------------------------------
const VOICE_TTL_MS = 10 * 60 * 1000;
const voiceCache = new Map();

/** Un extrait court de la voix, sur le texte de l'utilisateur. */
const ttsSample = async ({text, voiceId, apiKey, stability}) => {
  const r = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`, {
    method: 'POST',
    headers: {'xi-api-key': apiKey, 'content-type': 'application/json'},
    body: JSON.stringify({
      text,
      model_id: TAGGED_MODEL_ID,
      voice_settings: {stability, similarity_boost: 0.8},
    }),
  });
  if (!r.ok) {
    const body = await r.text();
    throw Object.assign(new Error(`ElevenLabs ${r.status} — ${body}`), {
      status: r.status,
      libraryVoice: /paid_plan_required|library voices/i.test(body),
    });
  }
  return Buffer.from(await r.arrayBuffer());
};

const normalizeVoice = (v, source) => ({
  id: v.voice_id,
  name: v.name,
  source,
  language: v.language ?? v.labels?.language ?? null,
  gender: v.gender ?? v.labels?.gender ?? null,
  age: v.age ?? v.labels?.age ?? null,
  accent: v.accent ?? v.labels?.accent ?? null,
  descriptive: v.descriptive ?? v.labels?.descriptive ?? null,
  useCase: v.use_case ?? v.labels?.use_case ?? null,
  preview: v.preview_url ?? null,
  // Le palier gratuit refuse tout ce qui n'est pas une voix maison.
  requiresPaid: source === 'bibliothèque' || (v.category ?? 'premade') !== 'premade',
});

/**
 * Les voix du compte PLUS la bibliotheque publique, dans une seule liste.
 * La bibliotheque compte des centaines de voix par langue : c'est la que se
 * trouvent les vraies voix francaises.
 */
const voiceCatalogue = async ({key, language}) => {
  const cached = voiceCache.get(language);
  if (cached && Date.now() - cached.at < VOICE_TTL_MS) return cached.data;

  const headers = {'xi-api-key': key};
  const voices = [];
  const seen = new Set();

  const push = (list, source) => {
    for (const v of list) {
      if (!v?.voice_id || seen.has(v.voice_id)) continue;
      seen.add(v.voice_id);
      voices.push(normalizeVoice(v, source));
    }
  };

  const own = await fetch('https://api.elevenlabs.io/v1/voices', {headers});
  if (!own.ok) throw new Error(`ElevenLabs ${own.status}`);
  push((await own.json()).voices ?? [], 'compte');

  // Trois pages suffisent a couvrir largement une langue.
  for (let page = 0; page < 3; page++) {
    const u = new URL('https://api.elevenlabs.io/v1/shared-voices');
    u.searchParams.set('page_size', '100');
    u.searchParams.set('page', String(page));
    if (language !== 'all') u.searchParams.set('language', language);
    const r = await fetch(u, {headers});
    if (!r.ok) break;
    const data = await r.json();
    push(data.voices ?? [], 'bibliothèque');
    if (!data.has_more) break;
  }

  // Les voix de la langue demandee d'abord : sur une chaine francaise, les
  // voix maison anglaises n'ont rien a faire en tete de liste.
  if (language !== 'all') {
    voices.sort((a, b) => (b.language === language ? 1 : 0) - (a.language === language ? 1 : 0));
  }

  voiceCache.set(language, {at: Date.now(), data: voices});
  return voices;
};

/**
 * Une cle utilisable pour un appel de lecture (liste des voix) : la premiere
 * du trousseau qui a encore du quota, sinon la premiere tout court.
 */
const elevenLabsKey = () => {
  const keys = elevenLabsKeys();
  const alive = keys.find((k) => (k.quota?.remaining ?? 1) > 0);
  return (alive ?? keys[0])?.key ?? '';
};

const jamendoClientId = () => {
  const envFile = p('.env');
  if (!fs.existsSync(envFile)) return '';
  const match = fs.readFileSync(envFile, 'utf8').match(/^\s*JAMENDO_CLIENT_ID\s*=\s*(.*)$/m);
  return match ? match[1].trim().replace(/^["']|["']$/g, '') : '';
};

// ---------------------------------------------------------------------------
// Fichiers statiques + medias
// ---------------------------------------------------------------------------
const serveStatic = (res, file) => {
  if (!fs.existsSync(file)) {
    res.writeHead(404).end('Introuvable');
    return;
  }
  res.writeHead(200, {
    'content-type': MIME[path.extname(file)] ?? 'application/octet-stream',
    'cache-control': 'no-store',
  });
  fs.createReadStream(file).pipe(res);
};

/** Sert un media avec support du Range, sinon le lecteur ne peut pas se deplacer. */
const serveMedia = (req, res, file) => {
  if (!fs.existsSync(file)) {
    res.writeHead(404).end('Introuvable');
    return;
  }
  const type = MIME[path.extname(file).toLowerCase()] ?? 'application/octet-stream';
  const {size} = fs.statSync(file);
  const range = req.headers.range;

  if (!range) {
    res.writeHead(200, {
      'content-type': type,
      'content-length': size,
      'accept-ranges': 'bytes',
    });
    fs.createReadStream(file).pipe(res);
    return;
  }

  const match = range.match(/bytes=(\d*)-(\d*)/);
  const start = match && match[1] ? Number(match[1]) : 0;
  const end = match && match[2] ? Number(match[2]) : size - 1;

  if (Number.isNaN(start) || Number.isNaN(end) || start >= size || end >= size) {
    res.writeHead(416, {'content-range': `bytes */${size}`}).end();
    return;
  }

  res.writeHead(206, {
    'content-type': type,
    'content-range': `bytes ${start}-${end}/${size}`,
    'content-length': end - start + 1,
    'accept-ranges': 'bytes',
  });
  fs.createReadStream(file, {start, end}).pipe(res);
};

// ---------------------------------------------------------------------------
// Routage
// ---------------------------------------------------------------------------
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const route = url.pathname;

  try {
    // --- pages et assets ---
    if (route === '/' || route === '/index.html') {
      return serveStatic(res, path.join(UI_DIR, 'index.html'));
    }
    if (route === '/app.js' || route === '/style.css') {
      return serveStatic(res, path.join(UI_DIR, route.slice(1)));
    }

    // --- etat ---
    if (route === '/api/status' && req.method === 'GET') {
      return json(res, 200, projectStatus());
    }
    if (route === '/api/scripts' && req.method === 'GET') {
      return json(res, 200, listScripts());
    }

    // --- decoupage d'un script colle ---
    if (route === '/api/segment' && req.method === 'POST') {
      const body = JSON.parse((await readBody(req)).toString('utf8'));
      const result = segmentScript(String(body.text ?? ''));
      if (result.beats.length === 0) {
        return json(res, 400, {error: 'Le texte est vide'});
      }
      return json(res, 200, result);
    }

    // --- texte continu reecrit : on recale sans casser l'habillage ---
    if (route === '/api/resegment' && req.method === 'POST') {
      const body = JSON.parse((await readBody(req)).toString('utf8'));
      const slug = String(body.slug ?? '');
      if (!SLUG_OK.test(slug)) return json(res, 400, {error: 'Slug invalide'});
      const file = p('scripts', `${slug}.json`);
      if (!fs.existsSync(file)) return json(res, 404, {error: 'Script introuvable'});

      const doc = readJson(file);
      const result = remapBeats(Array.isArray(doc.beats) ? doc.beats : [], body.text);
      if (result.beats.length === 0) return json(res, 400, {error: 'Le texte est vide'});
      return json(res, 200, result);
    }

    if (route === '/api/import' && req.method === 'POST') {
      const body = JSON.parse((await readBody(req)).toString('utf8'));
      const title = String(body.title ?? '').trim();
      const slug = slugify(body.slug || title);
      if (!title) return json(res, 400, {error: 'Titre manquant'});
      if (!SLUG_OK.test(slug)) return json(res, 400, {error: 'Titre inutilisable comme nom de fichier'});

      const file = p('scripts', `${slug}.json`);
      if (fs.existsSync(file) && !body.overwrite) {
        return json(res, 409, {error: 'Un script porte deja ce nom'});
      }

      const {beats, stats} = segmentScript(String(body.text ?? ''));
      if (beats.length === 0) return json(res, 400, {error: 'Le texte est vide'});

      ensureDir(p('scripts'));
      fs.writeFileSync(
        file,
        JSON.stringify(
          {
            slug,
            title,
            hook: beats[0]?.text ?? '',
            beats: beats.map((b) => ({text: b.text, visual_query: b.visual_query})),
            youtube: {title, description: '', tags: [], thumbnail_text: ''},
          },
          null,
          2,
        ) + '\n',
        'utf8',
      );
      return json(res, 201, {slug, beats: beats.length, stats});
    }

    // --- musique ---
    if (route === '/api/music/search' && req.method === 'GET') {
      const provider = url.searchParams.get('provider') === 'jamendo' ? 'jamendo' : 'openverse';
      const clientId = jamendoClientId();

      if (provider === 'jamendo' && !clientId) {
        return json(res, 400, {
          error:
            'JAMENDO_CLIENT_ID absent du .env. Reste sur Openverse, qui ne demande aucune cle.',
        });
      }

      try {
        const tracks = await searchMusic({
          provider,
          clientId,
          mood: url.searchParams.get('mood') ?? 'romantique',
          query: url.searchParams.get('q') ?? '',
          limit: 16,
        });
        return json(res, 200, tracks);
      } catch (err) {
        return json(res, 502, {error: err.message});
      }
    }

    // --- musique deposee a la main (Pixabay, achat perso, n'importe quel mp3) ---
    if (route === '/api/music/upload' && req.method === 'POST') {
      const rawName = decodeURIComponent(url.searchParams.get('name') ?? '');
      // Meme alphabet que la route de lecture /music/... : sinon le fichier
      // s'enregistre mais devient introuvable a l'ecoute.
      const clean = rawName
        .replace(/[^A-Za-z0-9 ._-]/g, ' ')
        .replace(/\s+/g, ' ')
        .replace(/\s+\./g, '.')
        .trim();
      const ext = (clean.split('.').pop() ?? '').toLowerCase();
      // Les quatre formats que la liste et la route d'ecoute savent servir.
      const jouables = ['mp3', 'wav', 'm4a', 'aac'];
      if (!clean || !jouables.includes(ext)) {
        return json(res, 400, {error: `Formats acceptés : ${jouables.join(', ')}`});
      }

      const buffer = await readBody(req);
      if (buffer.length === 0) return json(res, 400, {error: 'Fichier vide'});

      ensureDir(p('public', 'music'));
      // Jamais d'ecrasement silencieux : un doublon prend un suffixe.
      let target = clean;
      let n = 1;
      while (fs.existsSync(p('public', 'music', target))) {
        target = clean.replace(new RegExp(`\\.${ext}$`), `-${++n}.${ext}`);
      }
      fs.writeFileSync(p('public', 'music', target), buffer);
      return json(res, 201, {file: target, bytes: buffer.length});
    }

    if (route === '/api/music/download' && req.method === 'POST') {
      const track = JSON.parse((await readBody(req)).toString('utf8'));
      if (!track?.url || !/^https:\/\//i.test(track.url)) {
        return json(res, 400, {error: 'Piste invalide'});
      }
      try {
        const file = await downloadTrack(track, p('public', 'music'));
        return json(res, 200, {file: path.basename(file)});
      } catch (err) {
        return json(res, 502, {error: err.message});
      }
    }

    // --- catalogue de voix : celles du compte + la bibliotheque ElevenLabs ---
    if (route === '/api/voices' && req.method === 'GET') {
      const key = elevenLabsKey();
      if (!key) return json(res, 400, {error: 'Aucune clé ElevenLabs dans le trousseau'});
      try {
        const language = url.searchParams.get('language') || 'fr';
        const catalogue = await voiceCatalogue({key, language});

        // Vue par defaut : la selection maison, dans son ordre. Le catalogue
        // entier reste accessible pour qui veut chercher lui-meme.
        if (url.searchParams.get('set') !== 'tout') {
          const parId = new Map(catalogue.map((v) => [v.id, v]));
          return json(
            res,
            200,
            CURATED_VOICES.map((choix) => {
              const v = parId.get(choix.id);
              return {
                ...(v ?? {id: choix.id, requiresPaid: true, preview: null}),
                name: choix.name,
                gender: choix.gender,
                note: choix.note,
                curated: true,
              };
            }),
          );
        }

        return json(
          res,
          200,
          catalogue.map((v) => ({...v, note: curatedInfo(v.id)?.note ?? null, curated: CURATED_IDS.has(v.id)})),
        );
      } catch (err) {
        return json(res, 502, {error: err.message});
      }
    }

    // --- extrait de la voix choisie, sur le texte du script ---
    if (route === '/api/voice-sample' && req.method === 'POST') {
      const body = JSON.parse((await readBody(req)).toString('utf8'));
      const voiceId = String(body.voiceId ?? '').trim();
      const slug = String(body.slug ?? '');
      if (!voiceId) return json(res, 400, {error: 'Voix manquante'});
      if (!SLUG_OK.test(slug)) return json(res, 400, {error: 'Slug invalide'});

      const file = p('scripts', `${slug}.json`);
      if (!fs.existsSync(file)) return json(res, 404, {error: 'Script introuvable'});
      const doc = readJson(file);
      const beats = (Array.isArray(doc.beats) ? doc.beats : []).slice(0, 2);
      if (beats.length === 0) return json(res, 400, {error: 'Script vide'});

      // Deux beats suffisent a juger une voix, et coutent une centaine de credits.
      const text = taggedVoiceover(beats, resolveEmotions(beats));

      try {
        const audio = await withKey({
          needed: text.length,
          quiet: true,
          run: (apiKey) =>
            ttsSample({
              text,
              voiceId,
              apiKey,
              stability: Number(process.env.ELEVENLABS_V3_STABILITY ?? 0.5),
            }),
        });
        res.writeHead(200, {
          'content-type': 'audio/mpeg',
          'content-length': audio.length,
          'cache-control': 'no-store',
        });
        return res.end(audio);
      } catch (err) {
        return json(res, 502, {error: err.message});
      }
    }

    // --- trousseau de cles ElevenLabs ---
    if (route === '/api/keys' && req.method === 'GET') {
      return json(res, 200, await keysPayload({refresh: url.searchParams.get('refresh') === '1'}));
    }

    if (route === '/api/keys' && req.method === 'POST') {
      const body = JSON.parse((await readBody(req)).toString('utf8'));
      const key = String(body.key ?? '').trim();
      if (!key) return json(res, 400, {error: 'Colle la clé ElevenLabs'});

      // On verifie la cle aupres d'ElevenLabs avant de la ranger : une cle
      // morte dans le trousseau ferait rater une production plus tard.
      let quota;
      try {
        quota = await getQuota(key);
      } catch (err) {
        return json(res, 400, {
          error: err.badKey
            ? 'Clé refusée par ElevenLabs (vérifie le copier-coller)'
            : `ElevenLabs injoignable : ${err.message}`,
        });
      }

      try {
        const added = addElevenLabsKey({label: body.label, key, quota});
        return json(res, 201, {...added, quota});
      } catch (err) {
        return json(res, 400, {error: err.message});
      }
    }

    const keyMatch = route.match(/^\/api\/keys\/([A-Za-z0-9-]+)$/);
    if (keyMatch && req.method === 'DELETE') {
      const removed = removeElevenLabsKey(keyMatch[1]);
      if (!removed) return json(res, 404, {error: 'Clé introuvable'});
      return json(res, 200, {ok: true});
    }
    if (keyMatch && req.method === 'PATCH') {
      const body = JSON.parse((await readBody(req)).toString('utf8'));
      try {
        if (!renameElevenLabsKey(keyMatch[1], body.label)) {
          return json(res, 404, {error: 'Clé introuvable'});
        }
      } catch (err) {
        return json(res, 400, {error: err.message});
      }
      return json(res, 200, {ok: true});
    }

    // --- intonation retenue pour chaque beat (declaree ou deduite) ---
    if (route === '/api/emotions' && req.method === 'GET') {
      const slug = url.searchParams.get('slug') ?? '';
      if (!SLUG_OK.test(slug)) return json(res, 400, {error: 'Slug invalide'});
      const file = p('scripts', `${slug}.json`);
      if (!fs.existsSync(file)) return json(res, 404, {error: 'Script introuvable'});
      const doc = readJson(file);
      const beats = Array.isArray(doc.beats) ? doc.beats : [];
      return json(res, 200, resolveEmotions(beats));
    }

    // --- cles simples (Pexels, Jamendo) reglables depuis l'interface ---
    if (route === '/api/env-keys' && req.method === 'POST') {
      const body = JSON.parse((await readBody(req)).toString('utf8'));
      const autorisees = {PEXELS_API_KEY: 'Pexels', JAMENDO_CLIENT_ID: 'Jamendo'};
      const name = String(body.name ?? '');
      if (!Object.hasOwn(autorisees, name)) return json(res, 400, {error: 'Clé inconnue'});

      const value = String(body.value ?? '').trim();

      // Pas de verification aupres de Pexels : teste le 10/08/2026, leur API
      // sert les resultats et renvoie les memes en-tetes de quota avec une
      // cle inventee. Un controle qui accepte tout vaut moins que pas de
      // controle du tout. On se limite donc a la forme.
      if (value && !/^[A-Za-z0-9]{20,80}$/.test(value)) {
        return json(res, 400, {
          error: 'Format inattendu : une clé Pexels est une longue suite de lettres et de chiffres.',
        });
      }

      try {
        setEnvKey(name, value);
      } catch (err) {
        return json(res, 400, {error: err.message});
      }
      return json(res, 200, {ok: true, service: autorisees[name], set: value.length > 0});
    }

    // --- verification du quota pour un script donne ---
    if (route === '/api/quota' && req.method === 'GET') {
      const slug = url.searchParams.get('slug') ?? '';
      if (!SLUG_OK.test(slug)) return json(res, 400, {error: 'Slug invalide'});
      const file = p('scripts', `${slug}.json`);
      if (!fs.existsSync(file)) return json(res, 404, {error: 'Script introuvable'});

      const doc = readJson(file);
      const beats = Array.isArray(doc.beats) ? doc.beats : [];
      // Les balises d'intonation sont facturees comme du texte : le devis doit
      // porter sur ce qui part vraiment chez ElevenLabs.
      const text = taggedVoiceover(beats, resolveEmotions(beats));

      if (!hasElevenLabsKey()) {
        return json(res, 200, {
          ok: false,
          needed: estimateCredits(text),
          total: 0,
          keys: [],
          message: 'Aucune clé ElevenLabs dans le trousseau.',
        });
      }

      const check = await checkQuota(text);
      return json(res, 200, {
        ok: check.ok,
        needed: check.needed,
        total: check.total,
        message: check.message,
        keys: check.snapshot.map(({id, label, masked, remaining, limit, resetUnix, error}) => ({
          id,
          label,
          masked,
          remaining,
          limit,
          resetUnix,
          error,
        })),
      });
    }

    const musicFileMatch = route.match(/^\/api\/music\/([^/]+)$/);
    if (musicFileMatch && req.method === 'DELETE') {
      const name = decodeURIComponent(musicFileMatch[1]);
      if (!/^[A-Za-z0-9 ._-]+$/.test(name)) return json(res, 400, {error: 'Nom invalide'});
      for (const target of [p('public', 'music', name), p('public', 'music', `${name}.licence.txt`)]) {
        if (fs.existsSync(target)) fs.unlinkSync(target);
      }
      return json(res, 200, {ok: true});
    }

    // --- un script ---
    const scriptMatch = route.match(/^\/api\/scripts\/([^/]+)$/);
    if (scriptMatch) {
      const slug = decodeURIComponent(scriptMatch[1]);
      if (!SLUG_OK.test(slug)) return json(res, 400, {error: 'Slug invalide'});
      const file = p('scripts', `${slug}.json`);

      if (req.method === 'GET') {
        if (!fs.existsSync(file)) return json(res, 404, {error: 'Script introuvable'});
        return json(res, 200, readJson(file));
      }
      if (req.method === 'PUT') {
        const body = JSON.parse((await readBody(req)).toString('utf8'));
        const errors = validateScript(body);
        if (errors.length > 0) return json(res, 400, {error: errors.join('. ')});
        body.slug = slug;
        ensureDir(p('scripts'));
        fs.writeFileSync(file, JSON.stringify(body, null, 2) + '\n', 'utf8');
        return json(res, 200, {ok: true, slug});
      }
      if (req.method === 'DELETE') {
        // Deplace vers une corbeille plutot que d'effacer : un script
        // represente du travail d'ecriture, pas un fichier temporaire.
        if (fs.existsSync(file)) {
          const trash = ensureDir(p('out', '.trash'));
          let target = path.join(trash, `${slug}.json`);
          let n = 1;
          while (fs.existsSync(target)) {
            target = path.join(trash, `${slug}-${++n}.json`);
          }
          fs.renameSync(file, target);
          return json(res, 200, {ok: true, trashed: path.relative(p('.'), target)});
        }
        return json(res, 200, {ok: true});
      }
    }

    // --- upload d'une voix off ---
    const audioMatch = route.match(/^\/api\/audio\/([^/]+)$/);
    if (audioMatch && req.method === 'POST') {
      const slug = decodeURIComponent(audioMatch[1]);
      if (!SLUG_OK.test(slug)) return json(res, 400, {error: 'Slug invalide'});
      const ext = (url.searchParams.get('ext') || 'mp3').toLowerCase().replace(/[^a-z0-9]/g, '');
      const buffer = await readBody(req);
      if (buffer.length === 0) return json(res, 400, {error: 'Fichier vide'});
      ensureDir(p('public', 'audio'));

      // On garde le fichier brut (pour un eventuel speech-to-speech rejouable)
      // et on prepare la voix off de travail en mp3.
      for (const stale of rawVoiceCandidates(slug)) fs.rmSync(stale, {force: true});
      const raw = p('public', 'audio', `${slug}.src.${ext === 'mp3' ? 'mp3' : ext}`);
      fs.writeFileSync(raw, buffer);
      await transcodeToMp3(raw, p('public', 'audio', `${slug}.mp3`));

      return json(res, 200, {ok: true, bytes: buffer.length});
    }
    if (audioMatch && req.method === 'DELETE') {
      const slug = decodeURIComponent(audioMatch[1]);
      if (!SLUG_OK.test(slug)) return json(res, 400, {error: 'Slug invalide'});
      for (const file of [p('public', 'audio', `${slug}.mp3`), ...rawVoiceCandidates(slug)]) {
        if (fs.existsSync(file)) fs.unlinkSync(file);
      }
      return json(res, 200, {ok: true});
    }

    // --- jobs ---
    if (route === '/api/jobs' && req.method === 'POST') {
      if ([...jobs.values()].some((j) => j.status === 'running')) {
        return json(res, 409, {error: 'Une production est deja en cours'});
      }
      const body = JSON.parse((await readBody(req)).toString('utf8'));
      const slug = String(body.slug ?? '');
      if (!SLUG_OK.test(slug) || !fs.existsSync(p('scripts', `${slug}.json`))) {
        return json(res, 400, {error: 'Script introuvable'});
      }
      const job = {
        id: String(++jobSeq),
        slug,
        format: body.format === 'long' ? 'long' : 'short',
        mediaType: ['photo', 'video', 'mix'].includes(body.mediaType) ? body.mediaType : 'mix',
        music: typeof body.music === 'string' && body.music ? body.music : null,
        musicVolume: Math.min(Math.max(Number(body.musicVolume) || 0.1, 0), 0.6),
        voiceId: typeof body.voiceId === 'string' && body.voiceId ? body.voiceId : null,
        ttsEngine: ['piper', 'xtts', 'elevenlabs'].includes(body.ttsEngine) ? body.ttsEngine : null,
        ttsVoice: typeof body.ttsVoice === 'string' && body.ttsVoice ? body.ttsVoice : null,
        xttsClone: Boolean(body.xttsClone),
        // Speech-to-speech : id de la voix cible ElevenLabs, seulement si une
        // voix brute a bien ete deposee pour ce script.
        stsVoice:
          typeof body.stsVoice === 'string' && body.stsVoice && rawVoiceFile(slug)
            ? body.stsVoice
            : null,
        align: ['whisper', 'elevenlabs'].includes(body.align) ? body.align : null,
        forceVoice: Boolean(body.forceVoice),
        noMedia: Boolean(body.noMedia),
        buildOnly: Boolean(body.buildOnly),
        status: 'running',
        stopped: false,
        lines: [],
        clients: new Set(),
        child: null,
        output: null,
      };
      jobs.set(job.id, job);
      startJob(job).catch((err) => {
        job.status = 'error';
        broadcast(job, {type: 'log', text: String(err)});
        broadcast(job, {type: 'end', status: 'error'});
      });
      return json(res, 201, {id: job.id});
    }

    const streamMatch = route.match(/^\/api\/jobs\/([^/]+)\/stream$/);
    if (streamMatch && req.method === 'GET') {
      const job = jobs.get(streamMatch[1]);
      if (!job) return json(res, 404, {error: 'Job introuvable'});

      res.writeHead(200, {
        'content-type': 'text/event-stream',
        'cache-control': 'no-cache',
        connection: 'keep-alive',
      });
      for (const line of job.lines) {
        res.write(`data: ${JSON.stringify(line)}\n\n`);
      }
      if (job.status !== 'running') {
        res.write(`data: ${JSON.stringify({type: 'end', status: job.status, output: job.output})}\n\n`);
      }
      job.clients.add(res);
      req.on('close', () => job.clients.delete(res));
      return;
    }

    const stopMatch = route.match(/^\/api\/jobs\/([^/]+)\/stop$/);
    if (stopMatch && req.method === 'POST') {
      const job = jobs.get(stopMatch[1]);
      if (!job) return json(res, 404, {error: 'Job introuvable'});
      job.stopped = true;
      if (job.child) job.child.kill();
      return json(res, 200, {ok: true});
    }

    // --- metadonnees YouTube du dernier rendu (titre, description, credits) ---
    if (route === '/api/meta' && req.method === 'GET') {
      const slug = url.searchParams.get('slug') ?? '';
      if (!SLUG_OK.test(slug)) return json(res, 400, {error: 'Slug invalide'});
      const file = p('out', `${slug}.meta.json`);
      if (!fs.existsSync(file)) return json(res, 404, {error: 'Pas encore de rendu'});
      const meta = readJson(file);

      // La description prete a coller : celle du script, plus les credits
      // obligatoires (musique CC-BY, voix locale, banques d'images).
      const blocs = [String(meta.youtube?.description ?? '').trim()];
      const credits = [];
      if (meta.musicAttribution) credits.push(`Musique : ${meta.musicAttribution}`);
      if (meta.voiceAttribution) credits.push(meta.voiceAttribution);
      if (Array.isArray(meta.credits) && meta.credits.length > 0) {
        credits.push(`Visuels : ${[...new Set(meta.credits)].join(', ')}`);
      }
      if (credits.length > 0) blocs.push(credits.join('\n'));

      return json(res, 200, {
        title: meta.youtube?.title ?? meta.title ?? slug,
        description: blocs.filter(Boolean).join('\n\n'),
        tags: meta.youtube?.tags ?? [],
        thumbnailText: meta.youtube?.thumbnail_text ?? '',
        durationSeconds: meta.durationSeconds ?? null,
        format: meta.format ?? 'short',
      });
    }

    // --- lecture des rendus ---
    const videoMatch = route.match(/^\/media\/([A-Za-z0-9._-]+\.mp4)$/);
    if (videoMatch && req.method === 'GET') {
      return serveMedia(req, res, p('out', videoMatch[1]));
    }

    // --- ecoute des musiques deposees ---
    // Le chemin arrive encode (%20 pour une espace) : il faut le decoder AVANT
    // de le filtrer, sinon tout nom contenant une espace repond 404.
    const musicPlayMatch = decodeURIComponent(route).match(
      /^\/music\/([A-Za-z0-9 ._-]+\.(?:mp3|wav|m4a|aac))$/i,
    );
    if (musicPlayMatch && req.method === 'GET') {
      return serveMedia(req, res, p('public', 'music', musicPlayMatch[1]));
    }

    res.writeHead(404, {'content-type': 'text/plain; charset=utf-8'}).end('Introuvable');
  } catch (err) {
    json(res, 500, {error: err.message});
  }
});

/**
 * Validation d'ENREGISTREMENT seulement : un brouillon en cours d'ecriture
 * doit pouvoir etre sauvegarde. Les regles completes (chaque beat rempli)
 * sont appliquees par build.mjs au moment de produire, et signalees dans
 * l'interface avant de lancer la production.
 */
function validateScript(body) {
  if (!body || typeof body !== 'object') return ['Corps de requete invalide'];
  const errors = [];
  if (!body.title || !String(body.title).trim()) errors.push('Titre manquant');
  if (!Array.isArray(body.beats)) errors.push('Le champ "beats" doit etre une liste');
  return errors;
}

server.listen(PORT, '127.0.0.1', () => {
  console.log(`\n  Interface de la chaine : http://127.0.0.1:${PORT}\n`);
  console.log('  Ctrl+C pour arreter.\n');
});

export {slugify};
