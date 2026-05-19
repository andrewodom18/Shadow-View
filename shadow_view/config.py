"""Configuration loading and validation for the Shadow View cleaner."""

from __future__ import annotations

import tomllib
from pathlib import Path
from typing import Any

from .errors import CleanerError


def validate_identifier(value: str) -> None:
    if not value or not all(char.isalnum() or char == "_" for char in value):
        raise CleanerError(f"Unsafe identifier in config: {value!r}")


def load_config(path: Path) -> dict[str, Any]:
    try:
        with path.open("rb") as config_file:
            config = tomllib.load(config_file)
    except FileNotFoundError as exc:
        raise CleanerError(f"Config file not found: {path}") from exc
    except tomllib.TOMLDecodeError as exc:
        raise CleanerError(f"Invalid TOML config: {exc}") from exc

    if not isinstance(config.get("input_columns"), dict):
        raise CleanerError("Config must define [input_columns].")
    if not isinstance(config.get("output_columns"), list):
        raise CleanerError("Config must define at least one [[output_columns]] entry.")
    if not isinstance(config.get("sighting_count"), dict):
        raise CleanerError("Config must define [sighting_count].")

    return config


def configured_aliases(config: dict[str, Any]) -> dict[str, list[str]]:
    aliases: dict[str, list[str]] = {}
    for canonical, values in config["input_columns"].items():
        if not isinstance(values, list) or not all(isinstance(v, str) for v in values):
            raise CleanerError(
                f"input_columns.{canonical} must be a list of header aliases."
            )
        validate_identifier(canonical)
        aliases[canonical] = values
    return aliases


def output_columns(config: dict[str, Any]) -> list[dict[str, str]]:
    columns: list[dict[str, str]] = []
    for index, column in enumerate(config["output_columns"], start=1):
        if not isinstance(column, dict):
            raise CleanerError(f"output_columns entry {index} must be a table.")

        header = column.get("header")
        source = column.get("source")
        computed = column.get("computed")

        if not isinstance(header, str) or not header.strip():
            raise CleanerError(f"output_columns entry {index} needs a header.")
        if (source is None) == (computed is None):
            raise CleanerError(
                f"output_columns entry {index} must define exactly one of source or computed."
            )

        normalized: dict[str, str] = {"header": header}
        if source is not None:
            if not isinstance(source, str):
                raise CleanerError(f"output_columns entry {index} has invalid source.")
            validate_identifier(source)
            normalized["source"] = source
        if computed is not None:
            if not isinstance(computed, str):
                raise CleanerError(
                    f"output_columns entry {index} has invalid computed."
                )
            normalized["computed"] = computed
        columns.append(normalized)

    return columns


def output_column_by_header(columns: list[dict[str, str]]) -> dict[str, dict[str, str]]:
    return {column["header"]: column for column in columns}


def sighting_device_key(config: dict[str, Any]) -> str:
    device_key = config["sighting_count"].get("device_key", "bssid")
    if not isinstance(device_key, str):
        raise CleanerError("sighting_count.device_key must be a string.")
    validate_identifier(device_key)
    return device_key


def sort_columns(config: dict[str, Any]) -> list[str]:
    sort_config = config.get("sort", {})
    columns = sort_config.get("columns", [])
    if not isinstance(columns, list) or not all(isinstance(v, str) for v in columns):
        raise CleanerError("sort.columns must be a list of strings.")
    return columns


def color_config(config: dict[str, Any]) -> dict[str, Any]:
    value = config.get("color_coding", {})
    if not isinstance(value, dict):
        raise CleanerError("color_coding must be a table.")
    return value


def required_canonical_columns(
    config: dict[str, Any], columns: list[dict[str, str]], html_requested: bool
) -> set[str]:
    required: set[str] = set()
    aliases = configured_aliases(config)
    device_key = sighting_device_key(config)
    header_lookup = output_column_by_header(columns)

    for column in columns:
        if "source" in column:
            required.add(column["source"])
        elif column.get("computed") == "total_sightings":
            required.add(device_key)
        elif column.get("computed") == "unique_mgrs_count":
            required.update({device_key, "mgrs"})
        else:
            raise CleanerError(f"Unsupported computed column: {column.get('computed')}")

    for sort_column in sort_columns(config):
        if sort_column in aliases:
            required.add(sort_column)
        else:
            output_match = header_lookup.get(sort_column)
            if output_match and "source" in output_match:
                required.add(output_match["source"])
            elif output_match and output_match.get("computed") == "total_sightings":
                required.add(device_key)
            elif output_match and output_match.get("computed") == "unique_mgrs_count":
                required.update({device_key, "mgrs"})
            elif not output_match:
                raise CleanerError(
                    f"Sort column {sort_column!r} is not a canonical input name or output header."
                )

    if html_requested and color_config(config).get("enabled", False):
        event_column = str(color_config(config).get("event_time_column", "event_time"))
        required.add(event_column)

    unknown = sorted(required - set(aliases))
    if unknown:
        raise CleanerError(f"Required canonical columns missing aliases: {unknown}")

    return required
