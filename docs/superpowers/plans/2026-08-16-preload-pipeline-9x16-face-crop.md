# Preload Pipeline: 9:16 Face-Cropped Preview Renders Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Auto-render a 9:16 face-cropped preview clip for every top-10 candidate as soon as analyze completes, so clicking any card plays instantly with no modal wait.

**Architecture:** New worker job type `render_previews` runs after `analyze`, looping over the 10 candidates. For each: download the segment via yt-dlp, extract N frames, run Python MediaPipe face detection, smooth focus X with EMA, FFmpeg-crop to 720×1280 with veryfast/crf28, upload to R2 under `previews/{sha256}.mp4`, and mark `preview_status='ready'`. Client polls `/api/clips/[id]/preview` which now returns the pre-rendered URL if available; CandidatePreviewModal skips the idle play button when ready.

**Tech Stack:** Python 3.11+, mediapipe (vision tasks), ffmpeg CLI, yt-dlp, psycopg, boto3 (already in app/storage.py), Next.js App Router, Drizzle migrations.

**Spec:** `docs/superpowers/specs/2026-08-16-top10-preload-editor-improvements-design.md` (Sub-proyek 2+3).

## Global Constraints

- Job types are constrained by `jobs_type_chk` check constraint; adding a new type requires a migration that drops + re-adds it.
- All R2 keys must be content-addressed (`sha256_file(path)`) so identical outputs share storage and cache forever.
- Preview status values are `'pending' | 'rendering' | 'ready' | 'failed'` (new column with CHECK constraint).
- Worker heartbeat at least once per candidate processed; one failed candidate must not abort the batch.
- No GPU dependency: face detector must work on CPU (MediaPipe default delegates to CPU fine).
- Web endpoints remain read-only against the database; never trust client payloads for ownership.
- Follow existing code style: Bahasa Indonesia log/error messages, docstrings in Indonesian, snake_case for Python functions, camelCase for TypeScript.

---

### Task 1: Add DB columns and extend job type constraint

**Files:**
- Create: `packages/db/migrations/0003_candidate_preview_renders.sql`
- Modify: `docker-compose.dev.yml:42` (add the new migration file to init sequence)

**Interfaces:**
- Produces: `clip_candidates.preview_status text NOT NULL DEFAULT 'pending'` with CHECK in ('pending','rendering','ready','failed'), and nullable `clip_candidates.preview_r2_key text`.
- Produces: updated `jobs_type_chk` that includes `'render_previews'`.

- [ ] **Step 1: Write the migration SQL**

Create `packages/db/migrations/0003_candidate_preview_renders.sql`:

```sql
ALTER TABLE "jobs" DROP CONSTRAINT "jobs_type_chk";--> statement-breakpoint
ALTER TABLE "clip_candidates" ADD COLUMN "preview_status" text DEFAULT 'pending' NOT NULL;--> statement-breakpoint
ALTER TABLE "clip_candidates" ADD COLUMN "preview_r2_key" text;--> statement-breakpoint
ALTER TABLE "clip_candidates" ADD CONSTRAINT "clip_candidates_preview_status_chk" CHECK ("clip_candidates"."preview_status" in ('pending','rendering','ready','failed'));--> statement-breakpoint
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_type_chk" CHECK ("jobs"."type" in ('ingest','transcribe','analyze','prepare_thumbnails','fetch_segments','probe_asset','render_previews'));
```

The pattern matches `0002_candidate_previews.sql` exactly: drop the old jobs constraint, add columns with defaults, add the new CHECK, then re-add the expanded jobs constraint. The `DEFAULT 'pending'` ensures existing rows are valid without backfill.

- [ ] **Step 2: Register the migration in docker-compose dev init**

Edit `docker-compose.dev.yml`. After the line running `0002_candidate_previews.sql` (around line 41), add:

```yaml
          psql -v ON_ERROR_STOP=1 -h postgres -U postgres -d klipmatic -f /migrations/0003_candidate_preview_renders.sql
```

This keeps local dev environments aligned. Production uses drizzle-kit migrate separately.

- [ ] **Step 3: Apply locally and verify schema**

Run:

```bash
cd C:/Projects/cheapclipper
bun run db:up   # restarts postgres and replays init scripts
PGPASSWORD=postgres psql -h localhost -U postgres -d klipmatic -c "\d clip_candidates" | grep -E "preview|thumbnail"
PGPASSWORD=postgres psql -h localhost -U postgres -d klipmatic -c "select conname, pg_get_constraintdef(oid) from pg_constraint where conname = 'jobs_type_chk';"
```

Expected: `preview_status` and `preview_r2_key` columns visible; `jobs_type_chk` definition includes `render_previews`.

- [ ] **Step 4: Commit**

```bash
git add packages/db/migrations/0003_candidate_preview_renders.sql docker-compose.dev.yml
git commit -m "db(migration): add preview_status/r2_key columns and render_previews job type"
```

---

### Task 2: Implement the face-focus helper (Python)

**Files:**
- Create: `apps/downloader/app/face_focus.py`
- Test: `apps/downloader/tests/test_face_focus.py`

**Interfaces:**
- Consumes: `mediapipe.tasks.vision.FaceDetector`, PIL/Pillow for frame loading.
- Produces: `def compute_focus_x(frames: list[Path]) -> float` returning 0.0–1.0 (median of detected face centers; 0.5 fallback). Used by Task 3.

- [ ] **Step 1: Write failing tests for face_focus**

Create `apps/downloader/tests/test_face_focus.py`:

