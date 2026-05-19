#!/usr/bin/env python3
"""Generate the Shadow View Cleaner app icon with standard-library Python."""

from __future__ import annotations

import math
import struct
import zlib
from pathlib import Path


PROJECT_ROOT = Path(__file__).resolve().parents[1]
ASSET_DIR = PROJECT_ROOT / "assets"
SOURCE_SIZE = 1024
ICON_SIZES = [256, 128, 64, 48, 32, 16]


Color = tuple[int, int, int, int]


def clamp(value: int) -> int:
    return max(0, min(255, value))


def mix_channel(start: int, end: int, amount: float) -> int:
    return clamp(round(start + (end - start) * amount))


def mix_color(start: Color, end: Color, amount: float) -> Color:
    return tuple(mix_channel(start[index], end[index], amount) for index in range(4))


def blend_pixel(buffer: bytearray, width: int, x: int, y: int, color: Color) -> None:
    if x < 0 or y < 0 or x >= width or y >= width:
        return

    src_r, src_g, src_b, src_a = color
    if src_a <= 0:
        return

    offset = (y * width + x) * 4
    dst_r, dst_g, dst_b, dst_a = buffer[offset : offset + 4]
    src_alpha = src_a / 255
    dst_alpha = dst_a / 255
    out_alpha = src_alpha + dst_alpha * (1 - src_alpha)
    if out_alpha <= 0:
        buffer[offset : offset + 4] = bytes((0, 0, 0, 0))
        return

    out_r = (src_r * src_alpha + dst_r * dst_alpha * (1 - src_alpha)) / out_alpha
    out_g = (src_g * src_alpha + dst_g * dst_alpha * (1 - src_alpha)) / out_alpha
    out_b = (src_b * src_alpha + dst_b * dst_alpha * (1 - src_alpha)) / out_alpha

    buffer[offset : offset + 4] = bytes(
        (clamp(round(out_r)), clamp(round(out_g)), clamp(round(out_b)), clamp(round(out_alpha * 255)))
    )


def rounded_rect_distance(x: float, y: float, size: int, radius: float) -> float:
    center = size / 2
    half = size / 2 - 64
    qx = abs(x - center) - (half - radius)
    qy = abs(y - center) - (half - radius)
    outside = math.hypot(max(qx, 0), max(qy, 0))
    inside = min(max(qx, qy), 0)
    return outside + inside - radius


def draw_background(buffer: bytearray, size: int) -> None:
    top = (15, 23, 42, 255)
    bottom = (14, 116, 144, 255)
    radius = 210

    for y in range(size):
        vertical = y / (size - 1)
        for x in range(size):
            distance = rounded_rect_distance(x + 0.5, y + 0.5, size, radius)
            if distance > 0:
                continue
            color = mix_color(top, bottom, vertical)
            glow = max(0, 1 - math.hypot(x - size * 0.66, y - size * 0.26) / 520)
            color = (
                clamp(color[0] + round(26 * glow)),
                clamp(color[1] + round(48 * glow)),
                clamp(color[2] + round(56 * glow)),
                255,
            )
            offset = (y * size + x) * 4
            buffer[offset : offset + 4] = bytes(color)


def draw_circle_outline(
    buffer: bytearray,
    size: int,
    cx: float,
    cy: float,
    radius: float,
    thickness: float,
    color: Color,
) -> None:
    bounds = int(radius + thickness + 2)
    for y in range(max(0, int(cy - bounds)), min(size, int(cy + bounds) + 1)):
        for x in range(max(0, int(cx - bounds)), min(size, int(cx + bounds) + 1)):
            distance = abs(math.hypot(x + 0.5 - cx, y + 0.5 - cy) - radius)
            if distance <= thickness / 2:
                blend_pixel(buffer, size, x, y, color)


