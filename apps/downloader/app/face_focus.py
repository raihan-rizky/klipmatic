"""Deteksi wajah untuk menentukan fokus horizontal crop 9:16.

Strategi: ambil frame sampel dari segmen, deteksi wajah per frame, pilih
wajah terbesar tiap frame, lalu ambil median antar frame supaya posisi crop
stabil terhadap misdetection sesaat. Tanpa wajah sama sekali, fokus kembali
ke tengah (0.5).
"""
from __future__ import annotations

import logging
import statistics
from collections.abc import Callable
from pathlib import Path

log = logging.getLogger(__name__)

MODEL_PATH = Path(__file__).parent / "models" / "blaze_face_short_range.tflite"

# Satu deteksi: (luas kotak dalam piksel, pusat-x ternormalisasi 0..1).
FaceHit = tuple[float, float]

# Menerima daftar path frame, mengembalikan daftar deteksi per frame.
DetectFrames = Callable[[list[Path]], list[list[FaceHit]]]


def _create_detector():
    """Membuat FaceDetector MediaPipe dari model lokal (CPU)."""
    from mediapipe.tasks import python as mp_python
    from mediapipe.tasks.python import vision

    base_options = mp_python.BaseOptions(model_asset_path=str(MODEL_PATH))
    options = vision.FaceDetectorOptions(
        base_options=base_options,
        running_mode=vision.RunningMode.VIDEO,
        min_detection_confidence=0.5,
    )
    return vision.FaceDetector.create_from_options(options)


def _detect_with_mediapipe(frames: list[Path]) -> list[list[FaceHit]]:
    """Implementasi default: deteksi nyata memakai MediaPipe."""
    import mediapipe as mp

    detector = _create_detector()
    results: list[list[FaceHit]] = []
    for index, frame_path in enumerate(frames):
        try:
            image = mp.Image.create_from_file(str(frame_path))
        except Exception:  # noqa: BLE001 - frame rusak tidak membatalkan batch
            log.warning("frame %s gagal dibaca, dilewati", frame_path)
            results.append([])
            continue
        if image.width <= 0:
            results.append([])
            continue
        # Timestamp harus monoton naik pada running mode VIDEO.
        detection = detector.detect_for_video(image, index * 100)
        hits: list[FaceHit] = []
        for box in (d.bounding_box for d in detection.detections):
            if box is None or box.width <= 0 or box.height <= 0:
                continue
            area = float(box.width * box.height)
            center_x = (box.origin_x + box.width / 2) / image.width
            hits.append((area, max(0.0, min(1.0, center_x))))
        results.append(hits)
    return results


def compute_focus_x(
    frames: list[Path],
    *,
    _detect_frames: DetectFrames | None = None,
) -> float:
    """Mengembalikan fokus horizontal (0..1) dari daftar frame sampel.

    Memilih wajah terbesar pada tiap frame, lalu median antar frame. Nilai
    di-clamp ke [0, 1]. Kembali ke 0.5 kalau tidak ada wajah terdeteksi.
    """
    if not frames:
        return 0.5

    detect = _detect_frames or _detect_with_mediapipe
    per_frame = detect(frames)

    centers: list[float] = []
    for hits in per_frame:
        if not hits:
            continue
        _area, center_x = max(hits, key=lambda hit: hit[0])
        centers.append(center_x)

    if not centers:
        return 0.5
    return max(0.0, min(1.0, statistics.median(centers)))
