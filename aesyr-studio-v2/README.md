# Aesyr Studio v2

Rebuild of Aesyr Studio. The plan is in [../AESYR_STUDIO_PLAN.md](../AESYR_STUDIO_PLAN.md).

## Run the app

```bash
npm install
npm run dev        # http://127.0.0.1:5180
```

## Story generation (milestone 2)

The Idea stage posts to `/api/story`, served by the dev server from `server/story.ts`. That handler calls OpenAI's Responses API with a strict JSON schema, validates the reply with zod, and forces the chosen template's beats onto it.

To enable it, copy `.env.example` to `.env.local` and set `OPENAI_API_KEY`. `OPENAI_MODEL` defaults to `gpt-5-mini`. The key stays on the server and is never sent to the browser.

Without a key you get an offline draft: the template's beats with empty summaries, and character names taken from a pasted script.

Story structures live in `shared/narratives.ts`: Three-Act, Save the Cat, Hero's Journey, Kishōtenketsu, Fact short, and "Create my own".

Credits aren't charged yet. Generation will go through `private.reserve_job` once the job runner exists (milestone 8).

## Script & Cast (milestone 3)

- **Script** (`src/stages/script/`): you can write a draft from the outline (`/api/script`, OpenAI), use the screenplay pasted at the Idea stage, paste a new one, or start blank. `shared/screenplay.ts` parses Fountain-style text into scenes.
  - **Keyboard:** Enter adds the next line in screenwriting order. Tab and Shift+Tab change the line type. Backspace on an empty line deletes it. The arrow keys move between lines.
  - **Beat board:** toggles the script into scene cards coloured by beat, which you can reorder.
- **Breakdown:** each scene's cast comes from its speaker cues and from character names in the action lines; its location comes from the heading. Matching ignores case and "(voice)"-style notes. New speakers and locations get Casting cards automatically.
- **Casting** (panel B): character and location cards, with the scenes each appears in. Each card has:
  - **2D:** Google `gemini-3-pro-image`. It needs `GOOGLE_API_KEY` in `.env.local`. Images are saved to `.local-media/` and served at `/media/`.
  - **Code 3D:** OpenAI returns a list of primitive shapes (data, not code), which three.js renders. A shared renderer makes the card thumbnails, and "View 3D" opens an orbit viewer.
  - **Tripo:** disabled until the job runner (milestone 8).
  - **Credits:** the numbers on the buttons are estimates. Nothing is charged yet.

## Shots (milestone 4)

Both panels edit the same `shots` records (`shared/shots.ts`, `src/data/shot-ops.ts`).

