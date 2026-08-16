from __future__ import annotations

from pathlib import Path

import pytest

from app.face_focus import compute_focus_x


def _fake_detect(per_frame: list[list[tuple[float, float]]]):
    """Membuat callable _detect_frames yang mengembalikan hit statis."""
    def detect(frames: list[Path]) -> list[list[tuple[float, float]]]:  # noqa: ARG001
        return per_frame
    return detect


def test_returns_center_when_no_faces(tmp_path: Path) -> None:
    fake_frames = [tmp_path / f"f{i}.jpg" for i in range(3)]
    for p in fake_frames:
        p.write_bytes(b"\x00")

    result = compute_focus_x(fake_frames, _detect_frames=_fake_detect([[], [], []]))
    assert result == 0.5


def test_uses_median_of_detected_centers(tmp_path: Path) -> None:
    fake_frames = [tmp_path / f"f{i}.jpg" for i in range(3)]
    for p in fake_frames:
        p.write_bytes(b"\x00")

    # Frame 0: wajah di x=0.2, frame 1: x=0.8, frame 2: x=0.4 → median 0.4
    per_frame = [
        [(100.0, 0.2)],
        [(100.0, 0.8)],
        [(100.0, 0.4)],
    ]
    result = compute_focus_x(fake_frames, _detect_frames=_fake_detect(per_frame))
    assert result == pytest.approx(0.4)


def test_picks_largest_face_when_multiple(tmp_path: Path) -> None:
    fake_frames = [tmp_path / "f0.jpg"]
    fake_frames[0].write_bytes(b"\x00")

    # Dua wajah dalam satu frame; area 10 vs 90 → yang besar dipilih (center 0.75).
    per_frame = [[
        (10.0, 0.15),   # kecil
        (90.0, 0.75),   # besar
    ]]
    result = compute_focus_x(fake_frames, _detect_frames=_fake_detect(per_frame))
    assert result == pytest.approx(0.75)


def test_clamps_result_to_unit_interval(tmp_path: Path) -> None:
    """Nilai ekstrem tetap di-clamp ke [0, 1]."""
    fake_frames = [tmp_path / "f0.jpg"]
    fake_frames[0].write_bytes(b"\x00")

    per_frame = [[(100.0, 1.5)]]  # di atas batas
    result = compute_focus_x(fake_frames, _detect_frames=_fake_detect(per_frame))
    assert result == 1.0


def test_empty_frames_returns_center() -> None:
    assert compute_focus_x([], _detect_frames=_fake_detect([])) == 0.5
