"""SQLite-backed staging, counting, and sorting for Shadow View rows."""

from __future__ import annotations

import csv
import math
import sqlite3
from datetime import UTC
from pathlib import Path
from typing import Any

from .config import (
    configured_aliases,
    grouping_enabled,
    grouping_key,
    mgrs_unique_distance_meters,
    multi_value_separator,
    output_column_by_header,
    sighting_device_key,
    sort_columns,
    sort_rules,
)
from .errors import CleanerError
from .mgrs_distance import MgrsPoint, mgrs_distance_meters, parse_mgrs
from .time_buckets import parse_event_time


def quote_identifier(value: str) -> str:
    if not value or not all(char.isalnum() or char == "_" for char in value):
        raise CleanerError(f"Unsafe SQL identifier in config: {value!r}")
    return f'"{value}"'


def quote_alias(value: str) -> str:
    return '"' + value.replace('"', '""') + '"'


def quote_literal(value: str) -> str:
    return "'" + value.replace("'", "''") + "'"


def format_whole_number(value: float) -> str:
    return str(math.floor(value + 0.5))


def format_sql_number(value: float) -> str:
    if not math.isfinite(value):
        raise CleanerError(f"Invalid numeric config value: {value!r}")
    return format(value, ".15g")


def apply_sort_value_type(expression: str, value_type: str) -> str:
    if value_type == "number":
        return f"CAST(NULLIF({expression}, '') AS REAL)"
    if value_type == "datetime":
        return f"datetime_sort_key({expression})"
    return expression


def datetime_sort_key(value: object) -> str:
    if value is None:
        return ""
    parsed = parse_event_time(str(value))
    if parsed is None:
        return ""
    if parsed.tzinfo is not None:
        parsed = parsed.astimezone(UTC)
    return parsed.isoformat()


class DistinctList:
    def __init__(self) -> None:
        self.values: dict[str, str] = {}
        self.separator = " | "

    def step(self, value: object, separator: object = None) -> None:
        if separator is not None:
            self.separator = str(separator)
        if value is None:
            return

        cleaned = str(value).strip()
        if not cleaned:
            return

        self.values.setdefault(cleaned.casefold(), cleaned)

    def finalize(self) -> str:
        values = sorted(self.values.values(), key=lambda item: item.casefold())
        if not values:
            return ""
        if len(values) == 1:
            return values[0]
        return self.separator.join(values)


class AverageValue:
    def __init__(self) -> None:
        self.total = 0.0
        self.count = 0

    def step(self, value: object) -> None:
        if value is None:
            return
        cleaned = str(value).strip()
        if not cleaned:
            return
        try:
            self.total += float(cleaned)
        except ValueError:
            return
        self.count += 1

    def finalize(self) -> str:
        if self.count == 0:
            return ""
        return format_whole_number(self.total / self.count)


class DateTimeRange:
    def __init__(self) -> None:
        self.start = None
        self.end = None

    def step(self, value: object) -> None:
        if value is None:
            return
        parsed = parse_event_time(str(value))
        if parsed is None:
            return
        if self.start is None or parsed < self.start:
            self.start = parsed
        if self.end is None or parsed > self.end:
            self.end = parsed

    def finalize(self) -> str:
        if self.start is None or self.end is None:
            return ""

        start = self.start.strftime("%Y-%m-%d %H:%M:%S")
        end = self.end.strftime("%Y-%m-%d %H:%M:%S")
        if start == end:
            return start
        return f"{start} to {end}"


class UniqueMgrsCount:
    def __init__(self) -> None:
        self.distance_threshold_meters = 50.0
        self.points: list[MgrsPoint] = []

    def step(self, value: object, distance_threshold_meters: object = None) -> None:
        if distance_threshold_meters is not None:
            self.distance_threshold_meters = float(distance_threshold_meters)
        if value is None:
            return

        cleaned = str(value).strip()
        if not cleaned:
            return

        point = parse_mgrs(cleaned)
        if point is None:
            return

        self.points.append(point)

    def finalize(self) -> int:
        anchors: list[MgrsPoint] = []
        for point in sorted(
            self.points,
            key=lambda item: (
                item.zone,
                item.hemisphere,
                item.easting,
                item.northing,
            ),
        ):
            if any(
                mgrs_distance_meters(point, anchor) <= self.distance_threshold_meters
                for anchor in anchors
            ):
                continue
            anchors.append(point)

        return len(anchors)


def register_aggregates(connection: sqlite3.Connection) -> None:
    connection.create_function("datetime_sort_key", 1, datetime_sort_key)
    connection.create_aggregate("distinct_list", 2, DistinctList)
    connection.create_aggregate("average_value", 1, AverageValue)
    connection.create_aggregate("datetime_range", 1, DateTimeRange)
    connection.create_aggregate("unique_mgrs_count", 2, UniqueMgrsCount)


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
    index_columns = [
        grouping_key(config) if grouping_enabled(config) else sighting_device_key(config)
    ]
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
    if grouping_enabled(config):
        return build_grouped_query(config, columns, store_columns)
    return build_row_query(config, columns, store_columns)


