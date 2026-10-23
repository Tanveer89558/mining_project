"""
FastAPI backend for Mining Voice AI pipeline.

Endpoints:
  POST /api/upload              save WAV for later processing
  POST /api/process             upload + run full pipeline (UI)
  POST /api/process/{job_id}    run pipeline on a prior upload
  GET  /api/results/{job_id}    pull processed JSON artifacts
  GET  /api/export/{job_id}     download all JSON artifacts as a ZIP
  GET  /api/overview            Cowal overview dashboard JSON
  GET  /api/exchanges           communication exchanges list JSON
  POST /api/exchanges/process   process WAV, assign 5-digit id, persist exchange
  PATCH /api/exchanges/{id}/analysis     set analysis status (Pending, etc.)
  PATCH /api/exchanges/{id}/validation   save supervisor validation under UUID
  PATCH /api/exchanges/{id}/coaching     complete coaching for confirmed breaches
  GET  /api/audio/{job_id}      stream uploaded WAV for an exchange job
  GET  /api/demo-audio/{filename}  stream a bundled demo WAV for AI Analysis
  GET  /api/health              liveness check
"""

import io
import json
import os
import random
import re
import traceback
import zipfile
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, Optional, Set

from fastapi import Body, FastAPI, File, HTTPException, UploadFile
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

# Placeholder: point OVERVIEW_JSON_PATH at your overview JSON when ready.
# Default uses the bundled dummy file under Common/.
OVERVIEW_JSON_PATH = os.environ.get(
    "OVERVIEW_JSON_PATH",
    os.path.join(BASE_DIR, "Common", "overview_data.json"),
)

# Placeholder: point EXCHANGES_JSON_PATH at your exchanges JSON when ready.
# Populated when Test your audio runs real analysis.
EXCHANGES_JSON_PATH = os.environ.get(
    "EXCHANGES_JSON_PATH",
    os.path.join(BASE_DIR, "Common", "exchanges_data.json"),
)

DEMO_AUDIO_DIR = os.environ.get(
    "DEMO_AUDIO_DIR",
    os.path.join(BASE_DIR, "demo"),
)

DEMO_AUDIO_FILES = {
    "demo_ack_noisy_testfile.wav",
    "demo_hold_noisy_testfile.wav",
    "demo_unack_noisy_testfile.wav",
    "demo_mm_noisy_testfile.wav",
}

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


def _exchanges_path() -> Path:
    return Path(EXCHANGES_JSON_PATH)


def _load_exchanges_payload() -> dict:
    path = _exchanges_path()
    if not path.is_file():
        return {"exchanges": []}

    try:
        with open(path, "r", encoding="utf-8") as handle:
            data = json.load(handle)
    except json.JSONDecodeError as err:
        raise HTTPException(
            status_code=500,
            detail=f"Exchanges JSON at '{path}' is invalid: {err}",
        ) from err

    if isinstance(data, list):
        return {"exchanges": data}
    if isinstance(data, dict):
        exchanges = data.get("exchanges", [])
        if not isinstance(exchanges, list):
            exchanges = []
        return {"exchanges": exchanges}
    return {"exchanges": []}


def _save_exchanges_payload(payload: dict) -> None:
    path = _exchanges_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "w", encoding="utf-8") as handle:
        json.dump(payload, handle, indent=2, ensure_ascii=False)
        handle.write("\n")


def _new_exchange_id(existing_ids: Set[str]) -> str:
    for _ in range(200):
        candidate = f"{random.randint(10000, 99999)}"
        if candidate not in existing_ids:
            return candidate
    raise HTTPException(
        status_code=500,
        detail="Could not allocate a unique 5-digit exchange id.",
    )


_STATUS_DISPLAY_NAMES = {
    "PROCEED": "Compliant entry",
    "AMBIGUOUS": "Vague reply",
    "HOLD": "Explicit HOLD",
}

