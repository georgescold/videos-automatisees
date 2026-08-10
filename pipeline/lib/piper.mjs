/**
 * Voix off GENEREE en local par Piper, SANS aucune cle API.
 *
 * Piper est un moteur TTS neuronal rapide (binaire autonome, pas de Python).
 * Bien plus naturel que la synthese Windows, et surtout : les voix retenues
 * sont sous licence CC-BY 4.0, donc utilisables sur une chaine monetisee a
 * condition de crediter. L'attribution est ecrite dans out/<slug>.meta.json.
 *
 * Comme whisper.cpp, Piper s'installe hors du projet (dossier SANS espace) :
 * %LOCALAPPDATA%\love-piper.
 */
import {spawn} from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {RenderInternals} from '@remotion/renderer';
import {ensureDir, log} from './utils.mjs';

const PIPER_RELEASE =
  'https://github.com/rhasspy/piper/releases/download/2023.11.14-2/piper_windows_amd64.zip';
const VOICE_BASE = 'https://huggingface.co/rhasspy/piper-voices/resolve/main';

/**
 * Catalogue de voix francaises. UNIQUEMENT des licences compatibles avec une
 * chaine monetisee (CC-BY). Chaque voix porte son attribution obligatoire.
 */
export const VOICES = {
  'siwis-f': {
    label: 'Léa (féminine, douce)',
    gender: 'F',
    quality: 'medium',
    dir: 'fr/fr_FR/siwis/medium',
    file: 'fr_FR-siwis-medium',
    license: 'CC-BY 4.0',
    attribution: 'Voix de synthèse : SIWIS French Speech Database (CC-BY 4.0)',
  },
  'mls-m': {
    label: 'Antoine (masculine)',
    gender: 'M',
    quality: 'medium',
    dir: 'fr/fr_FR/mls/medium',
    file: 'fr_FR-mls-medium',
    speaker: 0,
    license: 'CC-BY 4.0',
    attribution: 'Voix de synthèse : Multilingual LibriSpeech FR (CC-BY 4.0)',
  },
};

export const piperDir = () => {
  const base =
    process.env.LOCALAPPDATA ||
    process.env.XDG_CACHE_HOME ||
    path.join(os.homedir(), '.cache');
  return path.join(base, 'love-piper');
};

const piperExe = () => path.join(piperDir(), 'piper', 'piper.exe');
const espeakData = () => path.join(piperDir(), 'piper', 'espeak-ng-data');
const voiceOnnx = (voice) => path.join(piperDir(), 'voices', `${voice.file}.onnx`);

export const isPiperInstalled = () => fs.existsSync(piperExe());
export const isVoiceInstalled = (id) => {
  const voice = VOICES[id];
  return Boolean(voice) && fs.existsSync(voiceOnnx(voice)) && fs.existsSync(`${voiceOnnx(voice)}.json`);
};

const ffmpegPath = () =>
  RenderInternals.getExecutablePath({
    indent: false,
    logLevel: 'error',
    type: 'ffmpeg',
    binariesDirectory: null,
  });

const download = async (url, dest) => {
  ensureDir(path.dirname(dest));
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Telechargement echoue (${res.status}) : ${url}`);
  fs.writeFileSync(dest, Buffer.from(await res.arrayBuffer()));
};

/** Extrait un zip via `tar` (present sur Windows 10+), robuste aux espaces. */
const unzip = (zip, dest) =>
  new Promise((resolve, reject) => {
    ensureDir(dest);
    const child = spawn('tar', ['-xf', zip, '-C', dest], {windowsHide: true});
    let err = '';
    child.stderr.on('data', (d) => (err += d.toString()));
    child.on('error', reject);
    child.on('close', (code) =>
      code === 0 ? resolve() : reject(new Error(`Extraction echouee : ${err.slice(-200)}`)),
    );
  });

export const ensurePiper = async () => {
  if (isPiperInstalled()) return;
  log.step('Installation de Piper (une seule fois)');
  const dir = ensureDir(piperDir());
  const zip = path.join(dir, 'piper.zip');
  await download(PIPER_RELEASE, zip);
  await unzip(zip, dir);
  fs.rmSync(zip, {force: true});
  if (!isPiperInstalled()) throw new Error('Piper installe mais piper.exe introuvable');
  log.ok('Piper pret');
};

export const ensureVoice = async (id) => {
  const voice = VOICES[id];
  if (!voice) throw new Error(`Voix inconnue : ${id}`);
  if (isVoiceInstalled(id)) return voice;

  log.step(`Telechargement de la voix « ${voice.label} »`);
  await download(`${VOICE_BASE}/${voice.dir}/${voice.file}.onnx`, voiceOnnx(voice));
  await download(`${VOICE_BASE}/${voice.dir}/${voice.file}.onnx.json`, `${voiceOnnx(voice)}.json`);
  log.ok('Voix prete');
  return voice;
};

/**
 * Synthetise le texte et ecrit un mp3.
 * @returns {Promise<{mp3: string, attribution: string, license: string}>}
 */
export const synthesizeToMp3 = async ({text, voiceId = 'siwis-f', outMp3, lengthScale = 1}) => {
  await ensurePiper();
  const voice = await ensureVoice(voiceId);

  const wav = path.join(os.tmpdir(), `love-piper-${Date.now()}.wav`);
  const args = [
    '--model', voiceOnnx(voice),
    '--espeak_data', espeakData(),
    '--output_file', wav,
    '--length_scale', String(lengthScale),
  ];
  if (typeof voice.speaker === 'number') args.push('--speaker', String(voice.speaker));

  await new Promise((resolve, reject) => {
    const child = spawn(piperExe(), args, {windowsHide: true});
    let err = '';
    child.stderr.on('data', (d) => (err += d.toString()));
    child.on('error', reject);
    child.on('close', (code) =>
      code === 0 ? resolve() : reject(new Error(`Piper a echoue : ${err.slice(-300)}`)),
    );
    child.stdin.write(text);
    child.stdin.end();
  });

  ensureDir(path.dirname(outMp3));
  await new Promise((resolve, reject) => {
    const child = spawn(
      ffmpegPath(),
      ['-y', '-i', wav, '-codec:a', 'libmp3lame', '-q:a', '3', outMp3],
      {windowsHide: true},
    );
    let err = '';
    child.stderr.on('data', (d) => (err += d.toString()));
    child.on('error', reject);
    child.on('close', (code) =>
      code === 0 ? resolve() : reject(new Error(`Conversion mp3 echouee : ${err.slice(-200)}`)),
    );
  });
  fs.rmSync(wav, {force: true});

  return {mp3: outMp3, attribution: voice.attribution, license: voice.license};
};
