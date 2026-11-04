"""RunPod Serverless handler: Blender object motion and clip merging (CPU).

Job input (validated again here; the app validates it first with shared/motion.ts):
    {
      "recipe": {...},                    # object-preset | keyframes | normalize | merge-clips
      "model_url": "https://...glb",      # the model to animate (or "model_b64")
      "sources": [{"url": "...", "name": "walk"}],   # merge-clips only: GLBs of the same rig
      "upload_url": "https://...signed PUT"           # optional; else the GLB comes back as base64
    }
Output: {"clips": [...], "bytes": n, "glb_b64": "..."} or {"clips": [...], "bytes": n, "uploaded": true}

The recipe is data, never code: recipes.py runs a fixed set of operations on it.
Run locally (no RunPod): python handler.py --test_input '{"input": {...}}'
"""

import base64
import json
import os
import shutil
import subprocess
import tempfile
import urllib.request

BLENDER = os.environ.get("BLENDER_BIN", "blender")
TIMEOUT = int(os.environ.get("RECIPE_TIMEOUT", "600"))
MAX_DOWNLOAD = 150 * 1024 * 1024  # Tripo's own model limit
MAX_INLINE = 9 * 1024 * 1024  # RunPod job output must stay under ~10 MB; larger needs upload_url
RECIPES = {"object-preset", "keyframes", "normalize", "merge-clips"}
HERE = os.path.dirname(os.path.abspath(__file__))


def fetch(url, path):
    allow_http = os.environ.get("ALLOW_HTTP_INPUTS") == "1"  # local testing only
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
        data = handle.read()
    request = urllib.request.Request(url, data=data, method="PUT", headers={"Content-Type": "model/gltf-binary"})
    with urllib.request.urlopen(request, timeout=300) as response:
        if response.status >= 300:
            raise RuntimeError(f"Upload failed with HTTP {response.status}.")


def run_job(job_input, workdir):
    recipe = job_input.get("recipe")
    if not isinstance(recipe, dict) or recipe.get("recipe") not in RECIPES:
        raise ValueError("Unknown recipe.")
    source = os.path.join(workdir, "in.glb")
    if job_input.get("model_url"):
        fetch(job_input["model_url"], source)
    elif job_input.get("model_b64"):
        with open(source, "wb") as handle:
            handle.write(base64.b64decode(job_input["model_b64"]))
    else:
        raise ValueError("Send model_url or model_b64.")

    recipe = dict(recipe)
    if recipe["recipe"] == "merge-clips":
        sources = job_input.get("sources") or []
        if not 1 <= len(sources) <= 24:
            raise ValueError("merge-clips takes 1 to 24 sources.")
        local = []
        for i, item in enumerate(sources):
            path = os.path.join(workdir, f"clip{i}.glb")
            fetch(item["url"], path)
            local.append({"path": path, "name": str(item.get("name") or "")[:60]})
        recipe["sources"] = local

    recipe_path = os.path.join(workdir, "recipe.json")
    with open(recipe_path, "w", encoding="utf-8") as handle:
        json.dump(recipe, handle)
    target = os.path.join(workdir, "out.glb")
    cmd = [BLENDER, "-b", "--factory-startup", "--python-exit-code", "1",
           "--python", os.path.join(HERE, "recipes.py"), "--", source, target, recipe_path]
    done = subprocess.run(cmd, capture_output=True, text=True, timeout=TIMEOUT)
    if done.returncode != 0 or not os.path.exists(target):
        tail = (done.stderr or done.stdout or "")[-1500:]
        raise RuntimeError(f"Blender failed: {tail}")
    with open(target + ".json", encoding="utf-8") as handle:
        clips = json.load(handle)["clips"]
    size = os.path.getsize(target)
    if job_input.get("upload_url"):
        upload(job_input["upload_url"], target)
        return {"clips": clips, "bytes": size, "uploaded": True}
    if size > MAX_INLINE:
        raise ValueError("The result is larger than 9 MB; send upload_url.")
    with open(target, "rb") as handle:
        return {"clips": clips, "bytes": size, "glb_b64": base64.b64encode(handle.read()).decode()}


def handler(job):
    workdir = tempfile.mkdtemp(prefix="aesyr-blender-")
    try:
        return run_job(job["input"], workdir)
    except Exception as error:  # reported to the app as a failed job
        return {"error": str(error)[:2000]}
    finally:
        shutil.rmtree(workdir, ignore_errors=True)


if __name__ == "__main__":
    import runpod

    runpod.serverless.start({"handler": handler})
