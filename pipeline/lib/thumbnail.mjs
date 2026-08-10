/**
 * Prompt de miniature YouTube, pret a coller dans ChatGPT.
 *
 * Doctrine : la miniature ne resume pas la video, elle incarne LA PEUR que le
 * spectateur porte deja. C'est elle qui arrete le pouce. Le hook du script est
 * precisement cette peur formulee en une phrase : il devient le coeur du
 * prompt. Le texte incruste reprend youtube.thumbnail_text, pense pour etre
 * lisible sur un ecran de telephone.
 *
 * Un script peut imposer son propre prompt via youtube.thumbnail_prompt :
 * il est alors repris tel quel, sans reconstruction.
 */
export const buildThumbnailPrompt = (script) => {
  const yt = script?.youtube ?? {};
  const impose = String(yt.thumbnail_prompt ?? '').trim();
  if (impose) return impose;

  const texte =
    String(yt.thumbnail_text ?? '').trim() ||
    String(yt.title ?? script?.title ?? '').trim().toUpperCase();
  const peur =
    String(script?.hook ?? '').trim() ||
    String(script?.beats?.[0]?.text ?? '').trim() ||
    String(script?.title ?? '').trim();

  return [
    'Crée une image au format 1280x720 (miniature YouTube, 16:9).',
    '',
    "Sujet : photographie réaliste, gros plan serré sur le visage d'une jeune femme",
    '(25 à 35 ans), regard planté dans la caméra. Son expression doit incarner',
    `exactement cette peur : « ${peur} »`,
    'Le spectateur doit se reconnaître en une fraction de seconde : tension retenue,',
    'pas de grimace théâtrale, pas de sourire.',
    '',
    'Lumière : cinématographique et contrastée, source unique légèrement latérale,',
    'fond sombre et flou (intérieur le soir). Ambiance intime, presque inconfortable.',
    'Palette : tons sombres, peau naturelle, un seul accent bordeaux (#8B2D4A).',
    '',
    `Texte incrusté : « ${texte} »`,
    'Très grand, en majuscules, police sans-serif ultra-grasse, couleur crème (#FBF9F7)',
    'avec un léger contour sombre. Placé sur le tiers gauche ou le tiers supérieur,',
    "sans couvrir le visage. Lisible d'un coup d'œil sur un écran de téléphone.",
    '',
    'Interdits : cartoon, illustration, rendu 3D, watermark, logo, texte',
    'supplémentaire, membres déformés, flou sur le visage.',
  ].join('\n');
};
