/**
 * Design system Compaatible : voir DESIGN.md a la racine.
 * Aucune couleur hors palette. Playfair pour le display, Inter pour le corps.
 */
import {loadFont as loadBody} from '@remotion/google-fonts/Inter';
import {loadFont as loadDisplay} from '@remotion/google-fonts/PlayfairDisplay';

const body = loadBody('normal', {weights: ['600', '800']});
const display = loadDisplay('normal', {weights: ['500', '600']});

export const captionFont = body.fontFamily;
export const titleFont = display.fontFamily;

export const CROSSFADE_FRAMES = 18;

export const palette = {
  burgundy: '#8B2D4A',
  rose: '#B5001F',
  plum: '#7A0016',
  creme: '#FBF9F7',
  ink: '#1F1115',
};
