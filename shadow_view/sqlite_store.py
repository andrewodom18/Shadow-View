"""SQLite-backed staging, counting, and sorting for Shadow View rows."""

from __future__ import annotations

import csv
import sqlite3
from pathlib import Path
from typing import Any

from .config import (
    configured_aliases,
    output_column_by_header,
    sighting_device_key,
    sort_columns,
)
from .errors import CleanerError


def quote_identifier(value: str) -> str:
    if not value or not all(char.isalnum() or char == "_" for char in value):
        raise CleanerError(f"Unsafe SQL identifier in config: {value!r}")
    return f'"{value}"'


def quote_alias(value: str) -> str:
    return '"' + value.replace('"', '""') + '"'


def create_observations_table(
    connection: sqlite3.Connection, store_columns: list[str]
) -> None:
    column_sql = ", ".join(
        f"{quote_identifier(column)} TEXT" for column in store_columns
    )
    connection.execute(
        f"CREATE TABLE observations (_row_id INTEGER PRIMARY KEY, {column_sql})"
    )


def ingest_csv(
    input_path: Path,
    connection: sqlite3.Connection,
    store_columns: list[str],
    input_indexes: dict[str, int],
) -> int:
    placeholders = ", ".join("?" for _ in store_columns)
    column_sql = ", ".join(quote_identifier(column) for column in store_columns)
    insert_sql = f"INSERT INTO observations ({column_sql}) VALUES ({placeholders})"

    row_count = 0
    batch: list[list[str]] = []
    with input_path.open(newline="", encoding="utf-8-sig") as input_file:
        reader = csv.reader(input_file)
        next(reader, None)
        for row in reader:
            batch.append(
                [
                    (
                        row[input_indexes[column]].strip()
                        if input_indexes[column] < len(row)
                        else ""
                    )
                    for column in store_columns
                ]
            )
            row_count += 1
            if len(batch) >= 5000:
                connection.executemany(insert_sql, batch)
                batch.clear()

    if batch:
        connection.executemany(insert_sql, batch)
    connection.commit()
    return row_count


def create_indexes(
    connection: sqlite3.Connection, store_columns: list[str], config: dict[str, Any]
) -> None:
    index_columns = [sighting_device_key(config)]
    index_columns.extend(
        column for column in sort_columns(config) if column in store_columns
    )

    for column in dict.fromkeys(index_columns):
        if column in store_columns:
            connection.execute(
                f"CREATE INDEX idx_observations_{column} ON observations ({quote_identifier(column)})"
            )


def select_expression(column: dict[str, str]) -> str:
    header = quote_alias(column["header"])
    if "source" in column:
        return f"o.{quote_identifier(column['source'])} AS {header}"

    computed = column["computed"]
    if computed == "total_sightings":
        return f"COALESCE(ts.total_sightings, 0) AS {header}"
    if computed == "unique_mgrs_count":
        return f"COALESCE(um.unique_mgrs_count, 0) AS {header}"
    raise CleanerError(f"Unsupported computed column: {computed}")


def build_query(
    config: dict[str, Any], columns: list[dict[str, str]], store_columns: list[str]
) -> str:
    device_key = sighting_device_key(config)
    select_sql = ", ".join(select_expression(column) for column in columns)

    needs_total = any(column.get("computed") == "total_sightings" for column in columns)
    needs_unique_mgrs = any(
        column.get("computed") == "unique_mgrs_count" for column in columns
    )

    with_parts: list[str] = []
    joins: list[str] = []
    if needs_total:
        with_parts.append(
            "total_sightings AS ("
            f"SELECT {quote_identifier(device_key)} AS device_key, COUNT(*) AS total_sightings "
            "FROM observations "
            f"GROUP BY {quote_identifier(device_key)})"
        )
        joins.append(
            f"LEFT JOIN total_sightings ts ON o.{quote_identifier(device_key)} = ts.device_key"
        )

    if needs_unique_mgrs:
        with_parts.append(
            "unique_mgrs AS ("
            f"SELECT {quote_identifier(device_key)} AS device_key, "
            f"COUNT(DISTINCT NULLIF(TRIM({quote_identifier('mgrs')}), '')) AS unique_mgrs_count "
            "FROM observations "
            f"GROUP BY {quote_identifier(device_key)})"
        )
        joins.append(
            f"LEFT JOIN unique_mgrs um ON o.{quote_identifier(device_key)} = um.device_key"
        )

    with_sql = f"WITH {', '.join(with_parts)} " if with_parts else ""
    join_sql = " ".join(joins)
    order_sql = build_order_by(config, columns, store_columns)
    return f"{with_sql}SELECT {select_sql} FROM observations o {join_sql} {order_sql}"


def build_order_by(
    config: dict[str, Any], columns: list[dict[str, str]], store_columns: list[str]
) -> str:
    aliases = configured_aliases(config)
    header_lookup = output_column_by_header(columns)
    case_sensitive = bool(config.get("sort", {}).get("case_sensitive", False))
    order_parts: list[str] = []

    for sort_column in sort_columns(config):
        source_column: str | None = None
        if sort_column in aliases:
            source_column = sort_column
        elif sort_column in header_lookup and "source" in header_lookup[sort_column]:
            source_column = header_lookup[sort_column]["source"]

        if source_column is not None:
            if source_column not in store_columns:
                raise CleanerError(f"Sort source is not available: {source_column}")
            expression = f"o.{quote_identifier(source_column)}"
            if not case_sensitive:
                expression = f"LOWER(COALESCE({expression}, ''))"
            order_parts.append(f"{expression} ASC")
        elif sort_column in header_lookup:
            order_parts.append(f"{quote_alias(sort_column)} ASC")
        else:
            raise CleanerError(f"Unsupported sort column: {sort_column}")

    order_parts.append("o._row_id ASC")
    return "ORDER BY " + ", ".join(order_parts)
