/**
 * Chaine complete : script JSON -> voix -> visuels -> montage -> MP4.
 *
 *   node pipeline/make.mjs scripts/mon-script.json [--format=short] [--media=photo]
 *
 * Accepte toutes les options de build.mjs et de render.mjs.
 */
import {spawnSync} from 'node:child_process';
import path from 'node:path';
import {fail, log, p, parseArgs, readJson, slugify} from './lib/utils.mjs';

const argv = process.argv.slice(2);
const {positional, flags} = parseArgs(argv);

if (positional.length === 0) {
  fail('Usage : node pipeline/make.mjs scripts/mon-script.json [--format=short]');
}

const run = (script, args) => {
  const result = spawnSync(process.execPath, [p('pipeline', script), ...args], {
    stdio: 'inherit',
  });
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
};

run('build.mjs', argv);

const scriptPath = path.isAbsolute(positional[0]) ? positional[0] : p(positional[0]);
const script = readJson(scriptPath);
const slug = script.slug ? slugify(script.slug) : slugify(script.title ?? 'video');

const renderArgs = [slug];
if (flags.format) renderArgs.push(`--format=${flags.format}`);
if (flags.concurrency) renderArgs.push(`--concurrency=${flags.concurrency}`);
if (flags.out) renderArgs.push(`--out=${flags.out}`);

run('render.mjs', renderArgs);

log.step('Video terminee');
