# Azure Container Apps Deployment

This repository builds one image containing the React frontend and FastAPI backend. The backend serves both the API and the built frontend on port 8000.

## Build the image

Build from the repository root so the Dockerfile can access both `frontend/` and the Python application.

The image uses a `python-deps` stage (system packages + torch + pip deps) and BuildKit cache mounts. After the first build, code-only changes should skip reinstalling torch and other Python packages.

### Fast local iteration (recommended while developing)

Keeps a warm Docker layer cache on your machine:

```powershell
$env:DOCKER_BUILDKIT = "1"
az acr login --name philipsopenfdacr
docker build -t philipsopenfdacr.azurecr.io/mining-voice-ai:latest .
docker push philipsopenfdacr.azurecr.io/mining-voice-ai:latest
```

### Remote ACR build

```powershell
az acr build --registry philipsopenfdacr --image mining-voice-ai:latest --file Dockerfile .
```

Remote builds upload context every time and reuse cache less reliably than a local daemon. Prefer local build + push for day-to-day code changes; use `az acr build` for clean/CI builds.

Create the Container App from `<ACR_LOGIN_SERVER>/mining-voice-ai:latest`. Configure HTTP ingress on target port `8000` and enable external ingress if the UI should be public.

## Configure environment variables

In the Container App, add the secret first, then map it to an environment variable:

| Name | Value |
| --- | --- |
| `AZURE_SPEECH_KEY` | Reference a Container App secret containing the Speech resource key. |
| `AZURE_SPEECH_REGION` | Speech resource region, for example `eastus`. Required when no endpoint is supplied. |
| `AZURE_SPEECH_ENDPOINT` | Optional custom Speech endpoint. Leave unset to use the region. |
| `APP_DATA_DIR` | `/mnt/data` when using the Azure Files mount below. |
| `MODEL_NAME` | Optional Hugging Face model override. Defaults to the model in `config.ini`. |
| `CORS_ORIGINS` | Leave unset for the single-image deployment. Set comma-separated origins only if a separate frontend will call this API. |

Do not put secrets in the image or in frontend `VITE_*` variables. Container App environment variables are set under the app's container configuration; store credentials under **Secrets** and set `AZURE_SPEECH_KEY` to the secret reference.

## Persist uploads and results

Container App files outside a mounted volume are ephemeral. Create an Azure Storage account and an Azure Files share, then attach that share to the Container Apps environment as a storage mount. In the Container App's **Volumes** configuration, select the attached storage and mount it into the container at `/mnt/data` with read/write access. Keep `APP_DATA_DIR=/mnt/data`.

The app writes uploaded WAV files to `/mnt/data/input` and JSON results to `/mnt/data/output`. Mounting the same share preserves them across replica restarts. Start with minimum and maximum replicas set to `1`: job IDs are derived from filenames, and concurrent replicas can process the same file or collide on output names. Add a queue and unique job IDs before scaling out.

## Health check

After deployment, open `https://<CONTAINER_APP_FQDN>/api/health`. The app should return `{"status":"ok",...}`; the root URL serves the frontend.

The existing Speech credential was present in source before this deployment setup. Rotate that key in Azure and configure only the replacement as a Container App secret. Removing a credential from the current file does not remove it from prior Git commits.