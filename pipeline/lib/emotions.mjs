/**
 * Intonation de la voix off, beat par beat.
 *
 * Le modele eleven_v3 obeit a des « balises audio » posees en clair dans le
 * texte : [sad], [whispers], [warmly]... Elles ne sont pas prononcees, elles
 * dirigent le jeu. Ce module traduit un vocabulaire francais d'emotions vers
 * ces balises, devine l'emotion quand le script n'en donne pas, et sait
 * ensuite retirer les balises partout ou elles ne doivent pas apparaitre :
 *   - dans les sous-titres,
 *   - dans l'alignement renvoye par ElevenLabs (qui les contient !),
 *   - dans le texte envoye aux voix locales, qui les liraient a voix haute.
 *
 * Verifie sur l'API le 29/07/2026 : les balises sont facturees comme des
 * caracteres ordinaires, et n'occupent aucune duree audible — sauf les
 * reactions ([sighs]), qui sont jouees, ce qui est leur role.
 */

/** Modele obligatoire pour que les balises soient comprises. */
export const TAGGED_MODEL_ID = 'eleven_v3';

/**
 * Vocabulaire d'intonation. Cle francaise -> balise v3.
 * Chaque emotion a une « soeur » : elle sert a casser la monotonie quand la
 * meme intonation revient trop souvent d'affilee.
 */
export const EMOTIONS = {
  pose: {label: 'Posé, neutre', tag: '[calm]', soeur: 'grave'},
  doux: {label: 'Doux', tag: '[softly]', soeur: 'tendre'},
  tendre: {label: 'Tendre, chaleureux', tag: '[warmly]', soeur: 'doux'},
  intime: {label: 'Intime, confidence', tag: '[whispers]', soeur: 'doux'},
  triste: {label: 'Triste', tag: '[sad]', soeur: 'melancolique'},
  melancolique: {label: 'Mélancolique', tag: '[sorrowful]', soeur: 'triste'},
  grave: {label: 'Grave, sérieux', tag: '[serious]', soeur: 'pose'},
  curieux: {label: 'Interpelle, questionne', tag: '[curious]', soeur: 'vif'},
  espoir: {label: "Plein d'espoir", tag: '[hopeful]', soeur: 'tendre'},
  complice: {label: 'Complice, léger', tag: '[mischievously]', soeur: 'vif'},
  vif: {label: 'Vif, engagé', tag: '[excited]', soeur: 'curieux'},
  soupir: {label: 'Soupir, lassitude', tag: '[sighs]', soeur: 'melancolique'},
};

export const EMOTION_KEYS = Object.keys(EMOTIONS);

export const isEmotion = (key) => Object.hasOwn(EMOTIONS, String(key ?? ''));

/**
 * Marqueurs FORTS uniquement. Un mot-cle ne comprend pas un texte : il ne sert
 * ici que de filet quand le script ne dit rien. Les mots ambigus (« amour »,
 * « avant », « peur ») sont volontairement absents — ils se trompaient plus
 * souvent qu'ils n'aidaient. La vraie intonation s'ecrit dans le script.
 */