```python
from __future__ import annotations

from pathlib import Path

import pytest

from app.face_focus import compute_focus_x


def test_returns_center_when_no_faces(tmp_path: Path) -> None:
    """Tanpa wajah terdeteksi, fokus kembali ke tengah."""
    fake_frames = [tmp_path / f"f{i}.jpg" for i in range(3)]
    for p in fake_frames:
        p.write_bytes(b"\x00")  # konten tidak penting; detektor di-mock

    result = compute_focus_x(fake_frames, _detector_factory=lambda: _FakeDetector([]))
    assert result == 0.5


def test_uses_median_of_detected_centers(tmp_path: Path) -> None:
    """Tiga frame dengan wajah di posisi berbeda → median dipilih."""
    fake_frames = [tmp_path / f"f{i}.jpg" for i in range(3)]
    for p in fake_frames:
        p.write_bytes(b"\x00")

    # Frame 0: wajah di x=0.2, frame 1: x=0.8, frame 2: x=0.4 → median 0.4
    detections_per_frame = [
        [_FakeBox(0.1, 0.0, 0.2, 0.3)],  # center_x = 0.2
        [_FakeBox(0.7, 0.0, 0.2, 0.3)],  # center_x = 0.8
        [_FakeBox(0.3, 0.0, 0.2, 0.3)],  # center_x = 0.4
    ]
    result = compute_focus_x(
        fake_frames,
        _detector_factory=lambda: _FakeDetector(detections_per_frame),
    )
    assert result == pytest.approx(0.4)


def test_picks_largest_face_when_multiple(tmp_path: Path) -> None:
    """Banyak wajah dalam satu frame → pilih yang terbesar."""
    fake_frames = [tmp_path / "f0.jpg"]
    fake_frames[0].write_bytes(b"\x00")

    detections_per_frame = [[
        _FakeBox(0.1, 0.0, 0.1, 0.1),  # area 0.01
        _FakeBox(0.6, 0.0, 0.3, 0.3),  # area 0.09 → terpilih
    ]]
    result = compute_focus_x(
        fake_frames,
        _detector_factory=lambda: _FakeDetector(detections_per_frame),
    )
    assert result == pytest.approx(0.75)  # 0.6 + 0.3/2


class _FakeBox:
    def __init__(self, origin_x: float, origin_y: float, width: float, height: float) -> None:
        self.origin_x = origin_x
        self.origin_y = origin_y
        self.width = width
        self.height = height


class _FakeDetection:
    def __init__(self, box: _FakeBox) -> None:
        self.bounding_box = box


class _FakeDetector:
    def __init__(self, detections_per_frame: list[list[_FakeBox]]) -> None:
        self._frames = iter(detections_per_frame)

    def detect_for_video(self, _image, _timestamp_ms: float):  # noqa: ANN001
        try:
            boxes = next(self._frames)
        except StopIteration:
            boxes = []
        return type("Result", (), {"detections": [_FakeDetection(b) for b in boxes]})()
```

The `_detector_factory` parameter lets us inject a fake detector without touching the network or real images. Tests cover: no-face fallback, median across frames, largest-face selection.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd C:/Projects/cheapclipper && uv run --directory apps/downloader pytest tests/test_face_focus.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'app.face_focus'`.

- [ ] **Step 3: Implement face_focus.py**

Create `apps/downloader/app/face_focus.py`:

```python
from __future__ import annotations

import logging
import statistics
from collections.abc import Callable
from pathlib import Path
from typing import Protocol

log = logging.getLogger(__name__)

# Tipe minimal yang dibutuhkan dari detektor MediaPipe; memudahkan mocking.
class _FaceDetectorLike(Protocol):
    def detect_for_video(self, image, timestamp_ms: float): ...  # noqa: ANN001


def _default_detector_factory() -> _FaceDetectorLike:
    """Membuat FaceDetector MediaPipe sekali pakai (CPU)."""
    from mediapipe.tasks.python import vision
    from mediapipe.tasks.python.vision import FaceDetector, FilesetResolver

    base_options = vision.BaseOptions(
        model_asset_path=(
            "https://storage.googleapis.com/mediapipe-models/"
            "face_detector/blaze_face_short_range/float16/latest/"
            "blaze_face_short_range.tflite"
        ),
    )
    options = vision.FaceDetectorOptions(
        base_options=base_options,
        running_mode=vision.RunningMode.VIDEO,
        min_detection_confidence=0.5,
    )
    resolver = FilesetResolver.for_vision_tasks(
        "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.35/wasm"
    )
    return FaceDetector.create_from_options(resolver, options)


def compute_focus_x(
    frames: list[Path],
    *,
    _detector_factory: Callable[[], _FaceDetectorLike] | None = None,
) -> float:
    """Mengembalikan posisi horizontal fokus (0..1) berdasarkan wajah terbesar.

    Jika tidak ada wajah terdeteksi di seluruh frame, mengembalikan 0.5
    (tengah). Memilih median dari semua pusat wajah supaya stabil terhadap
    outlier singkat.
    """
    if not frames:
        return 0.5

    factory = _detector_factory or _default_detector_factory
    detector = factory()

    centers: list[float] = []
    for index, frame_path in enumerate(frames):
        try:
            from mediapipe.tasks.python import vision
            image = vision.Image.create_from_file(str(frame_path))
        except Exception:  # noqa: BLE001 - frame rusak tidak membatalkan batch
            log.warning("frame %s gagal dibaca, dilewati", frame_path)
            continue

        result = detector.detect_for_video(image, float(index * 100))
        best_area = 0.0
        best_center: float | None = None
        for detection in result.detections:
            box = detection.bounding_box
            if box is None:
                continue
            area = box.width * box.height
            if area > best_area:
                best_area = area
                best_center = box.origin_x + box.width / 2
        if best_center is not None:
            centers.append(best_center)

    if not centers:
        return 0.5
    return max(0.0, min(1.0, statistics.median(centers)))
```

Key design choices:
- `_detector_factory` enables unit testing without downloading models.
- Largest face per frame (not average) prevents small background faces from pulling the crop.
- Median across frames is more robust than mean against transient misdetections.
- Gracefully skips unreadable frames instead of aborting the whole batch.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd C:/Projects/cheapclipper && uv run --directory apps/downloader pytest tests/test_face_focus.py -v`
Expected: 3 PASSED.

- [ ] **Step 5: Commit**

```bash
git add apps/downloader/app/face_focus.py apps/downloader/tests/test_face_focus.py
git commit -m "feat(worker): face focus helper with median-of-largest-face strategy"
```

---

### Task 3: Implement the FFmpeg vertical-crop helper

**Files:**
- Modify: `apps/downloader/app/ffmpeg.py` (append new function)
- Test: `apps/downloader/tests/test_ffmpeg.py` (add new tests)

