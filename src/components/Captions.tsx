import React from 'react';
import {AbsoluteFill, interpolate, spring, useCurrentFrame, useVideoConfig} from 'remotion';
import type {CaptionPage} from '../schema';
import {captionFont, palette} from '../theme';

const findPage = (pages: CaptionPage[], timeMs: number) => {
  for (const page of pages) {
    if (timeMs >= page.startMs && timeMs < page.endMs) {
      return page;
    }
  }
  return null;
};

export const Captions: React.FC<{
  pages: CaptionPage[];
  accent: string;
  vertical: boolean;
}> = ({pages, accent, vertical}) => {
  const frame = useCurrentFrame();
  const {fps, height} = useVideoConfig();
  const timeMs = (frame / fps) * 1000;

  const page = findPage(pages, timeMs);
  if (!page) {
    return null;
  }

  const enter = spring({
    frame: frame - Math.round((page.startMs / 1000) * fps),
    fps,
    config: {damping: 200, mass: 0.5},
    durationInFrames: 8,
  });

  const fontSize = vertical ? 88 : 72;

  return (
    <AbsoluteFill
      style={{
        justifyContent: vertical ? 'center' : 'flex-end',
        alignItems: 'center',
        paddingLeft: vertical ? 90 : 200,
        paddingRight: vertical ? 90 : 200,
        paddingBottom: vertical ? height * 0.06 : 110,
      }}
    >
      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          justifyContent: 'center',
          // Le rembourrage des pastilles fournit deja l'essentiel de
          // l'espacement horizontal.
          gap: `${fontSize * 0.14}px ${fontSize * 0.04}px`,
          transform: `scale(${interpolate(enter, [0, 1], [0.94, 1])})`,
        }}
      >
        {page.tokens.map((token, i) => {
          const isActive = timeMs >= token.fromMs && timeMs < token.toMs;
          return (
            <span
              key={`${token.text}-${i}`}
              style={{
                fontFamily: captionFont,
                fontWeight: 800,
                fontSize,
                lineHeight: 1.12,
                // Majuscules : la lecture est instantanee sur un petit ecran,
                // et le sous-titre tient tete au visuel qui defile dessous.
                textTransform: 'uppercase',
                // Le mot actif reprend le CTA de la marque : pastille
                // burgundy, texte creme. Le reste s'efface legerement.
                color: palette.creme,
                // Assez peu marque pour creer une hierarchie, assez lisible
                // pour rester net par-dessus une photo.
                opacity: isActive ? 1 : 0.92,
                backgroundColor: isActive ? accent : 'transparent',
                padding: `${fontSize * 0.04}px ${fontSize * 0.17}px`,
                borderRadius: 999,
                letterSpacing: '-0.02em',
                boxShadow: isActive ? '0 6px 20px rgba(31,17,21,0.45)' : 'none',
                textShadow: isActive
                  ? 'none'
                  : '0 4px 18px rgba(31,17,21,0.75), 0 0 3px rgba(31,17,21,0.95)',
                display: 'inline-block',
              }}
            >
              {token.text}
            </span>
          );
        })}
      </div>
    </AbsoluteFill>
  );
};
