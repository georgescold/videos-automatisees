import {Config} from '@remotion/cli/config';

Config.setVideoImageFormat('jpeg');
Config.setOverwriteOutput(true);
Config.setChromiumOpenGlRenderer('angle');
// Les images Pexels sont chargees depuis le disque (public/), pas depuis le reseau.
Config.setDelayRenderTimeoutInMilliseconds(120000);