- **Shot list** (`src/stages/shots/ShotList.tsx`): rows are grouped by scene. Columns:
  - number, start time and duration
  - thumbnail (the Casting asset of the shot's first cast member, else its location)
  - title and description
  - a cast picker
  - location
  - size, view, angle and movement as coloured pills
  - status

  Reorder with the drag handle (pointer events, so it works with mouse, pen and touch), including into another scene, or with ↑/↓ on the focused handle.
- **Draft shots:** a deterministic first pass per scene: an establishing wide, a medium close-up per speech (over-the-shoulder when the speaker changes; a wide push-in for V.O.), and a medium or tracking shot per further action beat. Durations come from word counts at the template pace. The AI auto-director replaces this in milestone 7.
- **Director canvas** (`DirectorCanvas.tsx`):
  - Cast and location nodes each have an output port. Scene nodes list their shots, each with an input port.
  - Dragging a wire from a cast port to a shot port casts that character or sets that location. Clicking a wire disconnects it.
  - Shot size and title are editable in the node.
  - The scene's Timeline button opens with milestone 5.

## Director timeline (milestone 5)

Open it from a scene node's **Timeline** button on the Director canvas (`src/stages/timeline/SceneTimeline.tsx`).

**Data model** (`shared/timeline.ts`):
- One timeline per scene, with six default tracks: Shots, Camera, Motion, Dialogue, Text and Audio. You can add more tracks.
- The **Shots track is derived from the shot list** and kept packed end to end. Moving, trimming, rolling, blading or deleting a shot clip edits the same shots the table and Director use.
- Clips on the other tracks never overlap within a track.

**Editing:** every gesture is a pure function in `src/data/timeline-ops.ts`, unit-tested in `timeline-ops.test.ts`. A drag previews live from its starting state and saves as one undo step.

| Gesture | Behaviour |
|---|---|
| Drag clip | Move, clamped so it can't overlap. A single clip can move to a compatible track (Dialogue ↔ Text). Alt+drag duplicates. |
| Drag edge | Trim. Audio can't go past its source; Shift time-stretches audio (0.25×–4×). Ripple (R) pushes later clips. |
| Drag a cut between touching clips | Rolling edit. Ctrl gives a plain trim instead. |
| Drag empty space | Marquee select. Shift adds to the selection. |
| Ruler | Scrub. Markers (M) and the in/out range (I/O) show here. |
| Track label edge | Resize the track. Tracks can also be locked or muted. |
| Snapping (S) | Snaps to clip edges, the playhead, markers, in/out and dialogue line ends. Hold Ctrl to bypass. |
| Keys | B blade · C/X/V copy, cut, paste at the playhead · Del delete · Space/J/K/L play · ←/→ step a frame · \ fit · Ctrl+wheel zoom · Ctrl+Z / Ctrl+Shift+Z undo, redo |
| Audio | Drop WAV/MP3/OGG/M4A files on the timeline, or use the import button. The file is sniffed and saved by `/api/upload-audio`, decoded in the browser for its waveform, and plays in sync. |
| Lines | Drag a script line from the sidebar onto Dialogue or Text. Its length comes from the template's speaking pace. Double-click a clip to edit its text. |
| Captions | Export Dialogue and Text clips as an SRT file. |

## Libraries (milestone 6)

Open them from the top bar's **Library** button or the Idea stage's "Library" links.

- **Schemas** (`shared/library.ts`, zod):
  - A **NarrativeStructure** has beats with shares that must add up to 100%, unique keys, optional rules and shot hints for the auto-director, a runtime range and a narration pace.
  - A **ScenePreset** holds the numeric camera grammar: the hold/drift/move mix (must add up to 100%), glide frames and easing, the cut threshold, push-in rates, roll, kick and whip settings. It also has a framing table per shot size, focus, sync, transitions, QA limits and readability traps.
- **Built-ins:**
  - Story structures (`shared/narratives.ts`): Three-Act, Save the Cat, Hero's Journey, Kishōtenketsu and Fact short.
  - Scene presets (`shared/scene-presets.ts`): **Continuous glide**, with numbers from the claude-animated-shorts camera study, and **Motion graphics**, marked *draft* until milestone 9 measures real references.
  - Both are checked against the schemas when they load.
- **Your own entries:** duplicate a built-in, or start a new structure, then edit it. Saving is refused until the entry is valid (for example "beat shares must add up to 100%"); "Normalise to 100%" fixes shares. Entries belong to each user.
- **Projects keep copies:** each project stores the structure and preset it was made with, so editing or deleting a library entry never changes an existing film. Custom structures are sent with story and script requests, and the server checks them with the same schema.
- **Per-scene style:** each scene row in the shot list can override the project's scene preset.
- **Database:** `library_entries.slug` is unique per built-in and per user, and the data is shape-checked. The built-ins are seeded by a generated migration (`npx tsx scripts/library-sql.ts`). A test fails if `shared/` changes without a new `*_library_builtins.sql` migration.

## Database (milestone 1)

The schema is in `supabase/migrations/`:
- projects and members (owner, manager, editor, commenter, viewer)
- stage approvals
- story beats, characters, environments, scenes, shots and shot cast
- Director timelines and assets
- the narrative/scene-preset library
- jobs and a per-user credit ledger

Every `public` table has RLS. Membership helpers and credit/job functions live in the non-exposed `private` schema. Credit and job writes are service-role only: `private.grant_credits`, `private.reserve_job` and `private.finish_job`.

```bash
npm run test:db    # runs the migrations on PGlite (Postgres 17) and checks RLS + credit rules
```

The tests use `tests/db/supabase-shim.sql` to stand in for Supabase's roles, `auth.users` and `auth.uid()`.

**Full local stack:** `npm run db:start` (`supabase start`) needs **Docker Desktop**, which is not installed on this machine yet. Once it is, run `supabase start`, then `supabase db advisors` to check the schema against Supabase's own linter.

## Icons

The UI uses [Phosphor icons](https://phosphoricons.com) (MIT licence). Storyboarder's own icon files are under Wonder Unit's EULA and are not reused.
