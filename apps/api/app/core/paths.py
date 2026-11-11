"""Filesystem locations resolved relative to the repository layout."""

from __future__ import annotations

from pathlib import Path

APP_DIR = Path(__file__).resolve().parents[1]  # apps/api/app
API_DIR = APP_DIR.parent  # apps/api
REPO_ROOT = API_DIR.parent.parent  # repository root
DATASETS_DIR = REPO_ROOT / "datasets"
REPORTS_DIR = API_DIR / "reports"
