/**
 * Musique de fond.
 *
 * Pexels n'expose AUCUN endpoint audio : son API ne couvre que les photos et
 * les videos. Deux sources sont donc branchees :
 *
 *   - Openverse (defaut) : agregateur Creative Commons, AUCUNE cle requise.
 *     C'est la source qui marche des l'ouverture du projet.
 *   - Jamendo (optionnel) : catalogue musical mieux tenu, filtre instrumental,
 *     mais demande un JAMENDO_CLIENT_ID gratuit.
 *
 * Dans les deux cas on ne retient que des licences utilisables sur une chaine
 * monetisee : CC0 (aucune obligation) et CC-BY (attribution obligatoire).
 * Les licences NC, ND et SA sont exclues. L'attribution est ecrite a cote du
 * fichier et reprise dans out/<slug>.meta.json.
 */
import fs from 'node:fs';
import path from 'node:path';
import {ensureDir} from './utils.mjs';

const OPENVERSE = 'https://api.openverse.org/v1/audio/';
const JAMENDO = 'https://api.jamendo.com/v3.0/tracks/';
const UA = 'love-channel-factory/1.0';
const MAX_BYTES = 40 * 1024 * 1024;

/** Ambiances proposees, traduites en mots-cles de recherche. */
export const MOODS = {
  romantique: 'romantic love piano',
  melancolique: 'melancholic sad emotional',
  calme: 'calm ambient relaxing',
  piano: 'piano instrumental emotional',
  cinematique: 'cinematic emotional strings',
  espoir: 'hopeful uplifting inspiring',
  tendu: 'dark tense dramatic',
};

export const PROVIDERS = {
  openverse: {label: 'Openverse', needsKey: false},
  jamendo: {label: 'Jamendo', needsKey: true},
};

