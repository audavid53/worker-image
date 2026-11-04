# Character product explainer: reference study

A frame-by-frame measurement of a 90 s product-launch film (854×480, 24 fps, 2,160 frames, music only) for the **character product explainer** template. Private study: the film, its frames and its copy are **not stored or reused**. Only derived numbers and rules are kept here, in `measurements.json`. Tools: `tools/reference-analyser/` (ffmpeg plus Node; see the bottom of this page).

## 1. What the film is made of

- **Cast:** a team of chunky, toy-like 3D mascots (about 2.5 heads tall, rounded silhouettes, one flat hue per character with a darker garment tone, big dark eyes). They are toon-shaded with soft ambient shading, no outlines and no ground shadows, and composited over flat backgrounds. Fast actions use stylised **smear frames** (stretched limbs and bodies on dives and exits).
- **World:** an Apple-like product UI: macOS windows (traffic lights, tabs), white rounded cards, wide soft shadows, an inner grey input field and a semibold grotesk type face. Backgrounds are **pastel tints with a halftone dot grid that fades radially**.
- **Two cursors with two meanings:**
  - The **user** is a white macOS hand cursor that types and clicks.
  - Each **AI agent** is a **3D arrow cursor**: an extruded triangle with a bevel, a soft gradient and a drop shadow, in that agent's colour (blue, coral, green or lilac). Optionally it carries a role label pill such as "Sales".
- **No narration.** On-screen type carries the script. The music runs at about 120 BPM in sections.

## 2. Measured grammar

| Measure | Value |
|---|---|
| Shots (hard cuts) | 18 in 90 s, 1.9 cuts per 10 s. Most scene changes are **zoom-throughs or graphic morphs, not cuts** (one take runs 36 s). |
| Shot length | median 2.75 s (p25 1.42, p75 5.83) |
| Camera state | **hold 70%**, drift 3%, move 27% of frames |
| Holds | truly static: no creeping push-in (unlike the "continuous glide" grammar) |
| Move events | 7.3 per 10 s; median **7 frames** (p25 5, p75 12) |
| Move envelope | **attack 2 frames, release 3 frames** (snap in, settle fast: an expo/back-out feel) |
| Zoom moves | 41 of 66; **pull-outs 27 vs push-ins 14** (reveal by pulling out) |
| Zoom size | median 12% per move; big reveals 40–80% |
| Zoom speed | peak median 7%/frame; p90 6.25%/frame over all zoom frames |
| Pan speed (1280-wide) | p90 12 px/frame; peaks 100–260 px/frame on zoom-throughs |
| Look | median brightness 0.94, **saturation 0.04**, contrast (p95–p5) 0.24: bright, airy, almost colourless, with colour reserved for characters, keywords and agent cursors |
| Background tints | warm off-white `#FDFAF9` (type and opener), blue-grey `#DFE9ED` (demo 1), peach `#FAE8E2` (demo 2), mint `#ECF6F2` (meetings), lavender `#EEE7F5` (team and proof), white `#FDFDFD` (product UI and CTA) |
| Music | ~120 BPM (one beat = 12 frames). Section changes drive the structure (drops at 8 s and 40 s; breakdown 24–40 s). Cuts and moves are **not** measurably beat-locked; the kinetic-type words land about every 12 frames. |

Caveat: the motion estimator reads type and cards scaling in as "zoom", so some move events are graphics animating rather than the camera. The envelope numbers apply to both, which is exactly what the template needs.

## 3. Structure (on-screen script, mapped to beats)

| Time | Beat | Scene style | Shots used |
|---|---|---|---|
| 0–7.5 s | Aspiration hook: "you have X, Y, Z" | kinetic type + mascot | word stack, mascot peek/pass-through, cast run-across |
| 7.5–8.5 | The need ("you need a team") | kinetic type | single line |
| 8.5–10 | Brand reveal on the music drop | kinetic type | logo, wipe by a mascot passing through frame |
| 10–12 | Promise line + cast intro | kinetic type + mascots | headline over a cast group |
| 12–26 | Demo 1: ask → agent does the task | **UI walkthrough + 3D cursors** | window establish, prompt type-on with hand click, agent arrival, card stack sends, calendar fills |
| 15–17, 26–29 | Character moments | character + speech bubbles | MS mascot, bubble, wave |
| 29–36 | Capability list | kinetic type | rolling vertical carousel of icon pills |
| 36–41 | Where it works (tabs, apps, docs) | kinetic type → UI | rolling list, app icons pop into the prompt UI |
| 41–48 | Demo 2: multi-agent in an app | UI walkthrough | chat panel and task list, 2–4 agent cursors building slides, charts grow |
| 48–59 | Demo 3: meeting → follow-ups | UI + character | notification toast, call grid with an agent pill, mascot with stacked result bubbles |
| 59–69 | Scale to the whole team | photo avatars → mascots, UI | role-labelled cursors organise a library |
| 69–80 | Social proof | proof | counter + app-logo cloud, testimonial card deck (depth of field), counter + avatar grid |
| 80–83 | Tagline + line-up | kinetic type + mascots | headline, cast line-up |
| 83–90 | CTA | end card | user cursor clicks a character, logo, CTA and store badges |

## 4. Reading it for the template

- **Colour is meaning.** The world is near-white. Colour belongs to characters, their cursors and one keyword per line.
- **Snap, then hold.** Motion happens in short, fast bursts (5–12 frames) between dead-still holds. There are no slow creeps.
- **Reveal by pulling out:** start macro on the detail (a typed prompt, a button), then pull back to show the context.
- **Join scenes without cuts:** zoom into an element, pass a character through frame, or morph a word into the next scene.
- **Characters perform; cursors work.** Mascots carry emotion (a wave, a run, a speech bubble). Agent cursors carry the product's actions.

## 5. Re-running the measurements

```bash
node tools/reference-analyser/measure.mjs <ffmpeg> <video> frames.json   # per-frame look, diff, camera motion
node tools/reference-analyser/segment.mjs frames.json shots.json         # shots and camera-state mix
node tools/reference-analyser/moves.mjs frames.json shots.json <ffmpeg> <video> moves.json   # move events, background tints
node tools/reference-analyser/transcribe.mjs .env.local audio.mp3 transcript.json           # optional word timings (OpenAI)
```

ffmpeg came from `@ffmpeg-installer/ffmpeg` (npm), installed in a scratch folder, not the project. These scripts are the seed of milestone 9's reference analyser.
