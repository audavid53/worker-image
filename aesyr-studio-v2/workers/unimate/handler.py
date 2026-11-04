"""RunPod Serverless handler: UniMate text-to-motion for a rigged character (GPU).

Pipeline per job (all inside the UniMate repo at /opt/unimate):
  1. rig_preprocess  rigged GLB -> asset dir (joint labels, facing pair, canonical GLB, cond.npy)
                     cached by the GLB's sha256 under $RIG_CACHE (a network volume when mounted)
  2. sample          one 60-frame motion per prompt x repetition
  3. animate         drive the canonical GLB with each motion -> one animated GLB per motion

Job input:
    {
      "model_url": "https://...rigged.glb",   # or "model_b64"; a Tripo rig works
      "prompts": ["An object waves its right hand."],   # 1-6, UniMate style: "An object ..."
      "num_repetitions": 1,      # 1-3 takes per prompt
      "cfg_scale": 3.0,          # 1-9; raise when a prompt is ignored
      "seed": 1,                 # optional
      "face_r": "R_Thigh", "face_l": "L_Thigh",   # optional facing pair (raw bone names)
      "rest_rotation": "x90",    # optional, for a rig lying down / upside down
      "upload_urls": ["https://signed PUT", ...]  # optional, one per output GLB in order
    }
Output:
    {"rig": {...summary...}, "motions": [{"prompt", "take", "bytes", "glb_b64" | "uploaded"}]}

Joint labels: with OPENAI_API_KEY set on the endpoint the labeller uses an OpenAI model
(UNIMATE_LABEL_MODEL, default gpt-5-mini); without it the offline rules label the rig.
"""

import base64
import glob
import hashlib
import json
import os
import re
import shutil
import subprocess
import tempfile
import urllib.request

REPO = os.environ.get("UNIMATE_DIR", "/opt/unimate")
EXP = os.path.join(REPO, "outputs", "unimate_uniml3d_f60_v3")
RIG_CACHE = os.environ.get("RIG_CACHE") or ("/runpod-volume/unimate-rigs" if os.path.isdir("/runpod-volume") else "/tmp/unimate-rigs")
MAX_DOWNLOAD = 150 * 1024 * 1024
MAX_INLINE = 9 * 1024 * 1024  # total base64 output must stay under RunPod's ~10 MB
TIMEOUT = int(os.environ.get("STEP_TIMEOUT", "900"))
BONE = re.compile(r"^[\w .:|-]{1,80}$")


def fetch(url, path):
    allow_http = os.environ.get("ALLOW_HTTP_INPUTS") == "1"
    if not (url.startswith("https://") or (allow_http and url.startswith("http://"))):
        raise ValueError("Inputs must be HTTPS URLs.")
    with urllib.request.urlopen(url, timeout=120) as response, open(path, "wb") as out:
        total = 0
        while chunk := response.read(1 << 20):
            total += len(chunk)
            if total > MAX_DOWNLOAD:
                raise ValueError("The model is larger than 150 MB.")
            out.write(chunk)


def upload(url, path):
    with open(path, "rb") as handle:
        request = urllib.request.Request(url, data=handle.read(), method="PUT", headers={"Content-Type": "model/gltf-binary"})
    with urllib.request.urlopen(request, timeout=300) as response:
        if response.status >= 300:
            raise RuntimeError(f"Upload failed with HTTP {response.status}.")


def step(args, name):
    done = subprocess.run(args, cwd=REPO, capture_output=True, text=True, timeout=TIMEOUT)
    if done.returncode != 0:
        tail = (done.stderr or done.stdout or "")[-1500:]
        raise RuntimeError(f"{name} failed: {tail}")
    return done.stdout


def clean_prompt(text):
    text = " ".join(str(text).split())[:200]
    if not text:
        raise ValueError("Empty prompt.")
    # The model was trained on captions that start with "An object"; add it when missing.
    if not text.lower().startswith("an object"):
        text = "An object " + text[0].lower() + text[1:]
    return text if text.endswith(".") else text + "."


