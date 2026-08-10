/**
 * Installe whisper.cpp + un modele. Lance en SOUS-PROCESSUS par whisper.mjs,
 * avec un repertoire courant SANS espace : le zip d'installation est
 * telecharge dans le repertoire courant et l'etape Expand-Archive de
 * @remotion/install-whisper-cpp casse sur un chemin contenant un espace.
 */
import {downloadWhisperModel, installWhisperCpp} from '@remotion/install-whisper-cpp';

const to = process.argv[2];
const model = process.argv[3] ?? 'base';

await installWhisperCpp({to, version: '1.5.5'});
await downloadWhisperModel({model, folder: to});
