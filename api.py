"""
FastAPI backend for Mining Voice AI pipeline.

Endpoints:
  POST /api/upload              save WAV for later processing
  POST /api/process             upload + run full pipeline (UI)
  POST /api/process/{job_id}    run pipeline on a prior upload
  GET  /api/results/{job_id}    pull processed JSON artifacts
  GET  /api/export/{job_id}     download all JSON artifacts as a ZIP
  GET  /api/health              liveness check
"""

import io
import json
import os
import re
import traceback
import zipfile
from pathlib import Path

from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response
from fastapi.staticfiles import StaticFiles

from Common.paths import (
    INPUT_DIR,
    OUTPUT_DIR,
    get_bert_output_path,
    get_diarized_output_path,
    get_grouped_output_path,
    get_input_audio_path,
    get_regex_output_path,
)

ALLOWED_EXTENSIONS = {".wav"}
MAX_UPLOAD_BYTES = 100 * 1024 * 1024

app = FastAPI(
    title="Mining Voice AI API",
    version="1.0.0",
)

default_cors_origins = (
    "http://localhost:5173,http://127.0.0.1:5173,"
    "http://localhost:4173,http://127.0.0.1:4173,"
    "http://localhost:5500,http://127.0.0.1:5500"
)
cors_origins = [
    origin.strip()
    for origin in os.environ.get("CORS_ORIGINS", default_cors_origins).split(",")
    if origin.strip()
]