def prepare_rig(glb, job_input):
    digest = hashlib.sha256(open(glb, "rb").read()).hexdigest()[:24]
    extra = [f"{k}={job_input.get(k)}" for k in ("face_r", "face_l", "rest_rotation") if job_input.get(k)]
    key = digest + ("-" + hashlib.sha256("|".join(extra).encode()).hexdigest()[:8] if extra else "")
    out = os.path.join(RIG_CACHE, key)
    summary_path = os.path.join(out, "summary.json")
    if not os.path.exists(os.path.join(out, "cond.npy")):
        os.makedirs(RIG_CACHE, exist_ok=True)
        args = ["python", "-m", "data_process.rig_preprocess", "run", "--input", glb, "--output_dir", out,
                "--name", "character", "--no_review", "--no_preview", "--exp_dir", EXP, "--overwrite"]
        if os.environ.get("OPENAI_API_KEY"):
            args += ["--annotate", "llm", "--model", os.environ.get("UNIMATE_LABEL_MODEL", "gpt-5-mini")]
        else:
            args += ["--annotate", "rule"]
        for flag in ("face_r", "face_l"):
            value = job_input.get(flag)
            if value:
                if not BONE.match(str(value)):
                    raise ValueError(f"Bad bone name for {flag}.")
                args += [f"--{flag}", str(value)]
        if job_input.get("rest_rotation"):
            if not re.match(r"^([xyz]-?\d{1,3})(,[xyz]-?\d{1,3}){0,2}$", job_input["rest_rotation"]):
                raise ValueError("rest_rotation looks like x90 or x90,y180.")
            args += ["--rest_rotation", job_input["rest_rotation"]]
        step(args, "Rig preprocessing")
    with open(summary_path, encoding="utf-8") as handle:
        summary = json.load(handle)
    fits = (summary.get("model_joint_limit") or {}).get("fits", True)
    if not fits:
        raise ValueError(f"The rig has {summary.get('n_joints')} joints; UniMate takes at most 71. Remove finger/face bones.")
    if not summary.get("canonical_glb"):
        raise ValueError(f"No mesh to drive: {summary.get('canonical_glb_error') or 'the rig has no skinned mesh'}.")
    return out, summary


def run_job(job_input, workdir):
    prompts = [clean_prompt(p) for p in (job_input.get("prompts") or [])]
    if not 1 <= len(prompts) <= 6:
        raise ValueError("Send 1 to 6 prompts.")
    reps = int(job_input.get("num_repetitions", 1))
    cfg = float(job_input.get("cfg_scale", 3.0))
    if not (1 <= reps <= 3 and 1.0 <= cfg <= 9.0):
        raise ValueError("num_repetitions is 1-3 and cfg_scale 1-9.")

    glb = os.path.join(workdir, "rigged.glb")
    if job_input.get("model_url"):
        fetch(job_input["model_url"], glb)
    elif job_input.get("model_b64"):
        with open(glb, "wb") as handle:
            handle.write(base64.b64decode(job_input["model_b64"]))
    else:
        raise ValueError("Send model_url or model_b64.")

    asset, summary = prepare_rig(glb, job_input)
    samples = os.path.join(workdir, "samples")
    args = ["python", "-m", "unimate.inference.sample", "--exp_dir", EXP, "--asset", asset,
            "--num_repetitions", str(reps), "--cfg_scale", str(cfg), "--output_dir", samples]
    if job_input.get("seed") is not None:
        args += ["--seed", str(int(job_input["seed"]))]
    args += ["--prompt", *prompts]
    step(args, "Sampling")
    step(["bash", "scripts/run_animate_motion.sh", samples], "Animating")

    with open(os.path.join(samples, "manifest.json"), encoding="utf-8") as handle:
        manifest = json.load(handle)["samples"]
    files = sorted(glob.glob(os.path.join(samples, "animated", "*.glb")))
    uploads = job_input.get("upload_urls") or []
    if uploads and len(uploads) < len(files):
        raise ValueError(f"Send {len(files)} upload_urls (one per motion).")
    motions, inline = [], 0
    takes = {}
    for i, path in enumerate(files):
        stem = os.path.splitext(os.path.basename(path))[0]
        meta = manifest.get(stem + ".npy") or next((v for k, v in manifest.items() if k.startswith(stem)), {})
        prompt = meta.get("prompt", "")
        takes[prompt] = takes.get(prompt, 0) + 1
        item = {"prompt": prompt, "take": takes[prompt], "bytes": os.path.getsize(path)}
        if uploads:
            upload(uploads[i], path)
            item["uploaded"] = True
        else:
            inline += item["bytes"]
            if inline > MAX_INLINE:
                raise ValueError("The motions are larger than 9 MB together; send upload_urls.")
            item["glb_b64"] = base64.b64encode(open(path, "rb").read()).decode()
        motions.append(item)
    rig = {k: summary.get(k) for k in ("n_joints", "face_pair", "notes", "annotate", "animated")}
    return {"rig": rig, "motions": motions}


def handler(job):
    workdir = tempfile.mkdtemp(prefix="aesyr-unimate-")
    try:
        return run_job(job["input"], workdir)
    except Exception as error:
        return {"error": str(error)[:2000]}
    finally:
        shutil.rmtree(workdir, ignore_errors=True)


if __name__ == "__main__":
    import runpod

    runpod.serverless.start({"handler": handler})
