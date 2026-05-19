"""Event-time parsing and 30-minute bucket color selection."""

from __future__ import annotations

from datetime import datetime


def parse_event_time(value: str) -> datetime | None:
    cleaned = value.strip()
    if not cleaned:
        return None

    if cleaned.endswith("Z"):
        cleaned = cleaned[:-1] + "+00:00"

    candidates = [cleaned]
    if len(cleaned) >= 19:
        candidates.append(cleaned[:19])

    for candidate in candidates:
        try:
            return datetime.fromisoformat(candidate)
        except ValueError:
            pass

    for pattern in ("%Y-%m-%d %H:%M:%S", "%Y-%m-%d %H:%M", "%m/%d/%Y %H:%M:%S"):
        for candidate in candidates:
            try:
                return datetime.strptime(candidate, pattern)
            except ValueError:
                continue

    return None


def color_for_event_time(
    value: str, bucket_minutes: int, palette: list[str]
) -> tuple[str, str] | None:
    event_time = parse_event_time(value)
    if event_time is None or not palette:
        return None

    bucket_minute = (event_time.minute // bucket_minutes) * bucket_minutes
    bucket = event_time.replace(minute=bucket_minute, second=0, microsecond=0)
    epoch = datetime(1970, 1, 1, tzinfo=bucket.tzinfo)
    total_minutes = int((bucket - epoch).total_seconds() // 60)
    color = palette[(total_minutes // bucket_minutes) % len(palette)]
    return bucket.strftime("%Y-%m-%d %H:%M"), color
