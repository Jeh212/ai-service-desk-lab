# AI Service Desk Lab — API

FastAPI backend. See the repository root `README.md` for the full guide.

Quick start (from this folder):

```bash
uv sync --extra dev
uv run uvicorn app.main:app --reload   # needs MongoDB running
uv run pytest                          # offline, mock provider, no API key
uv run asdl-eval --dataset service_desk_v1.json
```
