from __future__ import annotations

import argparse
import json
import sys
from dataclasses import asdict, replace
from pathlib import Path

from PIL import Image

from realshift.config import get_profile
from realshift.pipeline import optimize_image, save_jpeg
from realshift.scoring import score_image


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--report", required=True)
    parser.add_argument("--profile", choices=("light", "balanced"), default="light")
    parser.add_argument("--iterations", type=int, default=3)
    parser.add_argument("--seed", type=int, default=42)
    args = parser.parse_args()

    source = Path(args.input).resolve()
    output = Path(args.output).resolve()
    report_path = Path(args.report).resolve()
    with Image.open(source) as image:
        original = image.convert("RGB")
        profile = replace(get_profile(args.profile), output_width=original.width, output_height=original.height, exif=False, protect_face=False, protect_subject=False, protect_text=False)
        original_score = score_image(original)
        processed, processed_score, meta = optimize_image(original, profile, iterations=max(1, args.iterations), seed=args.seed, protect=False)
        save_jpeg(processed, output, profile, seed=args.seed)

    report = {
        "source": str(source),
        "output": str(output),
        "profile": args.profile,
        "iterations": max(1, args.iterations),
        "seed": args.seed,
        "original_score": asdict(original_score),
        "processed_score": asdict(processed_score),
        "chosen_iteration": meta["iteration"],
        "exif": False,
        "protection_masks": False,
    }
    report_path.parent.mkdir(parents=True, exist_ok=True)
    report_path.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(report, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:
        print(json.dumps({"error": str(exc)}, ensure_ascii=False), file=sys.stderr)
        raise
