/**
 * Trousseau local des cles ElevenLabs.
 *
 * Un compte gratuit ElevenLabs = 10 000 credits par mois. Avec plusieurs
 * comptes, on additionne les quotas : le trousseau garde toutes les cles,
 * et elevenlabs-pool.mjs choisit celle qui a de quoi couvrir la video AVANT
 * de lancer la synthese.
 *
 * Fichier : .keys.json a la racine. Jamais versionne (cf. .gitignore).
 * La cle eventuellement presente dans .env est importee automatiquement, pour
 * que le trousseau montre tout ce que l'usine sait utiliser.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import {env} from './env.mjs';
import {p, readJson, writeJson} from './utils.mjs';

const FILE = p('.keys.json');

const emptyStore = () => ({version: 1, elevenlabs: [], dismissedEnvKeys: []});

/** Empreinte courte : sert a reconnaitre une cle sans la stocker en clair ailleurs. */
const fingerprint = (key) => crypto.createHash('sha256').update(key).digest('hex').slice(0, 16);

const readStore = () => {
  if (!fs.existsSync(FILE)) return emptyStore();
  try {
    const data = readJson(FILE);
    return {
      version: 1,
      elevenlabs: Array.isArray(data.elevenlabs) ? data.elevenlabs.filter((k) => k?.key) : [],
      dismissedEnvKeys: Array.isArray(data.dismissedEnvKeys) ? data.dismissedEnvKeys : [],
    };
  } catch {
    // Trousseau illisible : on le met de cote plutot que de l'ecraser en
    // silence, une cle perdue coute un compte entier.
    fs.renameSync(FILE, `${FILE}.invalide`);
    return emptyStore();
  }
};

const writeStore = (store) => {
  writeJson(FILE, store);
  return store;
};

/**
 * Reprend la cle du .env dans le trousseau, une seule fois : c'est ce qui fait
 * apparaitre « la cle deja la » dans la liste des cles stockees.
 */
const importEnvKey = (store) => {
  const raw = String(env.elevenLabsKey ?? '').trim();
  if (!raw) return false;
  if (store.elevenlabs.some((k) => k.key === raw)) return false;
  // L'utilisateur a supprime cette cle du trousseau : on ne la reimporte pas.
  if (store.dismissedEnvKeys.includes(fingerprint(raw))) return false;

  store.elevenlabs.push({
    id: crypto.randomUUID().slice(0, 8),
    label: 'Clé du .env',
    key: raw,
    source: 'env',
    addedAt: new Date().toISOString(),
    quota: null,
  });
  return true;
};

const load = () => {
  const store = readStore();
  if (importEnvKey(store)) writeStore(store);
  return store;
};

/** sk_af45c7…fa29 : assez pour reconnaitre la cle, pas assez pour s'en servir. */
export const maskKey = (key) => {
  const str = String(key ?? '');
  if (str.length <= 12) return '••••';
  return `${str.slice(0, 8)}…${str.slice(-4)}`;
};

/** Toutes les cles utilisables, valeur en clair comprise (usage interne). */
export const elevenLabsKeys = () => load().elevenlabs;

export const hasElevenLabsKey = () => load().elevenlabs.length > 0;

/** Vue sans secret, pour l'interface. */
export const publicKeys = () =>
  load().elevenlabs.map(({id, label, key, source, addedAt, quota}) => ({
    id,
    label,
    masked: maskKey(key),
    source: source ?? 'manuel',
    addedAt,
    quota: quota ?? null,
  }));

const KEY_SHAPE = /^[A-Za-z0-9_-]{20,120}$/;

/**
 * @returns {{id: string}} la cle ajoutee
 * @throws si la cle est malformee ou deja presente
 */
export const addElevenLabsKey = ({label, key, quota = null}) => {
  const clean = String(key ?? '').trim();
  if (!KEY_SHAPE.test(clean)) {
    throw new Error('Clé ElevenLabs invalide : attendu une chaîne du type sk_… sans espace.');
  }

  const store = load();
  if (store.elevenlabs.some((k) => k.key === clean)) {
    throw new Error('Cette clé est déjà dans le trousseau.');
  }

  const name =
    String(label ?? '').trim() || `Compte ${store.elevenlabs.length + 1}`;
  const record = {
    id: crypto.randomUUID().slice(0, 8),
    label: name,
    key: clean,
    source: 'manuel',
    addedAt: new Date().toISOString(),
    quota,
  };
  store.elevenlabs.push(record);
  // Une cle reajoutee a la main redevient legitime, meme si elle vient du .env.
  store.dismissedEnvKeys = store.dismissedEnvKeys.filter((f) => f !== fingerprint(clean));
  writeStore(store);
  return {id: record.id, label: record.label, masked: maskKey(clean)};
};

export const removeElevenLabsKey = (id) => {
  const store = load();
  const found = store.elevenlabs.find((k) => k.id === id);
  if (!found) return false;

  store.elevenlabs = store.elevenlabs.filter((k) => k.id !== id);
  // Sinon la cle du .env reapparaitrait au prochain demarrage.
  const fp = fingerprint(found.key);
  if (!store.dismissedEnvKeys.includes(fp)) store.dismissedEnvKeys.push(fp);
  writeStore(store);
  return true;
};

/** Memorise le dernier quota connu d'une cle (affichage instantane cote interface). */
export const setQuota = (id, quota) => {
  const store = load();
  const found = store.elevenlabs.find((k) => k.id === id);
  if (!found) return false;
  found.quota = quota ? {...quota, checkedAt: new Date().toISOString()} : null;
  writeStore(store);
  return true;
};

export const renameElevenLabsKey = (id, label) => {
  const clean = String(label ?? '').trim();
  if (!clean) throw new Error('Nom vide.');
  const store = load();
  const found = store.elevenlabs.find((k) => k.id === id);
  if (!found) return false;
  found.label = clean.slice(0, 60);
  writeStore(store);
  return true;
};

export const KEYS_FILE = FILE;
