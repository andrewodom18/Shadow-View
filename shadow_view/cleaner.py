"""Top-level CSV cleaning pipeline for Shadow View exports."""

from __future__ import annotations

import csv
import sqlite3
import tempfile
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from .config import (
    color_config,
    configured_aliases,
    load_config,
    output_columns,
    required_canonical_columns,
)
from .errors import CleanerError
from .html_preview import (
    event_output_header,
    write_html_end,
    write_html_row,
    write_html_start,
)
from .sqlite_store import (
    build_query,
    create_indexes,
    create_observations_table,
    ingest_csv,
)


@dataclass(frozen=True)
class CleanResult:
    rows_processed: int
    headers: list[str]


def normalize_name(value: str) -> str:
    return " ".join(value.strip().lower().split())


def read_header(input_path: Path) -> list[str]:
    try:
        with input_path.open(newline="", encoding="utf-8-sig") as input_file:
            reader = csv.reader(input_file)
            header = next(reader)
    except FileNotFoundError as exc:
        raise CleanerError(f"Input CSV not found: {input_path}") from exc
    except StopIteration as exc:
        raise CleanerError(f"Input CSV is empty: {input_path}") from exc
    except csv.Error as exc:
        raise CleanerError(f"Could not read input CSV header: {exc}") from exc

    return header


def resolve_input_indexes(
    raw_header: list[str],
    aliases: dict[str, list[str]],
    required: set[str],
) -> dict[str, int]:
    normalized_header: dict[str, int] = {}
    for index, header in enumerate(raw_header):
        normalized_header.setdefault(normalize_name(header), index)

    resolved: dict[str, int] = {}
    for canonical, possible_names in aliases.items():
        for possible_name in possible_names:
            header_index = normalized_header.get(normalize_name(possible_name))
            if header_index is not None:
                resolved[canonical] = header_index
                break

    missing = sorted(canonical for canonical in required if canonical not in resolved)
    if missing:
        raise CleanerError(
            "Input CSV is missing required columns or aliases: " + ", ".join(missing)
        )

    return resolved


def write_outputs(
    connection: sqlite3.Connection,
    query: str,
    output_csv: Path,
    html_output: Path | None,
    headers: list[str],
    columns: list[dict[str, str]],
    config: dict[str, Any],
) -> None:
    output_csv.parent.mkdir(parents=True, exist_ok=True)
    if html_output is not None:
        html_output.parent.mkdir(parents=True, exist_ok=True)

    color_settings = color_config(config)
    color_enabled = (
        bool(color_settings.get("enabled", False)) and html_output is not None
    )
    bucket_minutes = int(color_settings.get("bucket_minutes", 30))
    palette = [str(color) for color in color_settings.get("palette", [])]
    event_header = event_output_header(color_settings, columns, headers)
    event_index = headers.index(event_header) if event_header in headers else None

    cursor = connection.execute(query)

    with output_csv.open("w", newline="", encoding="utf-8") as csv_file:
        writer = csv.writer(csv_file, lineterminator="\n")
        writer.writerow(headers)

        html_file = None
        try:
            if html_output is not None:
                html_file = html_output.open("w", encoding="utf-8")
                write_html_start(html_file, headers)

            for row in cursor:
                values = ["" if value is None else str(value) for value in row]
                writer.writerow(values)

                if html_file is not None:
                    write_html_row(
                        html_file,
                        values,
                        event_index,
                        bucket_minutes,
                        palette,
                        color_enabled,
                    )
        finally:
            if html_file is not None:
                write_html_end(html_file)
                html_file.close()


def clean_csv(
    input_csv: Path, output_csv: Path, config_path: Path, html_output: Path | None
) -> CleanResult:
    config = load_config(config_path)
    columns = output_columns(config)
    aliases = configured_aliases(config)
    required = required_canonical_columns(config, columns, html_output is not None)
    raw_header = read_header(input_csv)
    input_indexes = resolve_input_indexes(raw_header, aliases, required)

    store_columns = [canonical for canonical in aliases if canonical in required]
    headers = [column["header"] for column in columns]

    with tempfile.TemporaryDirectory(prefix="shadow_view_cleaner_") as temp_dir:
        db_path = Path(temp_dir) / "shadow_view.sqlite3"
        connection = sqlite3.connect(db_path)
        try:
            create_observations_table(connection, store_columns)
            row_count = ingest_csv(input_csv, connection, store_columns, input_indexes)
            create_indexes(connection, store_columns, config)
            query = build_query(config, columns, store_columns)
            write_outputs(
                connection,
                query,
                output_csv,
                html_output,
                headers,
                columns,
                config,
            )
        finally:
            connection.close()

    return CleanResult(rows_processed=row_count, headers=headers)
