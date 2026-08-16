from pathlib import Path


ROOT = Path(__file__).resolve().parents[3]
DOCKERFILE = ROOT / "apps/downloader/Dockerfile"


def test_worker_image_installs_mediapipe_graphics_runtime_and_smoke_checks_detector():
    dockerfile = DOCKERFILE.read_text(encoding="utf-8")

    assert "libgles2" in dockerfile
    assert "libegl1" in dockerfile
    assert "from app.face_focus import _create_detector" in dockerfile
    assert "_create_detector().close()" in dockerfile
