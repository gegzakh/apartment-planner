import json
from pathlib import Path

from fastapi.testclient import TestClient

from app.main import app
from app.pdf_import import parse_pdf, polygon_area

SAMPLE = Path(__file__).resolve().parents[2] / "samples" / "sample-plan.pdf"


def test_parse_sample_plan():
    plan = parse_pdf(SAMPLE.read_bytes())
    assert plan["scale"] == 50
    stats = plan["stats"]
    assert stats["doors"] == 6
    assert stats["windows"] == 3
    assert stats["rooms"] >= 5
    assert 15 <= stats["walls"] <= 40
    doors = [o for o in plan["openings"] if o["type"] == "door"]
    assert all(0.7 <= d["width"] <= 1.1 for d in doors)
    wall_ids = {w["id"] for w in plan["walls"]}
    assert all(o["wallId"] in wall_ids for o in plan["openings"])
    total = sum(polygon_area(r["polygon"]) for r in plan["rooms"])
    assert 70 <= total <= 130


def test_import_endpoint_and_projects():
    client = TestClient(app)
    with SAMPLE.open("rb") as f:
        r = client.post("/api/import", files={"file": ("plan.pdf", f, "application/pdf")})
    assert r.status_code == 200
    body = r.json()
    assert body["detected"] is True
    assert client.get(body["overlayUrl"]).status_code == 200

    r = client.put("/api/projects/test_project", json={"name": "Test", "plan": {"walls": []}})
    assert r.status_code == 200
    assert client.get("/api/projects/test_project").json()["name"] == "Test"
    assert any(p["id"] == "test_project" for p in client.get("/api/projects").json())
    assert client.delete("/api/projects/test_project").status_code == 200
    assert client.get("/api/projects/..%2Fetc").status_code in (400, 404)
    assert client.get("/api/projects/../etc").status_code == 404


def test_rejects_unknown_file():
    client = TestClient(app)
    r = client.post("/api/import", files={"file": ("x.txt", b"hello", "text/plain")})
    assert r.status_code == 400


def test_rejects_oversized_inputs():
    import cv2
    import numpy as np
    import pymupdf


    client = TestClient(app)
    doc = pymupdf.open()
    doc.new_page(width=14000, height=14000)
    r = client.post("/api/import", files={"file": ("big.pdf", doc.tobytes(), "application/pdf")})
    assert r.status_code == 400
    ok, png = cv2.imencode(".png", np.zeros((9000, 9000), np.uint8))
    r = client.post("/api/import", files={"file": ("big.png", png.tobytes(), "image/png")})
    assert r.status_code == 400


def test_ai_render_requires_token(tmp_path, monkeypatch):
    from app import ai_render

    monkeypatch.delenv("REPLICATE_API_TOKEN", raising=False)
    ai_render.init(tmp_path, tmp_path)
    client = TestClient(app)
    assert client.get("/api/ai/status").json()["configured"] is False
    r = client.post("/api/ai/render", data={"prompt": "room"}, files={"image": ("a.jpg", b"\xff\xd8\xff\xe0x", "image/jpeg")})
    assert r.status_code == 400


def test_ai_render_saves_output(tmp_path, monkeypatch):
    from app import ai_render

    monkeypatch.setenv("REPLICATE_API_TOKEN", "r8_test")
    ai_render.init(tmp_path, tmp_path)
    seen = {}

    def fake(token, model, prompt, control, mime, seed):
        seen.update(token=token, model=model, mime=mime)
        return b"\xff\xd8\xff\xe0photo"

    monkeypatch.setattr(ai_render, "run_prediction", fake)
    client = TestClient(app)
    r = client.post("/api/ai/render", data={"prompt": "bathroom", "model": "depth-dev"}, files={"image": ("a.jpg", b"\xff\xd8\xff\xe0x", "image/jpeg")})
    assert r.status_code == 200, r.text
    assert seen == {"token": "r8_test", "model": "depth-dev", "mime": "image/jpeg"}
    assert (tmp_path / r.json()["url"].rsplit("/", 1)[1]).read_bytes().endswith(b"photo")


def test_devin_job_roundtrip(tmp_path, monkeypatch):
    from app import devin_jobs

    for k in ("DEVIN_API_KEY", "DEVIN_ORG_ID", "DEVIN_SESSION_ID"):
        monkeypatch.delenv(k, raising=False)
    devin_jobs.init(tmp_path, tmp_path)
    client = TestClient(app)
    from app import ai_render

    ai_render.init(tmp_path, tmp_path)
    monkeypatch.setenv("DEVIN_ORG_ID", "org-x")
    monkeypatch.setenv("DEVIN_SESSION_ID", "devin-x")
    assert client.get("/api/devin/status").json()["configured"] is False
    st = client.put("/api/devin/settings", json={"key": "k1"}).json()
    assert st["configured"] and st["keySource"] == "app"
    assert "k1" not in json.dumps(st)
    assert client.put("/api/devin/settings", json={"enabled": False}).json()["enabled"] is False
    off = client.post("/api/devin/jobs", data={"meta": "[{}]"}, files=[("images", ("a.jpg", b"\xff\xd8\xff", "image/jpeg"))])
    assert off.status_code == 403
    client.put("/api/devin/settings", json={"enabled": True})
    assert client.delete("/api/devin/key").json()["configured"] is False
    jpg = b"\xff\xd8\xff\xe0x"
    r = client.post(
        "/api/devin/jobs",
        data={"meta": json.dumps([{"name": "Corner 1", "room": "Kitchen", "prompt": "kitchen"}])},
        files=[("images", ("a.jpg", jpg, "image/jpeg"))],
    )
    assert r.status_code == 200, r.text
    job = r.json()
    assert job["notified"] is False and job["items"][0]["result"] is None
    saved = json.loads((tmp_path / "devin_jobs" / job["id"] / "job.json").read_text())
    assert saved["items"][0]["prompt"] == "kitchen"
    r = client.post(f"/api/devin/jobs/{job['id']}/items/0", files={"image": ("p.png", b"\x89PNG\r\n\x1a\nimg", "image/png")})
    url = r.json()["items"][0]["result"]
    assert (tmp_path / url.rsplit("/", 1)[1]).read_bytes().endswith(b"img")
    assert client.get(f"/api/devin/jobs/{job['id']}/shots/0").content == jpg
    assert client.get("/api/devin/jobs/../x").status_code in (400, 404)
