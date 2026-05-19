"""Command-line interface for Shadow View CSV cleaners."""

from __future__ import annotations

import argparse
import csv
import sqlite3
import sys
import time
from pathlib import Path

from .cleaner import clean_csv
from .errors import CleanerError


DEFAULT_CONFIG = (
    Path(__file__).resolve().parents[1] / "config" / "co_traveler_csv_cleaner.toml"
)
DEFAULT_TOOL_NAME = "Co-Traveler CSV Cleaner"
DEFAULT_INPUT_DESCRIPTION = "Shadow View Co-Traveler CSV export"


def parse_args(
    argv: list[str],
    default_config: Path = DEFAULT_CONFIG,
    tool_name: str = DEFAULT_TOOL_NAME,
    input_description: str = DEFAULT_INPUT_DESCRIPTION,
) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description=f"Clean a {input_description} with standard-library Python."
    )
    parser.add_argument("input_csv", type=Path, help=f"Raw {input_description}.")
    parser.add_argument("output_csv", type=Path, help="Cleaned CSV path to write.")
    parser.add_argument(
        "--config",
        type=Path,
        default=default_config,
        help=f"{tool_name} config path. Default: {default_config}",
    )
    parser.add_argument(
        "--html-output",
        type=Path,
        help="Optional styled HTML preview path.",
    )
    parser.add_argument(
        "--xlsx-output",
        type=Path,
        help="Optional Excel workbook path with configured fill colors.",
    )
    return parser.parse_args(argv)


def main(
    argv: list[str] | None = None,
    default_config: Path = DEFAULT_CONFIG,
    tool_name: str = DEFAULT_TOOL_NAME,
    input_description: str = DEFAULT_INPUT_DESCRIPTION,
    cleaner_id: str | None = None,
) -> int:
    args = parse_args(
        argv or sys.argv[1:],
        default_config=default_config,
        tool_name=tool_name,
        input_description=input_description,
    )
    start_time = time.perf_counter()
    try:
        result = clean_csv(
            args.input_csv,
            args.output_csv,
            args.config,
            args.html_output,
            args.xlsx_output,
            cleaner_id,
        )
    except (CleanerError, OSError, sqlite3.Error, csv.Error, ValueError) as exc:
        print(f"Error: {exc}", file=sys.stderr)
        return 1

    elapsed_seconds = time.perf_counter() - start_time
    print(f"Processed {result.rows_processed} rows in {elapsed_seconds:.2f}s.")
    print(f"Wrote cleaned CSV: {args.output_csv}")
    if args.html_output is not None:
        print(f"Wrote HTML preview: {args.html_output}")
    if args.xlsx_output is not None:
        print(f"Wrote Excel workbook: {args.xlsx_output}")
    print("Output columns: " + ", ".join(result.headers))
    return 0