/** Openverse renvoie des titres contenant des entites HTML. */
const decodeEntities = (str) =>
  String(str ?? '')
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    .replace(/&(amp|lt|gt|quot|#39|apos);/g, (_, name) =>
      ({amp: '&', lt: '<', gt: '>', quot: '"', '#39': "'", apos: "'"}[name]),
    );

const attributionFor = ({name, artist, license}) =>
  license === 'cc0'
    ? `${name} par ${artist} (CC0, aucune attribution requise)`
    : `${name} par ${artist} (${license.toUpperCase()})`;

// ---------------------------------------------------------------------------
// Openverse : sans cle
// ---------------------------------------------------------------------------
/** Sans cle, Openverse plafonne page_size a 20 : on pagine. */
const OPENVERSE_PAGE = 20;

const fetchOpenverse = async ({query, category, pages = 2}) => {
  const collected = [];

  for (let page = 1; page <= pages; page++) {
    const url = new URL(OPENVERSE);
    url.searchParams.set('q', query);
    // Seules les licences confortables sur une chaine monetisee.
    url.searchParams.set('license', 'cc0,by');
    if (category) url.searchParams.set('category', category);
    url.searchParams.set('page_size', String(OPENVERSE_PAGE));
    url.searchParams.set('page', String(page));
    url.searchParams.set('format', 'json');

    const res = await fetch(url, {headers: {'User-Agent': UA}});
    if (res.status === 404) break; // page au-dela du dernier resultat
    if (!res.ok) {
      if (page > 1) break;
      throw new Error(`Openverse ${res.status} : ${(await res.text()).slice(0, 160)}`);
    }

    const json = await res.json();
    const batch = json.results ?? [];
    collected.push(...batch);
    if (batch.length < OPENVERSE_PAGE) break;
  }

  return collected;
};

const searchOpenverse = async ({query, limit, minSeconds, maxSeconds}) => {
  let results = await fetchOpenverse({query, category: 'music'});

  // La categorie « music » est renseignee de facon inegale : sans elle on
  // ratisse plus large plutot que de rendre une liste quasi vide.
  if (results.length < limit) {
    const wider = await fetchOpenverse({query, category: null});
    const seen = new Set(results.map((r) => r.id));
    results = [...results, ...wider.filter((r) => !seen.has(r.id))];
  }

  return results
    .map((r) => {
      // Openverse compte la duree en millisecondes.
      const duration = Math.round((r.duration ?? 0) / 1000);
      const license = String(r.license ?? '').toLowerCase();
      const track = {
        id: String(r.id),
        name: decodeEntities(r.title) || 'Sans titre',
        artist: decodeEntities(r.creator) || 'Inconnu',
        duration,
        url: r.url,
        preview: r.url,
        license,
        licenseUrl: r.license_url ?? '',
        source: 'openverse',
      };
      return {...track, attribution: attributionFor(track)};
    })
    .filter((t) => t.url && t.duration >= minSeconds && t.duration <= maxSeconds)
    .slice(0, limit);
};

// ---------------------------------------------------------------------------
// Jamendo : avec cle
// ---------------------------------------------------------------------------
const searchJamendo = async ({clientId, query, limit, minSeconds, maxSeconds}) => {
  const url = new URL(JAMENDO);
  url.searchParams.set('client_id', clientId);
  url.searchParams.set('format', 'json');
  url.searchParams.set('limit', String(Math.min(limit, 200)));
  url.searchParams.set('include', 'musicinfo licenses');
  url.searchParams.set('audioformat', 'mp32');
  url.searchParams.set('order', 'popularity_total');
  // Une voix chantee entrerait en concurrence avec la voix off.
  url.searchParams.set('vocalinstrumental', 'instrumental');
  url.searchParams.set('durationbetween', `${minSeconds}_${maxSeconds}`);
  url.searchParams.set('ccnc', 'false');
  url.searchParams.set('ccnd', 'false');
  url.searchParams.set('ccsa', 'false');
  url.searchParams.set('fuzzytags', query.replace(/\s+/g, '+'));

  const res = await fetch(url);
  if (!res.ok) throw new Error(`Jamendo ${res.status} : ${(await res.text()).slice(0, 160)}`);

  const json = await res.json();
  if (json.headers?.status !== 'success') {
    throw new Error(`Jamendo : ${json.headers?.error_message || 'reponse inattendue'}`);
  }

  return (json.results ?? [])
    .filter((t) => t.audiodownload_allowed && t.audiodownload)
    .map((t) => {
      const code = (t.license_ccurl ?? '').match(/licenses\/([a-z-]+)\//i)?.[1]?.toLowerCase() ?? 'by';
      const track = {
        id: String(t.id),
        name: t.name,
        artist: t.artist_name,
        duration: t.duration,
        url: t.audiodownload,
        preview: t.audio,
        license: code,
        licenseUrl: t.license_ccurl ?? '',
        source: 'jamendo',
      };
      return {...track, attribution: attributionFor(track)};
    });
};

/**
 * @returns {Promise<Array<{id,name,artist,duration,url,preview,license,licenseUrl,attribution,source}>>}
 */
export const searchMusic = async ({
  provider = 'openverse',
  clientId = '',
  mood = 'romantique',
  query = '',
  limit = 16,
  minSeconds = 40,
  maxSeconds = 900,
}) => {
  const terms = query.trim() || MOODS[mood] || MOODS.romantique;

  if (provider === 'jamendo') {
    if (!clientId) throw new Error('JAMENDO_CLIENT_ID manquant');
    return searchJamendo({clientId, query: terms, limit, minSeconds, maxSeconds});
  }
  return searchOpenverse({query: terms, limit, minSeconds, maxSeconds});
};

// ---------------------------------------------------------------------------
// Telechargement
// ---------------------------------------------------------------------------
export const downloadTrack = async (track, destDir) => {
  if (!/^https:\/\//i.test(String(track.url ?? ''))) {
    throw new Error('Seules les adresses https sont acceptees');
  }

  ensureDir(destDir);
  const safe = `${track.artist} - ${track.name}`
    .replace(/[^A-Za-z0-9 _-]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 60);
  const file = path.join(destDir, `${safe || `piste-${track.id}`}.mp3`);

  if (fs.existsSync(file) && fs.statSync(file).size > 0) return file;

  const res = await fetch(track.url, {headers: {'User-Agent': UA}});
  if (!res.ok) throw new Error(`Telechargement de la musique echoue (${res.status})`);

  const type = res.headers.get('content-type') ?? '';
  if (!/^audio\/|octet-stream/i.test(type)) {
    throw new Error(`Le fichier n'est pas de l'audio (${type || 'type inconnu'})`);
  }

  const buffer = Buffer.from(await res.arrayBuffer());
  if (buffer.length > MAX_BYTES) throw new Error('Fichier audio trop volumineux');
  if (buffer.length < 1024) throw new Error('Fichier audio vide');

  fs.writeFileSync(file, buffer);

  // Trace de la licence a cote du fichier : indispensable pour l'attribution.
  fs.writeFileSync(
    `${file}.licence.txt`,
    `${track.attribution}\n${track.licenseUrl}\nSource : ${track.source}\n`,
    'utf8',
  );

  return file;
};