_MISMATCH_DISPLAY_NAMES = {
    "truck_id": "Wrong truck number",
    "shovel_id": "Wrong shovel",
    "pocket_id": "Wrong pocket",
    "equipment_id": "Wrong equipment",
    "bench": "Wrong bench",
    "level": "Wrong level",
}


def _raw_status(regex: Optional[Dict[str, Any]]) -> str:
    if not isinstance(regex, dict):
        return "UNKNOWN"
    status = regex.get("status")
    flag = regex.get("flag")
    if status:
        return str(status)
    if flag:
        return str(flag)
    return "UNKNOWN"


def _mismatch_display_name(regex: Dict[str, Any]) -> str:
    mismatches = regex.get("mismatches")
    if not isinstance(mismatches, dict) or not mismatches:
        return "Entity mismatch"

    for field in (
        "truck_id",
        "shovel_id",
        "pocket_id",
        "equipment_id",
        "bench",
        "level",
    ):
        if field in mismatches:
            return _MISMATCH_DISPLAY_NAMES.get(field, "Entity mismatch")

    first_key = next(iter(mismatches.keys()), None)
    if first_key:
        return _MISMATCH_DISPLAY_NAMES.get(str(first_key), "Entity mismatch")
    return "Entity mismatch"


def _display_title(regex: Optional[Dict[str, Any]]) -> str:
    """
    Human-readable event name for lists / headers.

    Internal protocol status stays PROCEED / AMBIGUOUS / Mis Matched / HOLD.
    """

    if not isinstance(regex, dict):
        return "UNKNOWN"

    raw = _raw_status(regex)
    if raw in {"Mis Matched", "Mis Match", "Mismatch"}:
        return _mismatch_display_name(regex)
    return _STATUS_DISPLAY_NAMES.get(raw, raw)


VALID_DECISIONS = {
    "Confirmed breach",
    "Not a breach",
    "Needs further review",
}

VALID_CLASSIFICATIONS = {
    "Invalid response / closure",
    "Asset identity",
    "Intent and context",
    "Readback / hearback",
    "Transmission integrity",
    "Other",
}


def _build_exchange_record(
    *,
    exchange_id: str,
    job_id: str,
    filename: str,
    regex: Optional[Dict[str, Any]],
    execution: str,
    analysis: str = "Awaiting",
) -> Dict[str, Any]:
    reviewed = False
    raw_status = _raw_status(regex) if execution == "Successful" else "Failed"
    display_title = (
        _display_title(regex) if execution == "Successful" else "Failed"
    )
    return {
        "id": exchange_id,
        "title": display_title,
        "status": raw_status,
        "subtitle": "Scripted audio demonstration",
        "execution": execution,
        "analysis": analysis,
        "supervisorStatus": "Reviewed" if reviewed else "Not reviewed",
        "filter": "reviewed" if reviewed else "needs_review",
        "job_id": job_id,
        "filename": filename,
        "validation": None,
        "coaching": None,
    }


def _find_exchange(exchange_id: str):
    payload = _load_exchanges_payload()
    for index, item in enumerate(payload["exchanges"]):
        if isinstance(item, dict) and str(item.get("id")) == str(exchange_id):
            return payload, item, index
    raise HTTPException(
        status_code=404,
        detail=f"Exchange '{exchange_id}' was not found.",
    )


def _utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


@app.get("/api/health")
def health():
    return {
        "status": "ok",
        "input_dir": INPUT_DIR,
        "output_dir": OUTPUT_DIR,
        "overview_json_path": OVERVIEW_JSON_PATH,
        "exchanges_json_path": EXCHANGES_JSON_PATH,
    }


@app.get("/api/overview")
def get_overview():
    """
    Serve Cowal communications overview data from OVERVIEW_JSON_PATH.

    Replace the path (env OVERVIEW_JSON_PATH) when your real JSON is ready.
    """

    path = Path(OVERVIEW_JSON_PATH)
    if not path.is_file():
        raise HTTPException(
            status_code=404,
            detail=(
                f"Overview JSON not found at '{path}'. "
                "Set OVERVIEW_JSON_PATH to your JSON file location."
            ),
        )

    try:
        with open(path, "r", encoding="utf-8") as handle:
            return json.load(handle)
    except json.JSONDecodeError as err:
        raise HTTPException(
            status_code=500,
            detail=f"Overview JSON at '{path}' is invalid: {err}",
        ) from err


