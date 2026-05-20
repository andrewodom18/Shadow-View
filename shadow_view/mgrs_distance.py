"""MGRS parsing and distance helpers used by the cleaner."""

from __future__ import annotations

import math
import re
from dataclasses import dataclass


_MGRS_PATTERN = re.compile(
    r"^(\d{1,2})([C-HJ-NP-X])([A-HJ-NP-Z])([A-HJ-NP-Z])(\d*)$"
)
_LATITUDE_BANDS = "CDEFGHJKLMNPQRSTUVWX"
_COLUMN_SETS = ("ABCDEFGH", "JKLMNPQR", "STUVWXYZ")
_ROW_SETS = ("ABCDEFGHJKLMNPQRSTUV", "FGHJKLMNPQRSTUVABCDE")
_MIN_NORTHING_BY_BAND = {
    "C": 1100000,
    "D": 2000000,
    "E": 2800000,
    "F": 3700000,
    "G": 4600000,
    "H": 5500000,
    "J": 6400000,
    "K": 7300000,
    "L": 8200000,
    "M": 9100000,
    "N": 0,
    "P": 800000,
    "Q": 1700000,
    "R": 2600000,
    "S": 3500000,
    "T": 4400000,
    "U": 5300000,
    "V": 6200000,
    "W": 7000000,
    "X": 7900000,
}
_WGS84_A = 6378137.0
_WGS84_ECC_SQUARED = 0.00669438
_UTM_K0 = 0.9996
_EARTH_RADIUS_METERS = 6371008.8


@dataclass(frozen=True)
class MgrsPoint:
    zone: int
    band: str
    hemisphere: str
    easting: float
    northing: float


def parse_mgrs(value: object) -> MgrsPoint | None:
    if value is None:
        return None

    cleaned = re.sub(r"[\s-]+", "", str(value).strip().upper())
    if not cleaned:
        return None

    match = _MGRS_PATTERN.match(cleaned)
    if match is None:
        return None

    zone = int(match.group(1))
    band = match.group(2)
    column_letter = match.group(3)
    row_letter = match.group(4)
    digits = match.group(5)

    if zone < 1 or zone > 60:
        return None
    if band not in _LATITUDE_BANDS:
        return None
    if len(digits) > 10 or len(digits) % 2 != 0:
        return None

    column_set = _COLUMN_SETS[(zone - 1) % 3]
    row_set = _ROW_SETS[(zone - 1) % 2]
    if column_letter not in column_set or row_letter not in row_set:
        return None

    precision = len(digits) // 2
    scale = 10 ** (5 - precision)
    easting_digits = digits[:precision]
    northing_digits = digits[precision:]
    easting_offset = int(easting_digits) * scale if easting_digits else 0
    northing_offset = int(northing_digits) * scale if northing_digits else 0

    easting = (column_set.index(column_letter) + 1) * 100000 + easting_offset
    northing = row_set.index(row_letter) * 100000 + northing_offset
    min_northing = _MIN_NORTHING_BY_BAND[band]
    while northing < min_northing:
        northing += 2000000

    return MgrsPoint(
        zone=zone,
        band=band,
        hemisphere="N" if band >= "N" else "S",
        easting=float(easting),
        northing=float(northing),
    )


def mgrs_distance_meters(first: MgrsPoint, second: MgrsPoint) -> float:
    if first.zone == second.zone and first.hemisphere == second.hemisphere:
        return math.hypot(
            first.easting - second.easting,
            first.northing - second.northing,
        )

    first_lat_lon = _utm_to_lat_lon(first)
    second_lat_lon = _utm_to_lat_lon(second)
    return _haversine_meters(first_lat_lon, second_lat_lon)


def _utm_to_lat_lon(point: MgrsPoint) -> tuple[float, float]:
    x = point.easting - 500000.0
    y = point.northing
    if point.hemisphere == "S":
        y -= 10000000.0

    ecc_prime_squared = _WGS84_ECC_SQUARED / (1.0 - _WGS84_ECC_SQUARED)
    lon_origin = (point.zone - 1) * 6 - 180 + 3

    m = y / _UTM_K0
    mu = m / (
        _WGS84_A
        * (
            1.0
            - _WGS84_ECC_SQUARED / 4.0
            - 3.0 * _WGS84_ECC_SQUARED**2 / 64.0
            - 5.0 * _WGS84_ECC_SQUARED**3 / 256.0
        )
    )

    e1 = (1.0 - math.sqrt(1.0 - _WGS84_ECC_SQUARED)) / (
        1.0 + math.sqrt(1.0 - _WGS84_ECC_SQUARED)
    )
    phi1 = (
        mu
        + (3.0 * e1 / 2.0 - 27.0 * e1**3 / 32.0) * math.sin(2.0 * mu)
        + (21.0 * e1**2 / 16.0 - 55.0 * e1**4 / 32.0) * math.sin(4.0 * mu)
        + (151.0 * e1**3 / 96.0) * math.sin(6.0 * mu)
    )

    sin_phi1 = math.sin(phi1)
    cos_phi1 = math.cos(phi1)
    tan_phi1 = math.tan(phi1)
    n1 = _WGS84_A / math.sqrt(1.0 - _WGS84_ECC_SQUARED * sin_phi1**2)
    t1 = tan_phi1**2
    c1 = ecc_prime_squared * cos_phi1**2
    r1 = _WGS84_A * (1.0 - _WGS84_ECC_SQUARED) / (
        1.0 - _WGS84_ECC_SQUARED * sin_phi1**2
    ) ** 1.5
    d = x / (n1 * _UTM_K0)

    lat = phi1 - (n1 * tan_phi1 / r1) * (
        d**2 / 2.0
        - (5.0 + 3.0 * t1 + 10.0 * c1 - 4.0 * c1**2 - 9.0 * ecc_prime_squared)
        * d**4
        / 24.0
        + (
            61.0
            + 90.0 * t1
            + 298.0 * c1
            + 45.0 * t1**2
            - 252.0 * ecc_prime_squared
            - 3.0 * c1**2
        )
        * d**6
        / 720.0
    )
    lon = math.radians(lon_origin) + (
        d
        - (1.0 + 2.0 * t1 + c1) * d**3 / 6.0
        + (
            5.0
            - 2.0 * c1
            + 28.0 * t1
            - 3.0 * c1**2
            + 8.0 * ecc_prime_squared
            + 24.0 * t1**2
        )
        * d**5
        / 120.0
    ) / cos_phi1

    return math.degrees(lat), math.degrees(lon)


def _haversine_meters(
    first: tuple[float, float], second: tuple[float, float]
) -> float:
    first_lat = math.radians(first[0])
    first_lon = math.radians(first[1])
    second_lat = math.radians(second[0])
    second_lon = math.radians(second[1])

    delta_lat = second_lat - first_lat
    delta_lon = second_lon - first_lon
    haversine = (
        math.sin(delta_lat / 2.0) ** 2
        + math.cos(first_lat) * math.cos(second_lat) * math.sin(delta_lon / 2.0) ** 2
    )
    return _EARTH_RADIUS_METERS * 2.0 * math.atan2(
        math.sqrt(haversine), math.sqrt(1.0 - haversine)
    )
