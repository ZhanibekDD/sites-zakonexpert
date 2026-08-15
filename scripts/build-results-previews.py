#!/usr/bin/env python3
"""Build readable, privacy-safe WebP previews from the rulings archive.

The source PDFs already contain manual opaque redactions. This script rasterizes
the first page so hidden PDF text cannot be recovered, then adds a conservative
second redaction pass for common personal-data patterns. It creates a small card
thumbnail and a larger document image for the fullscreen viewer.
"""

from __future__ import annotations

import argparse
import io
import json
import re
from collections import defaultdict
from pathlib import Path

import fitz
from PIL import Image, ImageDraw


ROOT = Path(__file__).resolve().parents[1]
DEFAULT_SOURCE = ROOT / "tmp" / "rulings-archive-20260816"
DATA_FILE = ROOT / "public" / "js" / "results-archive-data.js"
OUTPUT_DIR = ROOT / "public" / "img" / "rezultaty" / "archive"
THUMB_DIR = OUTPUT_DIR / "thumbs"

EXCLUDED = {
    # Four large featured results are rendered separately above the archive.
    "3780371,08.pdf",
    "4091645.pdf",
    "6047477,95.pdf",
    "6942105,3.pdf",
    # Duplicate or technical versions removed during the archive audit.
    "45692_2.pdf",
    "95094_2.pdf",
    "52164.37_2.pdf",
    "85800_3.pdf",
    "85800_4.pdf",
    "143188.pdf",
}

SENSITIVE_LINE_MARKERS = (
    "иин",
    "жсн",
    "дата рождения",
    "удостоверени",
    "телефон",
    "тел.",
    "e-mail",
    "email",
    "электронная почта",
    "место жительства",
    "прожива",
    "адрес",
    "номер счета",
    "номер счёта",
    "лицевой счет",
    "лицевой счёт",
    "номер карты",
)


def parse_archive_data(path: Path) -> tuple[str, list[dict]]:
    source = path.read_text(encoding="utf-8-sig")
    match = re.search(r"^(.*?window\.ZAKONEXPERT_RESULTS_ARCHIVE=)(\[.*\]);\s*$", source, re.S)
    if not match:
        raise ValueError(f"Cannot parse archive data: {path}")
    return match.group(1), json.loads(match.group(2))


def normalized_stem(path: Path) -> str:
    value = re.sub(r"[,_\.]+", "-", path.stem.lower())
    return re.sub(r"-+", "-", value).strip("-")


def build_source_map(source_dir: Path, items: list[dict]) -> dict[str, Path]:
    selected = sorted(
        (path for path in source_dir.glob("*.pdf") if path.name not in EXCLUDED),
        key=lambda path: path.name,
    )
    if len(selected) != len(items):
        raise ValueError(f"Expected {len(items)} selected PDFs, found {len(selected)}")

    groups: dict[str, list[Path]] = defaultdict(list)
    for path in selected:
        groups[normalized_stem(path)].append(path)

    mapping: dict[str, Path] = {}
    for base, paths in groups.items():
        paths.sort(key=lambda path: path.name)
        if len(paths) == 1:
            mapping[base] = paths[0]
        else:
            for index, path in enumerate(paths, 1):
                mapping[f"{base}-{index}"] = path

    item_ids = {item["id"] for item in items}
    if set(mapping) != item_ids:
        missing = sorted(item_ids - set(mapping))
        extra = sorted(set(mapping) - item_ids)
        raise ValueError(f"PDF mapping mismatch. Missing={missing}; extra={extra}")
    return mapping


def should_redact_token(text: str) -> bool:
    compact_digits = re.sub(r"\D", "", text)
    if 10 <= len(compact_digits) <= 16:
        return True
    if "@" in text and "." in text:
        return True
    return False


