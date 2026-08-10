/**
 * Alignement local des sous-titres par whisper.cpp, SANS aucune cle API.
 *
 * Quand l'utilisateur fournit sa propre voix (ou une voix issue du
 * speech-to-speech), on transcrit l'audio en local pour obtenir les
 * horodatages mot a mot. C'est ce qui permet de produire une video complete
 * sans jamais appeler ElevenLabs.
 *
 * whisper.cpp s'installe hors du projet (dans un dossier SANS espace), parce
 * que le script d'installation de @remotion/install-whisper-cpp construit une
 * commande PowerShell Expand-Archive non echappee : un espace dans le chemin
 * casse l'extraction. Le repertoire d'installation est donc fixe sous
 * %LOCALAPPDATA%\love-whisper.
 */
import {spawn} from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {transcribe} from '@remotion/install-whisper-cpp';
import {RenderInternals} from '@remotion/renderer';
import {log, p} from './utils.mjs';

const WHISPER_VERSION = '1.5.5';
const PROJECT_ROOT = path.resolve(fileURLToPath(new URL('../../', import.meta.url)));

/** Dossier d'installation, garanti sans espace. */
export const whisperDir = () => {
  const base =
    process.env.LOCALAPPDATA ||
    process.env.XDG_CACHE_HOME ||
    path.join(os.homedir(), '.cache');
  return path.join(base, 'love-whisper');
};

const binaryName = () => (process.platform === 'win32' ? 'main.exe' : 'main');

export const isWhisperInstalled = (model = 'base') => {
  const dir = whisperDir();
  return (
    fs.existsSync(path.join(dir, binaryName())) &&
    fs.existsSync(path.join(dir, `ggml-${model}.bin`))
  );
};

/**
 * Installe whisper.cpp + le modele si besoin.
 *
 * L'installation se fait via un sous-processus dont le repertoire courant est
 * SANS espace : le zip d'installation est telecharge dans ce repertoire et
 * l'etape Expand-Archive casserait sinon.
 */
export const ensureWhisper = async ({model = 'base'} = {}) => {
  const dir = whisperDir();
  if (isWhisperInstalled(model)) return dir;

  log.step('Installation de whisper.cpp (une seule fois)');
  fs.mkdirSync(path.dirname(dir), {recursive: true});

  await new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [p('pipeline', 'lib', 'whisper-install.mjs'), dir, model],
      {cwd: path.dirname(dir), stdio: 'inherit', windowsHide: true},
    );
    child.on('error', reject);
    child.on('close', (code) =>
      code === 0 ? resolve() : reject(new Error(`Installation whisper.cpp echouee (code ${code})`)),
    );
  });

  if (!isWhisperInstalled(model)) {
    throw new Error("whisper.cpp est installe mais le binaire ou le modele reste introuvable");
  }
  log.ok('whisper.cpp pret');
  return dir;
};

/** Chemin du ffmpeg embarque par Remotion : aucune dependance externe. */
const ffmpegPath = () =>
  RenderInternals.getExecutablePath({
    indent: false,
    logLevel: 'error',
    type: 'ffmpeg',
    binariesDirectory: null,
  });

/** whisper.cpp exige un WAV 16 kHz mono 16 bits. */
const toWav16k = (inputPath) =>
  new Promise((resolve, reject) => {
    const out = path.join(
      os.tmpdir(),
      `love-whisper-${Date.now()}-${path.basename(inputPath).replace(/\W+/g, '_')}.wav`,
    );
    const child = spawn(
      ffmpegPath(),
      ['-y', '-i', inputPath, '-ar', '16000', '-ac', '1', '-c:a', 'pcm_s16le', out],
      {windowsHide: true},
    );
    let err = '';
    child.stderr.on('data', (d) => (err += d.toString()));
    child.on('error', reject);
    child.on('close', (code) =>
      code === 0 ? resolve(out) : reject(new Error(`Conversion WAV echouee : ${err.slice(-200)}`)),
    );
  });

