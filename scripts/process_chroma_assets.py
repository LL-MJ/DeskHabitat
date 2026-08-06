from __future__ import annotations

import argparse
from pathlib import Path

from PIL import Image


def trim_and_resize(
    source: Path,
    destination: Path,
    max_width: int,
    max_height: int,
    exact_size: tuple[int, int] | None = None,
    padding: int = 4,
) -> tuple[int, int]:
    image = Image.open(source).convert("RGBA")
    alpha = image.getchannel("A")
    bounds = alpha.point(lambda value: 255 if value > 4 else 0).getbbox()
    if bounds is None:
        raise ValueError(f"{source} contains no visible pixels")

    image = image.crop(bounds)
    if exact_size is not None:
        image = image.resize(exact_size, Image.Resampling.LANCZOS)
    else:
        image.thumbnail((max_width, max_height), Image.Resampling.LANCZOS)

    if padding > 0:
        padded = Image.new(
            "RGBA",
            (image.width + padding * 2, image.height + padding * 2),
        )
        padded.alpha_composite(image, (padding, padding))
        image = padded

    destination.parent.mkdir(parents=True, exist_ok=True)
    image.save(destination, optimize=True)
    return image.size


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Trim chroma-keyed RGBA assets and normalize their texture sizes."
    )
    parser.add_argument("source_dir", type=Path)
    parser.add_argument("output_dir", type=Path)
    args = parser.parse_args()

    specs = {
        "apple-tree": (512, 512, None),
        "shelter": (768, 512, None),
        "apple-basket": (256, 192, None),
        "wildflowers": (256, 256, None),
        "grass-tile": (256, 128, (256, 128)),
        "stone-edge": (384, 192, None),
    }

    for name, (max_width, max_height, exact_size) in specs.items():
        source = args.source_dir / f"{name}-alpha.png"
        destination = args.output_dir / f"{name}.png"
        size = trim_and_resize(
            source,
            destination,
            max_width,
            max_height,
            exact_size,
            padding=0 if name == "grass-tile" else 4,
        )
        print(f"{name}: {size[0]}x{size[1]} -> {destination}")


if __name__ == "__main__":
    main()
