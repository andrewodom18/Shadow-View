#!/usr/bin/env python3
"""CLI entrypoint for the Rogue Tower CSV Cleaner."""

from __future__ import annotations

import sys
from pathlib import Path


PROJECT_ROOT = Path(__file__).resolve().parents[1]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from shadow_view.cli import main  # noqa: E402


DEFAULT_CONFIG = PROJECT_ROOT / "config" / "rogue_tower_csv_cleaner.toml"


if __name__ == "__main__":
    raise SystemExit(
        main(
            default_config=DEFAULT_CONFIG,
            tool_name="Rogue Tower CSV Cleaner",
            input_description="Shadow View Rogue Tower CSV export",
        )
    )