@app.get("/api/exchanges")
def get_exchanges():
    """
    Serve communication exchanges from EXCHANGES_JSON_PATH.

    Set EXCHANGES_JSON_PATH when your exchanges JSON lives elsewhere.
    """

    return _load_exchanges_payload()


@app.post("/api/exchanges/process")
async def process_and_save_exchange(audio: UploadFile = File(...)):
    """
    Upload a WAV, assign a 5-digit exchange id, run diarization, and append
    the exchange record to EXCHANGES_JSON_PATH for Overview / Exchanges UI.
    """

    payload = _load_exchanges_payload()
    existing_ids = {
        str(item.get("id"))
        for item in payload["exchanges"]
        if isinstance(item, dict) and item.get("id") is not None
    }
    exchange_id = _new_exchange_id(existing_ids)

    job_id, audio_path = await _save_upload(audio)
    filename = os.path.basename(audio_path)

    try:
        pipeline_result = _run_pipeline(audio_path)
    except Exception as err:
        traceback.print_exc()
        exchange = _build_exchange_record(
            exchange_id=exchange_id,
            job_id=job_id,
            filename=filename,
            regex=None,
            execution="Failed",
            analysis="Awaiting",
        )
        payload["exchanges"].insert(0, exchange)
        _save_exchanges_payload(payload)
        raise HTTPException(
            status_code=500,
            detail=str(err) or "The audio could not be processed.",
        ) from err

    ui_payload = _ui_payload(job_id, pipeline_result)
    regex = ui_payload.get("regex") if isinstance(ui_payload.get("regex"), dict) else None
    exchange = _build_exchange_record(
        exchange_id=exchange_id,
        job_id=job_id,
        filename=filename,
        regex=regex,
        execution="Successful",
        analysis="Awaiting",
    )
    payload["exchanges"].insert(0, exchange)
    _save_exchanges_payload(payload)

    return {
        **ui_payload,
        "exchange": exchange,
        "exchanges": payload["exchanges"],
    }


@app.get("/api/audio/{job_id}")
def get_audio(job_id: str):
    """Stream the uploaded WAV for listen / review playback."""

    audio_path = _resolve_audio_path(job_id)
    return FileResponse(
        audio_path,
        media_type="audio/wav",
        filename=os.path.basename(audio_path),
    )


@app.get("/api/demo-audio/{filename}")
def get_demo_audio(filename: str):
    """Stream a whitelisted demo WAV from the demo folder."""

    safe_name = Path(filename).name
    if safe_name not in DEMO_AUDIO_FILES:
        raise HTTPException(status_code=404, detail="Demo audio not found.")

    audio_path = Path(DEMO_AUDIO_DIR) / safe_name
    if not audio_path.is_file():
        raise HTTPException(status_code=404, detail="Demo audio file is missing on the server.")

    return FileResponse(
        audio_path,
        media_type="audio/wav",
        filename=safe_name,
    )


@app.patch("/api/exchanges/{exchange_id}/analysis")
def update_exchange_analysis(exchange_id: str, body: Dict[str, Any] = Body(...)):
    """Set analysis status for an exchange (e.g. Pending after Run analysis)."""

    analysis = str(body.get("analysis") or "").strip()
    if analysis == "Simulated result":
        analysis = "Completed"
    allowed = {"Awaiting", "Pending", "Completed"}
    if analysis not in allowed:
        raise HTTPException(
            status_code=400,
            detail=f"analysis must be one of: {', '.join(sorted(allowed))}",
        )

    payload, exchange, index = _find_exchange(exchange_id)
    exchange["analysis"] = analysis
    payload["exchanges"][index] = exchange
    _save_exchanges_payload(payload)
    return {"exchange": exchange, "exchanges": payload["exchanges"]}


