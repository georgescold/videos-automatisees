import {log, normalizeWord} from './utils.mjs';

/**
 * Convertit l'alignement caractere-par-caractere d'ElevenLabs (TTS) en mots.
 * @returns {Array<{text:string,start:number,end:number}>} temps en secondes
 */
export const wordsFromCharacterAlignment = (alignment) => {
  const chars = alignment.characters ?? [];
  const starts = alignment.character_start_times_seconds ?? [];
  const ends = alignment.character_end_times_seconds ?? [];

  const words = [];
  let text = '';
  let start = null;
  let end = null;

  const flush = () => {
    if (text.trim().length > 0 && start !== null) {
      words.push({text: text.trim(), start, end: end ?? start});
    }
    text = '';
    start = null;
    end = null;
  };

  for (let i = 0; i < chars.length; i++) {
    const char = chars[i];
    if (/\s/.test(char)) {
      flush();
      continue;
    }
    if (start === null) start = starts[i] ?? 0;
    end = ends[i] ?? start;
    text += char;
  }
  flush();

  return mergeLonePunctuation(words);
};

/**
 * La typographie francaise detache « : », « ? » et « ! » du mot par une
 * espace. Decoupes ainsi, ils deviennent des mots a part entiere dans
 * l'alignement, alors que le decoupage des beats les ignore : le compte se
 * desaligne et les images finissent en face des mauvaises phrases.
 *
 * On les recolle au mot precedent. Les sous-titres gardent la ponctuation,
 * et un mot aligne correspond bien a un mot du script.
 */
const mergeLonePunctuation = (words) => {
  const merged = [];
  for (const word of words) {
    if (normalizeWord(word.text).length === 0) {
      const previous = merged[merged.length - 1];
      // Une ponctuation en tete n'a rien a quoi se rattacher : on la jette.
      if (!previous) continue;
      previous.text = `${previous.text} ${word.text}`;
      previous.end = Math.max(previous.end, word.end);
      continue;
    }
    merged.push(word);
  }
  return merged;
};

/** Normalise la reponse du forced alignment vers la meme forme. */
export const wordsFromForcedAlignment = (json) =>
  (json.words ?? [])
    .filter((w) => normalizeWord(w.text ?? '').length > 0)
    .map((w) => ({text: (w.text ?? '').trim(), start: w.start, end: w.end}));

/**
 * Decoupe le flux de mots en groupes naturels : une phrase, ou un bloc
 * separe du suivant par un silence marque.
 */
const splitIntoGroups = (words, gapMs) => {
  const groups = [];
  let current = [];

  for (const [i, word] of words.entries()) {
    current.push(word);
    const next = words[i + 1];
    const endsSentence = /[.!?…:]$/.test(word.text);
    const silenceAfter = next ? (next.start - word.end) * 1000 : 0;

    if (endsSentence || silenceAfter > gapMs) {
      groups.push(current);
      current = [];
    }
  }
  if (current.length > 0) groups.push(current);

  return groups;
};

/**
 * Le mot tel qu'il s'affiche a l'ecran.
 *
 * La ponctuation basse (point, virgule, deux-points, point-virgule) sert la
 * VOIX : elle cree les respirations. A l'ecran elle ne sert a rien et casse
 * la lecture rapide. On la retire donc de l'affichage seulement, jamais du
 * texte envoye a la synthese. Le point d'interrogation et l'exclamation
 * restent : ils portent du sens.
 */
export const captionText = (text) =>
  String(text ?? '')
    .replace(/[.,;:]+/g, '')
    .replace(/\s+/g, ' ')
    .trim();

/**
 * Regroupe les mots en "pages" de sous-titres facon TikTok.
 *
 * Les pages sont calculees phrase par phrase et equilibrees : une phrase de
 * 7 mots donne 3 / 2 / 2 et non 3 / 3 / 1. Cela evite les pages orphelines
 * d'un seul mot en fin de phrase, qui font clignoter l'ecran.
 */
export const buildPages = (
  words,
  {maxWords = 3, maxChars = 24, maxDurationMs = 1800, gapMs = 420} = {},
) => {
  const pages = [];

  const pushPage = (chunk) => {
    if (chunk.length === 0) return;
    const tokens = chunk
      .map((w) => ({
        text: captionText(w.text),
        fromMs: Math.round(w.start * 1000),
        toMs: Math.round(w.end * 1000),
      }))
      // Un mot reduit a sa seule ponctuation n'a plus rien a afficher.
      .filter((t) => t.text.length > 0);
    if (tokens.length === 0) return;

    pages.push({
      startMs: Math.round(chunk[0].start * 1000),
      endMs: Math.round(chunk[chunk.length - 1].end * 1000),
      tokens,
    });
  };

  for (const group of splitIntoGroups(words, gapMs)) {
    const chars = group.reduce((sum, w) => sum + w.text.length + 1, 0) - 1;
    const durationMs = (group[group.length - 1].end - group[0].start) * 1000;

    // Nombre de pages impose par la contrainte la plus forte.
    const pageCount = Math.max(
      Math.ceil(group.length / maxWords),
      Math.ceil(chars / maxChars),
      Math.ceil(durationMs / maxDurationMs),
      1,
    );

    // Repartition equilibree : le reste est distribue sur les 1res pages.
    const base = Math.floor(group.length / pageCount);
    const remainder = group.length % pageCount;

    let cursor = 0;
    for (let i = 0; i < pageCount; i++) {
      const size = base + (i < remainder ? 1 : 0);
      if (size === 0) continue;
      pushPage(group.slice(cursor, cursor + size));
      cursor += size;
    }
  }

  // Etire chaque page jusqu'a la suivante pour eviter les trous a l'ecran.
  for (let i = 0; i < pages.length; i++) {
    const next = pages[i + 1];
    const naturalEnd = pages[i].endMs + 260;
    pages[i].endMs = next ? Math.min(naturalEnd, next.startMs) : naturalEnd;
    if (pages[i].endMs <= pages[i].startMs) {
      pages[i].endMs = pages[i].startMs + 200;
    }
  }

  return pages;
};

/**
 * Repartit les mots alignes sur les beats du script.
 * Le voiceover etant la concatenation des beats, la consommation
 * sequentielle des mots suffit — on verifie la derive au passage.
 * @returns {Array<{index:number,startMs:number,endMs:number}>}
 */
export const mapBeatsToTimeline = (beats, words) => {
  const timeline = [];
  let cursor = 0;
  let drift = 0;

  for (const [index, beat] of beats.entries()) {
    const beatWords = beat.text.split(/\s+/).filter((w) => normalizeWord(w).length > 0);
    const take = Math.min(beatWords.length, words.length - cursor);

    if (take <= 0) {
      const last = timeline[timeline.length - 1];
      timeline.push({
        index,
        startMs: last ? last.endMs : 0,
        endMs: last ? last.endMs : 0,
      });
      continue;
    }

    const slice = words.slice(cursor, cursor + take);

    // Controle qualite : le 1er mot du beat doit correspondre.
    if (normalizeWord(slice[0].text) !== normalizeWord(beatWords[0])) {
      drift++;
    }

    timeline.push({
      index,
      startMs: Math.round(slice[0].start * 1000),
      endMs: Math.round(slice[slice.length - 1].end * 1000),
    });
    cursor += take;
  }

  if (drift > 0) {
    log.warn(
      `${drift} beat(s) legerement desynchronises du texte aligne — verifie que "voiceover" correspond bien a la concatenation des beats.`,
    );
  }

  return timeline;
};
