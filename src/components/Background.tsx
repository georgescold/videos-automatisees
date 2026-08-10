import React from 'react';
import {
  AbsoluteFill,
  Img,
  OffthreadVideo,
  Sequence,
  interpolate,
  staticFile,
  useCurrentFrame,
} from 'remotion';
import type {Scene} from '../schema';
import {CROSSFADE_FRAMES, palette} from '../theme';

const SceneLayer: React.FC<{scene: Scene; isFirst: boolean}> = ({
  scene,
  isFirst,
}) => {
  const frame = useCurrentFrame();
  const {durationInFrames} = scene;

  const progress = interpolate(frame, [0, Math.max(durationInFrames, 1)], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });

  const scale = interpolate(progress, [0, 1], [scene.zoomFrom, scene.zoomTo]);
  const x = interpolate(progress, [0, 1], [scene.panXFrom, scene.panXTo]);
  const y = interpolate(progress, [0, 1], [scene.panYFrom, scene.panYTo]);

  // Fondu enchaine : la scene du dessus apparait par-dessus la precedente.
  const opacity = isFirst
    ? 1
    : interpolate(frame, [0, CROSSFADE_FRAMES], [0, 1], {
        extrapolateLeft: 'clamp',
        extrapolateRight: 'clamp',
      });

  return (
    <AbsoluteFill style={{opacity}}>
      <AbsoluteFill
        style={{
          transform: `scale(${scale}) translate(${x}%, ${y}%)`,
          willChange: 'transform',
        }}
      >
        {scene.type === 'video' ? (
          <OffthreadVideo
            src={staticFile(scene.src)}
            muted
            trimBefore={scene.trimBefore || undefined}
            style={{width: '100%', height: '100%', objectFit: 'cover'}}
          />
        ) : (
          <Img
            src={staticFile(scene.src)}
            style={{width: '100%', height: '100%', objectFit: 'cover'}}
          />
        )}
      </AbsoluteFill>
    </AbsoluteFill>
  );
};

export const Background: React.FC<{scenes: Scene[]}> = ({scenes}) => {
  if (scenes.length === 0) {
    return (
      <AbsoluteFill
        style={{
          // Teinte derivee par opacite plutot que par une nouvelle valeur.
          backgroundColor: palette.ink,
          backgroundImage: `radial-gradient(circle at 50% 35%, ${palette.plum}59 0%, transparent 72%)`,
        }}
      />
    );
  }

  return (
    <AbsoluteFill style={{backgroundColor: palette.ink}}>
      {scenes.map((scene, i) => (
        <Sequence
          key={`${scene.src}-${i}`}
          from={scene.from}
          durationInFrames={scene.durationInFrames}
          layout="none"
        >
          <SceneLayer scene={scene} isFirst={i === 0} />
        </Sequence>
      ))}
    </AbsoluteFill>
  );
};