@app.patch("/api/exchanges/{exchange_id}/validation")
def save_exchange_validation(exchange_id: str, body: Dict[str, Any] = Body(...)):
    """
    Persist supervisor validation under the exchange UUID.

    Decision is required. Classification is required unless Decision is
    'Not a breach'. Reviewer note is optional.
    """

    decision = str(body.get("decision") or "").strip()
    classification = str(body.get("classification") or "").strip()
    reviewer_note = str(body.get("reviewerNote") or "").strip()

    if decision not in VALID_DECISIONS:
        raise HTTPException(
            status_code=400,
            detail=(
                "decision must be one of: Confirmed breach, Not a breach, "
                "Needs further review"
            ),
        )

    if decision == "Not a breach":
        classification = ""
    else:
        if not classification:
            raise HTTPException(
                status_code=400,
                detail="classification is required unless decision is 'Not a breach'.",
            )
        if classification not in VALID_CLASSIFICATIONS:
            raise HTTPException(
                status_code=400,
                detail=f"classification must be one of: {', '.join(sorted(VALID_CLASSIFICATIONS))}",
            )

    payload, exchange, index = _find_exchange(exchange_id)
    exchange["validation"] = {
        "decision": decision,
        "classification": classification,
        "reviewerNote": reviewer_note,
        "savedAt": _utc_now(),
    }

    if decision == "Not a breach":
        exchange["supervisorStatus"] = "No breach"
        exchange["filter"] = "reviewed"
        exchange["analysis"] = "Completed"
        exchange["coaching"] = None
    elif decision == "Confirmed breach":
        exchange["supervisorStatus"] = "Confirmed breach"
        exchange["filter"] = "reviewed"
        exchange["analysis"] = "Completed"
        existing_coaching = (
            exchange.get("coaching") if isinstance(exchange.get("coaching"), dict) else {}
        )
        exchange["coaching"] = {
            "status": existing_coaching.get("status") or "Pending",
            "followUp": existing_coaching.get("followUp") or "Recheck next shift",
            "classification": classification,
            "note": existing_coaching.get("note") or "",
        }
    else:
        # Needs further review — keep the exchange open for more supervisor work.
        exchange["supervisorStatus"] = "Under Review"
        exchange["filter"] = "needs_review"
        exchange["analysis"] = "Pending"
        exchange["coaching"] = None

    payload["exchanges"][index] = exchange
    _save_exchanges_payload(payload)
    return {"exchange": exchange, "exchanges": payload["exchanges"]}


@app.patch("/api/exchanges/{exchange_id}/coaching")
def save_exchange_coaching(exchange_id: str, body: Dict[str, Any] = Body(...)):
    """Complete or update coaching for a confirmed-breach exchange."""

    payload, exchange, index = _find_exchange(exchange_id)
    validation = exchange.get("validation") if isinstance(exchange.get("validation"), dict) else {}
    if validation.get("decision") != "Confirmed breach":
        raise HTTPException(
            status_code=400,
            detail="Coaching requires a confirmed breach validation.",
        )

    existing = exchange.get("coaching") if isinstance(exchange.get("coaching"), dict) else {}
    status = str(body.get("status") or existing.get("status") or "Completed").strip()
    follow_up = str(body.get("followUp") or existing.get("followUp") or "Recheck next shift").strip()
    note = str(body.get("note") or existing.get("note") or "").strip()

    exchange["coaching"] = {
        "status": status,
        "followUp": follow_up,
        "classification": validation.get("classification") or existing.get("classification") or "",
        "note": note,
        "completedAt": _utc_now() if status == "Completed" else existing.get("completedAt"),
    }
    payload["exchanges"][index] = exchange
    _save_exchanges_payload(payload)
    return {"exchange": exchange, "exchanges": payload["exchanges"]}


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
