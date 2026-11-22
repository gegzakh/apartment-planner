"""Plan recognition from photos, scans and screenshots (raster images).

Pipeline: binarise -> deskew -> hatched walls -> wall gaps (doors/windows) -> rooms -> furniture.
Works best on CAD-style drawings where walls are hatched or filled; the result is a starting
point to correct in the editor.
"""
from __future__ import annotations

import math

import cv2
import numpy as np

from .pdf_import import _guess_furniture, _id, _mask_to_rects, _merge_contained, _name_rooms

WORK_SIDE = 2400  # longer image side used for processing (px)
DOOR_M = 0.85  # typical door gap used to guess the scale


def _binarise(gray: np.ndarray) -> np.ndarray:
    block = max(15, (min(gray.shape) // 40) | 1)
    return cv2.adaptiveThreshold(gray, 255, cv2.ADAPTIVE_THRESH_MEAN_C, cv2.THRESH_BINARY_INV, block, 25)


def _deskew_angle(ink: np.ndarray) -> float:
    side = max(ink.shape)
    lines = cv2.HoughLinesP(ink, 1, np.pi / 720, 200, minLineLength=side // 8, maxLineGap=10)
    if lines is None:
        return 0.0
    ds, ws = [], []
    for x1, y1, x2, y2 in lines.reshape(-1, 4).astype(float):
        a = math.degrees(math.atan2(y2 - y1, x2 - x1)) % 180
        d = a - 90 if 45 < a < 135 else (a if a < 45 else a - 180)
        if abs(d) < 5:
            ds.append(d)
            ws.append(math.hypot(x2 - x1, y2 - y1))
    return float(np.average(ds, weights=ws)) if ds else 0.0


def _hatch_mask(ink: np.ndarray, unit: int) -> np.ndarray:
    """Regions filled with diagonal hatching or solid ink."""
    n = max(9, unit | 1)
    k1 = np.eye(n, dtype=np.uint8)
    diag = cv2.bitwise_or(cv2.morphologyEx(ink, cv2.MORPH_OPEN, k1), cv2.morphologyEx(ink, cv2.MORPH_OPEN, np.fliplr(k1).copy()))
    solid = cv2.morphologyEx(ink, cv2.MORPH_OPEN, np.ones((n, n), np.uint8))
    m = cv2.bitwise_or(diag, solid)
    m = cv2.morphologyEx(m, cv2.MORPH_CLOSE, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (int(n * 1.5), int(n * 1.5))))
    return cv2.morphologyEx(m, cv2.MORPH_OPEN, np.ones((int(n * 1.2), int(n * 1.2)), np.uint8))


def _keep_plan(walls: np.ndarray) -> np.ndarray:
    """Drops blobs touching the image edge (screen UI, page borders) and specks far from the plan."""
    h, w = walls.shape
    n, lab, stats, _ = cv2.connectedComponentsWithStats(walls, connectivity=8)
    keep = np.zeros_like(walls)
    big = [i for i in range(1, n) if stats[i][4] > 0.002 * h * w]
    for i in big:
        x, y, bw, bh, _ = stats[i]
        if x <= 1 or y <= 1 or x + bw >= w - 1 or y + bh >= h - 1:
            if bw > 0.9 * w or bh > 0.9 * h:
                continue  # frame line spanning the whole image
            if bh < 0.05 * h or bw < 0.05 * w:
                continue  # toolbar strip at the edge
        keep[lab == i] = 255
    return keep


def _gaps(walls: np.ndarray, rects, max_len: int, min_len: int, max_thick: int):
    """Breaks between collinear wall pieces: (x0, y0, x1, y1, horizontal).

    From each end of a wall rectangle, walk along the wall axis through free space; a break is a
    free strip of the wall's thickness that ends on wall again within max_len.
    """
    h, w = walls.shape
    on = walls > 0
    out = []
    for x0, y0, x1, y1 in rects:
        x0, y0, x1, y1 = int(round(x0)), int(round(y0)), int(round(x1)), int(round(y1))
        horiz = (x1 - x0) >= (y1 - y0)
        lo, hi = (y0, y1) if horiz else (x0, x1)
        if hi - lo < 3 or hi - lo > max_thick:
            continue
        for sign in (-1, 1):
            edge = (x1 if sign > 0 else x0) if horiz else (y1 if sign > 0 else y0)
            n_ax = w if horiz else h

            def cover(c):
                return (on[lo:hi, c] if horiz else on[c, lo:hi]).mean()

            c = edge
            while 0 <= c < n_ax and abs(c - edge) < 40 and cover(c) > 0.15:
                c += sign  # finish leaving the wall piece
            start, hit, partial = c, None, 0
            while 0 <= c < n_ax and abs(c - start) <= max_len:
                cv = cover(c)
                if cv >= 0.5:
                    hit = abs(c - start)
                    break
                partial = partial + 1 if cv > 0.15 else 0
                if partial > 4:
                    break  # partly blocked: not a clean break
                c += sign
            if hit is None or hit < min_len:
                continue
            a, b = sorted((start, start + sign * hit))
            a, b = (a, b) if sign > 0 else (a + 1, b + 1)
            g = (a, lo, b, hi, True) if horiz else (lo, a, hi, b, False)
            # strip sides must be open, otherwise this is a notch, not a doorway
            if horiz:
                sides = np.concatenate([on[max(0, lo - 3), a:b], on[min(h - 1, hi + 2), a:b]])
            else:
                sides = np.concatenate([on[a:b, max(0, lo - 3)], on[a:b, min(w - 1, hi + 2)]])
            half = len(sides) // 2
            if sides[:half].mean() > 0.5 or sides[half:].mean() > 0.5:
                continue
            if any(abs(g[0] - o[0]) < 6 and abs(g[1] - o[1]) < 6 and abs(g[2] - o[2]) < 6 and abs(g[3] - o[3]) < 6 for o in out):
                continue
            out.append(g)
    return out


def parse_image(data: bytes, width_m: float | None = None) -> dict:
    img = cv2.imdecode(np.frombuffer(data, np.uint8), cv2.IMREAD_GRAYSCALE)
    if img is None:
        raise ValueError("Cannot read image")
    f = WORK_SIDE / max(img.shape)
    gray = cv2.resize(img, None, fx=f, fy=f, interpolation=cv2.INTER_CUBIC if f > 1 else cv2.INTER_AREA)
    ink = _binarise(gray)
    h, w = ink.shape
    rot = _deskew_angle(ink)
    R = cv2.getRotationMatrix2D((w / 2, h / 2), rot, 1)
    ink = cv2.warpAffine(ink, R, (w, h), flags=cv2.INTER_NEAREST)
    gray = cv2.warpAffine(gray, R, (w, h), flags=cv2.INTER_LINEAR, borderValue=255)

    unit = max(9, WORK_SIDE // 140)
    walls = _keep_plan(_hatch_mask(ink, unit))
    ys, xs = np.nonzero(walls)
    if len(xs) < 100:
        raise ValueError("No hatched or filled walls found in this image")
    bx0, by0, bx1, by1 = xs.min(), ys.min(), xs.max(), ys.max()
    plan_w = bx1 - bx0

    # --- openings: breaks in the walls ---
    max_thick = int(plan_w * 0.06)
    rects = _mask_to_rects(walls, tol_px=plan_w / 300, min_area_px=(plan_w * 0.008) ** 2)
    if not rects:
        raise ValueError("No walls found in this image")
    gaps = _gaps(walls, rects, max_len=int(plan_w * 0.3), min_len=int(plan_w * 0.04), max_thick=int(plan_w * 0.045))
    closed = walls.copy()
    for x0, y0, x1, y1, _ in gaps:
        closed[y0:y1, x0:x1] = 255
    # outside = free space connected to the plan bbox border
    free = cv2.bitwise_not(closed)
    pad = 4
    canvas = np.zeros((h + 2 * pad, w + 2 * pad), np.uint8)
    canvas[pad:-pad, pad:-pad] = free
    canvas[:pad, :] = canvas[-pad:, :] = 255
    canvas[:, :pad] = canvas[:, -pad:] = 255
    canvas[pad:-pad, pad:-pad][:, :bx0] = 255
    canvas[pad:-pad, pad:-pad][:, bx1 + 1:] = 255
    canvas[pad:-pad, pad:-pad][:by0, :] = 255
    canvas[pad:-pad, pad:-pad][by1 + 1:, :] = 255
    ff = canvas.copy()
    cv2.floodFill(ff, np.zeros((h + 2 * pad + 2, w + 2 * pad + 2), np.uint8), (0, 0), 128)
    outside = (ff[pad:-pad, pad:-pad] == 128)

    def is_exterior(g):
        x0, y0, x1, y1, horiz = g
        d = max_thick // 2 + 4
        if horiz:
            a, b = outside[max(0, y0 - d):y0, x0:x1], outside[y1:y1 + d, x0:x1]
        else:
            a, b = outside[y0:y1, max(0, x0 - d):x0], outside[y0:y1, x1:x1 + d]
        return (a.size > 0 and a.mean() > 0.5) or (b.size > 0 and b.mean() > 0.5)

    def kind(g):
        x0, y0, x1, y1, horiz = g
        # window frames are drawn as 2+ long lines along the break; a doorway has at most an arc crossing it
        strip = ink[y0:y1, x0:x1] > 0
        cov = strip.mean(axis=1 if horiz else 0)
        rows = np.flatnonzero(cov > 0.6)
        lines = 0 if not len(rows) else 1 + int((np.diff(rows) > 2).sum())
        return "window" if lines >= 2 else "door"

    kinds = [kind(g) for g in gaps]
    door_lens = [(g[2] - g[0]) if g[4] else (g[3] - g[1]) for g, k in zip(gaps, kinds) if k == "door"]
    door_lens = [d for d in door_lens if d < plan_w * 0.15] or door_lens
    if width_m:
        px_m = plan_w / width_m
    elif door_lens:
        px_m = float(np.median(door_lens)) / DOOR_M
    else:
        px_m = plan_w / 10.0
    m = 1.0 / px_m
    # wide interior breaks are open passages, not doorways
    keep = [k == "window" or max(g[2] - g[0], g[3] - g[1]) * m <= 1.4 for g, k in zip(gaps, kinds)]
    gaps = [g for g, ok in zip(gaps, keep) if ok]
    kinds = [k for k, ok in zip(kinds, keep) if ok]
    closed = walls.copy()
    for x0, y0, x1, y1, _ in gaps:
        closed[y0:y1, x0:x1] = 255

    # --- walls ---
    margin = 0.5

    def M(x, y):
        return [round((x - bx0) * m + margin, 3), round((y - by0) * m + margin, 3)]

    wall_objs = []
    for x0, y0, x1, y1 in rects:
        if x1 - x0 >= y1 - y0:
            a, b, t = M(x0, (y0 + y1) / 2), M(x1, (y0 + y1) / 2), (y1 - y0) * m
        else:
            a, b, t = M((x0 + x1) / 2, y0), M((x0 + x1) / 2, y1), (x1 - x0) * m
        if math.dist(a, b) >= 0.02:
            wall_objs.append({"id": _id("w"), "a": a, "b": b, "thickness": round(t, 3)})

    openings = []
    for (x0, y0, x1, y1, horiz), kind in zip(gaps, kinds):
        if horiz:
            a, b, t = M(x0, (y0 + y1) / 2), M(x1, (y0 + y1) / 2), (y1 - y0) * m
        else:
            a, b, t = M((x0 + x1) / 2, y0), M((x0 + x1) / 2, y1), (x1 - x0) * m
        wall = {"id": _id("w"), "a": a, "b": b, "thickness": round(t, 3)}
        wall_objs.append(wall)
        width = round(math.dist(a, b), 3)
        o = {"id": _id("o"), "wallId": wall["id"], "offset": round(width / 2, 3), "width": width}
        if kind == "window":
            o.update(type="window", height=1.5, sill=0.85)
        elif width > 1.25:
            o.update(type="opening", height=2.1, sill=0.0)
        else:
            o.update(type="door", height=2.1, sill=0.0, hinge="start", swing=1)
        openings.append(o)

    # --- rooms ---
    inside = cv2.bitwise_and(cv2.bitwise_not(closed), (~outside).astype(np.uint8) * 255)
    inside = cv2.erode(inside, np.ones((3, 3), np.uint8))
    n, lab, stats, _ = cv2.connectedComponentsWithStats(inside, connectivity=4)
    room_polys = []
    for i in range(1, n):
        if stats[i][4] * m * m < 1.0:
            continue
        comp = cv2.dilate((lab == i).astype(np.uint8) * 255, np.ones((3, 3), np.uint8))
        cs, _ = cv2.findContours(comp, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        cnt = max(cs, key=cv2.contourArea)
        room_polys.append((cv2.approxPolyDP(cnt, 0.04 * px_m, True).reshape(-1, 2), stats[i][4]))
    rooms = [{"id": _id("r"), "name": "", "polygon": [M(*p) for p in poly]} for poly, _ in sorted(room_polys, key=lambda r: -r[1])]
    _name_rooms(rooms)

    # --- furniture: remaining line drawings inside rooms ---
    gap_zone = np.zeros_like(walls)
    for x0, y0, x1, y1, horiz in gaps:
        r = int(max(x1 - x0, y1 - y0) * 1.1)
        cv2.rectangle(gap_zone, (x0 - r, y0 - r), (x1 + r, y1 + r), 255, -1)
    lines = cv2.bitwise_and(ink, cv2.bitwise_not(cv2.dilate(walls, np.ones((7, 7), np.uint8))))
    lines = cv2.bitwise_and(lines, (~outside).astype(np.uint8) * 255)
    # long straight guide lines (dashed beams, axes) would chain furniture together
    dash = max(3, int(0.25 * px_m))
    long_len = int(3.2 * px_m)
    for x0, y0, x1, y1, _ in gaps:
        lines[max(0, y0 - 6):y1 + 6, max(0, x0 - 6):x1 + 6] = 0
    long_lines = np.zeros_like(lines)
    for kd, kl in (((1, dash), (1, long_len)), ((dash, 1), (long_len, 1))):
        joined = cv2.morphologyEx(lines, cv2.MORPH_CLOSE, np.ones(kd, np.uint8))
        long_lines |= cv2.morphologyEx(joined, cv2.MORPH_OPEN, np.ones(kl, np.uint8))
    lines = cv2.bitwise_and(lines, cv2.bitwise_not(cv2.dilate(long_lines, np.ones((5, 5), np.uint8))))
    grouped = cv2.dilate(lines, np.ones((5, 5), np.uint8))
    n, lab, stats, _ = cv2.connectedComponentsWithStats(grouped, connectivity=8)
    boxes = []
    for i in range(1, n):
        x, y, bw, bh, area = stats[i]
        lo, hi = sorted([bw * m, bh * m])
        if hi < 0.3 or lo < 0.12 or hi > 4.5:
            continue  # dashes, text, long dashed guide lines
        if hi < 1.3 and gap_zone[y:y + bh, x:x + bw].mean() > 128:
            continue  # door swing arc
        boxes.append([x, y, x + bw, y + bh, i])
    furniture = []
    kept = _merge_contained([b[:4] for b in boxes])
    for x0, y0, x1, y1 in kept:
        idx = [b[4] for b in boxes if b[0] >= x0 and b[1] >= y0 and b[2] <= x1 and b[3] <= y1]
        a, b = M(x0, y0), M(x1, y1)
        cx, cy = (a[0] + b[0]) / 2, (a[1] + b[1]) / 2
        sub = (np.isin(lab[y0:y1, x0:x1], idx) & (lines[y0:y1, x0:x1] > 0)).astype(np.uint8) * 255
        cs, _ = cv2.findContours(sub, cv2.RETR_LIST, cv2.CHAIN_APPROX_SIMPLE)
        paths = []
        for c in cs:
            if cv2.arcLength(c, True) * m < 0.1:
                continue
            pts = cv2.approxPolyDP(c, 1.5, True).reshape(-1, 2)
            pts = [M(px + x0, py + y0) for px, py in pts]
            paths.append("M" + " L".join(f"{p[0] - cx:.3f} {p[1] - cy:.3f}" for p in pts) + " Z")
        wdt, dep = b[0] - a[0], b[1] - a[1]
        ftype, height = _guess_furniture(wdt, dep)
        furniture.append({"id": _id("f"), "type": ftype, "x": round(cx, 3), "y": round(cy, 3), "rotation": 0,
                          "width": round(wdt, 3), "depth": round(dep, 3), "height": height,
                          "outline": " ".join(paths)[:20000]})

    ok, png = cv2.imencode(".png", gray)
    origin = M(0, 0)
    return {
        "scale": 50,
        "walls": wall_objs,
        "openings": openings,
        "rooms": rooms,
        "furniture": furniture,
        "overlay": {"x": origin[0], "y": origin[1], "width": round(w * m, 3), "height": round(h * m, 3)},
        "overlayPng": png.tobytes(),
        "stats": {"walls": len(wall_objs), "doors": sum(o["type"] != "window" for o in openings),
                  "windows": sum(o["type"] == "window" for o in openings), "rooms": len(rooms),
                  "furniture": len(furniture)},
    }
