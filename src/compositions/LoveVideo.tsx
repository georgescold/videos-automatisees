import React from 'react';
import {AbsoluteFill, Audio, interpolate, staticFile, useVideoConfig} from 'remotion';
import {Background} from '../components/Background';
import {Captions} from '../components/Captions';
import {Grain, ProgressBar, Scrim, Vignette, WarmGrade} from '../components/Overlays';
import {TitleCard} from '../components/TitleCard';
import type {LoveVideoProps} from '../schema';
import {palette} from '../theme';

const FADE_OUT_FRAMES = 45;

export const LoveVideo: React.FC<LoveVideoProps> = ({
  title,
  audioSrc,
  musicSrc,
  musicVolume,
  voiceVolume,
  captionPages,
  scenes,
  accent,
  showProgress,
  showTitle,
}) => {
  const {width, height, durationInFrames} = useVideoConfig();
  const vertical = height > width;

  return (
    <AbsoluteFill style={{backgroundColor: palette.ink}}>
      <Background scenes={scenes} />
      <Scrim />
      <WarmGrade accent={accent} />
      <Vignette />
      <Grain />

      {showTitle ? <TitleCard title={title} accent={accent} vertical={vertical} /> : null}

      <Captions pages={captionPages} accent={accent} vertical={vertical} />

      {showProgress ? <ProgressBar accent={accent} /> : null}

      {audioSrc ? <Audio src={staticFile(audioSrc)} volume={voiceVolume} /> : null}

      {musicSrc ? (
        <Audio
          src={staticFile(musicSrc)}
          loop
          volume={(f) =>
            interpolate(
              f,
              [0, 30, durationInFrames - FADE_OUT_FRAMES, durationInFrames],
              [0, musicVolume, musicVolume, 0],
              {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'},
            )
          }
        />
      ) : null}
    </AbsoluteFill>
  );
};
