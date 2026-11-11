"""Evaluation regression gate: the core dataset must stay green on the mock.

This is how the lab prevents silent behaviour drift — a failing case here means
the deterministic safety/behaviour contract changed.
"""

from __future__ import annotations

import pytest

from app.ai.evaluation.runner import EvaluationRunner, load_dataset
from app.core.config import get_settings
from app.core.paths import DATASETS_DIR

pytestmark = pytest.mark.evals


async def test_core_dataset_all_pass_on_mock():
    dataset = load_dataset(DATASETS_DIR / "service_desk_v1.json")
    runner = EvaluationRunner(get_settings())
    report = await runner.run(dataset, provider_name="mock")
    failed = [r.case_id for r in report.results if not r.passed]
    assert report.metrics.pass_rate == 1.0, f"Failing cases: {failed}"
    assert report.metrics.forbidden_action_rate == 0.0
