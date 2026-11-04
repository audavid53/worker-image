# Aesyr Studio v2: Product Plan & Design Direction

_Drafted 2026-11-03. This plan rebuilds the existing `Aesyr/website/studio` workspace (React 19, Vite, TypeScript, Supabase, Three.js, Excalidraw, Tiptap). Build everything locally first, then host it._

---

## 1. Goal

Aesyr Studio is a simple, collaborative **film-directing workspace**. A small team goes from an idea to a script, a cast, a shot list, a 3D animatic and a **Three.js output**, all in one project.

- **Who it's for:** directors, writers and small animation teams. It should also stay usable for non-technical clients.
- **Core promise:** each stage of production has one structured view and one free-form canvas, and stages hand data to the next stage instead of re-typing it.
- **Scale target:** up to **100 concurrent users** generating media on a **credit-based** platform, with secure server-side keys, per-user quotas and auditable spending.
- **Output:** a playable Three.js animatic (with timing, camera, audio and captions), and a **zip export** of the whole project (animated GLBs, timelines, cameras and audio) that Claude Code turns into the final Three.js render.

---

## 2. Reverse-engineering findings (evidence)

The design direction comes from what is actually shipped in the two apps installed on this PC.

### 2.1 Storyboarder (`C:\Program Files\Storyboarder`): Electron

- **How it was read:** `resources/app.asar` (229 MB) was extracted; there are 19,930 entries. The stylesheets are in `src/css/*.css`. REA's `analyze-javascript-application` was run on the ASAR (its summary and evidence are in the session scratchpad).
- **Surfaces** (most-used values in `mainwindow.css` and `shot-generator.css`):
  - body `#333333`
  - script/scenes column `#444`
  - shot-generator panels `#333639`, `rgb(41,41,44)` and `#111114` (the deepest well)
  - overlays `rgba(0,0,0,.8–.9)`
- **Layering method:** it rarely uses new colours. Elevation and hover come from **white at low alpha**: `rgba(255,255,255,.05)` (18 uses), `.1` (14), `.2` (10) and `.5` for secondary text.
- **Accent:** one indigo/violet family. `#5c65c0` is used for selection, focus and primary buttons. `#8d89cf` marks the active or selected thumbnail. `#6f68f0` is the Welcome "blue" button.
- **Text:** `#999`, `#888` and `#eee`. The typeface is WonderUnitSans (Thin to Black). Sizes are mostly 13–14px, with 10px for metadata.
- **Shape:** border radii are 3, 4 and 6px, with 8px for cards. Controls are small and dense.
- **Layout:**
  - a fixed 200px left column for scenes/script
  - the main stage (`flex:1`)
  - a 350px right column for board metadata
  - a 100px **thumbnail strip** with a cursor
  - a thin 10px **timeline** bar with playback controls underneath
  - a 70px drag-handle title area

### 2.2 SimpleScript (`%LOCALAPPDATA%\SimpleScript\screenwriter.exe`): Tauri

- **How it was read:** the 12.9 MB exe is a **Tauri** app: 263 `tauri` strings, plus `wry` and `webview2`. Inside is a Vite/React bundle with each asset brotli-compressed into the binary. A small extractor walked the `(&str path, &[u8] data)` pairs in the PE file and decompressed 13 assets, including `index-BkkUBtgP.css` (117 KB) and `index-gPMdrcSR.js` (1.86 MB). REA was then run on the extracted tree.
  - The extractor is `scratchpad/tauri-extract.mjs`.
- **Theme system:** a single `[data-theme=…]` attribute switches a flat token set. There are 8 themes: dark, midnight, forest, burgundy, dark_sepia, sepia, rose and white. The **dark** theme is:

  | token | value | token | value |
  |---|---|---|---|
  | `--bg` | `#1c1c1e` | `--btn-bg` | `#3a3a3c` |
  | `--page-bg` | `#242426` | `--btn-hover` | `#4a4a4e` |
  | `--sidebar-bg` | `#232325` | `--btn-active` | `#5a5a5e` |
  | `--sidebar-border` | `#333335` | `--ctx-bg` | `#2c2c2e` |
  | `--topbar-bg` | `#1c1c1e` | `--ctx-border` | `#3e3e40` |
  | `--text` | `#dcdcdc` | `--text-dim` | `#939393` |
  | `--cursor` | `#a0c4ff` | `--selection` | `rgba(100,160,255,.22)` |
  | `--note-color` | `#f0b429` | `--page-shadow` | `0 2px 28px rgba(0,0,0,.65)` |

