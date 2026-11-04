# Aesyr Studio v2: UniMate text-to-motion worker for RunPod Serverless (GPU endpoint, 16 GB tier).
# Ubuntu 22.04 ships Python 3.10, which UniMate's pinned bpy 4.0 wheel needs.
# The checkpoint and text encoder are baked in so a cold worker never downloads them.
FROM nvidia/cuda:12.4.1-cudnn-runtime-ubuntu22.04

ARG UNIMATE_COMMIT=b78c7807df7cf4231d4e67f8d0ece29c5e11025b
ENV DEBIAN_FRONTEND=noninteractive PYTHONUNBUFFERED=1 HF_HOME=/opt/hf PIP_NO_CACHE_DIR=1

RUN apt-get update \
 && apt-get install -y --no-install-recommends python3 python3-pip python-is-python3 git ca-certificates curl \
      libx11-6 libxi6 libxxf86vm1 libxfixes3 libxrender1 libxkbcommon0 libsm6 libgl1 libegl1 libglu1-mesa libgomp1 \
 && rm -rf /var/lib/apt/lists/*

RUN git clone https://github.com/Friedrich-M/UniMate.git /opt/unimate \
 && git -C /opt/unimate checkout "$UNIMATE_COMMIT"

WORKDIR /opt/unimate
RUN pip install "setuptools<81" \
 && pip install -r requirements.txt --no-build-isolation \
 && pip install runpod==2.1.0

# Checkpoint (CC BY-NC 4.0, see README) and the flan-t5-base text encoder.
RUN hf download Linzhan/UniMate --repo-type model --local-dir outputs \
      --include "unimate_uniml3d_f60_v3/*.json" --include "unimate_uniml3d_f60_v3/*.npy" \
      --include "unimate_uniml3d_f60_v3/checkpoints/checkpoint_step_150000.pt" \
 && python -c "from transformers import AutoTokenizer, AutoModel; AutoTokenizer.from_pretrained('google/flan-t5-base'); AutoModel.from_pretrained('google/flan-t5-base')"

COPY blender /usr/local/bin/blender
COPY handler.py /app/handler.py
RUN chmod +x /usr/local/bin/blender
ENV UNIMATE_DIR=/opt/unimate
CMD ["python", "-u", "/app/handler.py"]
