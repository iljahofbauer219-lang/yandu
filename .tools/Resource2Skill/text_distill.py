from __future__ import annotations

import argparse
from pathlib import Path

from core.analyzer import analyze_text


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--domain", required=True)
    parser.add_argument("--input", required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--model", default="gemini-2.5-flash")
    args = parser.parse_args()
    root = Path(__file__).resolve().parent
    prompt = root / "domains" / args.domain / "distiller_prompt.md"
    if not prompt.is_file():
        raise SystemExit(f"invalid domain: {args.domain}")
    evidence_prompt = prompt.read_text(encoding="utf-8") if args.domain == "general" else """You are a rigorous skill distiller. Convert the timestamped transcript into one reusable, actionable knowledge skill.

Rules:
1. Use only claims explicitly supported by the transcript. Never infer visuals, UI, colors, layouts, tools, or actions that are not stated.
2. Cite timestamps like [28:10] after every extracted principle or example.
3. Clearly label transcription uncertainty, especially names and non-English passages.
4. Focus on the interview's transferable method: professional growth, discipline, respect, hard work, handling pressure, and advice to young players.
5. Return Markdown with: Purpose, Inputs, Principles with evidence, Step-by-step application, Decision rules, Failure modes, Verification checklist, Source limitations.
6. Do not output implementation code. Do not claim that the source is a tutorial.
"""
    result = analyze_text(
        Path(args.input).read_text(encoding="utf-8"),
        model=args.model,
        prompt_text=evidence_prompt,
        extra_instructions=(
            "The source is a timestamped Watch Skill report rather than raw video. "
            "Preserve evidence timestamps, do not invent unseen UI actions, and return Markdown."
        ),
    )
    Path(args.output).write_text(result, encoding="utf-8")


if __name__ == "__main__":
    main()
