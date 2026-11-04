// Director timeline model (plan §5). One timeline per scene.
// The shot track is not stored: it is derived from the scene's shots (packed end to end), so the
// shot list, the Director canvas and the timeline all edit the same shot records.

export const TRACK_KINDS = ["shot", "camera", "motion", "dialogue", "text", "audio"] as const;
export type TrackKind = (typeof TRACK_KINDS)[number];

export interface Track {
  id: string;
  kind: TrackKind;
  name: string;
  height: number; // px
  locked: boolean;
  muted: boolean;
}

export interface ClipProps {
  text?: string; // dialogue line, caption, camera/motion note
  speaker?: string;
  url?: string; // audio file
  name?: string; // audio file name
  peaks?: number[]; // 0–1 waveform peaks across the whole source
}

export interface Clip {
  id: string;
  trackId: string;
  start: number; // seconds from scene start
  length: number; // seconds on the timeline
  /** Media clips (audio): where the clip starts inside the source, the source's length, playback rate. */
  sourceIn?: number;
  sourceLength?: number;
  rate?: number;
  ref?: { type: "shot" | "line"; id: string };
  props: ClipProps;
}

export interface Marker {
  id: string;
  t: number;
  label: string;
}

export interface TimelineDoc {
  sceneId: string;
  fps: number;
  tracks: Track[];
  clips: Clip[]; // every track except the shot track
  markers: Marker[];
  inPoint?: number;
  outPoint?: number;
}

export const TRACK_LABEL: Record<TrackKind, string> = {
  shot: "Shots",
  camera: "Camera",
  motion: "Motion",
  dialogue: "Dialogue",
  text: "Text",
  audio: "Audio",
};

export const TRACK_HEIGHT = { min: 28, max: 200, default: 44 };