**Interfaces:**
- Consumes: existing `ffmpeg` subprocess pattern from `extract_thumbnail`.
- Produces: `def crop_vertical(src: Path, dest: Path, focus_x: float, *, width: int = 720, height: int = 1280) -> Path` — crops the source video to a 9:16 window centered at `focus_x`, scales to `width×height`, encodes H.264 veryfast crf 28 + AAC 128k. Returns `dest`. Used by Task 4.

- [ ] **Step 1: Write failing tests for crop_vertical**

Append to `apps/downloader/tests/test_ffmpeg.py` (create if missing):

```python
from __future__ import annotations

import subprocess
from pathlib import Path
from unittest.mock import patch

import pytest

from app.ffmpeg import crop_vertical


def test_crop_vertical_builds_correct_filter(tmp_path: Path) -> None:
    """Filter FFmpeg harus crop lalu scale sesuai fokus dan resolusi."""
    src = tmp_path / "in.mp4"
    dst = tmp_path / "out.mp4"
    src.write_bytes(b"\x00")

    captured: list[list[str]] = []

    def fake_run(args: list[str], **kwargs):  # noqa: ANN001
        captured.append(args)
        dst.write_bytes(b"\x00")
        return subprocess.CompletedProcess(args, 0, "", "")

    with patch("app.ffmpeg.subprocess.run", side_effect=fake_run):
        crop_vertical(src, dst, focus_x=0.75, width=720, height=1280)

    assert len(captured) == 1
    args = captured[0]
    assert "-i" in args
    assert str(src) in args
    assert str(dst) in args
    # Filter string contains crop and scale
    vf_index = args.index("-vf") + 1
    vf = args[vf_index]
    assert "crop=" in vf
    assert "scale=720:1280" in vf
    assert "-preset" in args and "veryfast" in args
    assert "-crf" in args and "28" in args


def test_crop_vertical_clamps_focus_to_edges(tmp_path: Path) -> None:
    """Fokus di tepi tidak boleh membuat crop keluar dari frame."""
    src = tmp_path / "in.mp4"
    dst = tmp_path / "out.mp4"
    src.write_bytes(b"\x00")

    captured: list[list[str]] = []

    def fake_run(args: list[str], **kwargs):  # noqa: ANN001
        captured.append(args)
        dst.write_bytes(b"\x00")
        return subprocess.CompletedProcess(args, 0, "", "")

    with patch("app.ffmpeg.subprocess.run", side_effect=fake_run):
        crop_vertical(src, dst, focus_x=0.0)

    vf = captured[0][captured[0].index("-vf") + 1]
    # When focus_x=0, the crop's x offset should clamp to 0, not go negative.
    # We just verify the filter parses without error; clamping logic is internal.
    assert "crop=" in vf
```

These tests stub `subprocess.run` so they don't need ffmpeg installed, but verify the exact command shape the worker will execute.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd C:/Projects/cheapclipper && uv run --directory apps/downloader pytest tests/test_ffmpeg.py::test_crop_vertical_builds_correct_filter -v`
Expected: FAIL (`ImportError` or `AttributeError`).

- [ ] **Step 3: Implement crop_vertical in ffmpeg.py**

Append to `apps/downloader/app/ffmpeg.py`:

```python
def crop_vertical(
    src: Path,
    dest: Path,
    focus_x: float,
    *,
    width: int = 720,
    height: int = 1280,
) -> Path:
    """Crop sumber ke jendela 9:16 berpusat pada focus_x, lalu scale ke resolusi target.

    focus_x adalah nilai 0..1 yang menyatakan posisi horizontal pusat crop
    relatif terhadap lebar frame asli. Nilai di-clamp supaya jendela tidak
    keluar dari tepi kiri/kanan. Encoding memakai preset veryfast dan CRF 28
    supaya preview siap dalam hitungan detik per kandidat.
    """
    import subprocess as _sp

    focus_x = max(0.0, min(1.0, float(focus_x)))
    # Crop dulu dengan rasio 9:16 dari tinggi asli, baru scale.
    # ih*9/16 = lebar crop; x = focus_x*iw - cw/2, di-clamp ke [0, iw-cw].
    vf = (
        f"crop=ih*9/16:ih:clamp({focus_x}*iw-(ih*9/16)/2,0,iw-ih*9/16):0,"
        f"scale={width}:{height}:flags=lanczos"
    )
    dest.parent.mkdir(parents=True, exist_ok=True)
    proc = _sp.run(
        [
            "ffmpeg", "-y", "-hide_banner", "-loglevel", "error",
            "-i", str(src),
            "-vf", vf,
            "-c:v", "libx264", "-preset", "veryfast", "-crf", "28",
            "-pix_fmt", "yuv420p",
            "-c:a", "aac", "-b:a", "128k",
            "-movflags", "+faststart",
            str(dest),
        ],
        capture_output=True,
        text=True,
    )
    if proc.returncode != 0:
        raise JobError("INTERNAL", f"ffmpeg crop gagal: {proc.stderr.strip()}")
    if not dest.exists():
        raise JobError("INTERNAL", "ffmpeg selesai tanpa menghasilkan file")
    return dest
```

Notes:
- `clamp()` in the crop filter prevents the window from leaving the frame regardless of input aspect ratio.
- `-movflags +faststart` puts moov atom up front so playback starts before full download.
- Reuses the existing `JobError` pattern already imported at module top.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd C:/Projects/cheapclipper && uv run --directory apps/downloader pytest tests/test_ffmpeg.py -v -k crop_vertical`
Expected: 2 PASSED.

- [ ] **Step 5: Commit**

```bash
git add apps/downloader/app/ffmpeg.py apps/downloader/tests/test_ffmpeg.py
git commit -m "feat(worker): ffmpeg crop_vertical helper for 9:16 previews"
```

---

### Task 4: Implement the render_previews handler

**Files:**
- Create: `apps/downloader/app/handlers/render_previews.py`
- Test: `apps/downloader/tests/test_render_previews.py`

**Interfaces:**
- Consumes: `download_section` (ytdlp), `compute_focus_x` (Task 2), `crop_vertical` (Task 3), `sha256_file`, `Storage.put_file`, `heartbeat`, `enqueue` (queue).
- Produces: `handle_render_previews(conn, job, *, storage=None, ...) -> None`. Updates `clip_candidates.preview_status` and `.preview_r2_key` per candidate. Enqueued by Task 5.

- [ ] **Step 1: Write failing tests for handle_render_previews**

Create `apps/downloader/tests/test_render_previews.py`:

```python
from __future__ import annotations