const LEXIQUE = [
  ['triste', /rupture|quitté|quittée|abandonn|souffr|douleur|blessur|pleur|larme|solitude|chagrin|brisé|effondr|trahi/i],
  ['melancolique', /souvenir|nostalg|regret|autrefois|à l'époque|des années plus tard/i],
  ['espoir', /guéri|apais|répare|mérites|recommenc|libre|avancer|s'en sortir|meilleur|demain/i],
  // Structure de revelation : « ce n'est pas X, c'est Y ». Le cœur du propos.
  ['grave', /n(?:'|’)est pas .{0,60}?c(?:'|’)est|en réalité|la vérité|au fond/i],
  ['intime', /je vais te dire|personne ne te (?:le )?dira|entre nous|secret/i],
  ['vif', /^(?:écoute|arrête|regarde|attends|stop)\b/i],
];

/**
 * Devine l'intonation d'un beat qui n'en declare pas. Aucun beat ne reste
 * sans intention : une lecture plate est le defaut a eviter.
 *
 * Priorite : question adressee au spectateur, puis marqueur fort, puis place
 * dans le recit (accroche / chute), puis douceur par defaut.
 *
 * @param {string} text
 * @param {number} index position du beat
 * @param {number} total nombre de beats
 */
export const inferEmotion = (text, index, total) => {
  const clean = String(text ?? '').trim();

  // L'ACCROCHE PASSE AVANT TOUT. Deux secondes pour arreter un pouce qui
  // defile : une accroche murmuree ou triste laisse partir le spectateur.
  // Une question interpelle, sinon on attaque franchement.
  if (index === 0) return /\?\s*$/.test(clean) ? 'curieux' : 'vif';

  // Une question s'adresse au spectateur : elle interpelle.
  if (/\?\s*$/.test(clean)) return 'curieux';

  for (const [emotion, motif] of LEXIQUE) {
    if (motif.test(clean)) return emotion;
  }

  // La chute doit reconforter.
  if (total > 2 && index === total - 1) return 'espoir';

  return 'doux';
};

/**
 * Intonation retenue pour chaque beat : celle du script si elle est valide,
 * sinon celle devinee. La meme intonation trois fois de suite bascule sur sa
 * soeur, sinon la voix s'installe dans une seule couleur.
 *
 * @returns {Array<{emotion: string, tag: string, devinee: boolean}>}
 */
export const resolveEmotions = (beats) => {
  const resolved = [];

  for (const [index, beat] of beats.entries()) {
    const declaree = isEmotion(beat.emotion) ? beat.emotion : null;
    let emotion = declaree ?? inferEmotion(beat.text, index, beats.length);

    // Uniquement sur les intonations devinees : un choix explicite se respecte.
    if (!declaree) {
      const deuxDernieres = resolved.slice(-2);
      if (
        deuxDernieres.length === 2 &&
        deuxDernieres.every((r) => r.emotion === emotion)
      ) {
        emotion = EMOTIONS[emotion].soeur;
      }
    }

    resolved.push({emotion, tag: EMOTIONS[emotion].tag, devinee: !declaree});
  }

  return resolved;
};

/** Le texte lu, sans aucune direction de jeu. */
export const cleanVoiceover = (beats) =>
  beats.map((b) => String(b.text ?? '').trim()).join(' ');

/** Le texte envoye a eleven_v3, chaque beat precede de son intonation. */
export const taggedVoiceover = (beats, emotions) =>
  beats
    .map((b, i) => `${emotions[i].tag} ${String(b.text ?? '').trim()}`)
    .join(' ');

/** Retire les balises d'un texte (et les espaces qu'elles laissent). */
export const stripTags = (text) =>
  String(text ?? '')
    .replace(/\[[^\]]*\]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

/**
 * ElevenLabs renvoie les balises DANS l'alignement caractere par caractere.
 * Sans ce nettoyage, « [sad] » deviendrait un mot de sous-titre et decalerait
 * le decoupage des beats.
 */
export const stripTagsFromAlignment = (alignment) => {
  if (!alignment?.characters) return alignment;

  const chars = alignment.characters;
  const starts = alignment.character_start_times_seconds ?? [];
  const ends = alignment.character_end_times_seconds ?? [];

  const keptChars = [];
  const keptStarts = [];
  const keptEnds = [];
  let inTag = false;

  for (let i = 0; i < chars.length; i++) {
    const char = chars[i];
    if (char === '[') {
      inTag = true;
      continue;
    }
    if (inTag) {
      // Le ']' ferme la balise et n'est pas garde non plus.
      if (char === ']') inTag = false;
      continue;
    }
    keptChars.push(char);
    keptStarts.push(starts[i]);
    keptEnds.push(ends[i]);
  }

  return {
    characters: keptChars,
    character_start_times_seconds: keptStarts,
    character_end_times_seconds: keptEnds,
  };
};
