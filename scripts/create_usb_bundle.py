#!/usr/bin/env python3
"""Create the user-facing Shadow View USB bundle."""

from __future__ import annotations

import argparse
import shutil
import sys
import zipfile
from pathlib import Path


PROJECT_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_DIST_DIR = PROJECT_ROOT / "dist"
DEFAULT_BUNDLE_DIR = DEFAULT_DIST_DIR / "Shadow View USB Bundle"
START_HERE_SOURCE = PROJECT_ROOT / "docs" / "USB_START_HERE.txt"


def build_arg_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Assemble the Shadow View USB bundle from built Windows executables."
    )
    parser.add_argument(
        "--csv-cleaner-exe",
        type=Path,
        default=DEFAULT_DIST_DIR / "Shadow View CSV Cleaner.exe",
        help="Path to the built CSV cleaner executable.",
    )
    parser.add_argument(
        "--web-app-exe",
        type=Path,
        default=DEFAULT_DIST_DIR / "Shadow View Web App.exe",
        help="Path to the built web app launcher executable.",
    )
    parser.add_argument(
        "--output-dir",
        type=Path,
        default=DEFAULT_BUNDLE_DIR,
        help="Directory to create for the USB-ready bundle.",
    )
    parser.add_argument(
        "--no-zip",
        action="store_true",
        help="Create only the folder and skip the zip archive.",
    )
    return parser


def require_file(path: Path, label: str) -> Path:
    resolved = path.resolve()
    if not resolved.is_file():
        raise FileNotFoundError(f"{label} not found: {resolved}")
    return resolved


def copy_bundle_file(source: Path, destination_dir: Path, destination_name: str | None = None) -> Path:
    destination = destination_dir / (destination_name or source.name)
    shutil.copy2(source, destination)
    return destination


def create_zip(bundle_dir: Path) -> Path:
    zip_path = bundle_dir.with_suffix(".zip")
    if zip_path.exists():
        zip_path.unlink()

    with zipfile.ZipFile(zip_path, "w", compression=zipfile.ZIP_DEFLATED) as archive:
        for path in sorted(bundle_dir.rglob("*")):
            if path.is_file():
                archive.write(path, path.relative_to(bundle_dir.parent))
    return zip_path


def create_bundle(
    csv_cleaner_exe: Path,
    web_app_exe: Path,
    output_dir: Path,
    make_zip: bool = True,
) -> tuple[Path, Path | None]:
    csv_cleaner = require_file(csv_cleaner_exe, "CSV cleaner executable")
    web_app = require_file(web_app_exe, "Web app executable")
    start_here = require_file(START_HERE_SOURCE, "Start-here instructions")

    if output_dir.exists():
        shutil.rmtree(output_dir)
    output_dir.mkdir(parents=True)

    copy_bundle_file(start_here, output_dir, "START HERE - Shadow View.txt")
    copy_bundle_file(csv_cleaner, output_dir)
    copy_bundle_file(web_app, output_dir)

    zip_path = create_zip(output_dir) if make_zip else None
    return output_dir, zip_path


def main(argv: list[str] | None = None) -> int:
    args = build_arg_parser().parse_args(argv)
    try:
        bundle_dir, zip_path = create_bundle(
            args.csv_cleaner_exe,
            args.web_app_exe,
            args.output_dir,
            make_zip=not args.no_zip,
        )
    except OSError as exc:
        print(f"Could not create USB bundle: {exc}", file=sys.stderr)
        return 1

    print(f"USB bundle folder: {bundle_dir}")
    if zip_path is not None:
        print(f"USB bundle zip: {zip_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
