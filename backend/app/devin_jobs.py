"""AI photo jobs fulfilled by a Devin session.

The browser uploads 3D shots plus prompts as a job; the server messages the Devin session
through the Devin API. Devin generates the photos and uploads them back to the job.
"""
from __future__ import annotations

import json
import os
import re
import threading
import time
import uuid
from pathlib import Path

import httpx
from fastapi import APIRouter, File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse

API = "https://api.devin.ai/v3"
MAX_SHOT = 8 * 1024 * 1024
MAX_ITEMS = 60
JOB_ID = re.compile(r"^[a-f0-9]{12}$")

router = APIRouter(prefix="/api/devin")
_lock = threading.Lock()
_files_dir: Path
_jobs_dir: Path


def init(data_dir: Path, files_dir: Path) -> None:
    global _files_dir, _jobs_dir
    _files_dir = files_dir
    _jobs_dir = data_dir / "devin_jobs"
    _jobs_dir.mkdir(parents=True, exist_ok=True)


def _cfg() -> tuple[str, str, str] | None:
    key, org, sess = (os.environ.get(k) for k in ("DEVIN_API_KEY", "DEVIN_ORG_ID", "DEVIN_SESSION_ID"))
    return (key, org, sess) if key and org and sess else None


def _path(job_id: str) -> Path:
    if not JOB_ID.match(job_id):
        raise HTTPException(400, "Invalid job id")
    p = _jobs_dir / job_id / "job.json"
    if not p.exists():
        raise HTTPException(404, "Job not found")
    return p


def _load(job_id: str) -> dict:
    return json.loads(_path(job_id).read_text())


def _save(job: dict) -> None:
    p = _jobs_dir / job["id"] / "job.json"
    tmp = p.with_suffix(".tmp")
    tmp.write_text(json.dumps(job, indent=1))
    tmp.replace(p)


def _mime(data: bytes) -> str:
    if data[:3] == b"\xff\xd8\xff":
        return "jpg"
    if data[:8] == b"\x89PNG\r\n\x1a\n":
        return "png"
    raise HTTPException(400, "Image must be JPEG or PNG")


def notify(job: dict) -> str | None:
    """Messages the Devin session; returns an error text or None."""
    cfg = _cfg()
    if not cfg:
        return "Devin API key not configured"
    key, org, sess = cfg
    folder = _jobs_dir / job["id"]
    msg = (
        f"Apartment planner AI photo job {job['id']}: {len(job['items'])} photo(s). "
        f"Job file: {folder / 'job.json'} (each item has its 3D shot path and prompt). "
        f"For each item, generate a photorealistic image with the shot as input image and the prompt, "
        f"then upload it with: curl -F image=@<file> http://localhost:{os.environ.get('PORT', '8080')}"
        f"/api/devin/jobs/{job['id']}/items/<index>"
    )
    try:
        r = httpx.post(
            f"{API}/organizations/{org}/sessions/{sess}/messages",
            json={"message": msg},
            headers={"Authorization": f"Bearer {key}"},
            timeout=20,
        )
    except httpx.HTTPError as e:
        return f"Could not reach Devin: {e}"
    if r.status_code >= 300:
        return f"Devin API error {r.status_code}"
    return None


def _public(job: dict) -> dict:
    return {
        "id": job["id"],
        "created": job["created"],
        "notified": job.get("notified", False),
        "notifyError": job.get("notifyError"),
        "items": [{k: it.get(k) for k in ("index", "name", "room", "result", "error")} for it in job["items"]],
    }


@router.get("/status")
def status():
    return {"configured": _cfg() is not None}


@router.post("/jobs")
def create_job(images: list[UploadFile] = File(...), meta: str = Form(...)):
    try:
        items = json.loads(meta)
        assert isinstance(items, list) and len(items) == len(images)
    except (ValueError, AssertionError):
        raise HTTPException(400, "meta must be a JSON list with one entry per image")
    if not items or len(items) > MAX_ITEMS:
        raise HTTPException(400, f"Send 1–{MAX_ITEMS} images")
    job_id = uuid.uuid4().hex[:12]
    folder = _jobs_dir / job_id
    folder.mkdir()
    out = []
    for i, (img, it) in enumerate(zip(images, items)):
        data = img.file.read(MAX_SHOT + 1)
        if len(data) > MAX_SHOT:
            raise HTTPException(413, "Shot image too large")
        shot = folder / f"shot-{i}.{_mime(data)}"
        shot.write_bytes(data)
        out.append({
            "index": i,
            "name": str(it.get("name", ""))[:200],
            "room": str(it.get("room", ""))[:200],
            "prompt": str(it.get("prompt", ""))[:4000],
            "shot": str(shot),
            "result": None,
        })
    job = {"id": job_id, "created": time.time(), "items": out}
    err = notify(job)
    job["notified"] = err is None
    job["notifyError"] = err
    _save(job)
    return _public(job)


@router.get("/jobs/{job_id}")
def get_job(job_id: str):
    return _public(_load(job_id))


@router.post("/jobs/{job_id}/items/{index}")
def put_result(job_id: str, index: int, image: UploadFile = File(...)):
    if not 0 <= index < len(_load(job_id)["items"]):
        raise HTTPException(404, "No such item")
    data = image.file.read(MAX_SHOT * 4 + 1)
    if len(data) > MAX_SHOT * 4:
        raise HTTPException(413, "Image too large")
    name = f"{uuid.uuid4().hex[:16]}.{_mime(data)}"
    (_files_dir / name).write_bytes(data)
    with _lock:
        job = _load(job_id)
        job["items"][index]["result"] = f"/api/files/{name}"
        job["items"][index]["error"] = None
        _save(job)
    return _public(job)


@router.get("/jobs/{job_id}/shots/{index}")
def get_shot(job_id: str, index: int):
    items = _load(job_id)["items"]
    if not 0 <= index < len(items):
        raise HTTPException(404, "No such item")
    return FileResponse(items[index]["shot"])
