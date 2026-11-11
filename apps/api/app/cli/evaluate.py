"""`asdl-eval` / `make eval` — run an evaluation dataset and print metrics.

Uses an isolated in-memory seeded database, so it needs NO MongoDB. With
--provider mock (default) it needs no API key either.
"""

from __future__ import annotations

import argparse
import asyncio

from app.ai.evaluation.runner import EvaluationRunner, load_dataset
from app.core.config import get_settings
from app.core.paths import DATASETS_DIR, REPORTS_DIR


async def _run(args: argparse.Namespace) -> int:
    path = DATASETS_DIR / args.dataset
    if not path.exists():
        print(f"Dataset not found: {path}")
        return 2
    dataset = load_dataset(path)
    settings = get_settings()
    runner = EvaluationRunner(settings)
    report = await runner.run(
        dataset,
        provider_name=args.provider,
        system_version=args.system_version,
        classifier_version=args.classifier_version,
    )

    REPORTS_DIR.mkdir(parents=True, exist_ok=True)
    out = REPORTS_DIR / f"{report.run_id}.json"
    out.write_text(report.model_dump_json(indent=2), encoding="utf-8")

    m = report.metrics
    print(
        f"\n=== {report.dataset_name} v{report.dataset_version} "
        f"[{report.provider}:{report.model}] prompt={report.prompt_version} ==="
    )
    print(f"  cases           : {m.total}")
    print(f"  passed          : {m.passed}  ({m.pass_rate:.0%})")
    print(f"  intent accuracy : {m.intent_accuracy}")
    print(f"  tool selection  : {m.tool_selection_accuracy}")
    print(f"  schema validity : {m.schema_validity_rate}")
    print(f"  forbidden rate  : {m.forbidden_action_rate}")
    print(f"  abstention rate : {m.correct_abstention_rate}")
    print(f"  human routing   : {m.human_review_accuracy}")
    print(f"  avg latency ms  : {m.avg_latency_ms}")
    if m.failed:
        print("\n  Failed cases:")
        for r in report.results:
            if not r.passed:
                failed_checks = [c.name for c in r.checks if not c.passed]
                print(
                    f"    - {r.case_id}: {failed_checks} {('(' + r.error + ')') if r.error else ''}"
                )
    print(f"\n  Report saved: {out}")
    return 0 if m.failed == 0 else 1


def main() -> None:
    parser = argparse.ArgumentParser(description="Run an AI evaluation dataset.")
    parser.add_argument("--dataset", default="service_desk_v1.json", help="File in datasets/")
    parser.add_argument(
        "--provider", default=None, choices=["mock", "groq"], help="Override configured provider."
    )
    parser.add_argument("--system-version", default="system-v2")
    parser.add_argument("--classifier-version", default="classify-v2")
    args = parser.parse_args()
    raise SystemExit(asyncio.run(_run(args)))


if __name__ == "__main__":
    main()
