"""Registered Shadow View CSV cleaner profiles."""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
import sys

from .errors import CleanerError


def application_base_path() -> Path:
    bundled_path = getattr(sys, "_MEIPASS", None)
    if bundled_path:
        return Path(bundled_path)
    return Path(__file__).resolve().parents[1]


PROJECT_ROOT = application_base_path()
CONFIG_DIR = PROJECT_ROOT / "config"


@dataclass(frozen=True)
class CleanerProfile:
    cleaner_id: str
    display_name: str
    input_description: str
    config_path: Path

    def to_dict(self) -> dict[str, str]:
        return {
            "cleaner_id": self.cleaner_id,
            "display_name": self.display_name,
            "input_description": self.input_description,
            "config_path": str(self.config_path),
        }


CLEANER_PROFILES: dict[str, CleanerProfile] = {
    "co_traveler": CleanerProfile(
        cleaner_id="co_traveler",
        display_name="Co-Traveler CSV Cleaner",
        input_description="Shadow View Co-Traveler CSV export",
        config_path=CONFIG_DIR / "co_traveler_csv_cleaner.toml",
    ),
    "rogue_tower": CleanerProfile(
        cleaner_id="rogue_tower",
        display_name="Rogue Tower CSV Cleaner",
        input_description="Shadow View Rogue Tower CSV export",
        config_path=CONFIG_DIR / "rogue_tower_csv_cleaner.toml",
    ),
}


def get_profile(cleaner_id: str) -> CleanerProfile:
    try:
        return CLEANER_PROFILES[cleaner_id]
    except KeyError as exc:
        available = ", ".join(sorted(CLEANER_PROFILES))
        raise CleanerError(
            f"Unknown cleaner_id {cleaner_id!r}. Available cleaners: {available}"
        ) from exc


def list_profiles() -> list[CleanerProfile]:
    return list(CLEANER_PROFILES.values())
