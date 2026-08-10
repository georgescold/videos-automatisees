/**
 * Sélection de voix pour la chaîne « amour ».
 *
 * La bibliothèque ElevenLabs compte plus de trois cents voix françaises. La
 * plupart ne servent à rien ici : voix de service client, voix commerciales,
 * voix UGC surexcitées. Raconter une histoire d'amour demande autre chose —
 * du calme, de la proximité, une voix qui sait tenir une confidence sans
 * jouer la comédie.
 *
 * Retenues sur trois critères : un usage déclaré compatible (narration,
 * podcast, conversation), un registre chaud ou posé, et une popularité réelle
 * (nombre de clonages) qui écarte les voix bâclées. Chaque entrée porte ce
 * qu'elle apporte, pour choisir sans tout écouter.
 *
 * L'ordre compte : c'est celui de la liste dans l'interface, du plus proche
 * de la ligne éditoriale au plus spécifique.
 */
export const CURATED_VOICES = [
  // --- Féminines : le registre principal de la chaîne -----------------------
  {
    id: 'sANWqF1bCMzR6eyZbCGw',
    name: 'Marie',
    gender: 'female',
    note: 'Chaleureuse et expressive. Le meilleur passe-partout : tient aussi bien la confidence que la révélation.',
  },
  {
    id: '3EkZsEff6fKDaatADyt6',
    name: 'Marishnou',
    gender: 'female',
    note: 'Sereine, nocturne, presque murmurée. Faite pour les vidéos qu\'on regarde seul, tard.',
  },
  {
    id: 'WeAAwKYcS06VmXw086yZ',
    name: 'Victoria',
    gender: 'female',
    note: 'Parisienne, grave et posée. Donne du poids aux vérités qui dérangent.',
  },
  {
    id: 'TojRWZatQyy9dujEdiQ1',
    name: 'Koraly, conteuse',
    gender: 'female',
    note: 'Très modulée : elle joue le récit au lieu de le lire. Pour les vidéos les plus narratives.',
  },
  {
    id: 'sH0WdfE5fsKuM2otdQZr',
    name: 'Koraly, adoucie',
    gender: 'female',
    note: 'La même voix, registre feutré. Quand le sujet est une blessure plutôt qu\'une histoire.',
  },
  {
    id: '5opxviIE64D8KxYYJKpx',
    name: 'Sarah veloutée',
    gender: 'female',
    note: 'Jeune, veloutée, presque méditative. Apaise un propos dur sans l\'affadir.',
  },
  {
    id: 'tMyQcCxfGDdIt7wJ2RQw',
    name: 'Marie Alice',
    gender: 'female',
    note: 'Jeune, douce, captivante. La voix d\'une amie qui te parle, pas d\'une narratrice.',
  },
  {
    id: 'tLK6fPv15M0oKv4V3ACR',
    name: 'Mélanie',
    gender: 'female',
    note: 'Élégante et calme. Un ton documentaire feutré, sans froideur.',
  },
  {
    id: 'cuo3D4C6LVenyV7b2Kpd',
    name: 'Anna P',
    gender: 'female',
    note: 'Voix de podcast parisienne. Naturelle sur les formats longs.',
  },
  {
    id: 'ucMmKRQbfDEYyb2IIGax',
    name: 'Aurore',
    gender: 'female',
    note: 'Parisienne au timbre grave. Rare et reconnaissable : bon choix pour installer une identité.',
  },
  {
    id: 'd3AXX0BlgJHYFCuH9X88',
    name: 'Émilie',
    gender: 'female',
    note: 'Ton podcast décontracté. Pour les vidéos qui parlent d\'égal à égal plutôt que d\'expliquer.',
  },
  {
    id: 'PSVUmed8NvS8aUA3d5oO',
    name: 'Anna, lectrice',
    gender: 'female',
    note: 'Narratrice de livre audio, très régulière. Sûre sur les scripts longs.',
  },

  // --- Masculines : contrepoint et registre documentaire --------------------
  {
    id: 'YV28ox2c5Cuh5rim0LrW',
    name: 'Marcel',
    gender: 'male',
    note: 'Chaud, doux, intime. La voix masculine la plus proche de la ligne éditoriale.',
  },
  {
    id: 'UBXZKOKbt62aLQHhc1Jm',
    name: 'François Louis',
    gender: 'male',
    note: 'Grave, chaleureux, posé. Une autorité tranquille pour les sujets sérieux.',
  },
  {
    id: 'I0ZNjxaJrLklKmZK1mlA',
    name: 'Waul, conteur',
    gender: 'male',
    note: 'Calme et narratif. Raconte une histoire sans jamais forcer.',
  },
  {
    id: 'hqfrgApggtO1785R4Fsn',
    name: 'Théodore',
    gender: 'male',
    note: 'Méditatif, très ancré. Pour les vidéos d\'apaisement ou de reconstruction.',
  },
  {
    id: 'jUHQdLfy668sllNiNTSW',
    name: 'Clément',
    gender: 'male',
    note: 'Parisien, calme, neutre. Le plus sobre : laisse le texte occuper toute la place.',
  },
  {
    id: 'BVBq6HVJVdnwOMJOqvy9',
    name: 'Nova',
    gender: 'male',
    note: 'Grave et calme, registre conversationnel. Proche du micro, sans effet.',
  },
  {
    id: 'c365oriviHmAhyLhpuN6',
    name: 'Adrien Clairon',
    gender: 'male',
    note: 'Narrateur de podcast. Le ton documentaire classique, si tu veux ce format.',
  },
];

export const CURATED_IDS = new Set(CURATED_VOICES.map((v) => v.id));

export const curatedInfo = (id) => CURATED_VOICES.find((v) => v.id === id) ?? null;
