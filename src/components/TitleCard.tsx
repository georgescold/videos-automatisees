import React from 'react';
import {AbsoluteFill, interpolate, spring, useCurrentFrame, useVideoConfig} from 'remotion';
import {palette, titleFont} from '../theme';

/** Bandeau titre discret en haut, façon "chapitre" de la chaine. */
export const TitleCard: React.FC<{title: string; accent: string; vertical: boolean}> = ({
  title,
  accent,
  vertical,
}) => {
  const frame = useCurrentFrame();
  const {fps, durationInFrames} = useVideoConfig();

  const enter = spring({frame, fps, config: {damping: 200}, durationInFrames: 20});
  const exit = interpolate(
    frame,
    [durationInFrames - 30, durationInFrames - 10],
    [1, 0],
    {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'},
  );

  return (
    <AbsoluteFill
      style={{
        alignItems: 'center',
        justifyContent: 'flex-start',
        paddingTop: vertical ? 150 : 70,
        opacity: enter * exit,
      }}
    >
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: 14,
          transform: `translateY(${interpolate(enter, [0, 1], [-24, 0])}px)`,
        }}
      >
        <div
          style={{
            fontFamily: titleFont,
            fontWeight: 600,
            fontSize: vertical ? 46 : 40,
            color: palette.creme,
            textAlign: 'center',
            maxWidth: vertical ? 860 : 1300,
            textShadow: '0 3px 16px rgba(31,17,21,0.65)',
            letterSpacing: '0.01em',
          }}
        >
          {title}
        </div>
        <div
          style={{
            width: 120,
            height: 3,
            borderRadius: 3,
            background: `linear-gradient(90deg, transparent, ${accent}, transparent)`,
          }}
        />
      </div>
    </AbsoluteFill>
  );
};