- **Chrome:**
  - toolbar: 40px, `--sidebar-bg`, 1px bottom border; it can be pinned or shown on hover
  - status bar: 26px at 11px dim text; it slides in from the bottom
  - app text: `system-ui` at 13px, plus a `--ui-scale` zoom variable
  - script pages: **Courier Prime**
- **View modes:** a single state holds `"script" | "beatboard" | "split"`. The toolbar button flips between "Beat Board" and "Back to Script". Split view uses a **6px `col-resize` divider** (`--ctx-border` at 60% opacity).
- **Beat board:** a free canvas of absolutely positioned `.beat-card`s. Each card has:
  - 10px radius, `--page-bg` fill and the page shadow
  - Courier text
  - a coloured **band label** at 11px bold
  - scene "chips" (6px radius, `--ctx-hover`)
  - resize handles, a colour popover, swap and add controls
- **Beat palette:** `#8a8f98 #e0524b #e8873b #dcb63a #5aab54 #3fae9f #4b8fe0 #8f6fd6 #d95fa0`
- **What to take from it:** have one token layer and swap the theme with an attribute. Keep the chrome to two thin bars. Show the content as a "page" sitting on a darker background. Let the user switch between the structured panel and the canvas, or show both with a resizable divider.

### 2.3 Shot-list reference (supplied screenshot)

The screenshot is a dark database table, one row per shot. Its columns are:

- Date & Time
- Time for shot
- Shot image
- Title & description
- Casting
- Location
- Shot size
- Shot view
- Camera angle
- Camera movement

Each categorical column uses **its own pill hue**: casting red, location green, shot size pink, view purple, angle blue, movement blue. That is the template for the Shots-stage structured panel.

### 2.4 LTX Director (`WhatDreamsCost-ComfyUI` @ `a3c809c`)

`js/ltx_director.js` is 11,769 lines: a single-file ComfyUI widget timeline.

- **Tracks:** image, motion (motion_video), audio and text/prompt. There are also a global prompt and a "custom/override audio" track.
- **Segment model:** `{ id, start, length, type }`, where `type` is one of video, motion_video, image, audio, text or temp. `temp` is a ghost segment shown while dragging.
- **Drag types:** `left` and `right` (trim), `center` (move), `joint` (moves the boundary between two neighbouring segments), `retake_left/right/center`, `playhead`, `box_select`, `divider`/`audio_divider` (track-height resize) and `width_resize`/`height_resize`.
- **Snapping:** a `snapCandidates` list (segment edges and the playhead) with a toggle. Zoom works with the mouse wheel or Ctrl+wheel, between a minimum and a maximum.
- **Keys handled:** b, c, v, x, s, i, o and Delete. The exact action bound to each key was not verified.
- **Shortcomings to improve on:**
  - 11.8k lines of imperative DOM code in one file
  - tied to the ComfyUI node graph
  - no ripple editing and no linked selection
  - dragging audio and text is coupled to widget state

### 2.5 claude-animated-shorts (`mromidev/claude-animated-shorts` @ `e3b817b`)

This is a Claude skill (`cartoon-3d-short`) that makes 55–70 s three.js/Remotion story shorts. It's the model for both libraries in Section 6 and for the auto-director.

**How it analyses reference videos (the "look-match loop"):**
1. Extract frames and make contact sheets (60 frames = 2 s per sheet).
2. Mask any burned-in captions.
3. Run **one analysis agent per topic**: motion, depth, lighting, grade, outlines, textures and characters. Each one writes **measured numbers, not adjectives** to `references/reports/<topic>.md`. All agents share a common brief, `CONTEXT.md`.
4. Each report ends with a recipe for the stack (exact values and which file to change) and its top 5 changes.
5. A verifier compares our frames side by side with the reference and scores each area out of 10. In the repo the scores went from 5/3/4/5/4/7/4/6 to 7/5–6/5–6/6/5–6/7/6–7/6–7 over 4 rounds.

**Narrative structure it encodes** (the beat formula in `SKILL.md`), at about 3.7 words/s:
1. Hook: the absurd fact
2. Setting
3. Action: 3–4 escalating beats
4. Snap
5. Deadpan "Luckily… / Unluckily…"
6. Explanation through an everyday analogy
7. Consequence
8. Callback twist

Two rules come with it: "never describe on screen what the viewer already sees", and everything is timed to `words.json` (word timings).