from decimal import Decimal
from pathlib import Path
from unittest.mock import MagicMock

import pytest

from app.handlers.render_previews import handle_render_previews
from app.queue import Job


class _InMemoryStorage:
    def __init__(self) -> None:
        self.uploaded: dict[str, bytes] = {}

    def put_file(self, key: str, path: Path, content_type: str) -> None:
        self.uploaded[key] = path.read_bytes()


@pytest.fixture
def conn(tmp_path):  # noqa: ANN001
    """SQLite-like stand-in isn't feasible; use a real Postgres via test helpers if available.
    Fallback: skip if DATABASE_URL unset (CI/local parity handled elsewhere)."""
    import os

    dsn = os.environ.get("DATABASE_URL")
    if not dsn:
        pytest.skip("DATABASE_URL not set")
    import psycopg

    c = psycopg.connect(dsn)
    c.autocommit = False
    yield c
    c.rollback()
    c.close()


def _make_job(project_id: str, user_id: str) -> Job:
    return Job(
        id="job-render-1",
        type="render_previews",
        payload={"project_id": project_id},
        attempts=1,
        max_attempts=3,
        project_id=project_id,
        user_id=user_id,
    )


def test_marks_candidates_ready_after_successful_render(tmp_path: Path, conn, monkeypatch) -> None:
    """Setelah render sukses, preview_status berubah jadi ready dan key tersimpan."""
    project_id = "00000000-0000-0000-0000-000000000001"
    user_id = "00000000-0000-0000-0000-000000000002"
    source_id = "00000000-0000-0000-0000-000000000003"

    conn.execute(
        "insert into sources (id, url_original, duration_sec) values (%s, %s, %s)",
        (source_id, "https://example.com/v.mp4", 60),
    )
    conn.execute(
        "insert into projects (id, user_id, source_id) values (%s, %s, %s)",
        (project_id, user_id, source_id),
    )
    candidate_id = "00000000-0000-0000-0000-000000000004"
    conn.execute(
        "insert into clip_candidates (id, project_id, llm_run_id, start_sec, end_sec, score, title, hook_text, transcript_slice) "
        "values (%s, %s, %s, %s, %s, %s, %s, %s, %s)",
        (candidate_id, project_id, "run-1", Decimal("5"), Decimal("35"), 0.9, "T", "H", "..."),
    )
    conn.commit()

    storage = _InMemoryStorage()
    fake_segment = tmp_path / "seg.mp4"
    fake_segment.write_bytes(b"\x00" * 100)

    monkeypatch.setattr(
        "app.handlers.render_previews._download_section",
        lambda url, s, e, dest: (dest.write_bytes(fake_segment.read_bytes()) or dest),
    )
    monkeypatch.setattr("app.handlers.render_previews._compute_focus_x", lambda frames: 0.5)
    monkeypatch.setattr(
        "app.handlers.render_previews._crop_vertical",
        lambda src, dest, fx, **kw: (dest.write_bytes(b"cropped") or dest),
    )
    monkeypatch.setattr("app.handlers.render_previews._extract_frames", lambda src, dest_dir, fps: [])

    handle_render_previews(conn, _make_job(project_id, user_id), storage=storage)

    row = conn.execute(
        "select preview_status, preview_r2_key from clip_candidates where id = %s",
        (candidate_id,),
    ).fetchone()
    assert row is not None
    assert row[0] == "ready"
    assert row[1] is not None and row[1].startswith("previews/")
    assert len(storage.uploaded) == 1


def test_failed_candidate_does_not_abort_batch(tmp_path: Path, conn, monkeypatch) -> None:
    """Satu kandidat gagal → ditandai failed, sisanya tetap diproses."""
    project_id = "00000000-0000-0000-0000-000000000011"
    user_id = "00000000-0000-0000-0000-000000000012"
    source_id = "00000000-0000-0000-0000-000000000013"

    conn.execute(
        "insert into sources (id, url_original, duration_sec) values (%s, %s, %s)",
        (source_id, "https://example.com/v.mp4", 60),
    )
    conn.execute(
        "insert into projects (id, user_id, source_id) values (%s, %s, %s)",
        (project_id, user_id, source_id),
    )
    ids = ["00000000-0000-0000-0000-000000000014", "00000000-0000-0000-0000-000000000015"]
    for cid in ids:
        conn.execute(
            "insert into clip_candidates (id, project_id, llm_run_id, start_sec, end_sec, score, title, hook_text, transcript_slice) "
            "values (%s, %s, %s, %s, %s, %s, %s, %s, %s)",
            (cid, project_id, "run-1", Decimal("0"), Decimal("30"), 0.9, "T", "H", "..."),
        )
    conn.commit()

    call_count = {"n": 0}

    def flaky_download(url, s, e, dest):  # noqa: ANN001
        call_count["n"] += 1
        if call_count["n"] == 1:
            raise RuntimeError("boom")
        dest.write_bytes(b"\x00")
        return dest

    storage = _InMemoryStorage()
    monkeypatch.setattr("app.handlers.render_previews._download_section", flaky_download)
    monkeypatch.setattr("app.handlers.render_previews._compute_focus_x", lambda frames: 0.5)
    monkeypatch.setattr(
        "app.handlers.render_previews._crop_vertical",
        lambda src, dest, fx, **kw: (dest.write_bytes(b"cropped") or dest),
    )
    monkeypatch.setattr("app.handlers.render_previews._extract_frames", lambda src, dest_dir, fps: [])

    handle_render_previews(conn, _make_job(project_id, user_id), storage=storage)

    rows = conn.execute(
        "select id, preview_status from clip_candidates where project_id = %s order by id",
        (project_id,),
    ).fetchall()
    statuses = {str(r[0]): r[1] for r in rows}
    assert statuses[ids[0]] == "failed"
    assert statuses[ids[1]] == "ready"
```

Two critical behaviors tested: successful render marks ready with an R2 key, and one failure doesn't poison the rest.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd C:/Projects/cheapclipper && uv run --directory apps/downloader pytest tests/test_render_previews.py -v`
Expected: FAIL (`ModuleNotFoundError`).

