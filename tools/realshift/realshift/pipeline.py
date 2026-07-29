from __future__ import annotations

import io
import math
import random
from dataclasses import asdict, dataclass, replace
from pathlib import Path

import numpy as np
from PIL import Image, ImageChops, ImageEnhance, ImageFilter, ImageOps

from .config import Profile
from .scoring import Score, score_image

try:
    from .exif import build_exif
except (ImportError, ModuleNotFoundError):
    def build_exif(seed: int | None = None) -> bytes | None:
        return None

try:
    from .masking import MaskOptions, blend_protected, build_protection_mask
except (ImportError, ModuleNotFoundError):
    @dataclass(frozen=True)
    class MaskOptions:
        face: bool = False
        subject: bool = False
        text: bool = False
        strength: float = 0

    def build_protection_mask(image: Image.Image, options: MaskOptions) -> Image.Image:
        return Image.new("L", image.size, 0)

    def blend_protected(original: Image.Image, processed: Image.Image, mask: Image.Image) -> Image.Image:
        return processed

SUPPORTED_EXTS = {".jpg", ".jpeg", ".png", ".webp", ".bmp", ".tif", ".tiff"}


def iter_images(input_path: Path, recursive: bool = False) -> list[Path]:
    if input_path.is_file():
        return [input_path] if input_path.suffix.lower() in SUPPORTED_EXTS else []
    pattern = "**/*" if recursive else "*"
    return sorted(p for p in input_path.glob(pattern) if p.is_file() and p.suffix.lower() in SUPPORTED_EXTS)


def normalize_image(image: Image.Image, width: int, height: int) -> Image.Image:
    image = ImageOps.exif_transpose(image).convert("RGB")
    return ImageOps.fit(image, (width, height), method=Image.Resampling.LANCZOS, centering=(0.5, 0.5))


def _edge_color(image: Image.Image) -> tuple[int, int, int]:
    arr = np.asarray(image.resize((32, 32), Image.Resampling.BILINEAR), dtype=np.float32)
    edges = np.concatenate([arr[0], arr[-1], arr[:, 0], arr[:, -1]], axis=0)
    color = np.median(edges, axis=0)
    return tuple(int(x) for x in color)


def _jitter_color(image: Image.Image, rng: random.Random, amount: float) -> Image.Image:
    image = ImageEnhance.Color(image).enhance(1 + rng.uniform(-amount, amount))
    image = ImageEnhance.Contrast(image).enhance(1 + rng.uniform(-amount * 0.8, amount * 0.8))
    image = ImageEnhance.Brightness(image).enhance(1 + rng.uniform(-amount * 0.55, amount * 0.55))
    return image


def _tone_curve(image: Image.Image, rng: random.Random) -> Image.Image:
    gamma = rng.uniform(0.94, 1.08)
    lift = rng.uniform(-3, 5)
    table = []
    for value in range(256):
        corrected = 255 * ((value / 255) ** gamma) + lift
        table.append(int(np.clip(corrected, 0, 255)))
    return image.point(table * 3)


def _add_noise(image: Image.Image, rng: random.Random, sigma: float, grain: float) -> Image.Image:
    arr = np.asarray(image, dtype=np.float32) / 255.0
    gray = arr.mean(axis=2, keepdims=True)
    shadow_weight = np.clip(1.2 - gray * 1.3, 0.25, 1.2)
    noise = rng.normalvariate(0, 1)
    seed = int((noise + 9) * 1_000_000) & 0xFFFFFFFF
    np_rng = np.random.default_rng(seed)
    sensor = np_rng.normal(0, sigma, arr.shape) * shadow_weight
    mono = np_rng.normal(0, grain, arr.shape[:2] + (1,)) * 0.65
    out = np.clip(arr + sensor + mono, 0, 1)
    return Image.fromarray(np.uint8(out * 255), "RGB")


def _chromatic_aberration(image: Image.Image, rng: random.Random, amount: float) -> Image.Image:
    if amount <= 0:
        return image
    r, g, b = image.split()
    dx = max(1, int(round(amount)))
    dy = rng.choice([-1, 0, 1])
    r = ImageChops.offset(r, dx, dy)
    b = ImageChops.offset(b, -dx, -dy)
    return Image.merge("RGB", (r, g, b))


def _vignette(image: Image.Image, strength: float) -> Image.Image:
    if strength <= 0:
        return image
    w, h = image.size
    yy, xx = np.ogrid[:h, :w]
    x = (xx - w / 2) / (w / 2)
    y = (yy - h / 2) / (h / 2)
    radius = np.sqrt(x * x + y * y)
    mask = 1 - np.clip((radius - 0.22) / 0.92, 0, 1) ** 2 * strength
    arr = np.asarray(image, dtype=np.float32)
    arr *= mask[..., None]
    return Image.fromarray(np.uint8(np.clip(arr, 0, 255)), "RGB")