**Continuous-camera grammar** (`templates/bridge/story.ts` and `reports/motion.md`):
- **Camera keys:** each shot has `CAMS` keys `{f, dur?, cut?, s: f => {pos, look, fov, roll}}`.
- **Glides:** smootherstep over 18–40 frames, with a peak of about 25 px/frame or less at 720p.
- **Cuts:** a big move becomes a cut when the glide it needs would be longer than the time available.
- **Holds:** every hold pushes in at 0.15–0.35 %/frame (0.6 %/frame on punch words). There is no static hold of 4 frames or more, and no hand-held float.
- **Rolls:** 4–5° over about 18 frames.
- **Impact kicks:** the offset flips sign every frame and decays over 7 frames.
- **Whip pans:** with motion blur.
- **Depth of field:** blur is set per shot size, in px at 1080 width: CU 12–16, MS 10–12, wides 0. Focus is on the eyes.
- **Foreground props:** in about ⅓ of shots.
- **Timing:** every visual reaction lands 0–3 frames before its word.
- **QA:** `short_qa.py` flags black, white, frozen (12 frames or more) and pop frames, plus loudness.

**Rule we keep:** reference videos are private study material. The libraries store **derived rules and numbers**, never copied shots, characters or scripts.

---

## 3. Design direction

### 3.1 Principles

1. **Two thin bars and a stage.** Use a 40px top bar (stage tabs and view switch) and a 26px status bar (credits, sync, collaborators). Everything else is the workspace.
2. **Neutral dark, one accent.** Use near-black greys (SimpleScript) and layer them with low-alpha white (Storyboarder). Colour is reserved for **meaning**: the accent, beat/scene colours and category pills.
3. **Content is a "page".** Structured panels sit on a slightly lighter `--page-bg` card with a soft shadow. Canvases use the darkest background.
4. **Every stage has Panel A (structured) and Panel B (canvas).** The views are A, split or B, as in SimpleScript. The divider position is remembered per stage.
5. **Dense but calm.** Use 13px UI text, 11px metadata and Courier Prime only for screenplay text. Radii are 4–6px for controls and 10px for cards.

### 3.2 Token set (starting point)

```css
:root[data-theme="dark"] {
  /* surfaces (SimpleScript dark) */
  --bg:#1c1c1e; --canvas-bg:#161618; --page-bg:#242426; --panel-bg:#232325;
  --border:#333335; --ctx-bg:#2c2c2e; --ctx-border:#3e3e40;
  /* elevation overlays (Storyboarder) */
  --hover:rgba(255,255,255,.05); --raised:rgba(255,255,255,.10); --pressed:rgba(255,255,255,.20);
  /* text */
  --text:#dcdcdc; --text-dim:#939393; --text-faint:rgba(255,255,255,.4);
  /* accent: Storyboarder indigo (#5c65c0 primary, #8d89cf active/selected, #53537c pressed) */
  --accent:#5c65c0; --accent-hi:#8d89cf; --accent-lo:#53537c; --focus:#8d89cf; --selection:rgba(92,101,192,.28);
  --note:#f0b429; --danger:#e5484d; --ok:#5aab54;
  /* category pills (shot list) */
  --pill-cast:#e0524b; --pill-location:#5aab54; --pill-size:#d95fa0;
  --pill-view:#8f6fd6; --pill-angle:#4b8fe0; --pill-move:#3fae9f;
  /* beats / scene colours */
  --beat-1:#8a8f98; --beat-2:#e0524b; --beat-3:#e8873b; --beat-4:#dcb63a; --beat-5:#5aab54;
  --beat-6:#3fae9f; --beat-7:#4b8fe0; --beat-8:#8f6fd6; --beat-9:#d95fa0;
  /* type & shape */
  --font-ui:system-ui,-apple-system,"Segoe UI",sans-serif; --font-script:"Courier Prime",monospace;
  --r-sm:4px; --r-md:6px; --r-card:10px; --shadow-page:0 2px 28px rgba(0,0,0,.65);
  --bar-h:40px; --status-h:26px; --divider:6px;
}
```

Light and alternate themes (midnight, sepia) come later by redefining only these tokens.

### 3.3 App shell

```
┌ 40px  [Aesyr] Idea · Story · Script&Cast · Shots · Motion   [A | Split | B]   ●●● avatars  ┐
│                                                                                            │
│   Panel A (structured, page-card)   ║6px║   Panel B (canvas, darkest bg, pan/zoom)         │
│                                                                                            │
└ 26px  stage status · autosave ✓ · 1,240 credits · 3 jobs running · comments (2)            ┘
```

- The stage tabs form a **pipeline**. A stage unlocks when the previous stage's "Approve & continue" button has been pressed. Managers approve; this reuses the existing stage-approval logic in `studio`.
- Comments, presence avatars and an activity drawer slide in from the right, as the existing desktop drawer does.

---

## 4. Pipeline stages

Each stage writes typed records to the database. The next stage reads them instead of copying them.

### Stage 0: Idea (welcome)