def draw_line(
    buffer: bytearray,
    size: int,
    x1: float,
    y1: float,
    x2: float,
    y2: float,
    thickness: float,
    color: Color,
) -> None:
    radius = thickness / 2
    min_x = max(0, int(min(x1, x2) - radius - 2))
    max_x = min(size - 1, int(max(x1, x2) + radius + 2))
    min_y = max(0, int(min(y1, y2) - radius - 2))
    max_y = min(size - 1, int(max(y1, y2) + radius + 2))
    dx = x2 - x1
    dy = y2 - y1
    length_squared = dx * dx + dy * dy

    for y in range(min_y, max_y + 1):
        for x in range(min_x, max_x + 1):
            if length_squared == 0:
                distance = math.hypot(x + 0.5 - x1, y + 0.5 - y1)
            else:
                amount = ((x + 0.5 - x1) * dx + (y + 0.5 - y1) * dy) / length_squared
                amount = max(0, min(1, amount))
                nearest_x = x1 + amount * dx
                nearest_y = y1 + amount * dy
                distance = math.hypot(x + 0.5 - nearest_x, y + 0.5 - nearest_y)
            if distance <= radius:
                blend_pixel(buffer, size, x, y, color)


def draw_arc(
    buffer: bytearray,
    size: int,
    cx: float,
    cy: float,
    radius: float,
    start_degrees: float,
    end_degrees: float,
    thickness: float,
    color: Color,
) -> None:
    previous: tuple[float, float] | None = None
    steps = max(8, int(abs(end_degrees - start_degrees) / 3))
    for step in range(steps + 1):
        amount = step / steps
        angle = math.radians(start_degrees + (end_degrees - start_degrees) * amount)
        point = (cx + math.cos(angle) * radius, cy + math.sin(angle) * radius)
        if previous is not None:
            draw_line(buffer, size, previous[0], previous[1], point[0], point[1], thickness, color)
        previous = point


def draw_quadratic_curve(
    buffer: bytearray,
    size: int,
    start: tuple[float, float],
    control: tuple[float, float],
    end: tuple[float, float],
    thickness: float,
    color: Color,
) -> None:
    previous = start
    steps = 72
    for step in range(1, steps + 1):
        amount = step / steps
        inverse = 1 - amount
        x = inverse * inverse * start[0] + 2 * inverse * amount * control[0] + amount * amount * end[0]
        y = inverse * inverse * start[1] + 2 * inverse * amount * control[1] + amount * amount * end[1]
        draw_line(buffer, size, previous[0], previous[1], x, y, thickness, color)
        previous = (x, y)


def draw_polygon(buffer: bytearray, size: int, points: list[tuple[float, float]], color: Color) -> None:
    min_x = max(0, int(min(point[0] for point in points)))
    max_x = min(size - 1, int(max(point[0] for point in points)))
    min_y = max(0, int(min(point[1] for point in points)))
    max_y = min(size - 1, int(max(point[1] for point in points)))

    for y in range(min_y, max_y + 1):
        for x in range(min_x, max_x + 1):
            inside = False
            j = len(points) - 1
            for i, point in enumerate(points):
                other = points[j]
                if ((point[1] > y) != (other[1] > y)) and (
                    x < (other[0] - point[0]) * (y - point[1]) / (other[1] - point[1]) + point[0]
                ):
                    inside = not inside
                j = i
            if inside:
                blend_pixel(buffer, size, x, y, color)


def draw_filled_circle(buffer: bytearray, size: int, cx: float, cy: float, radius: float, color: Color) -> None:
    min_x = max(0, int(cx - radius))
    max_x = min(size - 1, int(cx + radius))
    min_y = max(0, int(cy - radius))
    max_y = min(size - 1, int(cy + radius))
    radius_squared = radius * radius
    for y in range(min_y, max_y + 1):
        for x in range(min_x, max_x + 1):
            if (x + 0.5 - cx) ** 2 + (y + 0.5 - cy) ** 2 <= radius_squared:
                blend_pixel(buffer, size, x, y, color)