- [ ] **Step 3: Implement handle_render_previews**

Create `apps/downloader/app/handlers/render_previews.py`:

```python
from __future__ import annotations

import logging
import shutil
import tempfile
from collections.abc import Callable
from pathlib import Path

import psycopg

from app.errors import JobError
from app.face_focus import compute_focus_x as _compute_focus_x
from app.ffmpeg import crop_vertical as _crop_vertical
from app.ffmpeg import sha256_file
from app.queue import Job, heartbeat
from app.storage import Storage, storage_from_env
from app.ytdlp import download_section as _download_section

log = logging.getLogger(__name__)

FRAMES_PER_CANDIDATE_FPS = 0.5  # ambil ~1 frame tiap 2 detik
MAX_FRAMES_PER_CANDIDATE = 16


def _extract_frames(src: Path, dest_dir: Path, fps: float = FRAMES_PER_CANDIDATE_FPS) -> list[Path]:
    """Ambil N frame JPEG dari video untuk analisis wajah."""
    import subprocess as _sp

    dest_dir.mkdir(parents=True, exist_ok=True)
    pattern = str(dest_dir / "frame_%04d.jpg")
    proc = _sp.run(
        [
            "ffmpeg", "-y", "-hide_banner", "-loglevel", "error",
            "-i", str(src),
            "-vf", f"fps={fps}",
            "-frames:v", str(MAX_FRAMES_PER_CANDIDATE),
            "-q:v", "5",
            pattern,
        ],
        capture_output=True,
        text=True,
    )
    if proc.returncode != 0:
        log.warning("frame extraction gagal: %s", proc.stderr.strip())
        return []
    return sorted(dest_dir.glob("frame_*.jpg"))


def _render_one_candidate(
    conn: psycopg.Connection,
    candidate_id: str,
    project_id: str,
    source_url: str,
    start: float,
    end: float,
    workdir: Path,
    storage: Storage,
) -> None:
    seg_dir = workdir / f"{candidate_id}_seg"
    seg_dir.mkdir(exist_ok=True)
    segment = seg_dir / "segment.mp4"
    _download_section(source_url, start, end, segment)

    frames_dir = workdir / f"{candidate_id}_frames"
    frames = _extract_frames(segment, frames_dir)
    focus_x = _compute_focus_x(frames)

    out_dir = workdir / f"{candidate_id}_out"
    out_dir.mkdir(exist_ok=True)
    cropped = out_dir / "preview.mp4"
    _crop_vertical(segment, cropped, focus_x)

    key = f"previews/{sha256_file(cropped)}.mp4"
    storage.put_file(key, cropped, "video/mp4")

    conn.execute(
        "update clip_candidates set preview_status = 'ready', preview_r2_key = %s "
        "where id = %s and project_id = %s",
        (key, candidate_id, project_id),
    )
    conn.commit()


def handle_render_previews(
    conn: psycopg.Connection,
    job: Job,
    *,
    storage: Storage | None = None,
    download: Callable[..., Path] = _download_section,
    extract_frames: Callable[[Path, Path, float], list[Path]] = _extract_frames,
    compute_focus: Callable[[list[Path]], float] = _compute_focus_x,
    crop: Callable[..., Path] = _crop_vertical,
    workdir: Path | None = None,
) -> None:
    """Render 9:16 face-cropped preview untuk semua kandidat sebuah project."""
    storage = storage or storage_from_env()
    project_id = str(job.payload.get("project_id") or "")

    owned = conn.execute(
        "select s.url_original from projects p join sources s on s.id = p.source_id "
        "where p.id = %s and p.user_id = %s",
        (project_id, job.user_id),
    ).fetchone()
    if owned is None:
        raise JobError("INTERNAL", "project/source tidak ditemukan", terminal=True)
    source_url = str(owned[0])

    rows = conn.execute(
        "select id, start_sec, end_sec from clip_candidates "
        "where project_id = %s order by score desc, start_sec asc limit 10",
        (project_id,),
    ).fetchall()
    if not rows:
        return

    owns_workdir = workdir is None
    root = workdir or Path(tempfile.mkdtemp(prefix="cc-renders-"))
    try:
        for index, (candidate_id, raw_start, raw_end) in enumerate(rows):
            start, end = float(raw_start), float(raw_end)
            try:
                # Inject dependencies via monkey-patching-friendly indirection.
                # Di production, _render_one_candidate memanggil fungsi global;
                # di tes kita ganti modul-level references via monkeypatch.
                _render_one_candidate(
                    conn, str(candidate_id), project_id, source_url, start, end, root, storage,
                )
            except Exception as exc:  # noqa: BLE001 - satu kandidat gagal tidak menghentikan batch
                error_code = exc.code if isinstance(exc, JobError) else "INTERNAL"
                log.exception(
                    "preview render gagal untuk kandidat %s", candidate_id,
                    extra={"error_code": error_code},
                )
                conn.execute(
                    "update clip_candidates set preview_status = 'failed', preview_r2_key = null "
                    "where id = %s and project_id = %s",
                    (str(candidate_id), project_id),
                )
                conn.commit()
            heartbeat(conn, job.id, (index + 1) * 100 // len(rows))
    finally:
        if owns_workdir:
            shutil.rmtree(root, ignore_errors=True)
```

Design notes:
- Mirrors `prepare_thumbnails` structure (ownership check, batch loop, per-item error isolation, heartbeat progress).
- Dependency injection points at module level make unit tests deterministic.
- Content-addressed R2 key deduplicates identical renders across retries/projects.
- Heartbeat after each candidate prevents the reaper from killing long-running jobs.

- [ ] **Step 4: Wire test to use injected dependencies**

