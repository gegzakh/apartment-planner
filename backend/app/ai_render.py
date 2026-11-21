"""Photo-real room renders through Replicate's FLUX structure-control models.

The browser sends the exact 3D shot of a room; the model keeps its geometry (depth or edges)
and repaints it as a photograph following the prompt. The API token never leaves the server.
"""
from __future__ import annotations

import base64
import json
import os
import time
import uuid
from pathlib import Path

import httpx
from fastapi import APIRouter, File, Form, HTTPException, UploadFile
from pydantic import BaseModel

API = "https://api.replicate.com/v1"
MODELS = {
    "depth-pro": ("black-forest-labs/flux-depth-pro", lambda p, s: {"steps": 40, "guidance": 15, "output_format": "jpg", "safety_tolerance": 2}),
    "depth-dev": ("black-forest-labs/flux-depth-dev", lambda p, s: {"num_inference_steps": 30, "guidance": 10, "megapixels": "match_input", "output_format": "jpg", "output_quality": 92}),
    "canny-pro": ("black-forest-labs/flux-canny-pro", lambda p, s: {"steps": 40, "guidance": 25, "output_format": "jpg", "safety_tolerance": 2}),
}
MAX_CONTROL = 8 * 1024 * 1024
TIMEOUT_S = 240

router = APIRouter(prefix="/api/ai")
_files_dir: Path
_settings: Path


def init(data_dir: Path, files_dir: Path) -> None:
    global _files_dir, _settings
    _files_dir = files_dir
    _settings = data_dir / "settings.json"


def _saved() -> dict:
    try:
        return json.loads(_settings.read_text())
    except (OSError, ValueError):
        return {}


def _token() -> tuple[str | None, str | None]:
    if os.environ.get("REPLICATE_API_TOKEN"):
        return os.environ["REPLICATE_API_TOKEN"], "env"
    t = _saved().get("replicateToken")
    return (t, "app") if t else (None, None)


@router.get("/status")
def status():
    tok, src = _token()
    return {"configured": bool(tok), "source": src, "models": list(MODELS)}


class TokenBody(BaseModel):
    token: str


@router.put("/token")
def set_token(body: TokenBody):
    tok = body.token.strip()
    if not tok or len(tok) > 200:
        raise HTTPException(400, "Paste a Replicate API token")
    r = httpx.get(f"{API}/account", headers={"Authorization": f"Bearer {tok}"}, timeout=20)
    if r.status_code == 401:
        raise HTTPException(400, "Replicate rejected this token")
    s = _saved()
    s["replicateToken"] = tok
    tmp = _settings.with_suffix(".tmp")
    tmp.write_text(json.dumps(s))
    os.chmod(tmp, 0o600)
    tmp.replace(_settings)
    return status()


@router.delete("/token")
def clear_token():
    s = _saved()
    s.pop("replicateToken", None)
    _settings.write_text(json.dumps(s))
    return status()


def _error(r: httpx.Response) -> HTTPException:
    try:
        detail = r.json().get("detail") or r.text
    except ValueError:
        detail = r.text
    if r.status_code == 401:
        return HTTPException(400, "Replicate rejected the API token")
    if r.status_code == 402:
        return HTTPException(402, "Replicate account has no credit. Add billing at replicate.com/account/billing")
    if r.status_code == 429:
        return HTTPException(429, "Replicate rate limit reached, try again in a minute")
    return HTTPException(502, f"Replicate error {r.status_code}: {str(detail)[:300]}")


def _control_url(client: httpx.Client, data: bytes, mime: str) -> str:
    if len(data) <= 250_000:
        return f"data:{mime};base64,{base64.b64encode(data).decode()}"
    r = client.post(f"{API}/files", files={"content": ("shot.jpg", data, mime)})
    if r.status_code >= 300:
        raise _error(r)
    return r.json()["urls"]["get"]


def run_prediction(token: str, model: str, prompt: str, control: bytes, mime: str, seed: int | None) -> bytes:
    slug, extra = MODELS[model]
    with httpx.Client(headers={"Authorization": f"Bearer {token}"}, timeout=90) as client:
        inp = {"prompt": prompt, "control_image": _control_url(client, control, mime), **extra(prompt, seed)}
        if seed is not None:
            inp["seed"] = seed
        r = client.post(f"{API}/models/{slug}/predictions", json={"input": inp}, headers={"Prefer": "wait=55"})
        if r.status_code >= 300:
            raise _error(r)
        pred = r.json()
        end = time.time() + TIMEOUT_S
        while pred.get("status") not in ("succeeded", "failed", "canceled"):
            if time.time() > end:
                raise HTTPException(504, "Replicate took too long; try again")
            time.sleep(2)
            r = client.get(pred["urls"]["get"])
            if r.status_code >= 300:
                raise _error(r)
            pred = r.json()
        if pred["status"] != "succeeded":
            raise HTTPException(502, f"Render failed: {pred.get('error') or pred['status']}")
        out = pred.get("output")
        url = out[0] if isinstance(out, list) else out
        if not url:
            raise HTTPException(502, "Replicate returned no image")
        img = client.get(url, follow_redirects=True)
        if img.status_code >= 300:
            raise _error(img)
        return img.content


@router.post("/render")
def render(
    image: UploadFile = File(...),
    prompt: str = Form(..., max_length=4000),
    model: str = Form("depth-pro"),
    seed: int | None = Form(None),
):
    if model not in MODELS:
        raise HTTPException(400, "Unknown model")
    tok, _ = _token()
    if not tok:
        raise HTTPException(400, "Add a Replicate API token first (AI photo settings)")
    data = image.file.read(MAX_CONTROL + 1)
    if len(data) > MAX_CONTROL:
        raise HTTPException(413, "Shot image too large")
    if data[:3] == b"\xff\xd8\xff":
        mime = "image/jpeg"
    elif data[:8] == b"\x89PNG\r\n\x1a\n":
        mime = "image/png"
    else:
        raise HTTPException(400, "Shot must be JPEG or PNG")
    out = run_prediction(tok, model, prompt, data, mime, seed)
    ext = "png" if out[:4] == b"\x89PNG" else "jpg"
    fid = uuid.uuid4().hex[:16]
    (_files_dir / f"{fid}.{ext}").write_bytes(out)
    return {"url": f"/api/files/{fid}.{ext}"}