- A single centred card on `--bg` with:
  - project name
  - **aspect ratio** (16:9, 2.39:1, 9:16, 1:1, 4:5)
  - a chat box: "describe your idea **or** paste a script"
- **Story template library:** this is the **Narrative Library** (Section 6.1). It includes Three-Act, Save the Cat, Hero's Journey, Kishōtenketsu, the "Fact short" (from 2.5), 30s ad, explainer and music video. There is also **"Create my own"**: the LLM proposes a structure from the idea, or the user **analyses a reference video** (Section 6.3) and saves the result as a template.
- **Scene style:** pick a default **Scene Preset** (Section 6.2), for example *Continuous glide* or *Motion graphics*. Individual scenes can override it later.
- **Generate:** an LLM call populates Stage 1 (bios and outline). It costs credits, and the cost is shown before running.

### Stage 1: Story

| Panel A: Story outline (structured) | Panel B: Character bios (canvas) |
|---|---|
| Acts, then beats, then scenes in a collapsible outline, following the template's structure. Each beat has a colour (beat palette), a summary and a target duration. | Free canvas of character cards: portrait slot, bio, want/need, arc and relationships (connector lines between cards). |

**Approve** moves to Stage 2 and seeds the script from the outline.

### Stage 2: Script and casting

| Panel A: Script (SimpleScript-style) | Panel B: Casting canvas |
|---|---|
| Tiptap screenplay editor in Courier Prime. Scene headings, action, character and dialogue. The script is broken down into **scene sections** automatically, and the `@` asset tags from the current studio are kept. Toggle **Beat Board** shows the scenes as cards. | Blocks for **Characters** and **Environments**. Each block has reference slots and a generation menu (below), and is linked to every scene where it appears. |

**Casting generation options** (the credit cost is shown on each button):

1. **2D asset:** image generation through the **Google image API**, producing a character sheet or environment plate.
2. **Simple 3D (code):** an LLM writes a parametric Three.js primitive rig, for example a capsule body with head, limbs and a low-poly set. It is cheap, instant, and editable as JSON or code.
3. **3D model (Tripo AI):** text or image to a GLB. The flow is: preview mesh, then refine, then optional auto-rig. The GLB is stored in project media.

Every asset keeps its version history, its source prompt and the credits it spent.

### Stage 3: Shots (director)

| Panel A: Shot list (table, as in the reference image) | Panel B: Director canvas |
|---|---|
| One row per shot: time and duration, thumbnail, title and description, casting, location, shot size, view, angle, movement (each a coloured pill), status and comments. Rows are grouped by scene and can be reordered by dragging. | Node canvas with a **timeline node per scene**. Cast and environment blocks have output **connectors** that wire into shot inputs. Opening a scene opens its own **Director timeline** (Section 5). |

Editing the table and editing the canvas change the same shot records.

**Auto-direct (per scene):** one button fills the scene's shot list and Director timeline from its script section, its narrative beat, its cast and environment, and its Scene Preset. It places the 3D assets and sets the cameras. See Section 7.

### Stage 4: Motion and animatic

- **Per-shot 3D stage** (Three.js; the existing `PrevisEditor` and `framing-orbit-controls` are reused):
  - place the cast GLBs
  - set the camera keyframes (dolly, pan, tilt, crane, handheld noise)
  - set lens, aspect ratio and safe frames
- **Character motion:**
  - **Tripo AI** generates the character mesh and its **skeleton** (auto-rig).
  - **UniMate** is a unified diffusion text-to-motion model that produces fine-grained 3D human motion from the shot's action text, for example "Gandalf turns sharply, raises his staff".
  - **Headless Blender** retargets the UniMate motion onto the Tripo skeleton, bakes it, simplifies the mesh and exports a GLB with named animation clips.
  - Each clip lands on the shot's `motion` track, trimmed to the shot's length.
- **Animatic:** the shots are assembled in timeline order with the audio, dialogue captions and transitions from the existing transition library. It plays in the browser as a realtime Three.js animatic.
- **Hand-off to the app:** Blender returns **animated GLBs** (mesh, Tripo skeleton and baked UniMate clips). The app places them into each shot's Three.js scene. Blender does not render frames.
- **Final render: Three.js.** The final picture is the Three.js scene, not a Blender or AI-video render.
- **Export to Claude Code:** "Export project" builds one **zip** containing:
  - `project.json` with the story, the beats, the shot list, every timeline (clips, camera keys, DOF, timings) and the Scene Preset values
  - `assets/` holding every animated GLB, texture and audio file
  - the script and word timings
  - `README.md` describing the layout

  Claude Code takes the zip and builds the final Three.js render, in the same way the `claude-animated-shorts` skill renders three.js inside Remotion.
