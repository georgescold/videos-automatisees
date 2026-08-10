/**
 * Rotation des cles ElevenLabs.
 *
 * Chaque compte gratuit donne 10 000 credits par mois (1 credit = 1 caractere).
 * Avec plusieurs comptes, l'usine :
 *   1. compte les caracteres de la voix off AVANT de synthetiser,
 *   2. releve le quota reel de chaque cle,
 *   3. refuse tout de suite si la somme ne couvre pas la video (rien n'est
 *      consomme, aucune demi-video),
 *   4. sinon repartit les morceaux entre les cles, la plus courte d'abord :
 *      on vide les petits restes et on garde les gros quotas pour les longues
 *      videos.
 * Si une cle casse en cours de route (quota epuise entre-temps, cle revoquee),
 * le morceau repart sur la cle suivante.
 */
import {chunkText, getQuota, ttsWithTimestamps} from './elevenlabs.mjs';
import {elevenLabsKeys, maskKey, setQuota} from './keys.mjs';
import {log} from './utils.mjs';

/** 1 credit ElevenLabs = 1 caractere envoye a la synthese. */
export const estimateCredits = (text) => String(text ?? '').length;

export const formatCredits = (n) => Number(n).toLocaleString('fr-FR');

/** Date de remise a zero. Une date deja passee n'apprend rien : on la tait. */
export const formatReset = (unix) => {
  if (!unix || unix * 1000 < Date.now()) return null;
  return new Date(unix * 1000).toLocaleDateString('fr-FR', {day: 'numeric', month: 'long'});
};

/**
 * Quota reel de chaque cle du trousseau, en parallele.
 * @returns {Promise<Array<{id, label, masked, remaining, limit, used, tier, resetUnix, error}>>}
 */
export const quotaSnapshot = async () => {
  const keys = elevenLabsKeys();
  return Promise.all(
    keys.map(async (record) => {
      const base = {id: record.id, label: record.label, masked: maskKey(record.key)};
      try {
        const quota = await getQuota(record.key);
        setQuota(record.id, quota);
        // Seuls les paliers payants accordent la licence commerciale et
        // l'acces aux voix de la bibliotheque.
        return {...base, ...quota, paid: (quota.tier ?? 'free') !== 'free', error: null};
      } catch (err) {
        const error = err.badKey ? 'Clé refusée par ElevenLabs' : err.message;
        setQuota(record.id, null);
        return {...base, remaining: 0, limit: 0, used: 0, tier: null, resetUnix: null, error};
      }
    }),
  );
};

/**
 * Repartit des morceaux de texte sur les cles disponibles, sans rien consommer.
 * Simule exactement ce que fera la synthese : plus petit reste suffisant d'abord.
 * @returns {{ok: boolean, plan: Array<{chunk: number, keyId: string, label: string, cost: number}>}}
 */
/**
 * Comptes autorises pour un audio publie.
 *
 * Le palier gratuit d'ElevenLabs n'accorde AUCUNE licence commerciale : un
 * son genere dessus ne peut pas partir sur une chaine monetisee. Des qu'un
 * compte payant existe, la synthese ne sort plus que de celui-la. Sans compte
 * payant, on retombe sur les gratuits — a l'utilisateur de savoir ce qu'il
 * publie.
 */
export const licensedPool = (snapshot, licensed = true) => {
  const vivantes = snapshot.filter((k) => !k.error);
  if (!licensed) return vivantes;
  const payantes = vivantes.filter((k) => k.paid);
  return payantes.length > 0 ? payantes : vivantes;
};

export const planChunks = (costs, snapshot, licensed = true) => {
  const pool = licensedPool(snapshot, licensed).map((k) => ({...k, left: k.remaining}));
  const plan = [];

  for (const [index, cost] of costs.entries()) {
    const candidates = pool.filter((k) => k.left >= cost).sort((a, b) => a.left - b.left);
    const chosen = candidates[0];
    if (!chosen) return {ok: false, plan};
    chosen.left -= cost;
    plan.push({chunk: index, keyId: chosen.id, label: chosen.label, cost});
  }
  return {ok: true, plan};
};

/** Message d'echec detaille : ce que chaque compte a encore, et quoi faire. */
const shortageMessage = (needed, snapshot) => {
  if (snapshot.length === 0) {
    return (
      `Aucune clé ElevenLabs dans le trousseau (cette voix off demande ${formatCredits(needed)} crédits). ` +
      'Ajoute une clé dans l\'interface (bouton « Clés »), ou choisis une voix locale (Piper / XTTS), qui ne coûte rien.'
    );
  }

  const lines = snapshot.map((k) => {
    if (k.error) return `    • ${k.label} (${k.masked}) : ${k.error}`;
    const reset = formatReset(k.resetUnix);
    return (
      `    • ${k.label} (${k.masked}) : ${formatCredits(k.remaining)} crédits restants` +
      (reset ? ` — remise à zéro le ${reset}` : '')
    );
  });
  const total = snapshot.reduce((sum, k) => sum + (k.error ? 0 : k.remaining), 0);

  return (
    `Quota ElevenLabs insuffisant : cette voix off demande ${formatCredits(needed)} crédits, ` +
    `${formatCredits(total)} disponibles au total.\n${lines.join('\n')}\n` +
    '    Ajoute une clé (bouton « Clés » dans l\'interface), raccourcis le script, ' +
    'ou passe la voix off en local (Piper / XTTS, sans clé).'
  );
};

/**
 * Verification prealable, sans rien consommer.
 * @returns {Promise<{ok, needed, total, snapshot, plan, message}>}
 */
