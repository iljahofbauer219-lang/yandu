from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class Profile:
    name: str
    output_width: int = 1280
    output_height: int = 1706
    jpeg_quality: int = 88
    noise: float = 0.018
    grain: float = 0.016
    blur_radius: float = 0.35
    chroma_shift: float = 0.65
    vignette: float = 0.16
    color_jitter: float = 0.045
    perspective: float = 0.006
    sharpen: float = 0.10
    blockiness: float = 0.08
    exif: bool = False
    protect_face: bool = True
    protect_subject: bool = True
    protect_text: bool = True
    protection_strength: float = 0.82


PROFILES: dict[str, Profile] = {
    "light": Profile(
        name="light",
        jpeg_quality=92,
        noise=0.010,
        grain=0.008,
        blur_radius=0.18,
        chroma_shift=0.30,
        vignette=0.08,
        color_jitter=0.025,
        perspective=0.002,
        sharpen=0.06,
        blockiness=0.03,
    ),
    "balanced": Profile(name="balanced"),
    "strong": Profile(
        name="strong",
        jpeg_quality=82,
        noise=0.030,
        grain=0.026,
        blur_radius=0.55,
        chroma_shift=1.1,
        vignette=0.24,
        color_jitter=0.075,
        perspective=0.010,
        sharpen=0.04,
        blockiness=0.15,
    ),
}


def get_profile(name: str) -> Profile:
    try:
        return PROFILES[name]
    except KeyError as exc:
        choices = ", ".join(sorted(PROFILES))
        raise ValueError(f"Unknown profile '{name}'. Choices: {choices}") from exc
