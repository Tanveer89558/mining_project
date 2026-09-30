# Mining Voice AI

Mining Voice AI processes two-speaker mining radio conversations from WAV audio. It diarizes speakers, measures semantic agreement between them, extracts operational entities (truck, shovel, pocket, bench, level), and returns a protocol status such as **PROCEED**, **HOLD**, **AMBIGUOUS**, or **Mis Matched**.

The solution ships as a FastAPI backend plus a React (Vite) frontend. You can run the full pipeline from the UI, the REST API, or the CLI (`main.py`).

---

## Table of contents

1. [What this project does](#what-this-project-does)
2. [Architecture](#architecture)
3. [Models and services](#models-and-services)
4. [Program flow](#program-flow)
5. [Input and output](#input-and-output)
6. [Project structure](#project-structure)
7. [Prerequisites](#prerequisites)
8. [Clone and install — PowerShell](#clone-and-install--powershell)
9. [Clone and install — WSL](#clone-and-install--wsl)
10. [Configuration](#configuration)
11. [How to run](#how-to-run)
12. [API reference](#api-reference)
13. [Deployment](#deployment)

---

## What this project does

| Stage | Responsibility |
| --- | --- |
| 1. Diarization | Azure Speech Conversation Transcriber splits the WAV into speaker-labeled segments and applies mining term normalization |
| 2. BERT score | A Hugging Face BERT encoder embeds Guest-1 and Guest-2 full conversations and returns cosine similarity (0.0–1.0) |
| 3. Regex extraction | Pattern matching extracts equipment IDs and protocol keywords, then compares Guest-1 vs Guest-2 for mismatches |

---

## Architecture

```text
┌─────────────────────────────────────────────────────────────────┐
│                        Frontend (React / Vite)                   │
│                   Upload WAV → call POST /api/process            │
└───────────────────────────────┬─────────────────────────────────┘
                                │
                                ▼
┌─────────────────────────────────────────────────────────────────┐
│                     FastAPI backend (api.py)                     │
│         Validate WAV → save to input/ → run_pipeline()           │
└───────────────────────────────┬─────────────────────────────────┘
                                │
                                ▼
┌─────────────────────────────────────────────────────────────────┐
│                      Pipeline (main.py)                          │
│                                                                  │
│  ┌──────────────────┐   ┌──────────────────┐   ┌──────────────┐ │
│  │ 1. Diarization   │──▶│ 2. BERT score    │──▶│ 3. Regex     │ │
│  │ Azure Speech     │   │ HF BERT encoder  │   │ Entity/status│ │
│  │ + term mappings  │   │ cosine similarity│   │ extraction   │ │
│  └────────┬─────────┘   └────────┬─────────┘   └──────┬───────┘ │
│           │                      │                     │         │
│           ▼                      ▼                     ▼         │
│   *_diarized.json         *_bert_score.json      *_regex.json    │
│   *_grouped.json                                                 │
└─────────────────────────────────────────────────────────────────┘
                                │
                                ▼
                    output/<audio_stem>/  + UI JSON payload
```

| Layer | Component | Role |
| --- | --- | --- |
| UI | `frontend/` | Upload WAV, preview audio, display transcript, BERT score, and protocol status |
| API | `api.py` | Upload, process, results, health; optionally serves `frontend/dist` |
| Orchestration | `main.py` | Runs diarization → BERT → regex in order |
| Speech | `diarization_code/diarization.py` | Azure Conversation Transcriber + alias mapping + speaker grouping |
| NLP score | `diarization_code/bert_code.py` | BERT embeddings + cosine similarity for Guest-1 vs Guest-2 |
| Rules | `regex_code/regex_parser.py` | Entity extraction and PROCEED / HOLD / AMBIGUOUS / Mis Matched |
| Paths | `Common/paths.py` | Resolves `input/` and `output/` (respects `APP_DATA_DIR`) |
| Config | `config.py`, `config.ini`, `.env` | Azure credentials and BERT model name |

---

## Models and services

| Name | Type | Purpose in this solution | Source / default |
| --- | --- | --- | --- |
| Azure Speech Conversation Transcriber | Cloud speech service | Speech-to-text **and** speaker diarization for two-party radio audio (`en-US`) | [Azure Cognitive Services Speech](https://learn.microsoft.com/azure/ai-services/speech-service/) — requires `AZURE_SPEECH_KEY` + region or endpoint |
| `bert-large-uncased-whole-word-masking-finetuned-squad` | Hugging Face Transformer (encoder) | Encode Guest-1 and Guest-2 full conversations; compute **cosine similarity** as agreement score. Not used as a Q&A model here. | [Hugging Face model card](https://huggingface.co/bert-large-uncased-whole-word-masking-finetuned-squad) — set in `config.ini` / override with `MODEL_NAME` |
| Term mapping (`Common/mappings.json`) | Local alias dictionary | Normalize ASR mishearings (e.g. “Hall track” → “Haul Truck”) before scoring and regex | Local project file |
| Regex patterns (`regex_code/regex_parser.py`) | Rule-based extractors | Pull truck / shovel / pocket / equipment / bench / level / movement / loading / status keywords | Local project code |

**Model → purpose summary**

| Used for | Model / service |
| --- | --- |
| Turn audio into speaker-labeled text | Azure Speech Conversation Transcriber |
| Measure semantic agreement between speakers | BERT encoder + cosine similarity |
| Extract mining entities and protocol status | Regex rules (+ mappings for cleaner text) |

---

## Program flow

End-to-end sequence when a user uploads a WAV (UI or `POST /api/process`):

1. **Validate upload** — filename present, extension `.wav`, non-empty, ≤ 100 MB.
2. **Persist audio** — saved as `input/<safe_stem>.wav` (`job_id` = stem).
3. **Diarization**
   - Azure Conversation Transcriber streams recognition with speaker IDs.
   - Near-duplicate segments from the same speaker within a short window are dropped.
   - Alias mapping normalizes mining terms in text.
   - Writes `*_diarized.json` (segment list) and `*_grouped.json` (messages per speaker).
4. **BERT score**
   - Loads Guest-1 and Guest-2 text from the grouped JSON.
   - Embeds each conversation with the configured BERT model (mean-pooled, L2-normalized).
   - Cosine similarity → `bert_score` in `[0.0, 1.0]`.
   - Writes `*_bert_score.json`.
5. **Regex extraction**
   - Extracts entities from each guest’s messages.
   - If both guests state the same field with different values → **Mis Matched** (stops before status).
   - Otherwise derives status from Guest-2 keywords: HOLD → PROCEED → AMBIGUOUS.
   - Writes `*_regex.json`.
6. **Return payload** — API/UI receive transcriptions, total BERT score, regex result, and output paths.

CLI entry point (`python main.py`) runs the same pipeline on `DEFAULT_AUDIO_FILE` (default: `input/mm_noisy_testfile-copy.wav`).

---

## Input and output

### Input

| Field | Expected value | Notes |
| --- | --- | --- |
| Audio format | `.wav` only | Other formats rejected |
| Language | English (`en-US` on Azure Speech) | Mining radio / two-speaker dialogue |
| Speakers | Ideally two labeled guests | Pipeline compares **Guest-1** and **Guest-2**; other labels (e.g. Unknown) are ignored for BERT/regex |
| Max size | 100 MB | Enforced by API and UI |
| Storage path | `input/<stem>.wav` | Under `APP_DATA_DIR` when set (default: project root) |
| Sample files | `test_data/*.wav` | Example noisy mining clips for local trials |

### Output files

For an upload named `ack_noisy_testfile.wav`, artifacts are written to `output/ack_noisy_testfile/`:

| File | Contents |
| --- | --- |
| `{stem}_diarized.json` | Ordered segments: `speaker`, `text`, `offset`, `duration` (after mapping) |
| `{stem}_grouped.json` | `{ "Guest-1": ["...", "..."], "Guest-2": ["..."] }` |
| `{stem}_bert_score.json` | Guest-1 text, Guest-2 text, `bert_score`, comparison metadata + timing |
| `{stem}_regex.json` | Matched entities + `status` / `flag`, or mismatch details |

### API / UI response (process)

| Field | Type | Meaning |
| --- | --- | --- |
| `job_id` | string | Safe audio stem |
| `transcriptions` | array | Diarized segments for the UI transcript |
| `comparison_mode` | string | `"paragraph"` (whole-conversation BERT compare) |
| `total_score` | number \| null | BERT cosine similarity 0.0–1.0 |
| `regex` | object | Extracted entities, flag, status, acknowledgment |
| `outputs` | object | Absolute paths to the four JSON artifacts |

### Regex output fields (matched case)

| Field | Description |
| --- | --- |
| `flag` | `Matched` or `Mis Matched` |
| `truck_id`, `shovel_id`, `pocket_id`, `equipment_id` | Extracted IDs |
| `bench`, `level` | Location-style numbers |
| `movement`, `loading` | Keyword hits (enter, load, tip, etc.) |
| `acknowledgment` | Guest-1 ack phrase if found |
| `status` | `PROCEED` \| `HOLD` \| `AMBIGUOUS` \| `Mis Matched` \| `null` |
| `mismatches` | Present only when `flag` is `Mis Matched` |

---

## Project structure

```text
mining_project/
├── api.py                 # FastAPI app
├── main.py                # Pipeline orchestration (+ CLI)
├── config.py              # Azure + default audio from env
├── config.ini             # Default BERT model name
├── requirements.txt       # Python dependencies
├── Dockerfile             # Single image: UI build + API
├── DEPLOYMENT.md          # Azure Container Apps notes
├── Common/
│   ├── paths.py           # input/output path helpers
│   └── mappings.json      # ASR alias → standard term
├── diarization_code/
│   ├── diarization.py     # Azure diarization + grouping
│   └── bert_code.py       # BERT similarity scoring
├── regex_code/
│   └── regex_parser.py    # Entity + status extraction
├── frontend/              # React + Vite UI
├── input/                 # Uploaded / default WAV files
├── output/                # Per-job JSON results
└── test_data/             # Sample WAV files
```

---

## Prerequisites

| Requirement | Notes |
| --- | --- |
| Python 3.11+ | Matches Docker image; 3.12 works locally if dependencies install cleanly |
| Node.js 18+ / npm | Frontend dev server and production build |
| Azure Speech resource | Key + region **or** custom endpoint |
| Disk / RAM | BERT large model download + inference; CPU works, GPU optional |
| Network | First BERT load pulls weights from Hugging Face; Azure Speech needs outbound access |

---

## Clone and install — PowerShell

Run these in **Windows PowerShell** or **PowerShell 7** from a folder where you want the repo.

### 1. Clone

```powershell
cd D:\projects
git clone <YOUR_REPO_URL> mining_project
cd mining_project
```

### 2. Python virtual environment and dependencies

```powershell
py -3.11 -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install --upgrade pip
pip install -r requirements.txt
```

If `Activate.ps1` is blocked by execution policy:

```powershell
Set-ExecutionPolicy -Scope CurrentUser RemoteSigned
.\.venv\Scripts\Activate.ps1
```

Optional (align with Docker CPU torch index if needed):

```powershell
pip install --index-url https://download.pytorch.org/whl/cpu torch
pip install -r requirements.txt
```

### 3. Environment file

```powershell
Copy-Item .env.example .env
notepad .env
```

Set at least:

```text
AZURE_SPEECH_KEY=<your-key>
AZURE_SPEECH_REGION=eastus
```

Leave `AZURE_SPEECH_ENDPOINT` blank unless you use a custom endpoint. Optionally set `MODEL_NAME` to override the BERT checkpoint.

Load env vars into the current session (PowerShell does not auto-load `.env`):

```powershell
Get-Content .env | ForEach-Object {
  if ($_ -match '^\s*#' -or $_ -match '^\s*$') { return }
  $name, $value = $_.Split('=', 2)
  Set-Item -Path "Env:$name" -Value $value
}
```

Or set them explicitly:

```powershell
$env:AZURE_SPEECH_KEY = "your-key"
$env:AZURE_SPEECH_REGION = "eastus"
```

### 4. Frontend dependencies

```powershell
cd frontend
npm install
cd ..
```

### 5. Verify

```powershell
python -c "import fastapi, torch, azure.cognitiveservices.speech; print('OK')"
```

---

## Clone and install — WSL

Run these inside your WSL distro (Ubuntu recommended).

### 1. Clone

```bash
cd ~
git clone <YOUR_REPO_URL> mining_project
cd mining_project
```

If the repo already lives on the Windows filesystem:

```bash
cd /mnt/d/projects/mining_project
```

### 2. System packages (recommended)

```bash
sudo apt update
sudo apt install -y python3 python3-venv python3-pip build-essential
# Node via nvm or distro packages:
# sudo apt install -y nodejs npm
```

Azure Speech SDK on Linux may need ALSA:

```bash
sudo apt install -y libasound2
```

### 3. Python virtual environment and dependencies

```bash
python3 -m venv .venv
source .venv/bin/activate
python -m pip install --upgrade pip
pip install -r requirements.txt
```

Optional CPU torch install (same approach as Docker):

```bash
pip install --index-url https://download.pytorch.org/whl/cpu torch
pip install -r requirements.txt
```

### 4. Environment file

```bash
cp .env.example .env
nano .env   # or vim / code .env
```

Export for the current shell:

```bash
set -a
source .env
set +a
```

Or:

```bash
export AZURE_SPEECH_KEY="your-key"
export AZURE_SPEECH_REGION="eastus"
```

### 5. Frontend dependencies

```bash
cd frontend
npm install
cd ..
```

### 6. Verify

```bash
python -c "import fastapi, torch, azure.cognitiveservices.speech; print('OK')"
```

---

## Configuration

| Variable | Required | Description |
| --- | --- | --- |
| `AZURE_SPEECH_KEY` | Yes (for diarization) | Azure Speech subscription key |
| `AZURE_SPEECH_REGION` | Yes if no endpoint | e.g. `eastus` |
| `AZURE_SPEECH_ENDPOINT` | Optional | Custom Speech endpoint; if set, region is not required |
| `MODEL_NAME` | Optional | Hugging Face model id; defaults to `config.ini` → `bert-large-uncased-whole-word-masking-finetuned-squad` |
| `APP_DATA_DIR` | Optional | Root for `input/` and `output/` (Container Apps often use `/mnt/data`) |
| `DEFAULT_AUDIO_FILE` | Optional | CLI default WAV path for `python main.py` |
| `CORS_ORIGINS` | Optional | Comma-separated origins; defaults include local Vite ports |
| `VITE_API_BASE` | Optional (frontend build) | API base URL; empty = same origin |

`config.ini`:

```ini
[TEXT_TAG]
llm_model = bert-large-uncased-whole-word-masking-finetuned-squad
```

---

## How to run

### Option A — API + frontend (local development)

**Terminal 1 — backend** (from repo root, venv active, env vars set):

PowerShell:

```powershell
uvicorn api:app --reload --host 127.0.0.1 --port 8000
```

WSL:

```bash
uvicorn api:app --reload --host 127.0.0.1 --port 8000
```

**Terminal 2 — frontend**:

```powershell
cd frontend
npm run dev
```

```bash
cd frontend
npm run dev
```

Open the Vite URL (typically `http://localhost:5173`). Upload a WAV from `test_data/` and run processing.

### Option B — Single process (API serves built UI)

```powershell
cd frontend
npm run build
cd ..
uvicorn api:app --host 0.0.0.0 --port 8000
```

```bash
cd frontend && npm run build && cd ..
uvicorn api:app --host 0.0.0.0 --port 8000
```

Open `http://localhost:8000`.

### Option C — CLI pipeline only

Place a WAV under `input/`, set `DEFAULT_AUDIO_FILE` if needed, then:

```powershell
python main.py
```

```bash
python main.py
```

Results appear under `output/<stem>/`.

### Health check

```text
GET http://127.0.0.1:8000/api/health
```

Expected: `{"status":"ok", ...}`.

---

## API reference

| Method | Path | Description |
| --- | --- | --- |
| `GET` | `/api/health` | Liveness; returns input/output directories |
| `POST` | `/api/upload` | Save WAV only; returns `job_id` |
| `POST` | `/api/process` | Upload WAV + run full pipeline (Form field: `audio`) |
| `POST` | `/api/process/{job_id}` | Run pipeline on a previously uploaded file |
| `GET` | `/api/results/{job_id}` | Load existing JSON artifacts for a job |

Example (PowerShell):

```powershell
curl.exe -X POST "http://127.0.0.1:8000/api/process" `
  -F "audio=@test_data/ack_noisy_testfile.wav"
```

Example (WSL / bash):

```bash
curl -X POST "http://127.0.0.1:8000/api/process" \
  -F "audio=@test_data/ack_noisy_testfile.wav"
```

---

## Deployment

Production packaging builds the React app into `frontend/dist` and runs FastAPI with Uvicorn on port **8000** (see `Dockerfile`). For Azure Container Apps environment variables, storage mounts, and health checks, follow [DEPLOYMENT.md](./DEPLOYMENT.md).

---