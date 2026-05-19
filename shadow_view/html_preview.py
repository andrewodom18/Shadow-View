"""Optional HTML preview output for cleaned Shadow View rows."""

from __future__ import annotations

import html
from typing import Any

from .time_buckets import color_for_event_time


def event_output_header(
    color_settings: dict[str, Any],
    columns: list[dict[str, str]],
    headers: list[str],
) -> str | None:
    event_column = str(color_settings.get("event_time_column", "event_time"))
    for column in columns:
        if column.get("source") == event_column:
            return column["header"]
    return "Event Time" if "Event Time" in headers else None


def write_html_start(
    html_file: Any, headers: list[str], title: str = "Shadow View CSV Preview"
) -> None:
    html_file.write(
        "<!doctype html>\n"
        '<html lang="en">\n'
        "<head>\n"
        '<meta charset="utf-8">\n'
        f"<title>{html.escape(title)} Preview</title>\n"
        "<style>\n"
        "body{font-family:Arial,sans-serif;margin:24px;color:#1f2933;}\n"
        "table{border-collapse:collapse;width:100%;font-size:13px;}\n"
        "th,td{border:1px solid #cfd7df;padding:6px 8px;text-align:left;}\n"
        "th{background:#1f2933;color:white;position:sticky;top:0;}\n"
        "tr:hover{filter:brightness(.97);}\n"
        "</style>\n"
        "</head>\n"
        "<body>\n"
        "<table>\n<thead><tr>"
    )
    for header in headers:
        html_file.write(f"<th>{html.escape(header)}</th>")
    html_file.write("</tr></thead>\n<tbody>\n")


def write_html_end(html_file: Any) -> None:
    html_file.write("</tbody>\n</table>\n</body>\n</html>\n")


def write_html_row(
    html_file: Any,
    values: list[str],
    event_index: int | None,
    bucket_minutes: int,
    palette: list[str],
    color_enabled: bool,
) -> None:
    style = ""
    title = ""
    if color_enabled and event_index is not None:
        color = color_for_event_time(values[event_index], bucket_minutes, palette)
        if color is not None:
            bucket_label, color_value = color
            style = f' style="background-color:{html.escape(color_value)}"'
            title = f' title="30-minute bucket: {html.escape(bucket_label)}"'

    html_file.write(f"<tr{style}{title}>")
    for value in values:
        html_file.write(f"<td>{html.escape(value)}</td>")
    html_file.write("</tr>\n")