- LTX per-shot AI video stays optional, for previews only.

---

## 5. Director timeline (improving on LTX Director)

Rebuild it as a **React component with a pure state model** rather than an 11k-line DOM file.

### Data model

```ts
type TrackKind = 'shot' | 'camera' | 'motion' | 'audio' | 'dialogue' | 'text' | 'prompt';
interface Track   { id; kind: TrackKind; name; height; locked; muted; solo; color? }
interface Clip    { id; trackId; start: number; length: number;   // seconds, frame-snapped
                    sourceIn?: number; sourceOut?: number;        // trim inside media
                    ref?: { type: 'shot'|'asset'|'audio'|'text'; id }; props: Record<string, unknown> }
interface Timeline{ id; sceneId; fps; duration; tracks: Track[]; clips: Clip[]; markers: Marker[] }
```

### Interaction spec

| Gesture | Kept from LTX Director | Added in Aesyr |
|---|---|---|
| Drag clip body | `center` move | Move **between tracks** of a compatible kind. Alt+drag duplicates. |
| Drag edge | `left`/`right` trim | **Trim vs. stretch** (Shift = time-stretch audio/motion). Trimming is clamped to the source length. |
| Drag shared edge | `joint` | Rolling edit. Ripple mode (`R`) pushes later clips along. |
| Playhead | `playhead` + snap | Scrubbing with audio scrub. J/K/L playback. |
| Marquee | `box_select` | Multi-select, then group move, trim and delete. |
| Track divider | `divider`/`audio_divider` | Track-height resize per track, plus collapse. |
| Snap | `snapCandidates` | Snaps to clip edges, playhead, **beats and markers**, **dialogue line ends** and frame grid. Hold Ctrl to bypass. |
| Zoom | wheel/ctrl+wheel | Zoom anchored on the cursor, "fit scene" (`\`) and a minimap. |
| Drop from OS | none | Drag **audio files** (WAV/MP3) onto the canvas to create an audio clip with a waveform. The upload starts immediately (tus). |
| Drop from script | none | Drag a **dialogue line or caption** from Panel A to create a text/dialogue clip. Its length is estimated from speech length, as the repo's `speech_length_calculator` does. |
| Text clips | text/prompt segments | Inline editing, resizing and styling (lower-third or subtitle). Exported as SRT/VTT. |

### Implementation notes

- Rendering uses a DOM or SVG ruler plus a canvas waveform layer. The state lives in a store (Zustand) with an **undo/redo command stack** and **CRDT sync** so several people can edit the same timeline (see Section 8).
- Keyboard map: `B` blade, `C/V/X` copy, paste and cut, `S` toggle snap, `I/O` in and out points, `Del` ripple-aware delete.

---

## 6. The two libraries

Both libraries are versioned JSON records stored in Postgres (`library_entries`, with a `kind` of `narrative` or `scene_preset`). They can be built in, belong to a workspace, or be private to a user, and each is validated with a zod schema. The AI reads them **as constraints**, and the solvers in Section 7 read them **as numbers**.

### 6.1 Narrative Library: how a story is structured

```ts
interface NarrativeStructure {
  id; name; version; source: 'builtin' | 'analysed' | 'custom';
  runtime: { min_s; max_s }; pace: { words_per_s: number };        // e.g. 3.7
  beats: Array<{ id; name; purpose; share: [min, max];             // fraction of runtime
                 rules: string[];                                  // "one line", "3–4 escalations, each bigger"
                 default_shot_bias?: { sizes; moves } }>;          // hints for the auto-director
  global_rules: string[];                                          // "never narrate what is on screen"
  evidence?: { reference_ids; report_md };                          // from the analyser (6.3)
}
```

- **First built-in entry: "Fact short"** (from 2.5). Its beats are Hook, Setting, Escalation ×3–4, Snap, Deadpan double, Analogy, Consequence and Callback, at 3.7 words/s over 55–70 s.
- **Other built-ins:** Three-Act, Save the Cat (15 beats), Hero's Journey, Kishōtenketsu, Problem→Solution ad, Explainer and Music-video verse/chorus.
- **What Stage 1 does with it:** builds the outline from the beats. In Stage 2, script scenes are tagged with their beat. In Stage 3, the beat's `default_shot_bias` steers the shot choices. For example, Hook means a close-up with a punch-in; Setting means an establishing wide.

### 6.2 Scene Preset Library: how a scene is shot

Every value is a number the camera solver can apply and the QA pass can check.

```ts
interface ScenePreset {
  id; name; version; family: 'continuous' | 'motion_graphics' | string;
  camera: {
    hold_pct; drift_pct; move_pct;                 // share of screen time
    glide_frames: [min, max]; ease: 'smootherstep' | 'easeInOut' | 'spring';
    peak_px_per_frame_720: number;                 // above this → convert to a cut
    push_in_pct_per_frame: [min, max]; punch_pct_per_frame: number;
    max_static_frames: number;                     // e.g. 4
    roll: { deg: [min, max]; frames: number; per_10s: number };
    kick: { decay_frames; px; sign_flip_every_frame: boolean };
    whip: { per_min; px_per_frame: [min, max]; motion_blur: boolean };
    handheld: number;                              // 0 = none
  };
  framing: Record<'ECU'|'CU'|'MCU'|'MS'|'MLS'|'FS'|'WS'|'EWS',
                  { subject_height_frac; fov_deg; lens_blur_px_1080 }>;
  focus: 'eyes' | 'subject' | 'none';
  foreground_props_share: number;                  // ~0.33
  sync: { reaction_lead_frames: [0, 3]; cut_on: 'word' | 'beat' | 'music' };
  transitions: { default; on_place_change; on_time_change; flash_after_hook? };
  look?: { light_presets; ink; grade; bloom };     // optional render look
  qa: { frozen_frames_max; black_white_check; speed_spike_check };
  readability_traps: string[];
  evidence?: { reference_ids; report_md; verifier_scores };
}
```

**Preset 1: Continuous glide.** Its values are taken from the bridge short's measured grammar (2.5):
- Moves take 65 % of screen time, drift 24 % and holds 10 %.
- Smootherstep glides of 18–40 frames, with a peak of about 25 px/frame at 720p (the bridge targets ≤ 25; the measured median peak is 13.7). Anything bigger becomes a cut.
- Pushes of 0.15–0.35 %/frame on holds, and 0.6 %/frame on punch words.
- Rolls of 4–5° over 18 frames, about 3 every 10 s.
- Sign-flipping kicks that decay over 7 frames.
- No hand-held float.
- Depth of field per shot size: CU 12–16 px, MS 10–12 px, wides 0. Focus is on the eyes.
- Foreground props in about ⅓ of shots.
- Reactions land 0–3 frames before their word.
- QA flags frozen spans of 12 frames or more.

**Preset 2: Motion graphics.** Kinetic type, shape layers and 2.5D parallax cards on a flat or gradient stage, with on-beat transitions such as wipes, masks, scale-pops and match-cuts. Its numbers (ease curves, overshoot %, hold lengths, words on screen, cut rate per bar, parallax depth ratios) are **measured from reference videos with the analyser (6.3)** before the preset ships. It renders as Three.js orthographic or perspective layers.

### 6.3 Reference analyser (how both libraries grow)

This is a "**Analyse a video**" job that productises the 2.5 look-match loop.

1. The user uploads a reference video or a link they have the rights to. It stays private to the workspace.
2. A worker extracts frames, makes contact sheets, a transcript with word timings, shot boundaries and optical-flow camera speed, and masks captions.
3. Topic agents produce numeric reports.
   - For the Narrative Library: beats, their timing shares and words/s.
   - For the Scene Preset Library: motion, depth, framing, lighting, grade and transitions.
4. A distiller turns the reports into a draft `NarrativeStructure` or `ScenePreset` JSON.
5. A person reviews and approves it before it is saved to the library.
6. A verifier render can compare our shots against the reference and attach scores to the preset's `evidence`.

Each analysis costs credits. Reference media is never published or reused in output.

---

## 7. Auto-director (AI shot generation in the Director)

When the user presses **Auto-direct** on a scene, it runs in four steps. **The AI picks the intent, and deterministic solvers apply the numbers.**

1. **Plan (LLM).**
   - **Input:** the scene's script section (action and dialogue with word timings), its narrative beat with `default_shot_bias`, the cast and environment (with their sizes from the GLB bounds) and the Scene Preset.
   - **Output:** shot rows `{beat, title, description, casting[], location, size, view, angle, movement, start, length, anchor_word}`. This is the Stage 3 table.
2. **Stage (solver).** Places the assets in the environment:
   - Blocking marks come from the action text.
   - Characters are snapped to the ground and set to face the camera or each other.
   - **Sight-line culling** removes any prop between the lens and the subject.
   - Foreground props are added in about the preset's share of shots.
   - Motion clips (UniMate) are requested for each character action.
3. **Camera (solver).** Builds the keys for each shot:
   - Distance comes from the shot size: subject height ÷ (2·tan(fov/2)·`subject_height_frac`).
   - The camera looks at the eyes, and the angle and view come from the row.
   - The movement is expanded with the preset's glide, push and roll rules.
   - If a move would exceed `peak_px_per_frame`, it is **converted to a cut**.
   - Depth of field comes from the framing table.
   - Each key is timed to land `reaction_lead_frames` before its `anchor_word`.
4. **QA and assemble.**
   - Runs the preset's checks: frozen spans, speed spikes, black and white frames, and subject in frame.
   - Writes clips to the Director timeline on the shot, camera, motion, dialogue and text tracks.
   - Renders thumbnails into the shot-list table.

Everything stays editable. Users can drag clips, change a row's shot size and re-solve that one shot, or **lock** shots so a re-run doesn't touch them. Credits are charged for the LLM plan and any UniMate or render jobs, not for solving.

---

## 8. Collaboration

- Keep **Supabase** (auth, Postgres, Storage, Realtime). It is already in use, with migrations in `studio/supabase/migrations`.
- **Realtime editing** for the script, the canvases and the timelines: use Yjs documents per stage panel, synced over Supabase Realtime broadcast or a small y-websocket service. Snapshots are saved to Postgres.
- **Presence** (cursors, who is viewing), threaded **comments** on any record, and **roles**: owner, manager, editor, commenter and client viewer. The existing permission model is reused.

---

## 9. Generation backend and scaling (credit-based, up to 100 users)

```
Browser ──► Vercel/API (auth, quotas, credit reserve) ──► jobs table (Postgres, status) ──► Dispatcher
                                                                                   │
           ┌────────────────────────────┬──────────────────────────┬──────────────┴───────────┐
       Tripo AI API             RunPod Serverless:         RunPod Serverless:        RunPod Serverless:
   (text/image→GLB, rig)        blender-headless           unimate-motion            comfyui-ltx (optional)
                                (retarget, bake, render)   (text/video→motion)       (LTX Director shots)
           └────────── results → Supabase Storage (signed URLs) → job row updated → Realtime → UI ──┘
```

### Workers

- **RunPod Serverless endpoints:**
  - `blender-headless` is a CPU or small GPU image with `blender -b` and a Python entrypoint for retargeting, baking, decimating, GLB export and EEVEE/Cycles animatic render.
  - `unimate-motion` is a GPU image. It takes action text and a duration, and returns a motion clip. Blender then retargets the clip onto the character's **Tripo-generated skeleton**.
  - `reference-analyser` is a CPU image with ffmpeg, contact sheets, optical-flow camera speed and speech-to-text word timings. It feeds the topic agents in Section 6.3.
  - `comfyui-ltx` is optional: ComfyUI with the LTX Director nodes, for per-shot video.
- **Scaling:** scale to zero, with `max_workers` sized to the plan; start with about 3–5 Blender and 2 GPU workers.
- **Inputs and outputs:** jobs receive a short-lived signed URL for their inputs and upload outputs to a signed URL. Workers never hold platform keys.

### Security

- Provider keys (Tripo, RunPod, LLM) live only server-side. The current studio already has a "Secret admin" with encrypted profiles.
- RLS on every table.
- Signed, expiring media URLs.
- An idempotency key per job.
- Webhook signature verification on job callbacks.
- Per-user and per-workspace rate limits, and a cap on concurrent jobs, for example 2 per user and 40 platform-wide at launch.
- Input validation with zod (already a dependency).

### Credits

- **Credits belong to each user**, not to a workspace. A job is charged to whoever runs it, even inside a shared project.
- An append-only `credit_ledger` (`user_id, delta, reason, job_id, project_id, created_at`). The balance is the sum of the ledger, cached.
- **Providers:** OpenAI is the LLM (idea, story, shot plan, code-3D). Images come from the Google image API, 3D meshes and skeletons from Tripo, and motion from UniMate.
- A job **reserves** its estimated cost, **commits** the actual cost on success and **refunds** on failure or timeout. This logic lives in a Postgres function inside a single transaction.
- A price table per job type (2D image, code-3D, Tripo preview, Tripo refine, rig, UniMate clip per second, Blender render per second, LTX clip). Cost is shown on every button before running.
- Admin top-ups first. Stripe can come later.

### 100-user sizing

The API is stateless. The real limit is how many workers run at once, and the jobs queue absorbs bursts. Show each job's queue position and ETA in the status bar.

---

## 10. Build locally first (milestones)

| # | Milestone | Done when |
|---|---|---|
| 0 | **Scaffold**: new `aesyr-studio-v2` app (Vite, React 19, TS). Port the tokens from 3.2, the app shell, the stage tabs and the A/Split/B view switch with a remembered divider. | The shell runs at `localhost`. Themes switch through `data-theme`. |
| 1 | **Local backend**: `supabase start` (local Docker). Schema for projects, stages, story, characters, scenes, shots, assets, timelines, jobs and credit_ledger, with RLS. | Migrations apply locally. RLS tests pass. |
| 2 | **Idea and Story stages**: welcome card, template library, LLM populate, outline panel, character canvas. | Idea → Generate → editable outline and bios. |
| 3 | **Script and Casting**: screenplay editor with scene breakdown and beat board; casting canvas with 2D and code-3D generation. | A pasted script splits into scenes, and cast blocks link to scenes. |
| 4 | **Shots**: shot-list table and director canvas with connectors. | Table and canvas edit the same shot rows. |
| 5 | **Director timeline** (Section 5), with audio drag-drop, text clips, trim, ripple, snap and undo. | Every gesture in the 5.2 table works, with tests on the state reducer. |
| 6 | **Libraries**: the `library_entries` schema and zod types (6.1, 6.2), the Narrative and Scene Preset browsers, and seed entries *Fact short* and *Continuous glide*. | The Idea stage lists the templates and presets. Picking one drives the outline beats. |
| 7 | **Auto-director v1** (Section 7): LLM shot plan, then the staging solver, the camera solver (glide, cut, push, roll, DOF) and QA. Unit tests check the solver against the preset's numbers (no frozen spans of 12 frames or more, peak px/frame under the limit). | One click turns a scripted scene into a shot list plus a playable timeline with cameras. |
| 8 | **Local job runner**: the dispatcher plus **local workers**. Blender headless runs in Docker on this PC. Tripo (mesh and skeleton) runs against its API with a test key. UniMate runs locally if a GPU is available, otherwise it is stubbed. Credits reserve, commit and refund. | A Tripo character gets a UniMate clip retargeted in local Blender and plays on a shot. Credits balance. |
| 9 | **Reference analyser** (6.3) and the *Motion graphics* preset measured from references, then built. | An analysed video produces a draft preset that a person approves and saves. |
| 10 | **Motion and animatic**: per-shot camera and motion, animatic playback, **Claude Code export zip**. | A scene plays end to end in the browser, and the zip has everything Claude Code needs to render it. |
| 11 | **Collaboration**: Yjs sync, presence, comments, roles. | Two browsers edit the same timeline without conflicts. |
| 12 | **Host**: RunPod serverless images for the workers, hosted Supabase, Vercel for the app and API, rate limits, load test with 100 simulated users. | Load test passes. No secrets reach the client (audit). |

---

## 11. What to reuse

- **From `claude-animated-shorts`** (MIT licence: keep the copyright notice; the reference videos it studied are **not** covered by the licence and must not be reused):
  - the camera grammar maths (`glide` smootherstep, `kickAt`, the `dofAt` table)
  - the camera-key shape (`CAMS`)
  - sight-line culling
  - the `short_qa.py` checks (port them to the animatic QA step)
  - the multi-agent look-match loop (the model for 6.3)

### From the current `studio`

| Area | Current files |
|---|---|
| Script editor and `@` asset tags | `ScriptEditor.tsx`, `AssetMention.tsx` |
| 3D previs and orbit controls | `PrevisEditor.tsx`, `previs-runtime.ts`, `framing-orbit-controls.ts` |
| Storyboard drawing | `Storyboard*.tsx` (Excalidraw) |
| Timeline and media tools | `TimelineMediaTools.tsx`, `scene-player.ts` |
| Generation | `SceneGeneration.tsx`, `generation-*.ts` |
| Blender export notes | `BLENDER_EXPORT.md` |
| Asset pipeline notes | `ASSET_PIPELINE.md` |
| Backend | Supabase migrations, resumable uploads, encrypted provider secrets, stage-approval and progress logic |

---

## 12. Open questions

1. **UniMate:** it is confirmed as a unified diffusion text-to-motion model, and the skeletons come from Tripo. Still to confirm:
   - the repository and weights licence (commercial use?)
   - its output joint format (SMPL-style or other), which sets up the Blender retarget map onto the Tripo rig
   - the GPU memory it needs, which decides the RunPod GPU tier
2. **Credit purchase:** admin grant at first, or Stripe? (Decided: credits belong to each user.)
3. **Which OpenAI model** for each step, and which Google image model.

**Decided (2026-11-03):**
- accent: Storyboarder indigo `#5c65c0`
- LLM: OpenAI
- images: Google API
- credits: per user
- final render: Three.js
- hand-off: Blender returns animated GLBs to the app's shot scenes, and the app exports everything as a zip for Claude Code
