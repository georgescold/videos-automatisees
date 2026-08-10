/**
 * Voix off GENEREE en local par XTTS-v2 (Coqui) : la meilleure qualite TTS
 * locale, francais inclus, accelere GPU. Peut cloner la voix de l'utilisateur.
 *
 * ATTENTION LICENCE : le modele XTTS-v2 est sous Coqui Public Model License
 * (CPML), NON commerciale. A n'utiliser que si l'utilisateur l'accepte. Les
 * voix Piper (CC-BY) restent l'option commerciale.
 *
 * L'environnement Python vit hors du projet (chemin sans espace) :
 * %LOCALAPPDATA%\love-xtts\venv. La synthese passe par xtts_synth.py.
 */
import {spawn} from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {RenderInternals} from '@remotion/renderer';
import {ensureDir, log, p} from './utils.mjs';

/** Voix studio integrees a XTTS proposees dans l'interface. */
export const XTTS_SPEAKERS = {
  'daisy-f': {label: 'Daisy (féminine, chaleureuse)', speaker: 'Daisy Studious', gender: 'F'},
  'sofia-f': {label: 'Sofia (féminine, posée)', speaker: 'Sofia Hellen', gender: 'F'},
  'andrew-m': {label: 'Andrew (masculine, vive)', speaker: 'Andrew Chipper', gender: 'M'},
  'damien-m': {label: 'Damien (masculine, grave)', speaker: 'Damien Black', gender: 'M'},
};

export const xttsRoot = () => {
  const base =
    process.env.LOCALAPPDATA ||
    process.env.XDG_CACHE_HOME ||
    path.join(os.homedir(), '.cache');
  return path.join(base, 'love-xtts');
};

const venvPython = () => {
  const root = xttsRoot();
  return process.platform === 'win32'
    ? path.join(root, 'venv', 'Scripts', 'python.exe')
    : path.join(root, 'venv', 'bin', 'python');
};

export const isXttsInstalled = () => fs.existsSync(venvPython());

const ffmpegPath = () =>
  RenderInternals.getExecutablePath({
    indent: false,
    logLevel: 'error',
    type: 'ffmpeg',
    binariesDirectory: null,
  });

const toMp3 = (wav, mp3) =>
  new Promise((resolve, reject) => {
    ensureDir(path.dirname(mp3));
    const child = spawn(
      ffmpegPath(),
      ['-y', '-i', wav, '-codec:a', 'libmp3lame', '-q:a', '3', mp3],
      {windowsHide: true},
    );
    let err = '';
    child.stderr.on('data', (d) => (err += d.toString()));
    child.on('error', reject);
    child.on('close', (code) =>
      code === 0 ? resolve(mp3) : reject(new Error(`Conversion mp3 echouee : ${err.slice(-200)}`)),
    );
  });

/**
 * @returns {Promise<{mp3: string, attribution: string, license: string}>}
 */
export const synthesizeToMp3 = async ({
  text,
  speakerId = 'daisy-f',
  cloneWav = null,
  outMp3,
  language = 'fr',
}) => {
  if (!isXttsInstalled()) {
    throw new Error(
      "XTTS n'est pas installe. Lance l'installation (voir README, section voix locale HD).",
    );
  }

  const speaker = XTTS_SPEAKERS[speakerId] ?? XTTS_SPEAKERS['daisy-f'];
  const wav = path.join(os.tmpdir(), `love-xtts-${Date.now()}.wav`);
  const textFile = path.join(os.tmpdir(), `love-xtts-${Date.now()}.txt`);
  fs.writeFileSync(textFile, text, 'utf8');

  const args = [
    p('pipeline', 'lib', 'xtts_synth.py'),
    '--text-file', textFile,
    '--out', wav,
    '--language', language,
  ];
  if (cloneWav) args.push('--clone', cloneWav);
  else args.push('--speaker', speaker.speaker);

  log.info('XTTS charge le modele et synthetise (GPU)...');
  await new Promise((resolve, reject) => {
    const child = spawn(venvPython(), args, {
      windowsHide: true,
      env: {...process.env, COQUI_TOS_AGREED: '1'},
    });
    let err = '';
    child.stderr.on('data', (d) => {
      const s = d.toString();
      err += s;
      // Les lignes [xtts] sont des jalons de progression.
      for (const line of s.split(/\r?\n/)) {
        if (line.includes('[xtts]')) log.info(line.replace('[xtts]', '').trim());
      }
    });
    child.on('error', reject);
    child.on('close', (code) =>
      code === 0 ? resolve() : reject(new Error(`XTTS a echoue :\n${err.slice(-400)}`)),
    );
  });

  fs.rmSync(textFile, {force: true});
  await toMp3(wav, outMp3);
  fs.rmSync(wav, {force: true});

  const attribution = cloneWav
    ? 'Voix : clonée depuis ta voix (XTTS-v2)'
    : `Voix de synthèse : XTTS-v2, timbre « ${speaker.label} »`;
  return {mp3: outMp3, attribution, license: 'CPML (non commercial)'};
};