def draw_icon(size: int = SOURCE_SIZE) -> bytearray:
    buffer = bytearray(size * size * 4)
    scale = size / SOURCE_SIZE

    def s(value: float) -> float:
        return value * scale

    draw_background(buffer, size)

    white = (245, 253, 255, 255)
    accent = (103, 232, 249, 235)
    shadow = (2, 6, 23, 130)

    left = (s(224), s(520))
    right = (s(800), s(520))
    top = (s(512), s(302))
    bottom = (s(512), s(738))
    shadow_offset = (s(34), s(44))

    stroke = s(58)
    for curve_control in (top, bottom):
        draw_quadratic_curve(
            buffer,
            size,
            (left[0] + shadow_offset[0], left[1] + shadow_offset[1]),
            (curve_control[0] + shadow_offset[0], curve_control[1] + shadow_offset[1]),
            (right[0] + shadow_offset[0], right[1] + shadow_offset[1]),
            stroke,
            shadow,
        )

    draw_quadratic_curve(buffer, size, left, top, right, stroke, white)
    draw_quadratic_curve(buffer, size, left, bottom, right, stroke, white)
    draw_circle_outline(buffer, size, s(512), s(520), s(114), s(38), accent)
    draw_filled_circle(buffer, size, s(512), s(520), s(48), white)
    return buffer


def downsample(source: bytearray, source_size: int, target_size: int) -> bytearray:
    scale = source_size // target_size
    target = bytearray(target_size * target_size * 4)

    for y in range(target_size):
        for x in range(target_size):
            totals = [0, 0, 0, 0]
            for sy in range(y * scale, (y + 1) * scale):
                for sx in range(x * scale, (x + 1) * scale):
                    offset = (sy * source_size + sx) * 4
                    for channel in range(4):
                        totals[channel] += source[offset + channel]
            count = scale * scale
            target_offset = (y * target_size + x) * 4
            target[target_offset : target_offset + 4] = bytes(round(value / count) for value in totals)

    return target


def png_bytes(width: int, height: int, rgba: bytearray) -> bytes:
    def chunk(kind: bytes, payload: bytes) -> bytes:
        return (
            struct.pack(">I", len(payload))
            + kind
            + payload
            + struct.pack(">I", zlib.crc32(kind + payload) & 0xFFFFFFFF)
        )

    rows = bytearray()
    stride = width * 4
    for y in range(height):
        rows.append(0)
        rows.extend(rgba[y * stride : (y + 1) * stride])

    return (
        b"\x89PNG\r\n\x1a\n"
        + chunk(b"IHDR", struct.pack(">IIBBBBB", width, height, 8, 6, 0, 0, 0))
        + chunk(b"IDAT", zlib.compress(bytes(rows), level=9))
        + chunk(b"IEND", b"")
    )


def write_ico(path: Path, images: list[tuple[int, bytes]]) -> None:
    header_size = 6 + len(images) * 16
    offset = header_size
    directory = bytearray()
    payload = bytearray()

    for size, image in images:
        directory.extend(
            struct.pack(
                "<BBBBHHII",
                0 if size == 256 else size,
                0 if size == 256 else size,
                0,
                0,
                1,
                32,
                len(image),
                offset,
            )
        )
        payload.extend(image)
        offset += len(image)

    path.write_bytes(struct.pack("<HHH", 0, 1, len(images)) + directory + payload)


def main() -> int:
    ASSET_DIR.mkdir(parents=True, exist_ok=True)
    source = draw_icon()
    images = []

    for size in ICON_SIZES:
        resized = downsample(source, SOURCE_SIZE, size)
        image = png_bytes(size, size, resized)
        images.append((size, image))
        if size == 256:
            (ASSET_DIR / "shadow_view_cleaner_icon.png").write_bytes(image)

    write_ico(ASSET_DIR / "shadow_view_cleaner_icon.ico", images)
    print(f"Wrote {ASSET_DIR / 'shadow_view_cleaner_icon.png'}")
    print(f"Wrote {ASSET_DIR / 'shadow_view_cleaner_icon.ico'}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
