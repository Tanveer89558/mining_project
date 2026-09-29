FROM node:22-alpine AS frontend-build

WORKDIR /build/frontend
COPY frontend/package*.json ./
RUN npm ci
COPY frontend/ ./
ARG VITE_API_BASE=
ENV VITE_API_BASE=${VITE_API_BASE}
RUN npm run build

FROM python:3.11-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PORT=8000 \
    APP_DATA_DIR=/mnt/data

WORKDIR /app

RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates libasound2 libgomp1 \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt ./
RUN pip install --no-cache-dir --timeout 120 --retries 5 --trusted-host download.pytorch.org --trusted-host download-r2.pytorch.org --index-url https://download.pytorch.org/whl/cpu torch \
    && pip install --no-cache-dir --timeout 120 --retries 5 -r requirements.txt

COPY . ./
COPY --from=frontend-build /build/frontend/dist ./frontend/dist

RUN mkdir -p /mnt/data/input /mnt/data/output

EXPOSE 8000
CMD ["sh", "-c", "uvicorn api:app --host 0.0.0.0 --port ${PORT:-8000}"]