app.add_middleware(
    CORSMiddleware,
    allow_origins=cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


def _safe_stem(filename: str) -> str:
    stem = Path(filename).stem
    cleaned = re.sub(r"[^A-Za-z0-9._-]+", "_", stem).strip("._")
    return cleaned or "audio"


def _job_id_from_path(audio_path: str) -> str:
    return Path(audio_path).stem


def _resolve_audio_path(job_id: str) -> str:
    cleaned = _safe_stem(job_id)
    audio_path = get_input_audio_path(f"{cleaned}.wav")

    if not os.path.isfile(audio_path):
        raise HTTPException(
            status_code=404,
            detail=f"No uploaded audio found for job '{cleaned}'.",
        )

    return audio_path


def _load_json(path: str):
    if not os.path.isfile(path):
        return None

    with open(path, "r", encoding="utf-8") as handle:
        return json.load(handle)


async def _save_upload(audio: UploadFile) -> tuple[str, str]:
    if not audio.filename:
        raise HTTPException(
            status_code=400,
            detail="Missing audio filename.",
        )

    extension = Path(audio.filename).suffix.lower()
    if extension not in ALLOWED_EXTENSIONS:
        raise HTTPException(
            status_code=400,
            detail="Choose a WAV audio file to continue.",
        )

    content = await audio.read()
    if not content:
        raise HTTPException(
            status_code=400,
            detail="This audio file is empty. Choose another file.",
        )

    if len(content) > MAX_UPLOAD_BYTES:
        raise HTTPException(
            status_code=400,
            detail="This file is larger than the 100 MB upload limit.",
        )

    job_id = _safe_stem(audio.filename)
    audio_path = get_input_audio_path(f"{job_id}.wav")

    os.makedirs(INPUT_DIR, exist_ok=True)
    with open(audio_path, "wb") as handle:
        handle.write(content)

    return job_id, audio_path


def _ui_payload(job_id: str, pipeline_result: dict) -> dict:
    return {
        "job_id": job_id,
        "transcriptions": pipeline_result.get("transcriptions", []),
        "comparison_mode": "paragraph",
        "total_score": pipeline_result.get("total_score"),
        "regex": pipeline_result.get("regex"),
        "outputs": pipeline_result.get("outputs", {}),
    }


def _run_pipeline(audio_path: str) -> dict:
    # Lazy import so /api/health and /api/results start without loading BERT.
    from main import run_pipeline

    return run_pipeline(audio_path)


@app.get("/api/health")
def health():
    return {
        "status": "ok",
        "input_dir": INPUT_DIR,
        "output_dir": OUTPUT_DIR,
    }


@app.post("/api/upload")
async def upload_audio(audio: UploadFile = File(...)):
    """
    API 1 (upload only): store WAV under input/ and return job_id.
    """

    job_id, audio_path = await _save_upload(audio)

    return {
        "job_id": job_id,
        "filename": os.path.basename(audio_path),
        "path": audio_path,
        "message": "Upload successful. Call /api/process/{job_id} to start the pipeline.",
    }


@app.post("/api/process")
async def process_upload(
    audio: UploadFile = File(...),
):
    """
    Upload a WAV and immediately run the full pipeline.

    Matches the current frontend FormData contract: audio
    """

    job_id, audio_path = await _save_upload(audio)

    try:
        pipeline_result = _run_pipeline(audio_path)
    except HTTPException:
        raise
    except Exception as err:
        traceback.print_exc()
        raise HTTPException(
            status_code=500,
            detail=str(err) or "The audio could not be processed.",
        ) from err

    return _ui_payload(job_id, pipeline_result)


@app.post("/api/process/{job_id}")
def process_job(job_id: str):
    """
    Start the pipeline for a previously uploaded file.
    """

    audio_path = _resolve_audio_path(job_id)
    cleaned_job_id = _job_id_from_path(audio_path)

    try:
        pipeline_result = _run_pipeline(audio_path)
    except Exception as err:
        traceback.print_exc()
        raise HTTPException(
            status_code=500,
            detail=str(err) or "The audio could not be processed.",
        ) from err

    return _ui_payload(cleaned_job_id, pipeline_result)


@app.get("/api/results/{job_id}")
def get_results(job_id: str):
    """
    API 3: pull data from processed JSON files for a job.
    """

    cleaned_job_id = _safe_stem(job_id)
    audio_path = get_input_audio_path(f"{cleaned_job_id}.wav")

    diarized_path = get_diarized_output_path(audio_path)
    grouped_path = get_grouped_output_path(audio_path)
    bert_path = get_bert_output_path(audio_path)
    regex_path = get_regex_output_path(audio_path)

    diarized = _load_json(diarized_path)
    grouped = _load_json(grouped_path)
    bert = _load_json(bert_path)
    regex = _load_json(regex_path)

    if all(value is None for value in (diarized, grouped, bert, regex)):
        raise HTTPException(
            status_code=404,
            detail=(
                f"No processed JSON found for job '{cleaned_job_id}'. "
                "Upload and process the audio first."
            ),
        )

    return {
        "job_id": cleaned_job_id,
        "transcriptions": diarized or [],
        "comparison_mode": "paragraph",
        "total_score": (
            bert.get("bert_score")
            if isinstance(bert, dict)
            else None
        ),
        "regex": regex,
        "grouped": grouped,
        "bert_score": bert,
        "outputs": {
            "diarized": diarized_path if diarized is not None else None,
            "grouped": grouped_path if grouped is not None else None,
            "bert_score": bert_path if bert is not None else None,
            "regex": regex_path if regex is not None else None,
        },
    }


@app.get("/api/export/{job_id}")
def export_training(job_id: str):
    """
    Download all generated JSON artifacts for a job as a ZIP archive.
    """

    cleaned_job_id = _safe_stem(job_id)
    audio_path = get_input_audio_path(f"{cleaned_job_id}.wav")

    artifacts = [
        (f"{cleaned_job_id}_diarized.json", get_diarized_output_path(audio_path)),
        (f"{cleaned_job_id}_grouped.json", get_grouped_output_path(audio_path)),
        (f"{cleaned_job_id}_bert_score.json", get_bert_output_path(audio_path)),
        (f"{cleaned_job_id}_regex.json", get_regex_output_path(audio_path)),
    ]

    existing = [
        (name, path)
        for name, path in artifacts
        if os.path.isfile(path)
    ]

    if not existing:
        raise HTTPException(
            status_code=404,
            detail=(
                f"No processed JSON found for job '{cleaned_job_id}'. "
                "Upload and process the audio first."
            ),
        )

    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w", zipfile.ZIP_DEFLATED) as archive:
        for name, path in existing:
            archive.write(path, arcname=name)
    buffer.seek(0)

    zip_name = f"{cleaned_job_id}_training_export.zip"
    return Response(
        content=buffer.getvalue(),
        media_type="application/zip",
        headers={
            "Content-Disposition": f'attachment; filename="{zip_name}"',
        },
    )


frontend_dist = Path(__file__).resolve().parent / "frontend" / "dist"
if frontend_dist.is_dir():
    app.mount("/", StaticFiles(directory=frontend_dist, html=True), name="frontend")
