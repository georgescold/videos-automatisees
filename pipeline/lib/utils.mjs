import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

export const ROOT = path.resolve(fileURLToPath(new URL('../../', import.meta.url)));

export const p = (...parts) => path.join(ROOT, ...parts);

export const ensureDir = (dir) => {
  fs.mkdirSync(dir, {recursive: true});
  return dir;
};

export const readJson = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));

export const writeJson = (file, data) => {
  ensureDir(path.dirname(file));
  fs.writeFileSync(file, JSON.stringify(data, null, 2), 'utf8');
};

const DIACRITICS = /[̀-ͯ]/g;

const stripAccents = (str) => str.normalize('NFD').replace(DIACRITICS, '');

export const slugify = (str) =>
  stripAccents(str)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 70);

/** Normalise un mot pour comparer deux tokenisations (accents/ponctuation ignores). */
export const normalizeWord = (str) =>
  stripAccents(str)
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');

export const log = {
  step: (msg) => console.log(`\n\x1b[35m▸\x1b[0m \x1b[1m${msg}\x1b[0m`),
  info: (msg) => console.log(`  ${msg}`),
  ok: (msg) => console.log(`  \x1b[32m✓\x1b[0m ${msg}`),
  warn: (msg) => console.log(`  \x1b[33m!\x1b[0m ${msg}`),
  // Sur stdout et non stderr : deux tubes separes arrivent dans le desordre
  // quand la sortie est capturee (interface web). Le code de sortie porte
  // deja l'echec.
  err: (msg) => console.log(`  \x1b[31m✗\x1b[0m ${msg}`),
};

/**
 * Progression destinee a l'interface, pas a l'humain.
 *
 * L'interface lit la sortie standard du pipeline : cette ligne lui donne un
 * pourcentage exploitable sans polluer la console, qui la filtre.
 *
 * @param {'build'|'render'} phase
 * @param {number} percent 0 a 100
 */
export const progress = (phase, percent) => {
  console.log(`##progress ${phase} ${Math.max(0, Math.min(100, Math.round(percent)))}`);
};

/** Parse `--cle=valeur` et `--flag` depuis argv. */
export const parseArgs = (argv) => {
  const positional = [];
  const flags = {};
  for (const arg of argv) {
    if (arg.startsWith('--')) {
      const [key, ...rest] = arg.slice(2).split('=');
      flags[key] = rest.length ? rest.join('=') : true;
    } else {
      positional.push(arg);
    }
  }
  return {positional, flags};
};

/** PRNG deterministe : meme index => memes mouvements de camera. */
export const seeded = (seed) => {
  let s = seed * 9301 + 49297;
  return () => {
    s = (s * 9301 + 49297) % 233280;
    return s / 233280;
  };
};

export const fail = (msg) => {
  log.err(msg);
  process.exit(1);
};
