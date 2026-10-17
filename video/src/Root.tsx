import { Composition } from "remotion";
import type { AnalysisData } from "../../shared/types";
import { MusicVideo, type MusicVideoProps } from "./MusicVideo";
import { videoSize } from "./size";

const empty: AnalysisData = {
  duration: 10, bpm: 0, key: "", beats: [], downbeats: [], onsets: [], sections: [{ start: 0, end: 10, label: "section_1" }],
  rms: [0], low: [0], mid: [0], high: [0], spectral_centroid: [0], onset_strength: [0], chroma: [],
};

const defaultProps: MusicVideoProps = {
  analysis: empty,
  lyrics: null,
  plan: null,
  storyboard: null,
  meta: { title: "", artist: "", meaning: "", genre: "", mood_tags: [], energy: "medium", influences: "" },
  settings: { lyric_video: true, aspect: "16:9", resolution: "1080p", fps: 30 },
  audioSrc: "",
};

export const Root = () => (
  <Composition
    id="MusicVideo"
    component={MusicVideo}
    width={1920}
    height={1080}
    fps={30}
    durationInFrames={300}
    defaultProps={defaultProps}
    calculateMetadata={({ props }) => {
      const fps = props.settings.fps ?? 30;
      return { fps, durationInFrames: Math.max(1, Math.ceil(props.analysis.duration * fps)), ...videoSize(props.settings) };
    }}
  />
);