def apply_secondary_redactions(image: Image.Image, page: fitz.Page) -> int:
    words = page.get_text("words")
    if not words:
        return 0

    x_scale = image.width / page.rect.width
    y_scale = image.height / page.rect.height
    lines: dict[tuple[int, int], list[tuple]] = defaultdict(list)
    for word in words:
        lines[(int(word[5]), int(word[6]))].append(word)

    rectangles: list[tuple[int, int, int, int]] = []
    for line_words in lines.values():
        line_words.sort(key=lambda word: word[0])
        line_text = " ".join(str(word[4]) for word in line_words).lower()
        redact_line = any(marker in line_text for marker in SENSITIVE_LINE_MARKERS)
        targets = line_words if redact_line else [word for word in line_words if should_redact_token(str(word[4]))]
        if not targets:
            continue
        if redact_line:
            x0 = min(word[0] for word in targets)
            y0 = min(word[1] for word in targets)
            x1 = max(word[2] for word in targets)
            y1 = max(word[3] for word in targets)
            targets = [(x0, y0, x1, y1, "", 0, 0, 0)]
        for word in targets:
            margin = 3
            rectangles.append((
                max(0, int(word[0] * x_scale) - margin),
                max(0, int(word[1] * y_scale) - margin),
                min(image.width, int(word[2] * x_scale) + margin),
                min(image.height, int(word[3] * y_scale) + margin),
            ))

    draw = ImageDraw.Draw(image)
    for rectangle in rectangles:
        draw.rectangle(rectangle, fill="#050505")
    return len(rectangles)


def render_first_page(path: Path, target_width: int = 1600) -> tuple[Image.Image, int]:
    document = fitz.open(path)
    try:
        page = document.load_page(0)
        zoom = target_width / page.rect.width
        pixmap = page.get_pixmap(matrix=fitz.Matrix(zoom, zoom), colorspace=fitz.csRGB, alpha=False)
        image = Image.frombytes("RGB", (pixmap.width, pixmap.height), pixmap.samples)
        redactions = apply_secondary_redactions(image, page)
        return image, redactions
    finally:
        document.close()


def save_webp_with_budget(image: Image.Image, path: Path, quality: int, max_bytes: int) -> int:
    path.parent.mkdir(parents=True, exist_ok=True)
    working = image
    for _ in range(4):
        for current_quality in range(quality, 45, -4):
            buffer = io.BytesIO()
            working.save(buffer, format="WEBP", quality=current_quality, method=6)
            payload = buffer.getvalue()
            if len(payload) <= max_bytes:
                path.write_bytes(payload)
                return len(payload)
        reduced_width = max(480, round(working.width * 0.86))
        reduced_height = round(working.height * reduced_width / working.width)
        working = working.resize((reduced_width, reduced_height), Image.Resampling.LANCZOS)
    raise RuntimeError(f"Unable to encode {path}")


def build_preview(item: dict, source: Path) -> tuple[int, int, int]:
    image, redactions = render_first_page(source)
    large_path = OUTPUT_DIR / f"{item['id']}.webp"
    large_size = save_webp_with_budget(image, large_path, quality=82, max_bytes=520 * 1024)

    thumb_width = 720
    thumb_height = round(image.height * thumb_width / image.width)
    thumb = image.resize((thumb_width, thumb_height), Image.Resampling.LANCZOS)
    thumb_path = THUMB_DIR / f"{item['id']}.webp"
    thumb_size = save_webp_with_budget(thumb, thumb_path, quality=68, max_bytes=95 * 1024)
    return large_size, thumb_size, redactions


def write_archive_data(prefix: str, items: list[dict]) -> None:
    for item in items:
        item["src"] = f"/img/rezultaty/archive/{item['id']}.webp"
        item["thumbSrc"] = f"/img/rezultaty/archive/thumbs/{item['id']}.webp"
    payload = json.dumps(items, ensure_ascii=False, separators=(",", ":"))
    DATA_FILE.write_text(f"{prefix}{payload};\n", encoding="utf-8")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--source-dir", type=Path, default=DEFAULT_SOURCE)
    parser.add_argument("--limit", type=int, default=0, help="Build only the first N items for visual QA")
    parser.add_argument("--no-write-data", action="store_true")
    args = parser.parse_args()

    prefix, items = parse_archive_data(DATA_FILE)
    mapping = build_source_map(args.source_dir, items)
    selected_items = items[: args.limit] if args.limit else items

    total_large = 0
    total_thumbs = 0
    total_redactions = 0
    for index, item in enumerate(selected_items, 1):
        large_size, thumb_size, redactions = build_preview(item, mapping[item["id"]])
        total_large += large_size
        total_thumbs += thumb_size
        total_redactions += redactions
        print(f"[{index:03d}/{len(selected_items):03d}] {item['id']}: {large_size // 1024}K + {thumb_size // 1024}K")

    if not args.no_write_data and not args.limit:
        write_archive_data(prefix, items)

    print(
        f"Built {len(selected_items)} readable previews; "
        f"large={total_large / 1024 / 1024:.1f}MB, thumbs={total_thumbs / 1024 / 1024:.1f}MB, "
        f"secondary redactions={total_redactions}"
    )


if __name__ == "__main__":
    main()
