# Apartment Planner

Plan an apartment renovation from your designer's drawings: upload a 2D plan (PDF/PNG/JPG), get an editable plan (JSON), and see every change at once in 2D, 3D and 360°.

## Run on Docker Desktop

```bash
docker compose up -d --build
```

Open http://localhost:8080. Projects and uploaded files are kept in the `planner-data` Docker volume. Stop with `docker compose down`.

The app has no login, so by default it is reachable only from this computer. To open it from a phone on the same Wi-Fi, change the port line in `docker-compose.yml` to `"8080:8000"` and use `http://<your-computer-ip>:8080`; anyone on that network can then see and edit your projects.

## Features

- **Import.** General-plan PDFs exported from CAD (like `samples/sample-plan.pdf`) are converted automatically into walls, doors, windows, rooms (with areas) and furniture. The drawing scale is auto-detected (or pick it), and the **Scale** tool calibrates from any known length.
- **Electrical and water plans** load as transparent overlays aligned with the general plan. Trace them with the symbol palettes (sockets, switches, lights, panel, cold/hot water, drains, radiators…) and the wire/pipe run tools. Symbols are not auto-recognised yet.
- **2D editor.** Draw, move and delete walls, doors, windows, openings, rooms, furniture, fixtures and runs. Includes snapping, dimensions, a measure tool, undo/redo (`Ctrl+Z` / `Ctrl+Y`), duplicate (`Ctrl+D`) and delete (`Del`).
- **Layers and presets.** Interior, Electrical, Water, Everything and Shell only. Every layer toggles in both 2D and 3D.
- **3D.** 2D / split / 3D switch, orbit, first-person walk (WASD), 360° panorama from any placed 360° point, day/evening/night lighting, cutaway, and per-room floor, wall and ceiling colours.
- **Quantities.** Floor areas, flooring with waste, paint area and litres, skirting, socket and switch counts, cable and pipe lengths, and an estimated electrical load.
- **Versions.** Save snapshots and compare the current plan against one (shown as a red ghost).
- **Export and share.** 2D PNG/SVG, 3D render, 360° JPG, PDF presentation, GLB model and JSON. On phones, **Share** opens the system share sheet (Telegram, WhatsApp, Instagram…). On desktop the file is downloaded, copied to the clipboard and the chosen app is opened so you can paste it. Instagram has no web share API, so on desktop you upload the file manually.
- **Projects.** Autosave to the server, with a browser-storage fallback when offline, and a JSON editor for direct changes.

## Development

```bash
# backend (http://localhost:8000)
cd backend && pip install -r requirements-dev.txt
uvicorn app.main:app --reload --port 8000
pytest -q tests

# frontend (http://localhost:5173, proxies /api to :8000)
cd frontend && npm install && npm run dev
```

Stack: FastAPI, PyMuPDF and OpenCV (PDF parsing); React, TypeScript, Vite, Zustand, SVG (2D), and Three.js / React Three Fiber (3D).
