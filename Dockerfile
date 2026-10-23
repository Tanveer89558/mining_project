# syntax=docker/dockerfile:1

FROM node:22-alpine AS frontend-build

WORKDIR /build/frontend
COPY frontend/package.json frontend/package-lock.json ./
RUN --mount=type=cache,target=/root/.npm \
    npm ci
COPY frontend/ ./
ARG VITE_API_BASE=
ENV VITE_API_BASE=${VITE_API_BASE}
RUN npm run build

# Heavy Python deps live in their own stage so app/frontend edits reuse them.
FROM python:3.11-slim AS python-deps

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    PIP_DEFAULT_TIMEOUT=600

WORKDIR /app

RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates libasound2 libgomp1 \
    && rm -rf /var/lib/apt/lists/*

# Torch is ~200MB. Use --no-cache-dir so a truncated download cannot poison pip's cache
# and fail later with "PACKAGES DO NOT MATCH THE HASHES".
RUN pip install --no-cache-dir --timeout 600 --retries 10 \
      --trusted-host download.pytorch.org \
      --trusted-host download-r2.pytorch.org \
      --index-url https://download.pytorch.org/whl/cpu \
      "torch==2.14.1"

COPY requirements.txt ./
RUN --mount=type=cache,target=/root/.cache/pip \
    pip install --timeout 120 --retries 5 -r requirements.txt

FROM python-deps AS runtime

ENV PORT=8000 \
    APP_DATA_DIR=/mnt/data

WORKDIR /app

COPY api.py main.py config.py config.ini ./
COPY Common ./Common
COPY demo ./demo
COPY diarization_code ./diarization_code
COPY regex_code ./regex_code
COPY --from=frontend-build /build/frontend/dist ./frontend/dist

RUN mkdir -p /mnt/data/input /mnt/data/output

EXPOSE 8000
CMD ["sh", "-c", "uvicorn api:app --host 0.0.0.0 --port ${PORT:-8000}"]
