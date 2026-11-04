# Aesyr Studio v2: Blender motion worker for RunPod Serverless (CPU endpoint).
# Built by CI (.github/workflows/workers.yml) or RunPod's GitHub integration; no local Docker needed.
FROM ubuntu:24.04

ARG BLENDER_SERIES=4.5
ARG BLENDER_VERSION=4.5.15
ENV DEBIAN_FRONTEND=noninteractive PYTHONUNBUFFERED=1

RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates curl xz-utils python3 python3-pip \
      libx11-6 libxi6 libxxf86vm1 libxfixes3 libxrender1 libxkbcommon0 libsm6 libgl1 libegl1 libglu1-mesa \
 && rm -rf /var/lib/apt/lists/*

RUN set -eu; \
    curl -fsSL "https://download.blender.org/release/Blender${BLENDER_SERIES}/blender-${BLENDER_VERSION}-linux-x64.tar.xz" | tar -xJ -C /opt; \
    ln -s "/opt/blender-${BLENDER_VERSION}-linux-x64/blender" /usr/local/bin/blender; \
    blender -b --factory-startup --version | head -1

RUN pip3 install --no-cache-dir --break-system-packages runpod==2.1.0

WORKDIR /app
COPY recipes.py handler.py ./
ENV BLENDER_BIN=blender RECIPE_TIMEOUT=600
CMD ["python3", "-u", "handler.py"]
