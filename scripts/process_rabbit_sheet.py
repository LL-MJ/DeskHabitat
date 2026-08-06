"""Split regular rabbit source sheets into normalized PNG frames."""

from __future__ import annotations

import argparse
from collections import deque
import math
from pathlib import Path

from PIL import Image


FACINGS = ("west", "south", "north", "east")
DEFAULT_STATES = ("idle_a", "idle_b", "walk_a", "walk_b")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--size", type=int, default=256)
    parser.add_argument(
        "--states",
        default=",".join(DEFAULT_STATES),
        help="Comma-separated row names, from top to bottom.",
    )
    parser.add_argument(
        "--target-alpha-area",
        type=int,
        help="Normalize visible subject area after fitting the source cell.",
    )
    parser.add_argument(
        "--side-profile",
        action="store_true",
        help="Read a 2-column A/B sheet and mirror east frames into west frames.",
    )
    return parser.parse_args()


def normalize_subject_area(
    frame: Image.Image,
    target_area: int,
    canvas_size: int,
) -> Image.Image:
    alpha = frame.getchannel("A")
    bounds = alpha.getbbox()
    if bounds is None:
        return frame

    visible_area = sum(1 for value in alpha.get_flattened_data() if value > 32)
    if visible_area <= 0:
        return frame

    subject = frame.crop(bounds)
    scale = math.sqrt(target_area / visible_area)
    maximum_scale = min(
        (canvas_size - 8) / subject.width,
        (canvas_size - 8) / subject.height,
    )
    scale = min(scale, maximum_scale)
    resized = subject.resize(
        (
            max(1, round(subject.width * scale)),
            max(1, round(subject.height * scale)),
        ),
        Image.Resampling.LANCZOS,
    )
    normalized = Image.new("RGBA", (canvas_size, canvas_size))
    normalized.alpha_composite(
        resized,
        ((canvas_size - resized.width) // 2, canvas_size - resized.height - 4),
    )
    return normalized


def retain_largest_subject(frame: Image.Image) -> Image.Image:
    alpha = frame.getchannel("A")
    width, height = frame.size
    values = bytes(alpha.get_flattened_data())
    visited = bytearray(width * height)
    largest: list[int] = []

    for start, value in enumerate(values):
        if value == 0 or visited[start]:
            continue
        visited[start] = 1
        component: list[int] = []
        pending = deque((start,))
        while pending:
            index = pending.popleft()
            component.append(index)
            x = index % width
            y = index // width
            for neighbor in (
                index - 1 if x > 0 else -1,
                index + 1 if x + 1 < width else -1,
                index - width if y > 0 else -1,
                index + width if y + 1 < height else -1,
            ):
                if (
                    neighbor >= 0
                    and values[neighbor] > 0
                    and not visited[neighbor]
                ):
                    visited[neighbor] = 1
                    pending.append(neighbor)
        if len(component) > len(largest):
            largest = component

    if not largest:
        return frame
    retained_alpha = bytearray(width * height)
    for index in largest:
        retained_alpha[index] = values[index]
    cleaned = frame.copy()
    cleaned.putalpha(Image.frombytes("L", frame.size, bytes(retained_alpha)))
    return cleaned


def find_subject_bounds(frame: Image.Image, count: int) -> list[tuple[int, int, int, int]]:
    alpha = frame.getchannel("A")
    width, height = frame.size
    values = bytes(alpha.get_flattened_data())
    visited = bytearray(width * height)
    components: list[tuple[int, int, int, int, int]] = []

    for start, value in enumerate(values):
        if value == 0 or visited[start]:
            continue
        visited[start] = 1
        pending = deque((start,))
        area = 0
        minimum_x = maximum_x = start % width
        minimum_y = maximum_y = start // width
        while pending:
            index = pending.popleft()
            area += 1
            x = index % width
            y = index // width
            minimum_x = min(minimum_x, x)
            maximum_x = max(maximum_x, x)
            minimum_y = min(minimum_y, y)
            maximum_y = max(maximum_y, y)
            for neighbor in (
                index - 1 if x > 0 else -1,
                index + 1 if x + 1 < width else -1,
                index - width if y > 0 else -1,
                index + width if y + 1 < height else -1,
            ):
                if (
                    neighbor >= 0
                    and values[neighbor] > 0
                    and not visited[neighbor]
                ):
                    visited[neighbor] = 1
                    pending.append(neighbor)
        components.append(
            (minimum_x, minimum_y, maximum_x + 1, maximum_y + 1, area),
        )

    largest = sorted(components, key=lambda component: component[4], reverse=True)[
        :count
    ]
    if len(largest) != count:
        raise ValueError(f"Expected {count} subjects, found {len(largest)}")
    return [component[:4] for component in largest]


def fit_frame(frame: Image.Image, args: argparse.Namespace) -> Image.Image:
    frame = retain_largest_subject(frame)
    frame.thumbnail((args.size, args.size), Image.Resampling.LANCZOS)
    canvas = Image.new("RGBA", (args.size, args.size))
    canvas.alpha_composite(
        frame,
        ((args.size - frame.width) // 2, args.size - frame.height),
    )
    if args.target_alpha_area:
        return normalize_subject_area(
            canvas,
            args.target_alpha_area,
            args.size,
        )
    return canvas


def main() -> None:
    args = parse_args()
    source = Image.open(args.input).convert("RGBA")
    args.output.mkdir(parents=True, exist_ok=True)
    states = tuple(state.strip() for state in args.states.split(",") if state.strip())
    if not states:
        raise ValueError("At least one state row is required")

    if args.side_profile:
        subject_bounds = find_subject_bounds(source, len(states) * 2)
        subject_bounds.sort(key=lambda bounds: (bounds[1] + bounds[3]) / 2)
        for row, state in enumerate(states):
            row_bounds = sorted(
                subject_bounds[row * 2 : row * 2 + 2],
                key=lambda bounds: bounds[0],
            )
            for frame_name, bounds in zip(("a", "b"), row_bounds, strict=True):
                left, top, right, bottom = bounds
                padding = 2
                left = max(0, left - padding)
                top = max(0, top - padding)
                right = min(source.width, right + padding)
                bottom = min(source.height, bottom + padding)
                canvas = fit_frame(
                    source.crop((left, top, right, bottom)),
                    args,
                )
                canvas.save(
                    args.output / f"rabbit-{state}_{frame_name}-east.png",
                    optimize=True,
                )
                canvas.transpose(Image.Transpose.FLIP_LEFT_RIGHT).save(
                    args.output / f"rabbit-{state}_{frame_name}-west.png",
                    optimize=True,
                )
        return

    for row, state in enumerate(states):
        top = round(source.height * row / len(states))
        bottom = round(source.height * (row + 1) / len(states))
        for column, facing in enumerate(FACINGS):
            left = round(source.width * column / len(FACINGS))
            right = round(source.width * (column + 1) / len(FACINGS))
            canvas = fit_frame(source.crop((left, top, right, bottom)), args)
            canvas.save(args.output / f"rabbit-{state}-{facing}.png", optimize=True)


if __name__ == "__main__":
    main()