const PUNCTUATION_ONLY = /^[.,!?…:;»")\]]+$/;

/**
 * whisper.cpp rend des tokens SOUS-mot : « go » + « ût », « am » + « our »,
 * et la ponctuation en tokens separes. On les recolle en mots entiers.
 *
 * Regle : un token commencant par une espace ouvre un nouveau mot ; un token
 * sans espace de tete est une continuation ; un token de ponctuation seule
 * se raccroche au mot precedent.
 */
const tokensToWords = (transcription) => {
  const words = [];

  for (const segment of transcription ?? []) {
    for (const token of segment.tokens ?? []) {
      const raw = token.text ?? '';
      const trimmed = raw.trim();
      if (!trimmed || /^\[.*\]$/.test(trimmed)) continue; // vide ou [_BEG_], [_TT_...]

      const from = (token.offsets?.from ?? 0) / 1000;
      const to = (token.offsets?.to ?? from * 1000) / 1000;
      const startsWord = raw.startsWith(' ');
      const last = words[words.length - 1];

      if (PUNCTUATION_ONLY.test(trimmed) && last) {
        last.text += trimmed;
        last.end = Math.max(last.end, to);
      } else if (startsWord || !last) {
        words.push({text: trimmed, start: from, end: to});
      } else {
        last.text += trimmed;
        last.end = Math.max(last.end, to);
      }
    }
  }

  // Garde-fou : un mot ne peut pas finir avant de commencer.
  for (const w of words) if (w.end < w.start) w.end = w.start;
  return words;
};

/**
 * Transcrit un audio et renvoie des mots horodatés au meme format que
 * l'alignement ElevenLabs : {text, start, end} en secondes.
 */
export const alignWithWhisper = async ({audioPath, model = 'base', language = 'fr'}) => {
  await ensureWhisper({model});
  const wav = await toWav16k(audioPath);

  try {
    const result = await transcribe({
      inputPath: wav,
      whisperPath: whisperDir(),
      model,
      tokenLevelTimestamps: true,
      language,
      whisperCppVersion: WHISPER_VERSION,
      printOutput: false,
    });
    return tokensToWords(result.transcription);
  } finally {
    fs.rmSync(wav, {force: true});
  }
};

const normWord = (w) =>
  w
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]/g, '');

/**
 * Voix GENEREE : on connait le texte exact prononce. On transcrit l'audio
 * pour recuperer le timing de Whisper, puis on transfere ce timing sur les
 * mots du SCRIPT. Les sous-titres affichent ainsi le texte exact, jamais une
 * transcription approximative.
 */
export const alignKnownText = async ({audioPath, text, model = 'base', language = 'fr'}) => {
  const spoken = await alignWithWhisper({audioPath, model, language});
  const target = text.split(/\s+/).filter((w) => normWord(w));
  if (target.length === 0 || spoken.length === 0) return spoken;

  const A = target.map(normWord);
  const B = spoken.map((s) => normWord(s.text));
  const n = A.length;
  const m = B.length;

  // Plus longue sous-sequence commune (programmation dynamique).
  const dp = Array.from({length: n + 1}, () => new Int32Array(m + 1));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = A[i] === B[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }

  // Retro-parcours : chaque mot du script matche recupere son horodatage.
  const timed = target.map(() => null);
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (A[i] === B[j]) {
      timed[i] = {start: spoken[j].start, end: spoken[j].end};
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      i++;
    } else {
      j++;
    }
  }

  // Les mots non matches sont repartis uniformement entre leurs voisins cales.
  const audioStart = spoken[0].start;
  const audioEnd = spoken[spoken.length - 1].end;
  const result = target.map((text, k) => ({text, start: 0, end: 0, timed: timed[k]}));

  let k = 0;
  while (k < result.length) {
    if (result[k].timed) {
      result[k].start = result[k].timed.start;
      result[k].end = result[k].timed.end;
      k++;
      continue;
    }
    // Groupe de mots sans horodatage : [k, g[.
    let g = k;
    while (g < result.length && !result[g].timed) g++;
    const from = k > 0 ? result[k - 1].end : audioStart;
    const to = g < result.length ? result[g].timed.start : audioEnd;
    const step = (to - from) / (g - k + (g < result.length ? 0 : 1) || 1);
    for (let x = k; x < g; x++) {
      result[x].start = from + step * (x - k);
      result[x].end = from + step * (x - k + 1);
    }
    k = g;
  }

  return result.map(({text, start, end}) => ({text, start, end: Math.max(end, start)}));
};

export {PROJECT_ROOT};