def build_row_query(
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
        distance_meters = format_sql_number(mgrs_unique_distance_meters(config))
        with_parts.append(
            "unique_mgrs AS ("
            f"SELECT {quote_identifier(device_key)} AS device_key, "
            f"unique_mgrs_count({quote_identifier('mgrs')}, {distance_meters}) AS unique_mgrs_count "
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


def grouped_source_expression(
    column: dict[str, str], group_key: str, separator: str
) -> str:
    source = column["source"]
    header = quote_alias(column["header"])
    aggregate = column.get("aggregate")

    if aggregate is None:
        if source == group_key:
            aggregate = "group_key"
        elif source == "accuracy":
            aggregate = "average"
        elif source == "event_time":
            aggregate = "datetime_range"
        else:
            aggregate = "distinct_list"

    source_sql = f"o.{quote_identifier(source)}"
    if aggregate == "group_key":
        return f"{source_sql} AS {header}"
    if aggregate == "distinct_list":
        return f"distinct_list({source_sql}, {quote_literal(separator)}) AS {header}"
    if aggregate == "average":
        return f"average_value({source_sql}) AS {header}"
    if aggregate == "datetime_range":
        return f"datetime_range({source_sql}) AS {header}"

    raise CleanerError(f"Unsupported aggregate for {source}: {aggregate}")


def grouped_computed_expression(column: dict[str, str], config: dict[str, Any]) -> str:
    computed = column["computed"]
    header = quote_alias(column["header"])

    if computed == "unique_mgrs_count":
        distance_meters = format_sql_number(mgrs_unique_distance_meters(config))
        return (
            f"unique_mgrs_count(o.{quote_identifier('mgrs')}, "
            f"{distance_meters}) AS {header}"
        )
    if computed == "total_sightings":
        return f"COUNT(*) AS {header}"

    raise CleanerError(f"Unsupported computed column: {computed}")


def grouped_select_expression(
    column: dict[str, str], group_key: str, separator: str, config: dict[str, Any]
) -> str:
    if "source" in column:
        return grouped_source_expression(column, group_key, separator)
    return grouped_computed_expression(column, config)


def build_grouped_query(
    config: dict[str, Any], columns: list[dict[str, str]], store_columns: list[str]
) -> str:
    group_key = grouping_key(config)
    if group_key not in store_columns:
        raise CleanerError(f"Grouping key is not available: {group_key}")

    separator = multi_value_separator(config)
    select_sql = ", ".join(
        grouped_select_expression(column, group_key, separator, config)
        for column in columns
    )
    final_select_sql = ", ".join(quote_alias(column["header"]) for column in columns)
    group_sql = f"GROUP BY o.{quote_identifier(group_key)}"
    order_sql = build_grouped_order_by(config, columns)
    return (
        "WITH grouped AS ("
        f"SELECT {select_sql}, MIN(o._row_id) AS __first_row_id "
        f"FROM observations o {group_sql}) "
        f"SELECT {final_select_sql} FROM grouped {order_sql}"
    )


def build_grouped_order_by(config: dict[str, Any], columns: list[dict[str, str]]) -> str:
    header_lookup = output_column_by_header(columns)
    case_sensitive = bool(config.get("sort", {}).get("case_sensitive", False))
    order_parts: list[str] = []

    for rule in sort_rules(config):
        sort_column = rule["column"]
        header = None
        if sort_column in header_lookup:
            header = sort_column
        else:
            for column in columns:
                if column.get("source") == sort_column:
                    header = column["header"]
                    break

        if header is None:
            raise CleanerError(
                f"Grouped sort column {sort_column!r} must be an output column."
            )

        expression = quote_alias(header)
        expression = apply_sort_value_type(expression, rule["value_type"])
        if rule["value_type"] == "text" and not case_sensitive:
            expression = f"LOWER(COALESCE({expression}, ''))"
        order_parts.append(f"{expression} {rule['direction'].upper()}")

    order_parts.append("__first_row_id ASC")
    return "ORDER BY " + ", ".join(order_parts)


def build_order_by(
    config: dict[str, Any], columns: list[dict[str, str]], store_columns: list[str]
) -> str:
    aliases = configured_aliases(config)
    header_lookup = output_column_by_header(columns)
    case_sensitive = bool(config.get("sort", {}).get("case_sensitive", False))
    order_parts: list[str] = []

    for rule in sort_rules(config):
        sort_column = rule["column"]
        source_column: str | None = None
        if sort_column in aliases:
            source_column = sort_column
        elif sort_column in header_lookup and "source" in header_lookup[sort_column]:
            source_column = header_lookup[sort_column]["source"]

        if source_column is not None:
            if source_column not in store_columns:
                raise CleanerError(f"Sort source is not available: {source_column}")
            expression = f"o.{quote_identifier(source_column)}"
            expression = apply_sort_value_type(expression, rule["value_type"])
            if rule["value_type"] == "text" and not case_sensitive:
                expression = f"LOWER(COALESCE({expression}, ''))"
            order_parts.append(f"{expression} {rule['direction'].upper()}")
        elif sort_column in header_lookup:
            expression = apply_sort_value_type(
                quote_alias(sort_column), rule["value_type"]
            )
            order_parts.append(f"{expression} {rule['direction'].upper()}")
        else:
            raise CleanerError(f"Unsupported sort column: {sort_column}")

    order_parts.append("o._row_id ASC")
    return "ORDER BY " + ", ".join(order_parts)
