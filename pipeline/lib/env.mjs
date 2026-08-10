import fs from 'node:fs';
import {p, fail} from './utils.mjs';

const envFile = p('.env');

// Depot fraichement clone : le .env n'est pas versionne (il porte des cles).
// On le cree depuis le modele plutot que de laisser l'utilisateur decouvrir
// tout seul pourquoi rien ne marche. Lancer.bat le fait aussi, mais on ne
// passe pas toujours par lui.
const modele = p('.env.example');
if (!fs.existsSync(envFile) && fs.existsSync(modele)) {
  fs.copyFileSync(modele, envFile);
}

if (fs.existsSync(envFile)) {
  for (const line of fs.readFileSync(envFile, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = value;
  }
}

export const env = {
  elevenLabsKey: process.env.ELEVENLABS_API_KEY ?? '',
  // Plusieurs cles d'un coup, separees par des virgules : c'est ce qui rend
  // le .env portable d'une machine a l'autre, trousseau compris.
  elevenLabsKeysBulk: process.env.ELEVENLABS_API_KEYS ?? '',
  voiceId: process.env.ELEVENLABS_VOICE_ID ?? 'XB0fDUnXU5powFXDhCwa',
  modelId: process.env.ELEVENLABS_MODEL_ID ?? 'eleven_multilingual_v2',
  // Obeissance aux balises d'intonation (eleven_v3) : 0 = tres expressif mais
  // instable, 0.5 = naturel, 1 = verrouille et sourd aux balises.
  v3Stability: process.env.ELEVENLABS_V3_STABILITY ?? '0.5',
  stsModelId: process.env.ELEVENLABS_STS_MODEL_ID ?? 'eleven_multilingual_sts_v2',
  pexelsKey: process.env.PEXELS_API_KEY ?? '',
  jamendoClientId: process.env.JAMENDO_CLIENT_ID ?? '',
  // Modele de transcription locale : base (rapide) ou small (plus precis).
  whisperModel: process.env.WHISPER_MODEL ?? 'base',
  // Voix Piper par defaut (voix off generee en local).
  piperVoice: process.env.PIPER_VOICE ?? 'siwis-f',
  // Voix XTTS par defaut (voix off HD locale).
  xttsVoice: process.env.XTTS_VOICE ?? 'daisy-f',
};

export const requireEnv = (key, humanName) => {
  if (!env[key]) {
    fail(
      `${humanName} manquante. Copie .env.example vers .env et renseigne la cle, puis relance.`,
    );
  }
  return env[key];
};