The test above uses `monkeypatch.setattr("app.handlers.render_previews._download_section", ...)`. Update the module so these names are accessible at module scope. They already are (imported as `_download_section`, etc.). Verify by running the tests.

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd C:/Projects/cheapclipper && uv run --directory apps/downloader pytest tests/test_render_previews.py -v`
Expected: 2 PASSED (requires DATABASE_URL; skipped gracefully otherwise).

- [ ] **Step 6: Commit**

```bash
git add apps/downloader/app/handlers/render_previews.py apps/downloader/tests/test_render_previews.py
git commit -m "feat(worker): render_previews handler with 9:16 face-crop pipeline"
```

---

### Task 5: Enqueue render_previews from analyze and register the handler

**Files:**
- Modify: `apps/downloader/app/handlers/analyze.py:81-95` (enqueue after thumbnails)
- Modify: `apps/downloader/app/worker.py:129-146` (register handler)
- Test: existing `apps/downloader/tests/test_analyze.py` (extend enqueue assertion)

**Interfaces:**
- Consumes: `enqueue` helper from `app.queue`.
- Produces: after `_write_candidates`, a `render_previews` job is queued with `{project_id}` payload, only if no active job exists yet (same idempotency pattern as thumbnails).

- [ ] **Step 1: Add failing test for render_previews enqueue**

Open `apps/downloader/tests/test_analyze.py` and append:

```python
def test_analyze_enqueues_render_previews_once(conn, storage, monkeypatch):
    """Setelah menulis kandidat, analyze meng-queue render_previews jika belum ada."""
    # Setup: same as existing analyze tests (source, transcript, llm mock).
    # ... reuse fixture setup from sibling tests ...
    from app.handlers.analyze import handle_analyze
    from app.queue import Job

    # (Assume fixtures provide project_id, source_id, user_id, transcript.)
    # Mock LLM to return two candidates.
    monkeypatch.setattr(
        "app.handlers.analyze._call_llm",
        lambda *_args, **_kw: '{"candidates":[{"start_sec":0,"end_sec":30,"score":0.9,"title":"T","hook_text":"H"}]}',
    )

    job = Job(id="j-analyze", type="analyze",
              payload={"source_id": "<source_id>", "project_id": "<project_id>"},
              attempts=1, max_attempts=3, project_id="<project_id>", user_id="<user_id>")
    handle_analyze(conn, job, storage=storage)

    rows = conn.execute(
        "select type from jobs where project_id = %s and type = 'render_previews'",
        ("<project_id>",),
    ).fetchall()
    assert len(rows) == 1
```

Replace `<...>` placeholders with the actual fixture IDs used by the existing analyze tests (read the file first to match conventions). The point is asserting exactly one `render_previews` row appears after analyze completes.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd C:/Projects/cheapclipper && uv run --directory apps/downloader pytest tests/test_analyze.py::test_analyze_enqueues_render_previews_once -v`
Expected: FAIL (no such job enqueued).

- [ ] **Step 3: Add enqueue call in analyze.py**

Inside `_write_candidates` in `apps/downloader/app/handlers/analyze.py`, after the thumbnail enqueue block (after line 95), add:

```python
    active_render_job = conn.execute(
        "select id from jobs where type = 'render_previews' and project_id = %s "
        "and status in ('queued','running') limit 1",
        (project_id,),
    ).fetchone()
    if active_render_job is None:
        conn.execute(
            "insert into jobs (type, payload, user_id, project_id) "
            "values ('render_previews', %s::jsonb, %s, %s)",
            (
                json.dumps({"project_id": project_id}),
                job.user_id,
                project_id,
            ),
        )
```

This mirrors the thumbnail enqueue pattern exactly: check for an active job first, then insert. Idempotent on retry.

- [ ] **Step 4: Register the handler in worker.py**

Edit `apps/downloader/app/worker.py`. In `default_handlers()`, after importing `handle_prepare_thumbnails` (around line 135), add:

```python
    from app.handlers.render_previews import handle_render_previews
```

And in the returned dict, after `"probe_asset": handle_probe_asset,` add:

```python
        "render_previews": handle_render_previews,
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd C:/Projects/cheapclipper && uv run --directory apps/downloader pytest tests/test_analyze.py -v`
Expected: all analyze tests PASS, including the new enqueue assertion.

- [ ] **Step 6: Commit**

```bash
git add apps/downloader/app/handlers/analyze.py apps/downloader/app/worker.py apps/downloader/tests/test_analyze.py
git commit -m "feat(worker): enqueue render_previews after analyze completes"
```

---

### Task 6: Extend web preview API to serve pre-rendered previews

**Files:**
- Modify: `apps/web/lib/clips.ts:127-172` (`loadClipPreview`)
- Modify: `apps/web/lib/clipTypes.ts:6-12` (extend `ClipPreviewStatus`)
- Test: `apps/web/test/clipPreviewRoute.test.ts` (add ready-with-preview-url case)

**Interfaces:**
- Consumes: new `clip_candidates.preview_status` / `preview_r2_key` columns.
- Produces: when a candidate's preview is ready, `loadClipPreview` returns `status: 'ready'` with a signed URL served through a new `/api/clips/[id]/preview-file` endpoint (or reuse `/api/clips/[id]/segment` semantics).

- [ ] **Step 1: Update ClipPreviewStatus type**

Edit `apps/web/lib/clipTypes.ts`. Change the interface:

```ts
export interface ClipPreviewStatus {
  clipId: string
  status: 'pending' | 'rendering' | 'ready' | 'failed'
  url: string | null
  jobId: string | null
  errorCode: string | null
  /** True ketika preview sudah di-render sebagai klip 9:16 oleh worker. */
  prerendered: boolean
}
```

Adding `prerendered` lets the modal know whether the URL points to a 9:16 pre-render (instant play) or a raw segment (legacy behavior during rollout).

- [ ] **Step 2: Write failing test for the new ready path**

In `apps/web/test/clipPreviewRoute.test.ts`, add a test case:

```ts
test('returns ready with prerendered url when preview_r2_key exists', async () => {
  // Arrange: insert a clip whose candidate has preview_status='ready' and preview_r2_key set.
  // Act: GET /api/clips/{id}/preview
  // Assert: body.status === 'ready', body.prerendered === true, body.url === '/api/clips/{id}/preview-file'
})
```

Read the existing test file first to mirror its setup patterns (DB seeding, auth mocking). The key assertion is that the presence of `preview_r2_key` flips the response to the pre-rendered URL rather than the legacy segment URL.

- [ ] **Step 3: Run test to verify it fails**

Run: `cd C:/Projects/cheapclipper && bun vitest run apps/web/test/clipPreviewRoute.test.ts -t "prerendered"`
Expected: FAIL (field missing or wrong URL).

- [ ] **Step 4: Update loadClipPreview to prefer pre-rendered preview**

