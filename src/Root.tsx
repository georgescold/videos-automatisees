import React from 'react';
import {Composition} from 'remotion';
import {LoveVideo} from './compositions/LoveVideo';
import {loveVideoSchema, type LoveVideoProps} from './schema';
import currentProps from './props/current.json';

export const FPS = 30;

const defaultProps = currentProps as unknown as LoveVideoProps;

export const RemotionRoot: React.FC = () => {
  return (
    <>
      <Composition
        id="LoveShort"
        component={LoveVideo}
        schema={loveVideoSchema}
        width={1080}
        height={1920}
        fps={FPS}
        durationInFrames={defaultProps.durationInFrames}
        defaultProps={defaultProps}
        calculateMetadata={({props}) => ({
          durationInFrames: Math.max(props.durationInFrames, 1),
        })}
      />
      <Composition
        id="LoveLong"
        component={LoveVideo}
        schema={loveVideoSchema}
        width={1920}
        height={1080}
        fps={FPS}
        durationInFrames={defaultProps.durationInFrames}
        defaultProps={defaultProps}
        calculateMetadata={({props}) => ({
          durationInFrames: Math.max(props.durationInFrames, 1),
        })}
      />
    </>
  );
};
