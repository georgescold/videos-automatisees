import React from 'react';
import {AbsoluteFill, interpolate, random, useCurrentFrame, useVideoConfig} from 'remotion';
import {palette} from '../theme';

/** Assombrit le haut et le bas pour que le texte reste lisible. */
export const Scrim: React.FC = () => (
  <AbsoluteFill
    style={{
      background:
        'linear-gradient(180deg, rgba(31,17,21,0.64) 0%, rgba(31,17,21,0.12) 28%, rgba(31,17,21,0.20) 55%, rgba(31,17,21,0.80) 100%)',
    }}
  />
);

/** Vignette douce. */
export const Vignette: React.FC = () => (
  <AbsoluteFill
    style={{
      background:
        'radial-gradient(ellipse at 50% 45%, rgba(0,0,0,0) 45%, rgba(0,0,0,0.55) 100%)',
    }}
  />
);

/** Voile burgundy, signature visuelle de la marque. */
export const WarmGrade: React.FC<{accent: string}> = ({accent}) => (
  <AbsoluteFill
    style={{
      background: `linear-gradient(135deg, ${accent}2E 0%, transparent 48%, ${palette.plum}26 100%)`,
      mixBlendMode: 'screen',
    }}
  />
);

const GRAIN_URI =
  "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='180' height='180'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='3'/%3E%3C/filter%3E%3Crect width='180' height='180' filter='url(%23n)' opacity='0.55'/%3E%3C/svg%3E\")";

const GRAIN_TILE = 180;

/**
 * Grain anime. La texture est deplacee par `transform` et non par
 * `background-position` : le compositeur suffit, la couche n'est jamais
 * repeinte, ce qui divise nettement le temps de rendu.
 */
export const Grain: React.FC<{opacity?: number}> = ({opacity = 0.06}) => {
  const frame = useCurrentFrame();
  const x = Math.round(random(`gx${frame}`) * GRAIN_TILE);
  const y = Math.round(random(`gy${frame}`) * GRAIN_TILE);

  return (
    <AbsoluteFill
      style={{overflow: 'hidden', opacity, mixBlendMode: 'overlay', pointerEvents: 'none'}}
    >
      <div
        style={{
          position: 'absolute',
          top: -GRAIN_TILE,
          left: -GRAIN_TILE,
          right: -GRAIN_TILE,
          bottom: -GRAIN_TILE,
          backgroundImage: GRAIN_URI,
          transform: `translate(${x}px, ${y}px)`,
          willChange: 'transform',
        }}
      />
    </AbsoluteFill>
  );
};

export const ProgressBar: React.FC<{accent: string}> = ({accent}) => {
  const frame = useCurrentFrame();
  const {durationInFrames} = useVideoConfig();
  const progress = interpolate(frame, [0, durationInFrames], [0, 1], {
    extrapolateRight: 'clamp',
  });

  return (
    <AbsoluteFill style={{justifyContent: 'flex-end'}}>
      <div style={{height: 8, width: '100%', backgroundColor: 'rgba(251,249,247,0.16)'}}>
        <div
          style={{
            height: '100%',
            width: `${progress * 100}%`,
            background: `linear-gradient(90deg, ${palette.plum}, ${accent})`,
          }}
        />
      </div>
    </AbsoluteFill>
  );
};
