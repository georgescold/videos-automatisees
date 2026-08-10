/**
 * Transforme un script brut (texte colle ou fichier) en beats prets pour le
 * montage : decoupage aux frontieres de phrases, regroupement a la bonne
 * longueur, et proposition de requete visuelle par theme.
 *
 * La requete visuelle proposee ici est une SUGGESTION. L'agent
 * love-scriptwriter produit de bien meilleures requetes ; l'interface
 * signale celles qui ont ete devinees.
 */
import {normalizeWord} from './utils.mjs';

const MIN_WORDS = 8;
const TARGET_WORDS = 18;
const MAX_WORDS = 26;
/** Au-dela, on coupe la phrase elle-meme sur une respiration interne. */
const SPLIT_ABOVE = 30;

/** Abreviations francaises dont le point ne termine pas une phrase. */
const ABBREVIATIONS = [
  'm', 'mm', 'mme', 'mlle', 'mr', 'dr', 'pr', 'st', 'ste', 'av', 'bd',
  'cf', 'ex', 'etc', 'p', 'pp', 'fig', 'art', 'no', 'nos', 'vol', 'ed',
  'env', 'min', 'max', 'env', 'tel', 'jc',
];

const countWords = (text) => text.split(/\s+/).filter((w) => normalizeWord(w).length > 0).length;

/**
 * Decoupe un paragraphe en phrases. Protege les abreviations, les nombres
 * decimaux et les points de suspension.
 */