def _micro_perspective(image: Image.Image, rng: random.Random, amount: float) -> Image.Image:
    if amount <= 0:
        return image
    w, h = image.size
    dx = int(w * amount * rng.uniform(-1, 1))
    dy = int(h * amount * rng.uniform(-1, 1))
    coeffs = (1, dx / max(h, 1), -dx / 2, dy / max(w, 1), 1, -dy / 2, 0, 0)
    return image.transform(image.size, Image.Transform.AFFINE, coeffs, Image.Resampling.BICUBIC)


def _jpeg_cycle(image: Image.Image, quality: int) -> Image.Image:
    buf = io.BytesIO()
    image.save(buf, format="JPEG", quality=quality, optimize=True, progressive=False, subsampling=2)
    buf.seek(0)
    return Image.open(buf).convert("RGB")


def _blockiness(image: Image.Image, amount: float, rng: random.Random) -> Image.Image:
    if amount <= 0:
        return image
    w, h = image.size
    scale = rng.choice([2, 3, 4])
    small = image.resize((max(1, w // scale), max(1, h // scale)), Image.Resampling.BILINEAR)
    pixel = small.resize((w, h), Image.Resampling.BILINEAR)
    return Image.blend(image, pixel, amount)


def _mask_options(profile: Profile) -> MaskOptions:
    return MaskOptions(
        face=profile.protect_face,
        subject=profile.protect_subject,
        text=profile.protect_text,
        strength=profile.protection_strength,
    )


def apply_profile(image: Image.Image, profile: Profile, seed: int | None = None, protect: bool = True) -> Image.Image:
    rng = random.Random(seed)
    base = normalize_image(image, profile.output_width, profile.output_height)
    processed = _micro_perspective(base, rng, profile.perspective)
    processed = _jitter_color(processed, rng, profile.color_jitter)
    processed = _tone_curve(processed, rng)
    if profile.blur_radius > 0:
        processed = processed.filter(ImageFilter.GaussianBlur(profile.blur_radius * rng.uniform(0.65, 1.2)))
    processed = _chromatic_aberration(processed, rng, profile.chroma_shift)
    processed = _vignette(processed, profile.vignette * rng.uniform(0.75, 1.25))
    processed = _add_noise(processed, rng, profile.noise, profile.grain)
    processed = _blockiness(processed, profile.blockiness, rng)
    processed = _jpeg_cycle(processed, max(50, min(96, profile.jpeg_quality + rng.randint(-4, 3))))
    if profile.sharpen > 0:
        processed = Image.blend(processed, processed.filter(ImageFilter.UnsharpMask(radius=1.1, percent=80, threshold=3)), profile.sharpen)
    if protect and (profile.protect_face or profile.protect_subject or profile.protect_text):
        mask = build_protection_mask(base, _mask_options(profile))
        processed = blend_protected(base, processed, mask)
    return processed


def _variant_profile(profile: Profile, rng: random.Random, strength: float) -> Profile:
    factor = 1 + rng.uniform(-0.25, 0.45) * strength
    return replace(
        profile,
        noise=max(0, profile.noise * factor),
        grain=max(0, profile.grain * factor),
        blur_radius=max(0, profile.blur_radius * (1 + rng.uniform(-0.3, 0.35) * strength)),
        chroma_shift=max(0, profile.chroma_shift * (1 + rng.uniform(-0.35, 0.5) * strength)),
        vignette=max(0, profile.vignette * (1 + rng.uniform(-0.35, 0.45) * strength)),
        jpeg_quality=int(np.clip(profile.jpeg_quality + rng.randint(-8, 5), 68, 94)),
        blockiness=max(0, profile.blockiness * (1 + rng.uniform(-0.5, 0.8) * strength)),
    )


def optimize_image(
    image: Image.Image,
    profile: Profile,
    iterations: int = 1,
    seed: int | None = None,
    scorer: object | None = None,
    protect: bool = True,
) -> tuple[Image.Image, Score, dict]:
    rng = random.Random(seed)
    best_image = apply_profile(image, profile, seed=rng.randint(0, 2**31 - 1), protect=protect)
    best_score = score_image(best_image, scorer=scorer)
    best_meta = {"profile": asdict(profile), "iteration": 0}
    for idx in range(1, max(1, iterations)):
        variant = _variant_profile(profile, rng, strength=min(1.0, idx / max(iterations - 1, 1)))
        candidate = apply_profile(image, variant, seed=rng.randint(0, 2**31 - 1), protect=protect)
        candidate_score = score_image(candidate, scorer=scorer)
        if candidate_score.risk < best_score.risk:
            best_image = candidate
            best_score = candidate_score
            best_meta = {"profile": asdict(variant), "iteration": idx}
    return best_image, best_score, best_meta


def save_jpeg(image: Image.Image, path: Path, profile: Profile, seed: int | None = None) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    exif = build_exif(seed) if profile.exif else None
    options = {"format": "JPEG", "quality": profile.jpeg_quality, "optimize": True, "subsampling": 2}
    if exif:
        options["exif"] = exif
    image.save(path, **options)
