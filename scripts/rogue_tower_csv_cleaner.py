#!/usr/bin/env python3
"""CLI entrypoint for the Rogue Tower CSV Cleaner."""

from __future__ import annotations

import sys
from pathlib import Path


PROJECT_ROOT = Path(__file__).resolve().parents[1]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from shadow_view.cli import main  # noqa: E402
from shadow_view.profiles import get_profile  # noqa: E402


if __name__ == "__main__":
    profile = get_profile("rogue_tower")
    raise SystemExit(
        main(
            default_config=profile.config_path,
            tool_name=profile.display_name,
            input_description=profile.input_description,
            cleaner_id=profile.cleaner_id,
        )
    )
