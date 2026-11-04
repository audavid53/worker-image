---
name: scene-kinetic-type-mascot
description: Build "kinetic type + mascots" scenes in three.js. Big word-by-word headlines on warm off-white, one colour-coded keyword per line, rolling capability lists, toy-like 3D mascots that peek, run across or pass through the frame as transitions, character speech-bubble moments, proof (counters, logo cloud, testimonial deck) and line-up/CTA end cards. Use for the hook, brand reveal, capability, proof and CTA beats of the character-product-explainer template, or whenever the user wants "kinetic typography with characters".
---

# Scene style: kinetic type + mascots

The numbers come from `references/product-explainer-study/`. The library preset is `kinetic-type-mascot`, and the reference build is `aesyr-studio-v2/src/prototypes/explainer/typeScene.ts`.

## Building blocks

- **Background:** warm off-white `#FDFAF9` shader with the halftone grid (dots strongest at the edges, clear in the centre). Section tints come from the template skill.
- **Type:** SDF text, grotesk weight 600–700.
  - Hero words at 14–22% of frame height. Lines of 2–5 words at 7–9%.
  - Near-black `#141416`, with **one keyword per line** in a hue: violet `#8B5CF6`, coral `#F2765A`, green `#22B455` or sky `#6FA8DC`. Keyword hues match the cast and cursor hues.
- **Mascots:** Tripo GLB (toon ramp, no outline), at the scale needed for the shot. For a peek they fill 60–90% of frame height.

## Motion grammar

- **Word-by-word:** one word or phrase per **beat (12 frames at 120 BPM)**. Each word pops: scale 0.6 → 1.04 → 1.0 and opacity 0 → 1 over 6 frames (back-out). Previous words reflow over 6 frames (expo-out).
- **Word swap** ("dreams → plans → goals"): the outgoing word scales to 0.9 and fades over 4 frames while the incoming one pops as above, every 12 frames, with the keyword hue changing each time.
- **Rolling list:** a vertical carousel of icon pills (pill radius 50%, pastel fill at 25% of the hue, hue text). The step is one pill height every 8–12 frames on an expo-out ease. Pills more than one step away blur (4–8 px) and fade to 30%.
- **Holds are dead still** between pops.

## Shot catalogue

| # | Shot | Recipe |
|---|---|---|
| K1 | Word stack | Words land on beats and the keyword lands last in colour; hold 12–24 frames after the line completes. |
| K2 | Word swap | One slot cycles 3 words on beats in different hues. |
| K3 | Mascot pass-through wipe | A mascot crosses or turns toward the lens until it fills more than 80% of the frame (10–14 f), the next text or logo is revealed behind it, and it exits with a smear (3 f). Use as a transition or for the brand reveal. |
| K4 | Run-across | The cast runs left to right in a staggered line (run cycle, 0.6–0.9 frame-widths per second, 4–6 frames between characters), parallax 1.0 / 0.9 / 0.8. |
| K5 | Speech bubbles | A mascot in MS on one side (idle, wave or typing loop); white bubbles (radius 40% of height, soft shadow) stack on the other side every 12–18 frames, each with one coloured phrase and an app glyph. |
| K6 | Logo reveal | The logo mark pops (back-out, 8 f), then the word-mark slides out from behind it (8 f), on the music drop. |
| K7 | Rolling capability list | "I can do [pill]", with the pill carousel cycling 6–10 capabilities. |
| K8 | Counter + grid | A number counts up over 24–48 f (ease-out) while avatar tiles pop in around it in a spiral, staggered 1–2 f. |
| K9 | Logo cloud | App icons orbit or drift around a headline at 2–4 px/f, scattered with depth (back icons blurred). |
| K10 | Testimonial deck | 3–5 quote cards in depth; the front card is sharp and the others blurred; slide horizontally one card per 36–60 f. |
| K11 | Line-up + CTA | The cast lines up, each mascot plays a 1 s idle variation, the user hand cursor clicks one (squash and a happy reaction), then cut to the end card: logo, two-line CTA (second line in the keyword hue) and store badges, held 4 s or more. |

## QA

One keyword hue per line. Mascots never overlap the keyword at the moment it lands. Smears appear only on exits and dives. The end card holds at least 4 s and its type stays at least 8% from the edges.
