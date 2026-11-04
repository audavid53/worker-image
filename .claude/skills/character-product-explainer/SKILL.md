---
name: character-product-explainer
description: Plan and build a 60–120 s character-led product explainer in Aesyr Studio (three.js animatic). The film has a cast of chunky toy-like 3D mascots (Tripo characters) acting as the product's "team", Apple-clean product UI with 3D agent cursors, kinetic type, and music-section pacing. Use when the user wants a product launch, SaaS or app explainer "with characters", "like the Strawberry video", or "with UI and cursors", or picks the Character product explainer structure. Covers the script outline, cast design, asset generation, scene styles, shot list, the timing grammar and QA.
---

# Character product explainer (template)

The measured reference and its numbers are in `references/product-explainer-study/REPORT.md` and `measurements.json`. That study is private: derive rules and numbers from it, and never copy its script, characters, brand, UI content or shots. Every film made with this template has its own product, copy and cast.

Scene-style skills (read the one for the scene you are building):
- `scene-ui-cursor-walkthrough`: product UI with a user hand cursor and coloured 3D agent cursors.
- `scene-kinetic-type-mascot`: word-by-word type, rolling lists and mascot performances, plus the proof and CTA shots.

## Platform mapping

| Step | Aesyr stage | Library entry |
|---|---|---|
| Outline | Idea → Story | narrative `character-product-explainer` |
| Script (on-screen type, optional V.O.) | Script & Cast | |
| Cast + environments | Casting (2D → Tripo 3D) | |
| Shot list | Shots | presets `ui-cursor-walkthrough`, `kinetic-type-mascot` |
| Timing | Director timeline | |
| Motion, camera, animatic | Motion | |
| Final render | export zip → Claude Code (three.js) | |

## Steps

### 1. Outline (Idea stage)

Pick **Character product explainer** in the library. Its beats, with shares measured from the reference, are:
1. aspiration hook
2. the need
3. brand reveal (on the music drop)
4. promise + cast intro
5. demo 1 (ask → agent does it)
6. character moment
7. capability list
8. where it works
9. demo 2 (multi-agent in an app)
10. demo 3 (a second use case → results)
11. scale to the team
12. social proof
13. tagline + line-up
14. CTA

For the idea input give: the product, its user, 3 jobs it does, 1 proof number and the CTA.

### 2. Script

- **The script is on-screen type.** One idea per line, at most about 7 words. One **keyword per line** carries a colour; everything else is near-black.
- Reveal the hook one word per beat: at 120 BPM a word lands every 12 frames.
- Narration is optional. If you use it, keep the type as captions of the key word only, never full sentences.
- Write each demo as **ask → act → result**: a typed prompt, the agents working, then a concrete result (a filled calendar, a finished deck, sent follow-ups).

### 3. Cast (Script & Cast → Casting)

- **3–6 mascots**, one per role or department. Give each **one hue** (they become the agent-cursor colours) plus a darker garment tone of the same hue.
- **Proportions:** about 2.5 heads tall, a big rounded head, small hands and feet, a readable silhouette prop (headset, beanie, spikes, antenna). Big dark eyes, a minimal mouth.
- **Pipeline:**
  1. 2D concept (Google image) using a "toy figure, soft clay, single colour" prompt and a turnaround sheet.
  2. Tripo image→multiview (`/v3/generation/image-to-multiview`), then multiview→model, then texture.
  3. `/v3/animations/rig`, then `/v3/animations/retarget` for walk, run, idle, wave and jump. Check the current preset names in Tripo's docs; the reference page is client-rendered.
  4. UniMate text-to-motion for anything bespoke (typing at a keyboard, pointing, a celebration), retargeted in headless Blender.
  5. Export GLB with named clips.
- **Look in three.js:** `MeshToonMaterial` with a **5-step** gradient ramp (soft toon, not hard cel), a hemisphere fill plus one soft key light, no outlines and no cast shadows. A small faint contact blob is optional.
- **Smear frames** for dives and exits: stretch along the motion vector (scale 1.0 → 1.6 → 1.0 over 3 frames) and offset a duplicated limb copy, or swap to a pre-made smear pose.

### 4. Environments and backgrounds

Choose by scene; generated assets are fine wherever they read better.

| Need | Best source | Why |
|---|---|---|
| Type, UI and CTA scenes (most of this template) | **shader background**: pastel tint + halftone dot grid fading radially | Pixel-crisp at 80% zooms, zero cost, tint changes per section. |
| A mood plate behind a character moment | **Google image (gemini-3-pro-image)** plate on a far plane, slight parallax | Painterly richness; keep it desaturated so characters own the colour. |
| A walk-through 3D place | **World Labs Marble** world (Gaussian splat + panorama) rendered with **Spark** in three.js, or a Tripo image→splat | A true 3D set with real parallax. |
| Props in the scene | Tripo or code-3D blockouts | Match the toy look. |

Section tints from the study: warm off-white `#FDFAF9`, blue-grey `#DFE9ED`, peach `#FAE8E2`, mint `#ECF6F2`, lavender `#EEE7F5`. Change tint with each feature section.

### 5. Shots

Draft the shot list from the beats, using each beat's shot hints and the shot catalogues in the two scene-style skills. Budget about 20–30 shots per 90 s, most joined by **zoom-throughs and morphs, not cuts**: hard cuts run about 2 per 10 s.

### 6. Timing (Director timeline)

- Put music section changes on markers. Scene changes land on section changes; inside a section, type lands on beats.
- **Camera grammar** (preset `ui-cursor-walkthrough`):
  - holds are 70% of the time and **dead still**
  - moves last 5–12 frames, median 7, attack 2 and release 3 (expo-out)
  - pull-outs outnumber push-ins 2:1
  - about 12% zoom per move; 40–80% for a reveal or a zoom-through
- Cursors travel 10–18 frames per hop on an eased arc. A click is a 3-frame squash to 85% plus a 6-frame ripple.

### 7. Animatic and export

- Play the animatic in three.js. Check that each beat reads with the sound off.
- **QA:**
  - no hold over 3 s without an event
  - no move slower than 14 frames unless it is a reveal
  - one coloured keyword per line
  - characters never cover the keyword
  - text stays at least 6% from the frame edges
  - the CTA end card holds for 4 s or more
- Export the zip for Claude Code to render. Reference implementation of both styles: `aesyr-studio-v2/src/prototypes/explainer/`.
