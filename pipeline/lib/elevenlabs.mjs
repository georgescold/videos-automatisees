import fs from 'node:fs';
import path from 'node:path';

const BASE = 'https://api.elevenlabs.io/v1';

/**
 * Erreur porteuse du code HTTP : la rotation des cles a besoin de distinguer
 * « cle refusee » (401) et « quota epuise » (429) d'une vraie panne.
 */
const apiError = (label, status, body) => {
  // Piege classique en palier gratuit : les voix de la bibliotheque (dont les
  // voix francaises) sont refusees a l'API. Seules les voix « premade » passent.
  const libraryVoice = /paid_plan_required|library voices/i.test(body);
  const message = libraryVoice
    ? `${label} ${status} — Cette voix est une voix de bibliothèque : le palier gratuit d'ElevenLabs ` +
      "ne l'autorise pas via l'API. Choisis une voix « premade » (liste dans l'interface) " +
      'ou passe le compte en plan payant.'
    : `${label} ${status} — ${body}`;

  return Object.assign(new Error(message), {
    status,
    body,
    libraryVoice,
    // Un refus de voix vient du compte, pas du quota : inutile d'essayer les
    // autres cles, elles echoueraient toutes pareil.
    quotaExceeded: !libraryVoice && (status === 429 || /quota|credit/i.test(body)),
    badKey: status === 401,
  });
};

/**
 * Quota d'un compte ElevenLabs. 1 credit = 1 caractere synthetise.
 * Gratuit : 10 000 credits, remis a zero chaque mois.
 * @returns {Promise<{tier, used, limit, remaining, resetUnix, status}>}
 */
export const getQuota = async (apiKey) => {
  const res = await fetch(`${BASE}/user/subscription`, {
    headers: {'xi-api-key': apiKey},
  });
  if (!res.ok) throw apiError('ElevenLabs quota', res.status, await res.text());

  const json = await res.json();
  const limit = Number(json.character_limit ?? 0);
  const used = Number(json.character_count ?? 0);
  return {
    tier: json.tier ?? 'inconnu',
    status: json.status ?? '',
    used,
    limit,
    remaining: Math.max(0, limit - used),
    resetUnix: json.next_character_count_reset_unix ?? null,
  };
};

/** ElevenLabs coupe au-dela d'une certaine longueur : on decoupe aux phrases. */
export const chunkText = (text, maxChars = 4000) => {
  if (text.length <= maxChars) return [text];
  const sentences = text.match(/[^.!?…]+[.!?…]*\s*/g) ?? [text];
  const chunks = [];
  let current = '';
  for (const sentence of sentences) {
    if (current.length + sentence.length > maxChars && current.length > 0) {
      chunks.push(current.trim());
      current = '';
    }
    current += sentence;
  }
  if (current.trim()) chunks.push(current.trim());
  return chunks;
};

/**
 * Text-to-speech avec alignement caractere par caractere.
 * @returns {Promise<{audio: Buffer, alignment: object}>}
 */
export const ttsWithTimestamps = async ({
  text,
  voiceId,
  modelId,
  apiKey,
  outputFormat = 'mp3_44100_128',
  voiceSettings,
}) => {
  const url = new URL(`${BASE}/text-to-speech/${voiceId}/with-timestamps`);
  url.searchParams.set('output_format', outputFormat);

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'xi-api-key': apiKey,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      text,
      model_id: modelId,
      voice_settings: voiceSettings ?? {
        stability: 0.45,
        similarity_boost: 0.8,
        style: 0.3,
        use_speaker_boost: true,
      },
    }),
  });

  if (!res.ok) throw apiError('ElevenLabs TTS', res.status, await res.text());

  const json = await res.json();
  return {
    audio: Buffer.from(json.audio_base64, 'base64'),
    alignment: json.normalized_alignment ?? json.alignment,
  };
};

/**
 * Speech-to-speech (voice changer) : garde l'intonation et le rythme de
 * l'audio source, mais applique une autre voix par-dessus.
 *
 * https://elevenlabs.io/docs/api-reference/speech-to-speech/convert
 * NON TESTE faute de cle ElevenLabs : ecrit d'apres la documentation.
 *
 * @returns {Promise<Buffer>} l'audio converti (mp3)
 */
export const speechToSpeech = async ({
  audioPath,
  voiceId,
  modelId = 'eleven_multilingual_sts_v2',
  apiKey,
  outputFormat = 'mp3_44100_128',
  removeBackgroundNoise = true,
}) => {
  const url = new URL(`${BASE}/speech-to-speech/${voiceId}`);
  url.searchParams.set('output_format', outputFormat);

  const form = new FormData();
  form.append('audio', new Blob([fs.readFileSync(audioPath)]), path.basename(audioPath));
  form.append('model_id', modelId);
  form.append('remove_background_noise', String(removeBackgroundNoise));

  const res = await fetch(url, {
    method: 'POST',
    headers: {'xi-api-key': apiKey},
    body: form,
  });

  if (!res.ok) throw apiError('ElevenLabs speech-to-speech', res.status, await res.text());

  return Buffer.from(await res.arrayBuffer());
};

/**
 * Forced alignment : cale un texte sur un fichier audio existant.
 * @returns {Promise<{characters: Array, words: Array, loss: number}>}
 */
export const forcedAlignment = async ({audioPath, text, apiKey}) => {
  const form = new FormData();
  const buffer = fs.readFileSync(audioPath);
  form.append('file', new Blob([buffer]), path.basename(audioPath));
  form.append('text', text);

  const res = await fetch(`${BASE}/forced-alignment`, {
    method: 'POST',
    headers: {'xi-api-key': apiKey},
    body: form,
  });

  if (!res.ok) throw apiError('ElevenLabs forced-alignment', res.status, await res.text());

  return res.json();
};
