---
name: scene-ui-cursor-walkthrough
description: Build "product UI walkthrough with 3D agent cursors" scenes in three.js. The look is Apple-clean macOS windows and cards on pastel halftone backgrounds, a white hand cursor for the user, and coloured 3D arrow cursors for AI agents doing the work, with snappy pull-out reveals. Use for the demo beats of the character-product-explainer template, or whenever the user asks for an "Apple-style UI scene", "3D mouse pointers" or an "agents working in the app" shot.
---

# Scene style: UI walkthrough + 3D cursors

The numbers come from `references/product-explainer-study/`. The library preset is `ui-cursor-walkthrough`, and the reference build is `aesyr-studio-v2/src/prototypes/explainer/uiScene.ts`.

## Building blocks (three.js)

- **Background:** a full-screen shader quad.
  - Tint from the section palette.
  - Halftone grid: dot pitch about 1.6% of frame height, dot radius 0.12–0.3 of pitch, alpha 0.05–0.12. The dots fade radially from the frame edges toward a clear centre (smoothstep 0.25 → 0.75).
  - Keep it static or moving 0–2 px per second.
- **Window:** a rounded-rect plane (`Shape.roundedRect`, radius about 1.2% of frame height for windows, 2–3% for cards), pure white.
  - Title bar 7% of window height with traffic lights (`#FF5F57`, `#FEBC2E`, `#28C840`, dots at 0.9% of window width) and a tab pill.
  - **Soft shadow:** a second plane under it, a blurred radial or box texture, offset down about 2% of the window height, scaled to 1.08, opacity 0.10–0.14. No hard shadows.
- **Text:** SDF text (`troika-three-text`) so it stays crisp through 80% zooms.
  - Grotesk font (Inter, or SF where licensed), weight 500–600.
  - Prompt text about 4.5% of frame height in macro shots.
- **Input field:** an inner rounded rect (`#F3F3F5`), a "+" glyph on the left and a round send button on the right in the brand colour.
- **Hand cursor (user):** a white glove with a dark outline and a tiny shadow, as a flat plane (a 2D sprite reads correctly). Its click is a 3-frame squash to 0.85 with no ripple.
- **Agent cursor (AI):** an **extruded triangle** (`ExtrudeGeometry`, depth about 0.15 of size, bevel about 0.12).
  - `MeshToonMaterial` or a two-tone gradient in the agent's colour, a slight rotation so the bevel catches light, and a soft blob shadow offset down-right.
  - Size about 3% of frame height.
  - Optional role label pill (white text on the agent hue) trailing at the lower right.
- **Card stack:** 2–4 copies behind the front card, offset 1–2% and rotated ±1.5–4°. The back cards get a depth-of-field blur (6–10 px at 1080) or 70% opacity.

## Motion grammar (measured)

- **Holds are dead still** (70% of frames). Nothing creeps.
- **Camera moves:**
  - 5–12 frames, median 7, with an expo-out envelope: attack 2 frames, release 3.
  - Pull-outs outnumber push-ins 2:1. Start macro on the action (the typed prompt, the button), then pull back to show where it lives.
  - About 12% zoom per move; a scene change zooms 40–80% *through* an element.
- **Typing:** about **0.8 characters per frame** (~20 per second; a 20-character prompt types in ~1 s, measured), caret blink 12 frames on / 12 off.
- **Hand cursor:** enters 8–12 frames before it clicks, rests 4–6 frames on the target, clicks, then leaves or holds.
- **Agent cursor hops:** 10–18 frames each on an eased arc (bezier control point 15–25% off the straight line), with a 2–4% overshoot settling over 4 frames. It arrives a couple of frames before the UI reacts.
- **UI reactions:** cards and blocks pop in with a scale 0.92 → 1.0 back-out over 6–8 frames, staggered 3–4 frames. Bars grow over 10–14 frames, staggered 2–3 frames.

## Shot catalogue

| # | Shot | Recipe |
|---|---|---|
| U1 | Window establish | Start on a blank tint, the window scales 0.94 → 1 with fade (8 f), hold. Or pull out 12% from the title bar. |
| U2 | Prompt type-on | Macro push to the input (zoom about 2.2×), type at ~0.8 chars/f, the hand cursor clicks send, then pull out 25–30% to the window. |
| U3 | Agent arrival | Toast or bubble "on it"; the agent cursor flies in from off-frame (14 f arc) and parks by the first target. |
| U4 | Task stack | A message card fills (typing), the cursor clicks "Send", the card slides down and the next card from the stack replaces it, three times. Back cards blurred. |
| U5 | Result reveal | Pull out to the result view (calendar slots fill or chart bars grow, staggered) while the agent cursor taps each new item. |
| U6 | Multi-agent build | 2–4 agent cursors, each in its own colour, work different regions of one document in parallel; the result assembles. |
| U7 | Notification | A dark toast (radius 2.5%, white text) pops near the top right; the hand cursor clicks its button; push in 20%. |
| U8 | Organise | A library grid; role-labelled agent cursors drag files into folders and labels appear on the items. |
| U9 | Zoom-through | Push 60–80% into one element (a tile, avatar or button) until it fills the frame; it becomes the next scene's background or its first shot. |

## QA

Text stays at least 6% from the edges and readable at the final zoom. Only agents have colour. The user cursor is always white. Never more than 4 agent cursors on screen. Every hold over 2 s has a cursor, typing or a pop.
