import fs from 'node:fs';
import path from 'node:path';
import {ensureDir} from './utils.mjs';

const PHOTO_URL = 'https://api.pexels.com/v1/search';
const VIDEO_URL = 'https://api.pexels.com/videos/search';

const call = async (url, apiKey) => {
  const res = await fetch(url, {headers: {Authorization: apiKey}});
  if (!res.ok) {
    throw new Error(`Pexels ${res.status} — ${await res.text()}`);
  }
  return res.json();
};

/**
 * Le CDN Pexels sait recadrer a la volee. On evite ainsi de telecharger des
 * originaux de 5000 px que Chrome devrait redecoder a chaque frame.
 * La cible est plus grande que la video pour laisser de la marge au zoom.
 */
const cropped = (originalUrl, width, height) => {
  const url = new URL(originalUrl);
  url.searchParams.set('auto', 'compress');
  url.searchParams.set('cs', 'tinysrgb');
  url.searchParams.set('fit', 'crop');
  url.searchParams.set('w', String(width));
  url.searchParams.set('h', String(height));
  return url.toString();
};

/**
 * Cherche des photos deja recadrees au format de la video.
 * @returns {Promise<Array<{id:number,url:string,credit:string,width:number,height:number}>>}
 */
export const searchPhotos = async ({
  query,
  orientation,
  apiKey,
  perPage = 15,
  targetWidth = 1440,
  targetHeight = 2560,
}) => {
  const url = new URL(PHOTO_URL);
  url.searchParams.set('query', query);
  url.searchParams.set('orientation', orientation);
  url.searchParams.set('per_page', String(perPage));
  url.searchParams.set('size', 'large');

  const json = await call(url, apiKey);
  return (json.photos ?? []).map((photo) => ({
    id: photo.id,
    url: cropped(photo.src.original, targetWidth, targetHeight),
    credit: `${photo.photographer} / Pexels`,
    width: targetWidth,
    height: targetHeight,
    duration: 0,
    kind: 'photo',
  }));
};

/**
 * Cherche des videos b-roll.
 *
 * Selectionne le fichier dont l'orientation correspond au format demande et
 * dont la definition est la plus proche de la cible sans la depasser
 * inutilement : un 4K sur une video 1080p ne fait qu'alourdir le rendu.
 */
export const searchVideos = async ({
  query,
  orientation,
  apiKey,
  perPage = 20,
  targetWidth = 1080,
  targetHeight = 1920,
  minDuration = 4,
}) => {
  const url = new URL(VIDEO_URL);
  url.searchParams.set('query', query);
  url.searchParams.set('orientation', orientation);
  url.searchParams.set('per_page', String(perPage));

  const json = await call(url, apiKey);
  const wantPortrait = targetHeight > targetWidth;
  const results = [];

  for (const video of json.videos ?? []) {
    if (video.duration && video.duration < minDuration) continue;

    const candidates = (video.video_files ?? []).filter(
      (f) => f.file_type === 'video/mp4' && f.width && f.height && f.link,
    );
    if (candidates.length === 0) continue;

    // On garde d'abord les fichiers dans la bonne orientation.
    const oriented = candidates.filter((f) =>
      wantPortrait ? f.height > f.width : f.width >= f.height,
    );
    const pool = oriented.length > 0 ? oriented : candidates;

    // Assez grand pour couvrir le cadre, puis le plus petit possible.
    const covering = pool
      .filter((f) => f.width >= targetWidth && f.height >= targetHeight)
      .sort((a, b) => a.width * a.height - b.width * b.height);
    const largest = [...pool].sort((a, b) => b.width * b.height - a.width * a.height);
    const file = covering[0] ?? largest[0];

    results.push({
      id: video.id,
      url: file.link,
      credit: `${video.user?.name ?? 'Pexels'} / Pexels`,
      width: file.width,
      height: file.height,
      duration: video.duration ?? 0,
      kind: 'video',
    });
  }

  return results;
};

export const download = async (url, dest) => {
  ensureDir(path.dirname(dest));
  if (fs.existsSync(dest) && fs.statSync(dest).size > 0) {
    return dest;
  }
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Telechargement echoue (${res.status}) : ${url}`);
  }
  const buffer = Buffer.from(await res.arrayBuffer());
  fs.writeFileSync(dest, buffer);
  return dest;
};
