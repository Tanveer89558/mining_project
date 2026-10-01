"""
FastAPI backend for Mining Voice AI pipeline.

Endpoints:
  POST /api/upload              save WAV for later processing
  POST /api/process             upload or sample + run full pipeline (UI)
  POST /api/process/{job_id}    run pipeline on a prior upload
  GET  /api/samples             list built-in scenario WAV files
  GET  /api/samples/{id}/audio  stream a built-in scenario WAV
  GET  /api/results/{job_id}    pull processed JSON artifacts
  GET  /api/export/{job_id}     download all JSON artifacts as a ZIP
  GET  /api/health              liveness check
"""

import io
import json
import os
import re
import shutil
import traceback
import zipfile
from pathlib import Path

from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, Response
from fastapi.staticfiles import StaticFiles

from Common.paths import (
    BASE_DIR,
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
TEST_DATA_DIR = os.path.join(BASE_DIR, "test_data")

# Built-in demos mapped to files under test_data/ (Scenario A/B/C in README).
SAMPLE_SCENARIOS = [
    {
        "id": "scenario_a",
        "filename": "ack_noisy_testfile.wav",
        "label": "Scenario A — Compliant entry",
        "expected_status": "PROCEED",
        "summary": "Clear callout, clear proceed, clear thanks",
    },
    {
        "id": "scenario_b",
        "filename": "unack_noisy_testfile.wav",
        "label": "Scenario B — Unacknowledged / vague reply",
        "expected_status": "AMBIGUOUS",
        "summary": 'Clear callout, vague "yeah / copy mate" reply',
    },
    {
        "id": "scenario_c",
        "filename": "mm_noisy_testfile.wav",
        "label": "Scenario C — Wrong truck number",
        "expected_status": "Mis Matched",
        "summary": "Clear callout, shovel repeats a different truck ID",
    },
]
SAMPLE_BY_ID = {item["id"]: item for item in SAMPLE_SCENARIOS}

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


def _sample_source_path(sample: dict) -> str:
    return os.path.join(TEST_DATA_DIR, sample["filename"])


def _available_samples() -> list[dict]:
    samples = []
    for sample in SAMPLE_SCENARIOS:
        path = _sample_source_path(sample)
        if not os.path.isfile(path):
            continue
        samples.append(
            {
                **sample,
                "size_bytes": os.path.getsize(path),
                "audio_url": f"/api/samples/{sample['id']}/audio",
            }
        )
    return samples


def _resolve_sample(sample_id: str) -> dict:
    cleaned = (sample_id or "").strip().lower()
    sample = SAMPLE_BY_ID.get(cleaned)
    if sample is None:
        raise HTTPException(
            status_code=404,
            detail=f"Unknown sample '{sample_id}'.",
        )

    path = _sample_source_path(sample)
    if not os.path.isfile(path):
        raise HTTPException(
            status_code=404,
            detail=(
                f"Sample file '{sample['filename']}' is missing from test_data/. "
                "Place the WAV there and restart the API."
            ),
        )

    return sample


def _stage_sample(sample_id: str) -> tuple[str, str]:
    sample = _resolve_sample(sample_id)
    source_path = _sample_source_path(sample)
    job_id = _safe_stem(sample["filename"])
    audio_path = get_input_audio_path(f"{job_id}.wav")

    os.makedirs(INPUT_DIR, exist_ok=True)
    shutil.copy2(source_path, audio_path)
    return job_id, audio_path


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
        "samples_available": len(_available_samples()),
    }


@app.get("/api/samples")
def list_samples():
    """
    List built-in scenario WAVs present under test_data/.
    """

    return {"samples": _available_samples()}


@app.get("/api/samples/{sample_id}/audio")
def get_sample_audio(sample_id: str):
    """
    Stream a built-in scenario WAV for UI preview playback.
    """

    sample = _resolve_sample(sample_id)
    path = _sample_source_path(sample)
    return FileResponse(
        path,
        media_type="audio/wav",
        filename=sample["filename"],
    )


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
    audio: UploadFile | None = File(None),
    sample_id: str | None = Form(None),
):
    """
    Run the full pipeline from either:
      - uploaded WAV (Form field: audio), or
      - built-in sample (Form field: sample_id)
    """

    has_upload = audio is not None and bool(audio.filename)
    has_sample = bool((sample_id or "").strip())

    if has_upload and has_sample:
        raise HTTPException(
            status_code=400,
            detail="Provide either an uploaded WAV or a sample_id, not both.",
        )
    if not has_upload and not has_sample:
        raise HTTPException(
            status_code=400,
            detail="Choose a WAV file or pick a built-in scenario sample.",
        )

    if has_sample:
        job_id, audio_path = _stage_sample(sample_id)
    else:
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
