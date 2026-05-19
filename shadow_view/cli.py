"""Command-line interface for the Co-Traveler CSV Cleaner."""

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


def parse_args(argv: list[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Clean a Shadow View Co-Traveler CSV export with standard-library Python."
    )
    parser.add_argument(
        "input_csv", type=Path, help="Raw Shadow View Co-Traveler CSV export."
    )
    parser.add_argument("output_csv", type=Path, help="Cleaned CSV path to write.")
    parser.add_argument(
        "--config",
        type=Path,
        default=DEFAULT_CONFIG,
        help=f"Cleaner config path. Default: {DEFAULT_CONFIG}",
    )
    parser.add_argument(
        "--html-output",
        type=Path,
        help="Optional styled HTML preview path for 30-minute color buckets.",
    )
    parser.add_argument(
        "--xlsx-output",
        type=Path,
        help="Optional Excel workbook path with 30-minute color bucket fills.",
    )
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv or sys.argv[1:])
    start_time = time.perf_counter()
    try:
        result = clean_csv(
            args.input_csv,
            args.output_csv,
            args.config,
            args.html_output,
            args.xlsx_output,
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
