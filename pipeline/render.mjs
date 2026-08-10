/**
 * Rend la video en MP4.
 *
 *   node pipeline/render.mjs [slug] [--format=short|long] [--concurrency=4]
 *
 * Sans slug, rend les dernieres props construites (src/props/current.json).
 */
import fs from 'node:fs';
import path from 'node:path';
import {bundle} from '@remotion/bundler';
import {renderMedia, selectComposition} from '@remotion/renderer';
import {ensureDir, fail, log, p, parseArgs, progress, readJson} from './lib/utils.mjs';

const {positional, flags} = parseArgs(process.argv.slice(2));
const format = flags.format === 'long' ? 'long' : 'short';
const compositionId = format === 'long' ? 'LoveLong' : 'LoveShort';

const slug = positional[0];
const propsFile = slug
  ? p('out', `${slug}.${format}.props.json`)
  : p('src', 'props', 'current.json');

if (!fs.existsSync(propsFile)) {
  fail(`Props introuvables : ${propsFile}\nLance d'abord : npm run build -- scripts/<script>.json`);
}

const inputProps = readJson(propsFile);
const name = slug ?? 'video';
const outFile = flags.out
  ? path.resolve(flags.out)
  : path.join(ensureDir(p('out')), `${name}.${format}.mp4`);

log.step(`Rendu ${compositionId} — ${inputProps.durationInFrames} frames`);

const serveUrl = await bundle({
  entryPoint: p('src', 'index.ts'),
  onProgress: (percent) => {
    if (percent % 25 === 0) log.info(`Bundle ${percent}%`);
    // Le bundle occupe les premiers pourcents de la phase de rendu.
    progress('render', percent * 0.05);
  },
});

const composition = await selectComposition({
  serveUrl,
  id: compositionId,
  inputProps,
});

let lastLogged = -1;
let lastSent = -1;

await renderMedia({
  composition,
  serveUrl,
  codec: 'h264',
  outputLocation: outFile,
  inputProps,
  concurrency: flags.concurrency ? Number(flags.concurrency) : null,
  crf: 18,
  x264Preset: 'medium',
  onProgress: ({progress: done}) => {
    const percent = Math.round(done * 100);
    // La console reste lisible (tous les 10 %), la barre avance en continu.
    if (percent !== lastLogged && percent % 10 === 0) {
      lastLogged = percent;
      log.info(`Rendu ${percent}%`);
    }
    if (percent !== lastSent) {
      lastSent = percent;
      progress('render', 5 + percent * 0.95);
    }
  },
});

log.ok(`Video prete : ${path.relative(p('.'), outFile)}`);
