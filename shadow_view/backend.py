"""Backend-facing API for Shadow View CSV cleaning."""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

from .cleaner import CleanResult, clean_csv
from .cleaner import normalize_name, read_header
from .config import (
    configured_aliases,
    load_config,
    output_columns,
    required_canonical_columns,
)
from .errors import CleanerError
from .profiles import CleanerProfile, get_profile, list_profiles


AUTO_CLEANER_ID = "auto"


@dataclass(frozen=True)
class CleanerRunRequest:
    cleaner_id: str
    input_csv: Path
    output_csv: Path
    html_output: Path | None = None
    xlsx_output: Path | None = None
    config_path: Path | None = None


def available_cleaners() -> list[dict[str, str]]:
    return [profile.to_dict() for profile in list_profiles()]


def missing_required_columns(input_csv: Path | str, profile: CleanerProfile) -> set[str]:
    raw_header = read_header(Path(input_csv))
    normalized_headers = {normalize_name(header) for header in raw_header}
    config = load_config(profile.config_path)
    columns = output_columns(config)
    aliases = configured_aliases(config)
    required = required_canonical_columns(config, columns, html_requested=True)

    missing: set[str] = set()
    for canonical in required:
        possible_names = aliases.get(canonical, [])
        if not any(normalize_name(alias) in normalized_headers for alias in possible_names):
            missing.add(canonical)
    return missing


def detect_cleaner_profile(input_csv: Path | str) -> CleanerProfile:
    matches: list[CleanerProfile] = []
    missing_by_profile: dict[str, set[str]] = {}

    for profile in list_profiles():
        missing = missing_required_columns(input_csv, profile)
        missing_by_profile[profile.cleaner_id] = missing
        if not missing:
            matches.append(profile)

    if len(matches) == 1:
        return matches[0]
    if len(matches) > 1:
        names = ", ".join(profile.cleaner_id for profile in matches)
        raise CleanerError(f"CSV matches multiple cleaner profiles: {names}")

    details = "; ".join(
        f"{cleaner_id} missing {', '.join(sorted(missing))}"
        for cleaner_id, missing in missing_by_profile.items()
    )
    raise CleanerError(f"Could not auto-detect cleaner profile. {details}")


def detect_cleaner_id(input_csv: Path | str) -> str:
    return detect_cleaner_profile(input_csv).cleaner_id


def clean_shadow_view_csv(
    cleaner_id: str,
    input_csv: Path | str,
    output_csv: Path | str,
    *,
    html_output: Path | str | None = None,
    xlsx_output: Path | str | None = None,
    config_path: Path | str | None = None,
) -> CleanResult:
    profile = detect_cleaner_profile(input_csv) if cleaner_id == AUTO_CLEANER_ID else get_profile(cleaner_id)
    return run_cleaner(
        CleanerRunRequest(
            cleaner_id=profile.cleaner_id,
            input_csv=Path(input_csv),
            output_csv=Path(output_csv),
            html_output=Path(html_output) if html_output is not None else None,
            xlsx_output=Path(xlsx_output) if xlsx_output is not None else None,
            config_path=Path(config_path) if config_path is not None else None,
        ),
        profile=profile,
    )


def run_cleaner(
    request: CleanerRunRequest, profile: CleanerProfile | None = None
) -> CleanResult:
    selected_profile = profile or get_profile(request.cleaner_id)
    selected_config = request.config_path or selected_profile.config_path
    return clean_csv(
        input_csv=request.input_csv,
        output_csv=request.output_csv,
        config_path=selected_config,
        html_output=request.html_output,
        xlsx_output=request.xlsx_output,
        cleaner_id=selected_profile.cleaner_id,
    )
