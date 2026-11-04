# Motion workers (RunPod Serverless)

The app animates Casting models for the three.js scenes with three providers:

| Provider | What it does | Where it runs | App job kind |
|---|---|---|---|
| **Tripo** | text/image → model → rig → preset clips (idle, walk, run, jump …) | Tripo API | `tripo_character`, `tripo_rig` |
| **UniMate** | text → motion for **any** rigged skeleton (characters, animals, robots) | `workers/unimate`, GPU endpoint | `unimate_motion` |
| **Blender** | preset or custom keyframed **object** motion, decimation, merging a rig's clips into one GLB, simplifying rigs for UniMate | `workers/blender`, CPU endpoint (or local Blender in dev) | `blender_motion` |

Requests are data checked by `shared/motion.ts`, then checked again by each worker. No request carries code.

## How it scales

- Each worker is a RunPod **queue endpoint**. Settings:
  - It runs **0 workers when idle**. With `workersMin 0`, a 5 s idle timeout and FlashBoot, nothing is billed while it waits.
  - It adds workers as the queue grows: up to 3 Blender and 2 UniMate. Raise `workersMax` in `scripts/runpod-deploy.mjs` when you need more throughput.
- The app holds no machines and no long requests (`server/jobs.ts`):
  - A job is a few steps.
  - Each poll of `GET /api/jobs/<id>` starts the current step or checks it once.
  - This is the same pattern that will run on Vercel functions.
- **Credits:** the estimate is reserved when a job is created. It is kept if the job succeeds and refunded if the job fails or is cancelled. This mirrors `private.reserve_job` / `finish_job`.
- **Outputs:** they are copied into app storage straight away, because Tripo's URLs expire.
  - Locally, storage is `.local-media/` (`/media/<uuid>.glb`).
  - Once hosted, it moves to Supabase Storage. Workers can then PUT to a signed `upload_url` instead of returning base64 (both handlers support this already).

## Cheapest settings (`scripts/runpod-deploy.mjs`)

| Endpoint | Hardware | Workers | Notes |
|---|---|---|---|
| `aesyr-blender-cpu` | CPU `cpu3c-2-4` (2 vCPU / 4 GB) | 0 → 3 | Blender 4.5 LTS. A clip runs in under 1 s; a cold start takes about 40 s. |
| `aesyr-unimate` | GPU: the 16 GB pool first (A4000 / RTX 2000 Ada / RTX 4000 Ada / A4500), then the 24 GB pool (RTX 3090 / L4 / A5000) when 16 GB is out of stock | 0 → 2 | Minimum CUDA 12.4. The checkpoint and flan-t5 are baked into the image. |

**RunPod gotchas (seen 2026-11-04):**
- REST `computeType: "CPU"` is silently ignored: it creates a GPU endpoint. The script pins CPU through GraphQL `saveEndpoint` (`instanceIds`).
- An explicit `allowedCudaVersions` list stopped any GPU worker from ever being scheduled. The script uses `minCudaVersion` instead.
- The 16 GB pool is often out of stock, hence the 24 GB fallback.
- UniMate's torch 2.5.1 (CUDA 12.4) has no **Blackwell** kernels. RunPod's 24 GB pool includes an RTX PRO 6000 Blackwell MIG slice, which fails with "no kernel image is available", so the script excludes Blackwell types. Workers that are already placed keep their GPU: after changing pools, set `workersMax` to 0 and then back.

## Deploy

1. **Build the images.** You need a GitHub repository for this project (there is no local Docker):
   - Push to it. `.github/workflows/workers.yml` builds both images into `ghcr.io/<owner>/aesyr-{blender,unimate}-worker`.
   - Make the two GHCR packages public, or add a RunPod container registry credential and pass `--registry-auth <id>`.
2. **Create the endpoints.** The script is safe to re-run: it updates the endpoints by name.
   ```bash
   node scripts/runpod-deploy.mjs --blender-image ghcr.io/<owner>/aesyr-blender-worker:<sha> --unimate-image ghcr.io/<owner>/aesyr-unimate-worker:<sha>
   ```
   Add `--dry-run` to see the requests first.
3. Put the printed `RUNPOD_BLENDER_ENDPOINT_ID` / `RUNPOD_UNIMATE_ENDPOINT_ID` into `.env.local` and restart `npm run dev`.

## UniMate notes

- **Licence.** The code is MIT. The **checkpoint is CC BY-NC 4.0 (non-commercial)**. Clear this before charging for UniMate output, or train or licence another checkpoint. Tripo presets and Blender recipes have no such restriction.
- **Prompts.** Prompts work best in the training style: "An object waves its right hand." The worker adds "An object" when it is missing.
- **Clip length.** Each clip is 60 frames, and an early model fails often. Ask for 2–3 takes (`takes`) and keep the best.
- **Your rig.**
  - UniMate takes **≤ 71 joints**. A Tripo biped has 77, 30 of them fingers. Each `unimate_motion` job therefore first runs the Blender `simplify-rig` recipe (`simplifyRig`, on by default). It drops fingers, limb twist/helper bones and face bones, and folds their skin weights into the nearest kept bone, which takes a Tripo biped to 25 joints. A rig that is already simple skips this step.
  - `rig_preprocess` labels the joints. It uses the offline rules unless you deploy with `--with-openai-key`, which copies `OPENAI_API_KEY` to the endpoint so an OpenAI model labels them.
  - Use `faceRight` / `faceLeft` (raw bone names) when a character faces the wrong way.
- **Output.** Each motion GLB is the *canonical* rig: centred, facing +Z and scaled to UniMate's frame (about 2.3 units tall), not the source model's size. Scale it in the scene. The app renames each clip from `Reconstructed_Action` to its prompt ("waves its right hand 1").
- **First live test (2026-11-04, Tripo robot, 25 joints after simplify):**
  - "jumps up and down" gave a clear crouch–launch–land.
  - "waves its right hand" came out almost static (≤ 3 cm of movement).
  - Expect misses: use `takes: 2–3` and raise `cfgScale` to 5–7 when a prompt is ignored.
- **Timing.** About 5 minutes for a cold start with a new image pull; about 10 s per job when warm.
- **Rig cache.** The prepared rig is cached by the GLB's hash. Mount a network volume on the endpoint so the cache survives between workers. This is optional.

## Local development

- **Blender.** Without `RUNPOD_BLENDER_ENDPOINT_ID`, `blender_motion` jobs run `workers/blender/recipes.py` on this machine's Blender. It is auto-detected, or set `BLENDER_PATH`.
- **UniMate** needs the GPU endpoint. There is no local fallback.
- **Testing a handler without RunPod:**
  ```bash
  ALLOW_HTTP_INPUTS=1 BLENDER_BIN=<blender> python -c "import handler; print(handler.run_job({...}, '/tmp/x'))"
  ```