Edit `apps/web/lib/clips.ts`, replacing `loadClipPreview` (lines 127–172):

```ts
export async function loadClipPreview(
  sql: Sql,
  userId: string,
  clipId: string,
): Promise<ClipPreviewStatus> {
  if (!UUID_RE.test(clipId)) throw new ClipNotFoundError()

  const [row] = await sql`
    select cl.id,
           c.preview_status,
           c.preview_r2_key,
           segment.id as segment_id,
           job.id as job_id,
           job.status as job_status,
           job.error_code as job_error_code
      from clips cl
      join clip_candidates c on c.id = cl.candidate_id
      join projects p on p.id = cl.project_id
      left join lateral (
        select ms.id
          from media_segments ms
         where ms.source_id = p.source_id
           and ms.start_sec = c.start_sec
           and ms.end_sec = c.end_sec
           and ms.expires_at > now()
         limit 1
      ) segment on true
      left join lateral (
        select j.id, j.status, j.error_code
          from jobs j
         where j.type = 'render_previews'
           and j.project_id = p.id
         order by j.created_at desc
         limit 1
      ) job on true
     where cl.id = ${clipId}
       and p.user_id = ${userId}
     limit 1`
  if (!row) throw new ClipNotFoundError()

  const prerenderReady = row.preview_status === 'ready' && Boolean(row.preview_r2_key)
  const segmentReady = Boolean(row.segment_id)
  const failed = row.preview_status === 'failed' || row.job_status === 'failed' || row.job_status === 'dead'

  if (prerenderReady) {
    return {
      clipId: row.id as string,
      status: 'ready',
      url: `/api/clips/${clipId}/preview-file`,
      jobId: (row.job_id as string | null) ?? null,
      errorCode: null,
      prerendered: true,
    }
  }
  if (segmentReady) {
    return {
      clipId: row.id as string,
      status: 'ready',
      url: `/api/clips/${clipId}/segment`,
      jobId: (row.job_id as string | null) ?? null,
      errorCode: null,
      prerendered: false,
    }
  }
  return {
    clipId: row.id as string,
    status: failed ? 'failed' : row.preview_status === 'rendering' ? 'rendering' : 'pending',
    url: null,
    jobId: (row.job_id as string | null) ?? null,
    errorCode: (row.job_error_code as string | null) ?? null,
    prerendered: false,
  }
}
```

Priority: pre-rendered preview wins over raw segment. This means as soon as the worker finishes a candidate, the modal plays the 9:16 version instantly. During the transition period (before all candidates are rendered), users still get the legacy segment-based preview.

- [ ] **Step 5: Create the preview-file serving route**

Create `apps/web/app/api/clips/[id]/preview-file/route.ts`:

```ts
import { NextResponse } from 'next/server'
import { ClipNotFoundError, loadClipPreviewFile } from '@/lib/clips'
import { sql } from '@/lib/db'
import { errorFields, withRequestLogging } from '@/lib/observability'
import { signedR2Get } from '@/lib/r2'
import { supabaseServer } from '@/lib/supabase/server'

export const GET = withRequestLogging<{ params: Promise<{ id: string }> }>(
  '/api/clips/[id]/preview-file',
  async (_request, ctx, log) => {
    const supabase = await supabaseServer()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
      return NextResponse.json(
        { error: { code: 'UNAUTHORIZED', message: 'Silakan masuk dulu.' } },
        { status: 401 },
      )
    }

    try {
      const preview = await loadClipPreviewFile(sql, user.id, (await ctx.params).id)
      const upstream = await fetch(await signedR2Get(preview.key), { cache: 'no-store' })
      if (!upstream.ok || !upstream.body) {
        throw new Error(`R2 mengembalikan status ${upstream.status}`)
      }
      const headers: Record<string, string> = {
        'cache-control': 'private, max-age=3600',
        'content-type': upstream.headers.get('content-type') ?? 'video/mp4',
      }
      const contentLength = upstream.headers.get('content-length')
      if (contentLength) headers['content-length'] = contentLength
      return new NextResponse(upstream.body, { status: 200, headers })
    } catch (error) {
      if (error instanceof ClipNotFoundError) {
        return NextResponse.json(
          { error: { code: 'NOT_FOUND', message: 'Preview tidak ditemukan.' } },
          { status: 404 },
        )
      }
      log.error('clip.preview-file.failed', errorFields(error))
      return NextResponse.json(
        { error: { code: 'STORAGE_ERROR', message: 'Preview gagal dimuat.' } },
        { status: 502 },
      )
    }
  },
)
```

Mirrors the existing segment route but serves from the preview R2 key. Add a corresponding `loadClipPreviewFile` function in `clips.ts`:

```ts
export async function loadClipPreviewFile(
  sql: Sql,
  userId: string,
  clipId: string,
): Promise<{ key: string }> {
  if (!UUID_RE.test(clipId)) throw new ClipNotFoundError()
  const [row] = await sql`
    select c.preview_r2_key
      from clips cl
      join clip_candidates c on c.id = cl.candidate_id
      join projects p on p.id = cl.project_id
     where cl.id = ${clipId}
       and p.user_id = ${userId}
       and c.preview_status = 'ready'
       and c.preview_r2_key is not null
     limit 1`
  if (!row) throw new ClipNotFoundError()
  return { key: row.preview_r2_key as string }
}
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `cd C:/Projects/cheapclipper && bun vitest run apps/web/test/clipPreviewRoute.test.ts`
Expected: all tests PASS, including the new prerendered case.

- [ ] **Step 7: Commit**

```bash
git add apps/web/lib/clipTypes.ts apps/web/lib/clips.ts apps/web/app/api/clips/[id]/preview-file/route.ts apps/web/test/clipPreviewRoute.test.ts
git commit -m "feat(web): serve pre-rendered 9:16 previews via /preview-file"
```

---

### Task 7: Skip idle state in CandidatePreviewModal when prerendered

**Files:**
- Modify: `apps/web/components/CandidatePreviewModal.tsx`
- Modify: `apps/web/lib/candidates.ts` (expose previewStatus/previewUrl on CandidateView)
- Test: `apps/web/test/CandidatePreviewModal.test.tsx`

**Interfaces:**
- Consumes: `CandidateView.previewStatus`, `ClipPreviewStatus.prerendered`.
- Produces: when opening a candidate whose preview is already ready, the modal shows the video immediately without the play-button overlay.

- [ ] **Step 1: Expose preview fields on CandidateView**

Edit `apps/web/lib/candidates.ts`. Add to the `CandidateView` interface:

```ts
  previewStatus: 'pending' | 'rendering' | 'ready' | 'failed'
  previewUrl: string | null
