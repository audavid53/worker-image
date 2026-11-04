// Shot vocabulary (the shot-list columns) shared by the table, the canvas and, later, the auto-director.

export const SHOT_SIZES = [
  { value: "ECU", label: "Extreme close-up" },
  { value: "CU", label: "Close-up" },
  { value: "MCU", label: "Medium close-up" },
  { value: "MS", label: "Medium shot" },
  { value: "MLS", label: "Medium long" },
  { value: "FS", label: "Full shot" },
  { value: "WS", label: "Wide shot" },
  { value: "EWS", label: "Extreme wide" },
] as const;
export type ShotSize = (typeof SHOT_SIZES)[number]["value"];

export const SHOT_VIEWS = ["Front view", "Three-quarter", "Side view", "Back view", "Over-the-shoulder", "POV", "Overhead"] as const;
export const CAMERA_ANGLES = ["Eye level", "Low angle", "High angle", "Ground level", "Shoulder level", "Hip level", "Bird's-eye", "Dutch angle"] as const;
export const CAMERA_MOVES = ["Static", "Pan", "Tilt", "Push in", "Pull out", "Tracking shot", "Dolly", "Crane", "Orbit", "Handheld", "Zoom"] as const;
export const SHOT_STATUSES = ["draft", "ready", "approved"] as const;

export type ShotView = (typeof SHOT_VIEWS)[number];
export type CameraAngle = (typeof CAMERA_ANGLES)[number];
export type CameraMove = (typeof CAMERA_MOVES)[number];
export type ShotStatus = (typeof SHOT_STATUSES)[number];

export interface Shot {
  id: string;
  sceneId: string; // scene heading element id
  title: string;
  description: string;
  durationS: number;
  size: ShotSize;
  view: ShotView;
  angle: CameraAngle;
  movement: CameraMove;
  castIds: string[]; // character ids
  locationId?: string; // environment id
  status: ShotStatus;
  note: string;
}

export const sizeLabel = (v: ShotSize) => SHOT_SIZES.find((s) => s.value === v)?.label ?? v;
