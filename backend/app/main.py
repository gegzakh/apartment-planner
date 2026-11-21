"""Apartment Planner API: PDF/image import, overlay files and project storage."""
from __future__ import annotations

import json
import os
import re
import time
import uuid
from pathlib import Path

os.environ.setdefault("OPENCV_IO_MAX_IMAGE_PIXELS", str(60_000_000))

from fastapi import FastAPI, File, HTTPException, Query, UploadFile
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

from .pdf_import import parse_pdf, render_overlay_png

DATA_DIR = Path(os.environ.get("DATA_DIR", Path(__file__).resolve().parents[1] / "data"))
STATIC_DIR = Path(os.environ.get("STATIC_DIR", Path(__file__).resolve().parents[2] / "frontend" / "dist"))
FILES = DATA_DIR / "files"
PROJECTS = DATA_DIR / "projects"
MAX_UPLOAD = 40 * 1024 * 1024
SAFE_ID = re.compile(r"^[A-Za-z0-9_-]{1,64}$")
SAFE_FILE = re.compile(r"^[A-Za-z0-9_-]{1,64}\.(png|jpg|jpeg|pdf)$")

for d in (FILES, PROJECTS):
    d.mkdir(parents=True, exist_ok=True)

app = FastAPI(title="Apartment Planner")


def _check_id(pid: str) -> str:
    if not SAFE_ID.match(pid):
        raise HTTPException(400, "Invalid id")
    return pid


@app.get("/api/health")
def health():
    return {"ok": True}


MAX_PAGE_AREA_PT2 = 10_000_000  # a bit larger than A0 (3370 x 2384 pt)
MAX_PAGE_SIDE_PT = 5000


def _check_pdf_size(data: bytes, page_index: int = 0) -> None:
    import pymupdf

    try:
        doc = pymupdf.open(stream=data, filetype="pdf")
        r = doc[page_index].rect
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(400, f"Cannot read PDF: {exc}") from exc
    if max(r.width, r.height) > MAX_PAGE_SIDE_PT or r.width * r.height > MAX_PAGE_AREA_PT2:
        raise HTTPException(400, "PDF page is too large (max A0)")


@app.post("/api/import")
async def import_plan(
    file: UploadFile = File(...),
    kind: str = Query("general", pattern="^(general|electrical|plumbing)$"),
    scale: int | None = Query(None, ge=1, le=1000),
    detect: bool = Query(True),
):
    data = await file.read()
    if len(data) > MAX_UPLOAD:
        raise HTTPException(413, "File too large (max 40 MB)")
    name = (file.filename or "").lower()
    fid = uuid.uuid4().hex[:16]
    is_pdf = data[:5] == b"%PDF-" or name.endswith(".pdf")
    if is_pdf:
        _check_pdf_size(data)
        (FILES / f"{fid}.pdf").write_bytes(data)
        try:
            png = render_overlay_png(data)
        except Exception as exc:  # noqa: BLE001
            raise HTTPException(400, f"Cannot read PDF: {exc}") from exc
        (FILES / f"{fid}.png").write_bytes(png)
        result: dict = {"overlayUrl": f"/api/files/{fid}.png", "kind": kind, "detected": False}
        if detect and kind == "general":
            try:
                parsed = parse_pdf(data, scale=scale)
                result.update(parsed)
                result["detected"] = True
            except Exception as exc:  # noqa: BLE001
                result["warning"] = f"Automatic recognition failed ({exc}); the file is added as a tracing overlay."
        if "overlay" not in result:
            # place the page assuming 1:50 so it can be calibrated afterwards
            import pymupdf

            page = pymupdf.open(stream=data, filetype="pdf")[0]
            mpp = 25.4 / 72 * (scale or 50) / 1000
            result["overlay"] = {"x": 0, "y": 0, "width": page.rect.width * mpp, "height": page.rect.height * mpp}
            result["scale"] = scale or 50
        return result
    if data[:8] == b"\x89PNG\r\n\x1a\n" or data[:3] == b"\xff\xd8\xff":
        ext = "png" if data[:4] == b"\x89PNG" else "jpg"
        (FILES / f"{fid}.{ext}").write_bytes(data)
        import cv2
        import numpy as np

        try:
            img = cv2.imdecode(np.frombuffer(data, np.uint8), cv2.IMREAD_UNCHANGED)
        except cv2.error:
            img = None
        if img is None:
            raise HTTPException(400, "Unsupported or too large image (max 60 megapixels)")
        h, w = img.shape[:2]
        width_m = 10.0
        return {"overlayUrl": f"/api/files/{fid}.{ext}", "kind": kind, "detected": False,
                "overlay": {"x": 0, "y": 0, "width": width_m, "height": width_m * h / w},
                "warning": "Images are added as overlays. Use the Calibrate tool to set the real scale."}
    raise HTTPException(400, "Upload a PDF, PNG or JPG file")


@app.get("/api/files/{name}")
def get_file(name: str):
    if not SAFE_FILE.match(name):
        raise HTTPException(400, "Invalid file name")
    path = FILES / name
    if not path.exists():
        raise HTTPException(404, "Not found")
    return FileResponse(path, headers={"Cache-Control": "public, max-age=31536000, immutable"})


@app.get("/api/projects")
def list_projects():
    out = []
    for p in sorted(PROJECTS.glob("*.json"), key=lambda p: -p.stat().st_mtime):
        try:
            doc = json.loads(p.read_text())
        except json.JSONDecodeError:
            continue
        out.append({"id": p.stem, "name": doc.get("name", p.stem), "updatedAt": p.stat().st_mtime})
    return out


@app.get("/api/projects/{pid}")
def get_project(pid: str):
    path = PROJECTS / f"{_check_id(pid)}.json"
    if not path.exists():
        raise HTTPException(404, "Project not found")
    return JSONResponse(json.loads(path.read_text()))


@app.put("/api/projects/{pid}")
async def save_project(pid: str, body: dict):
    path = PROJECTS / f"{_check_id(pid)}.json"
    body["updatedAt"] = time.time()
    tmp = path.with_suffix(".tmp")
    tmp.write_text(json.dumps(body))
    tmp.replace(path)
    return {"id": pid, "updatedAt": body["updatedAt"]}


@app.delete("/api/projects/{pid}")
def delete_project(pid: str):
    path = PROJECTS / f"{_check_id(pid)}.json"
    if path.exists():
        path.unlink()
    return {"ok": True}


if STATIC_DIR.exists():
    app.mount("/assets", StaticFiles(directory=STATIC_DIR / "assets"), name="assets")

    @app.get("/{full_path:path}")
    def spa(full_path: str):
        if full_path == "api" or full_path.startswith("api/"):
            raise HTTPException(404, "Not found")
        target = (STATIC_DIR / full_path).resolve()
        if full_path and target.is_file() and STATIC_DIR.resolve() in target.parents:
            return FileResponse(target)
        return FileResponse(STATIC_DIR / "index.html")