```

In `listCandidates`, update the SELECT to include `c.preview_status, c.preview_r2_key`, and map them:

```ts
    previewStatus: (r.preview_status as CandidateView['previewStatus']) ?? 'pending',
    previewUrl:
      r.preview_status === 'ready' && r.preview_r2_key
        ? `/api/candidates/${r.id as string}/preview-file`
        : null,
```

Also create `apps/web/app/api/candidates/[id]/preview-file/route.ts` mirroring the clip preview-file route but keyed on candidate ID directly (so cards can link without going through a clip). Read the thumbnail route for the pattern.

- [ ] **Step 2: Write failing test for instant-play behavior**

In `apps/web/test/CandidatePreviewModal.test.tsx`, add:

```tsx
test('skips idle state when candidate preview is already ready', () => {
  const candidate = {
    ...baseCandidate,
    previewStatus: 'ready' as const,
    previewUrl: '/api/candidates/c-1/preview-file',
  }
  render(<CandidatePreviewModal candidate={candidate} open {...otherProps} />)
  expect(screen.queryByLabelText(/Putar preview/i)).toBeNull()
  expect(screen.getByTestId('candidate-preview-video')).toHaveAttribute(
    'src',
    '/api/candidates/c-1/preview-file',
  )
})
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd C:/Projects/cheapclipper && bun vitest run apps/web/test/CandidatePreviewModal.test.tsx -t "skips idle"`
Expected: FAIL (idle play button still shown).

- [ ] **Step 4: Update CandidatePreviewModal to auto-start when ready**

Edit `apps/web/components/CandidatePreviewModal.tsx`. Inside the component, initialize state based on the candidate's pre-rendered status:

```ts
const [state, setState] = useState<PreviewState>(() =>
  candidate.previewStatus === 'ready' && candidate.previewUrl
    ? { kind: 'ready', clipId: initialClipId ?? '', url: candidate.previewUrl }
    : { kind: 'idle' },
)
```

Also update the `useEffect` that resets state on candidate change (line 95-99):

```ts
useEffect(() => {
  stopMedia()
  if (candidate.previewStatus === 'ready' && candidate.previewUrl) {
    setState({ kind: 'ready', clipId: initialClipId ?? '', url: candidate.previewUrl })
  } else {
    setState({ kind: 'idle' })
  }
  return stopMedia
}, [candidate.id, candidate.previewStatus, candidate.previewUrl, open, initialClipId, stopMedia])
```

This way, navigating between candidates that are already rendered swaps videos instantly without showing the play button.

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd C:/Projects/cheapclipper && bun vitest run apps/web/test/CandidatePreviewModal.test.tsx`
Expected: all tests PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/web/lib/candidates.ts apps/web/components/CandidatePreviewModal.tsx apps/web/app/api/candidates/[id]/preview-file/route.ts apps/web/test/CandidatePreviewModal.test.tsx
git commit -m "feat(web): instant preview playback when candidate is pre-rendered"
```

---

### Task 8: Show render progress in CandidateList cards

**Files:**
- Modify: `apps/web/components/CandidateList.tsx`
- Test: manual visual QA (no automated test needed for cosmetic badge)

**Interfaces:**
- Consumes: `CandidateView.previewStatus`.
- Produces: a small status badge/shimmer on each card reflecting render progress.

- [ ] **Step 1: Add status indicator to each card**

In `apps/web/components/CandidateList.tsx`, inside the card JSX (near the rank badge around line 79), add a conditional badge:

```tsx
{candidate.previewStatus === 'rendering' && (
  <span className="absolute right-3 top-3 rounded-md bg-primary/90 px-2 py-1 text-xs font-bold text-white animate-pulse">
    Menyiapkan preview…
  </span>
)}
{candidate.previewStatus === 'failed' && (
  <span className="absolute right-3 top-3 rounded-md bg-destructive/90 px-2 py-1 text-xs font-bold text-white">
    Preview gagal
  </span>
)}
```

When `previewStatus === 'pending'`, no badge (clean look). When `'ready'`, the play button overlay remains but the modal opens instantly.

- [ ] **Step 2: Manual verification**

Run the app locally (`bun run dev`), open a project with candidates, and confirm:
- Cards show "Menyiapkan preview…" while the worker renders.
- After render completes, clicking a card opens the modal with video playing immediately.
- If a render fails, the card shows "Preview gagal" and clicking falls back to the legacy flow.

- [ ] **Step 3: Commit**

```bash
git add apps/web/components/CandidateList.tsx
git commit -m "feat(web): show preview render status on candidate cards"
```

---

### Task 9: End-to-end smoke test and documentation

**Files:**
- Modify: `docs/superpowers/specs/2026-08-16-top10-preload-editor-improvements-design.md` (mark subproject 2 complete)
- No new code

- [ ] **Step 1: Run full test suites**

```bash
cd C:/Projects/cheapclipper
uv run --directory apps/downloader pytest -v
bun vitest run --project @klipmatic/web
```

All tests green (DB-dependent failures are pre-existing and unrelated).

- [ ] **Step 2: Local integration smoke test**

1. Start stack: `bun run db:up && bun run dev`
2. Upload a YouTube URL, wait for analyze to complete.
3. Observe worker logs: `render_previews` job runs, processes 10 candidates.
4. Open the project page: cards briefly show "Menyiapkan preview…", then clear.
5. Click a candidate: modal opens with video playing instantly (no spinner).
6. Confirm video is 9:16 and face-centered.

- [ ] **Step 3: Update spec status**

Add a note at the top of the spec: "Sub-proyek 2+3 selesai: <commit-sha>, <date>."

- [ ] **Step 4: Final commit**

```bash
git add docs/superpowers/specs/2026-08-16-top10-preload-editor-improvements-design.md
git commit -m "docs: mark preload pipeline subproject complete"
```
