import {z} from 'zod';

export const tokenSchema = z.object({
  text: z.string(),
  fromMs: z.number(),
  toMs: z.number(),
});

export const captionPageSchema = z.object({
  startMs: z.number(),
  endMs: z.number(),
  tokens: z.array(tokenSchema),
});

export const sceneSchema = z.object({
  /** Chemin relatif dans public/ — ex: "images/mon-slug/01.jpg" */
  src: z.string(),
  type: z.enum(['image', 'video']),
  /** Frame de depart (inclut deja le chevauchement de crossfade) */
  from: z.number(),
  durationInFrames: z.number(),
  /** Ken Burns */
  zoomFrom: z.number(),
  zoomTo: z.number(),
  panXFrom: z.number(),
  panXTo: z.number(),
  panYFrom: z.number(),
  panYTo: z.number(),
  /** Videos : nombre de frames a sauter au debut du clip source. */
  trimBefore: z.number(),
  credit: z.string().optional(),
});

export const loveVideoSchema = z.object({
  title: z.string(),
  hook: z.string(),
  /** Chemin relatif dans public/ — ex: "audio/mon-slug.mp3" */
  audioSrc: z.string().nullable(),
  musicSrc: z.string().nullable(),
  musicVolume: z.number(),
  voiceVolume: z.number(),
  captionPages: z.array(captionPageSchema),
  scenes: z.array(sceneSchema),
  accent: z.string(),
  showProgress: z.boolean(),
  showTitle: z.boolean(),
  durationInFrames: z.number(),
});

export type Token = z.infer<typeof tokenSchema>;
export type CaptionPage = z.infer<typeof captionPageSchema>;
export type Scene = z.infer<typeof sceneSchema>;
export type LoveVideoProps = z.infer<typeof loveVideoSchema>;