export const checkQuota = async (text, {licensed = true} = {}) => {
  const needed = estimateCredits(text);
  const snapshot = await quotaSnapshot();
  const costs = chunkText(String(text ?? '')).map((c) => c.length);
  const {ok, plan} = planChunks(costs, snapshot, licensed);
  // Le total annonce doit etre celui des comptes reellement utilisables,
  // sinon on promet des credits qui ne serviront pas.
  const pool = licensedPool(snapshot, licensed);
  const total = pool.reduce((sum, k) => sum + k.remaining, 0);

  return {
    ok,
    needed,
    total,
    snapshot,
    pool,
    plan,
    message: ok ? null : shortageMessage(needed, pool),
  };
};

/**
 * Execute un appel ElevenLabs sur la premiere cle qui a le quota demande,
 * en passant a la suivante si elle casse.
 *
 * @param {number} needed  credits estimes pour cet appel
 * @param {(apiKey: string) => Promise<any>} run
 * @param {Array} [snapshot] quotas deja releves (evite un aller-retour)
 */
export const withKey = async ({needed, run, snapshot, quiet = false, licensed = true}) => {
  const shot = snapshot ?? (await quotaSnapshot());
  const records = elevenLabsKeys();

  const candidates = licensedPool(shot, licensed)
    .filter((k) => k.remaining >= Math.max(needed, 1))
    .sort((a, b) => a.remaining - b.remaining);

  if (candidates.length === 0) throw new Error(shortageMessage(needed, licensedPool(shot, licensed)));

  let lastError = null;
  for (const candidate of candidates) {
    const record = records.find((r) => r.id === candidate.id);
    if (!record) continue;
    try {
      const result = await run(record.key);
      if (!quiet) {
        log.info(
          `Clé « ${candidate.label} » : ${formatCredits(needed)} crédits utilisés ` +
            `(${formatCredits(Math.max(0, candidate.remaining - needed))} restants)`,
        );
      }
      candidate.remaining = Math.max(0, candidate.remaining - needed);
      return result;
    } catch (err) {
      if (!err.quotaExceeded && !err.badKey && !err.libraryVoice) throw err;
      // Trois raisons d'ecarter une cle, toutes propres a ce compte :
      // quota epuise, cle revoquee, ou voix reservee au plan payant. Un
      // trousseau mixte (un compte payant, des gratuits) tombe dans le
      // troisieme cas : seule la cle payante peut jouer la voix demandee.
      candidate.error = err.badKey
        ? 'Clé refusée par ElevenLabs'
        : err.libraryVoice
          ? 'Voix réservée au plan payant'
          : 'Quota épuisé';
      if (!err.libraryVoice) candidate.remaining = 0;
      lastError = err;
      log.warn(`Clé « ${candidate.label} » écartée (${candidate.error}) — on passe à la suivante`);
    }
  }

  // Toutes les cles ont refuse la voix : c'est la voix qu'il faut changer,
  // pas les cles. Le message doit le dire, sinon on cherche au mauvais endroit.
  if (lastError?.libraryVoice) {
    throw new Error(
      "Aucun de tes comptes ne peut utiliser cette voix : elle vient de la bibliothèque ElevenLabs, " +
        'réservée aux plans payants. Choisis une voix « premade » dans l\'interface, ' +
        'ou passe un compte en plan payant (6 $/mois) pour débloquer les voix françaises.',
    );
  }

  throw new Error(
    `Aucune clé ElevenLabs utilisable.\n    ${lastError?.message ?? shortageMessage(needed, shot)}`,
  );
};

/**
 * Voix off complete, quota verifie d'abord puis morceaux repartis entre les
 * cles. Rien n'est envoye a ElevenLabs si le total ne suffit pas.
 *
 * @returns {Promise<{audio: Buffer, alignment: object|null}>}
 */
export const synthesizeVoice = async ({text, voiceId, modelId, outputFormat, voiceSettings}) => {
  const chunks = chunkText(text);
  const check = await checkQuota(text);

  const payantes = check.pool.filter((k) => k.paid);
  log.info(
    `Quota ElevenLabs : ${formatCredits(check.needed)} crédits nécessaires, ` +
      `${formatCredits(check.total)} disponibles sur ${check.pool.length} clé(s)`,
  );
  if (payantes.length > 0) {
    log.info(
      `Licence commerciale : synthèse réservée aux comptes payants (${payantes.map((k) => k.label).join(', ')})`,
    );
  } else if (check.pool.length > 0) {
    log.warn(
      "Aucun compte payant : l'audio produit n'est PAS couvert par une licence commerciale.",
    );
  }
  if (!check.ok) throw new Error(check.message);
  if (chunks.length > 1) log.info(`Texte long : ${chunks.length} segments de synthèse`);

  const buffers = [];
  let alignment = null;

  for (const [i, chunk] of chunks.entries()) {
    const result = await withKey({
      needed: chunk.length,
      snapshot: check.snapshot,
      run: (apiKey) =>
        ttsWithTimestamps({text: chunk, voiceId, modelId, apiKey, outputFormat, voiceSettings}),
    });
    buffers.push(result.audio);
    if (i === 0) alignment = result.alignment;
    log.ok(`Segment ${i + 1}/${chunks.length} synthétisé`);
  }

  return {
    audio: Buffer.concat(buffers),
    // L'alignement du 1er segment ne couvre pas tout : on force le realignement.
    alignment: chunks.length === 1 ? alignment : null,
  };
};
