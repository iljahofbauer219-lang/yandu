from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

import numpy as np
from PIL import Image, ImageFilter


@dataclass(frozen=True)
class Score:
    risk: float
    entropy: float
    high_frequency: float
    smoothness: float
    channel_correlation: float
    model_probability: float | None = None


def _to_gray_array(image: Image.Image) -> np.ndarray:
    return np.asarray(image.convert("L"), dtype=np.float32) / 255.0


def _entropy(gray: np.ndarray) -> float:
    hist, _ = np.histogram(gray, bins=256, range=(0, 1), density=False)
    hist = hist.astype(np.float64)
    hist /= max(1.0, hist.sum())
    hist = hist[hist > 0]
    return float(-(hist * np.log2(hist)).sum() / 8.0)


def _high_frequency(gray: np.ndarray) -> float:
    small = Image.fromarray(np.uint8(np.clip(gray * 255, 0, 255))).resize((256, 256), Image.Resampling.LANCZOS)
    arr = np.asarray(small, dtype=np.float32) / 255.0
    fft = np.fft.fftshift(np.fft.fft2(arr))
    mag = np.log1p(np.abs(fft))
    h, w = mag.shape
    yy, xx = np.ogrid[:h, :w]
    dist = np.sqrt((yy - h / 2) ** 2 + (xx - w / 2) ** 2)
    high = mag[dist > min(h, w) * 0.22].mean()
    low = mag[dist <= min(h, w) * 0.08].mean()
    return float(high / (low + 1e-6))


def _smoothness(image: Image.Image) -> float:
    blurred = image.convert("L").filter(ImageFilter.GaussianBlur(1.2))
    base = np.asarray(image.convert("L"), dtype=np.float32)
    blur = np.asarray(blurred, dtype=np.float32)
    return float(np.mean(np.abs(base - blur)) / 255.0)


def _channel_correlation(image: Image.Image) -> float:
    arr = np.asarray(image.convert("RGB"), dtype=np.float32).reshape(-1, 3)
    if arr.shape[0] > 20000:
        arr = arr[:: arr.shape[0] // 20000]
    corr = np.corrcoef(arr.T)
    vals = [abs(corr[0, 1]), abs(corr[0, 2]), abs(corr[1, 2])]
    vals = [0.0 if np.isnan(v) else float(v) for v in vals]
    return float(sum(vals) / len(vals))


def extract_features(image: Image.Image) -> dict[str, float]:
    gray = _to_gray_array(image)
    entropy = _entropy(gray)
    high_frequency = _high_frequency(gray)
    smoothness = _smoothness(image)
    channel_correlation = _channel_correlation(image)
    arr = np.asarray(image.convert("RGB").resize((256, 256), Image.Resampling.LANCZOS), dtype=np.float32) / 255.0
    channel_std = arr.reshape(-1, 3).std(axis=0)
    lap = np.gradient(gray)
    edge_energy = float(np.mean(np.sqrt(lap[0] * lap[0] + lap[1] * lap[1])))
    dark_ratio = float((gray < 0.08).mean())
    bright_ratio = float((gray > 0.92).mean())
    return {
        "entropy": entropy,
        "high_frequency": high_frequency,
        "smoothness": smoothness,
        "channel_correlation": channel_correlation,
        "red_std": float(channel_std[0]),
        "green_std": float(channel_std[1]),
        "blue_std": float(channel_std[2]),
        "edge_energy": edge_energy,
        "dark_ratio": dark_ratio,
        "bright_ratio": bright_ratio,
    }


def heuristic_risk(features: dict[str, float]) -> float:
    entropy = features["entropy"]
    high_frequency = features["high_frequency"]
    smoothness = features["smoothness"]
    channel_correlation = features["channel_correlation"]

    # Heuristic risk, not a platform detector: lower is better. AI images often look too smooth,
    # too channel-consistent, and too spectrally clean.
    low_entropy_penalty = max(0.0, 0.78 - entropy) * 0.9
    low_hf_penalty = max(0.0, 0.42 - high_frequency) * 0.9
    smooth_penalty = max(0.0, 0.045 - smoothness) * 4.0
    channel_penalty = max(0.0, channel_correlation - 0.965) * 1.5
    over_noise_penalty = max(0.0, smoothness - 0.14) * 1.2
    risk = low_entropy_penalty + low_hf_penalty + smooth_penalty + channel_penalty + over_noise_penalty
    return float(min(1.0, risk))


def score_image(image: Image.Image, scorer: object | None = None) -> Score:
    features = extract_features(image)
    risk = heuristic_risk(features)
    model_probability = None
    if scorer is not None and hasattr(scorer, "predict_ai_probability"):
        try:
            model_probability = float(scorer.predict_ai_probability(features))
            risk = float((risk * 0.35) + (model_probability * 0.65))
        except Exception:
            model_probability = None
    return Score(
        risk=float(min(1.0, risk)),
        entropy=features["entropy"],
        high_frequency=features["high_frequency"],
        smoothness=features["smoothness"],
        channel_correlation=features["channel_correlation"],
        model_probability=model_probability,
    )
