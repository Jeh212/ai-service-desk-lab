"""Evaluation routes: list datasets, run evaluations, browse past runs."""

from __future__ import annotations

import json

from fastapi import APIRouter
from pydantic import BaseModel

from app.ai.evaluation.runner import EvaluationRunner, load_dataset
from app.api.deps import AuthDep, ServicesDep, SettingsDep
from app.contracts.evaluation import EvalRunReport
from app.core.context import AuthContext
from app.core.errors import AppError, ErrorCode
from app.core.paths import DATASETS_DIR, REPORTS_DIR

router = APIRouter(prefix="/lab", tags=["evaluation"])


@router.get("/datasets")
async def list_datasets(_: AuthContext = AuthDep) -> dict:
    datasets = []
    if DATASETS_DIR.exists():
        for path in sorted(DATASETS_DIR.glob("*.json")):
            try:
                data = json.loads(path.read_text(encoding="utf-8"))
                datasets.append(
                    {
                        "file": path.name,
                        "name": data.get("name"),
                        "version": data.get("version"),
                        "cases": len(data.get("cases", [])),
                    }
                )
            except (json.JSONDecodeError, OSError):
                continue
    return {"datasets": datasets, "dir": str(DATASETS_DIR)}


class RunEvalInput(BaseModel):
    dataset: str  # file name within datasets/
    provider: str | None = None  # "mock" | "groq"; defaults to configured provider
    system_version: str | None = None
    classifier_version: str | None = None


@router.post("/evals/run", response_model=EvalRunReport)
async def run_eval(
    body: RunEvalInput,
    auth: AuthContext = AuthDep,
    settings=SettingsDep,
    services=ServicesDep,
) -> EvalRunReport:
    path = DATASETS_DIR / body.dataset
    if not path.exists():
        raise AppError(ErrorCode.INVALID_INPUT, f"Dataset '{body.dataset}' not found.")
    dataset = load_dataset(path)
    runner = EvaluationRunner(settings)
    report = await runner.run(
        dataset,
        provider_name=body.provider,
        system_version=body.system_version or "system-v2",
        classifier_version=body.classifier_version or "classify-v2",
    )
    await services.repos.eval_runs.save(report.model_dump(mode="json"))
    REPORTS_DIR.mkdir(parents=True, exist_ok=True)
    (REPORTS_DIR / f"{report.run_id}.json").write_text(
        report.model_dump_json(indent=2), encoding="utf-8"
    )
    return report


@router.get("/evals/runs")
async def list_runs(_: AuthContext = AuthDep, services=ServicesDep, limit: int = 50) -> dict:
    runs = await services.repos.eval_runs.list(limit=limit)
    return {
        "runs": [
            {
                "run_id": r.get("run_id"),
                "dataset_name": r.get("dataset_name"),
                "dataset_version": r.get("dataset_version"),
                "provider": r.get("provider"),
                "model": r.get("model"),
                "prompt_version": r.get("prompt_version"),
                "created_at": r.get("created_at"),
                "metrics": r.get("metrics"),
            }
            for r in runs
        ]
    }


@router.get("/evals/runs/{run_id}", response_model=EvalRunReport)
async def get_run(run_id: str, _: AuthContext = AuthDep, services=ServicesDep) -> EvalRunReport:
    raw = await services.repos.eval_runs.get(run_id)
    if raw is None:
        raise AppError(ErrorCode.PROPOSAL_NOT_FOUND, "Run not found.")
    return EvalRunReport(**raw)