export const splitSentences = (paragraph) => {
  const sentences = [];
  let current = '';

  const tokens = paragraph.split(/(\s+)/);

  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    current += token;

    if (/^\s+$/.test(token)) continue;

    const endsWithStop = /[.!?…]["»')\]]?$/.test(token);
    if (!endsWithStop) continue;

    // "M." , "cf." , "etc." : le point n'est pas une fin de phrase.
    const bare = token.replace(/[.!?…"»')\]]+$/, '').toLowerCase();
    if (/\.$/.test(token) && ABBREVIATIONS.includes(normalizeWord(bare))) continue;

    // "3.14" ou "1." en tete de liste.
    if (/^\d+\.$/.test(token)) continue;

    // Une majuscule ou une fin de texte doit suivre.
    const next = tokens.slice(i + 1).find((t) => !/^\s*$/.test(t));
    if (next && !/^["«(\[]?[A-ZÀ-ÖØ-Þ0-9]/.test(next)) continue;

    sentences.push(current.trim());
    current = '';
  }

  if (current.trim()) sentences.push(current.trim());
  return sentences.filter(Boolean);
};

/** Coupe une phrase trop longue sur sa respiration interne la plus centrale. */
const splitLongSentence = (sentence) => {
  const words = sentence.split(/\s+/);
  if (words.length <= SPLIT_ABOVE) return [sentence];

  // Points de coupe acceptables, du plus naturel au moins naturel.
  const patterns = [
    /,\s+(?=(?:mais|et|puis|alors|donc|car|parce que|pourtant|sauf|tandis)\b)/gi,
    /\s+(?=(?:mais|pourtant|alors que|tandis que|parce que|si bien que)\b)/gi,
    /(?:;|:)\s+/g,
    /,\s+/g,
  ];

  for (const pattern of patterns) {
    const cuts = [...sentence.matchAll(pattern)].map((m) => m.index + m[0].length);
    if (cuts.length === 0) continue;

    // Le point de coupe le plus proche du milieu.
    const middle = sentence.length / 2;
    const best = cuts.reduce((a, b) => (Math.abs(a - middle) <= Math.abs(b - middle) ? a : b));
    const left = sentence.slice(0, best).trim().replace(/[,;:]$/, '');
    const right = sentence.slice(best).trim();

    if (countWords(left) >= MIN_WORDS / 2 && countWords(right) >= MIN_WORDS / 2) {
      return [...splitLongSentence(left), ...splitLongSentence(right)];
    }
  }

  return [sentence];
};

// ---------------------------------------------------------------------------
// Suggestion de requete visuelle
// ---------------------------------------------------------------------------

/**
 * Themes du champ amoureux. Chaque theme porte ses mots declencheurs en
 * francais et plusieurs requetes Pexels en anglais, pour ne jamais repeter
 * la meme d'un plan a l'autre.
 */
const THEMES = [
  {
    key: 'solitude',
    // « personne » est volontairement absent : en francais il signifie aussi
    // bien « nobody » qu'« a person », et declenche a tort.
    words: ['seul', 'seule', 'solitude', 'vide', 'absence', 'silence', 'isole', 'abandonn'],
    queries: [
      'woman alone looking out window',
      'empty bed morning light',
      'person sitting alone dark room',
      'lonely figure empty street evening',
      'empty chair by window rain',
    ],
  },
  {
    key: 'rupture',
    words: ['rupture', 'quitte', 'quitter', 'separation', 'ex', 'fini', 'perdu', 'adieu', 'partir'],
    queries: [
      'couple walking apart street',
      'hand letting go of hand',
      'suitcase by open door',
      'torn photograph on floor',
      'woman removing ring window light',
    ],
  },
  {
    key: 'attente',
    words: ['attente', 'attendre', 'message', 'telephone', 'reponse', 'appel', 'silence radio', 'texto'],
    queries: [
      'hand holding phone screen glow dark',
      'woman checking phone night bed',
      'phone on table dim light',
      'person waiting cafe window evening',
    ],
  },
  {
    key: 'dispute',
    words: ['dispute', 'crie', 'colere', 'reproche', 'conflit', 'tension', 'engueul', 'fache'],
    queries: [
      'couple arguing silhouette apartment',
      'two people turned away from each other',
      'tense conversation kitchen evening',
      'man frustrated hands on face',
    ],
  },
  {
    key: 'jalousie',
    words: ['jalousie', 'jaloux', 'jalouse', 'doute', 'soupcon', 'mefiance', 'trahison', 'mensonge'],
    queries: [
      'woman looking at phone suspicious',
      'shadow behind curtain window',
      'person watching from distance street',
      'blurred figures crowded bar',
    ],
  },
  {
    key: 'tendresse',
    words: ['tendresse', 'douceur', 'caresse', 'etreinte', 'serrer', 'bras', 'peau', 'baiser', 'embrasse'],
    queries: [
      'couple embracing golden hour',
      'couple holding hands sunset',
      'forehead touching couple soft light',
      'hand on shoulder warm light',
      'couple hugging on beach evening',
    ],
  },
  {
    key: 'desir',
    words: ['desir', 'envie', 'attirance', 'passion', 'chaleur', 'frisson', 'trouble', 'electrique'],
    queries: [
      'close up eyes candlelight',
      'blurred city lights night street',
      'silhouette couple dancing dim room',
      'red curtain soft light interior',
    ],
  },
  {
    key: 'calme',
    words: ['calme', 'stable', 'paix', 'serein', 'securite', 'confiance', 'tranquille', 'repos'],
    queries: [
      'couple sitting quietly park bench',
      'woman closing eyes deep breath sunlight',
      'quiet morning coffee window',
      'calm lake at dawn',
    ],
  },
  {
    key: 'enfance',
    words: ['enfance', 'enfant', 'parent', 'mere', 'pere', 'famille', 'petit', 'grandi', 'appris'],
    queries: [
      'old family photograph wooden table',
      'child holding adult hand',
      'vintage photo album open',
      'empty childhood bedroom light',
    ],
  },
  {
    key: 'reflexion',
    words: ['comprends', 'comprendre', 'penser', 'pense', 'question', 'pourquoi', 'raison', 'cerveau', 'realite'],
    queries: [
      'thoughtful woman warm window light',
      'person writing journal kitchen table',
      'man looking at reflection mirror',
      'woman thinking coffee shop window',
    ],
  },
  {
    key: 'rencontre',
    words: ['rencontre', 'rencontrer', 'nouveau', 'nouvelle', 'premier', 'premiere', 'decouvre', 'rendez-vous'],
    queries: [
      'two people laughing over coffee',
      'first date restaurant candlelight',
      'strangers meeting eyes cafe',
      'couple walking city street evening',
    ],
  },
  {
    key: 'corps',
    words: ['corps', 'coeur', 'ventre', 'respire', 'souffle', 'nerveux', 'tremble', 'battement'],
    queries: [
      'hand on chest breathing',
      'close up hands nervous',
      'woman breathing deeply outdoors',
      'blurred motion running person',
    ],
  },
  {
    key: 'nuit',
    words: ['nuit', 'soir', 'sombre', 'obscur', 'insomnie', 'dormir', 'reve', 'minuit'],
    queries: [
      'city lights night window',
      'person awake in bed at night',
      'empty street lamp night',
      'moonlight through curtains bedroom',
    ],
  },
  {
    key: 'espoir',
    words: ['espoir', 'lumiere', 'avenir', 'demain', 'change', 'recommence', 'guerir', 'mieux'],
    queries: [
      'sunrise over horizon warm',
      'woman smiling gently looking at camera',
      'open window morning light curtain',
      'person walking toward light doorway',
    ],
  },
];

/** Requetes neutres quand aucun theme ne ressort. */
const FALLBACK = [
  'couple soft golden hour portrait',
  'thoughtful person window natural light',
  'hands close up warm light',
  'quiet interior warm lamp light',
  'city street bokeh evening',
  'woman portrait soft daylight',
];

const scoreTheme = (theme, words) => {
  let score = 0;
  for (const word of words) {
    for (const trigger of theme.words) {
      // Racine commune : "quitte" attrape "quittee", "jalou" attrape "jalouse".
      if (word === trigger || (trigger.length >= 4 && word.startsWith(trigger))) {
        score += 1;
        break;
      }
    }
  }
  return score;
};

/**
 * Propose une requete visuelle en anglais pour un texte francais.
 * `used` evite de reproposer la meme requete dans la meme video.
 */
export const suggestVisualQuery = (text, used = new Set()) => {
  const words = text.split(/\s+/).map(normalizeWord).filter(Boolean);

  const ranked = THEMES.map((theme) => ({theme, score: scoreTheme(theme, words)}))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score);

  const pools = ranked.length > 0 ? ranked.map((entry) => entry.theme.queries) : [FALLBACK];

  for (const pool of pools) {
    const free = pool.find((query) => !used.has(query));
    if (free) {
      used.add(free);
      return {query: free, guessed: true};
    }
  }

  // Tout est deja pris : on repart sur le fallback le moins utilise.
  const free = FALLBACK.find((query) => !used.has(query)) ?? FALLBACK[used.size % FALLBACK.length];
  used.add(free);
  return {query: free, guessed: true};
};

// ---------------------------------------------------------------------------
// Point d'entree
// ---------------------------------------------------------------------------

/**
 * @param {string} raw texte du script
 * @returns {{beats: Array<{text:string,visual_query:string,guessed:boolean}>, stats: object}}
 */
/**
 * Recale un script reecrit en texte continu sur ses beats existants.
 *
 * Redecouper tout le texte marcherait, mais detruirait le travail : les beats
 * ne se regrouperaient plus pareil et chaque phrase perdrait son image et son
 * intonation, y compris celles qu'on n'a pas touchees. Ici, on avance dans le
 * nouveau texte en reconnaissant les beats intacts ; seuls les passages
 * reellement modifies sont redecoupes.
 *
 * @param {Array<{text:string,visual_query?:string,emotion?:string}>} beats
 * @param {string} raw le texte reecrit
 * @returns {{beats: Array, preserved: number, created: number}}
 */
export const remapBeats = (beats, raw) => {
  const text = String(raw ?? '')
    .replace(/\r\n/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .trim();

  const normalise = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();
  const result = [];
  let preserved = 0;
  let created = 0;
  let cursor = 0;

  /** Le texte entre deux beats reconnus est nouveau : il faut le decouper. */
  const fillGap = (gap) => {
    const morceau = normalise(gap);
    if (!morceau) return;
    for (const beat of segmentScript(morceau).beats) {
      result.push({text: beat.text, visual_query: beat.visual_query});
      created++;
    }
  };

  for (const beat of beats) {
    const cible = normalise(beat.text);
    if (!cible) continue;
    const at = text.indexOf(cible, cursor);
    if (at === -1) continue; // beat modifie ou supprime : il tombera dans un trou

    fillGap(text.slice(cursor, at));
    result.push({
      text: cible,
      visual_query: beat.visual_query,
      ...(beat.emotion ? {emotion: beat.emotion} : {}),
    });
    preserved++;
    cursor = at + cible.length;
  }

  fillGap(text.slice(cursor));

  return {beats: result, preserved, created};
};

export const segmentScript = (raw) => {
  const text = String(raw ?? '')
    .replace(/\r\n/g, '\n')
    // Les tirets cadratins sont bannis par DESIGN.md et genent la synthese.
    .replace(/\s*[—–]\s*/g, ', ')
    .replace(/[ \t]+/g, ' ')
    .trim();

  if (!text) return {beats: [], stats: {paragraphs: 0, sentences: 0, words: 0}};

  const paragraphs = text.split(/\n\s*\n+/).map((p) => p.replace(/\n/g, ' ').trim()).filter(Boolean);

  /** @type {string[][]} un groupe de phrases par paragraphe */
  const perParagraph = paragraphs.map((paragraph) =>
    splitSentences(paragraph).flatMap(splitLongSentence),
  );

  const chunks = [];
  for (const sentences of perParagraph) {
    let current = [];
    let words = 0;

    for (const sentence of sentences) {
      const n = countWords(sentence);

      // Ajouter cette phrase ferait deborder : on ferme le beat en cours,
      // sauf s'il est encore trop court pour tenir seul.
      if (current.length > 0 && (words + n > MAX_WORDS || words >= TARGET_WORDS)) {
        chunks.push(current.join(' '));
        current = [];
        words = 0;
      }

      current.push(sentence);
      words += n;
    }

    if (current.length > 0) chunks.push(current.join(' '));
  }

  // Un dernier beat trop court est fusionne avec le precedent.
  for (let i = chunks.length - 1; i > 0; i--) {
    if (countWords(chunks[i]) < MIN_WORDS / 2 && countWords(chunks[i - 1]) + countWords(chunks[i]) <= MAX_WORDS + 6) {
      chunks[i - 1] = `${chunks[i - 1]} ${chunks[i]}`;
      chunks.splice(i, 1);
    }
  }

  const used = new Set();
  const beats = chunks.map((chunk) => {
    const {query, guessed} = suggestVisualQuery(chunk, used);
    return {text: chunk, visual_query: query, guessed};
  });

  const totalWords = countWords(text);
  return {
    beats,
    stats: {
      paragraphs: paragraphs.length,
      sentences: perParagraph.reduce((sum, s) => sum + s.length, 0),
      words: totalWords,
      estimatedSeconds: Math.round(totalWords / 2.5),
    },
  };
};
