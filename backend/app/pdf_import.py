"""Convert a vector floor-plan PDF (e.g. AutoCAD export) into plan JSON.

Pipeline: vector paths -> classified segments -> raster masks -> walls, openings,
rooms and furniture in metres (origin top-left, y pointing down).
"""
from __future__ import annotations

import math
import uuid
from dataclasses import dataclass, field

import cv2
import numpy as np
import pymupdf

PT_MM = 25.4 / 72.0
SCALES = [20, 25, 50, 75, 100, 200]
RES = 4.0  # raster pixels per PDF point
DEBUG = False


def _id(prefix: str) -> str:
    return f"{prefix}_{uuid.uuid4().hex[:8]}"


@dataclass
class Seg:
    a: tuple
    b: tuple
    width: float
    color: tuple
    kind: str = ""

    @property
    def length(self):
        return math.dist(self.a, self.b)

    @property
    def angle(self):
        return math.degrees(math.atan2(self.b[1] - self.a[1], self.b[0] - self.a[0])) % 180


@dataclass
class Arc:
    p0: tuple
    p3: tuple
    center: tuple
    radius: float
    pts: list
    width: float
    color: tuple


@dataclass
class Extracted:
    segs: list = field(default_factory=list)
    arcs: list = field(default_factory=list)
    curves: list = field(default_factory=list)  # flattened polylines of non-door curves
    page_w: float = 0
    page_h: float = 0


def _bezier(p0, p1, p2, p3, n=12):
    out = []
    for i in range(n + 1):
        t = i / n
        mt = 1 - t
        out.append((
            mt ** 3 * p0[0] + 3 * mt * mt * t * p1[0] + 3 * mt * t * t * p2[0] + t ** 3 * p3[0],
            mt ** 3 * p0[1] + 3 * mt * mt * t * p1[1] + 3 * mt * t * t * p2[1] + t ** 3 * p3[1],
        ))
    return out


def _line_intersect(p, d, q, e):
    den = d[0] * e[1] - d[1] * e[0]
    if abs(den) < 1e-9:
        return None
    t = ((q[0] - p[0]) * e[1] - (q[1] - p[1]) * e[0]) / den
    return (p[0] + d[0] * t, p[1] + d[1] * t)


def _arc_from_bezier(p0, p1, p2, p3):
    """Circle centre of a (quarter) arc bezier: normals at both ends intersect."""
    t0 = (p1[0] - p0[0], p1[1] - p0[1])
    t3 = (p3[0] - p2[0], p3[1] - p2[1])
    if math.hypot(*t0) < 1e-6 or math.hypot(*t3) < 1e-6:
        return None
    c = _line_intersect(p0, (-t0[1], t0[0]), p3, (-t3[1], t3[0]))
    if c is None:
        return None
    r0, r3 = math.dist(c, p0), math.dist(c, p3)
    if r0 < 1e-6 or abs(r0 - r3) / r0 > 0.08:
        return None
    # quarter arc: chord ~ r*sqrt(2)
    chord = math.dist(p0, p3)
    if abs(chord / r0 - math.sqrt(2)) > 0.2:
        return None
    return c, (r0 + r3) / 2


def extract(page: pymupdf.Page) -> Extracted:
    m = page.rotation_matrix
    ex = Extracted(page_w=page.rect.width, page_h=page.rect.height)
    for d in page.get_drawings():
        width = d.get("width") or 0.0
        color = tuple(round(c, 2) for c in (d.get("color") or (0, 0, 0)))
        items = d["items"]
        curves = [it for it in items if it[0] == "c"]
        for it in items:
            kind = it[0]
            if kind == "l":
                a, b = it[1] * m, it[2] * m
                ex.segs.append(Seg((a.x, a.y), (b.x, b.y), width, color))
            elif kind == "re":
                r = it[1]
                pts = [r.tl * m, r.tr * m, r.br * m, r.bl * m]
                for i in range(4):
                    a, b = pts[i], pts[(i + 1) % 4]
                    ex.segs.append(Seg((a.x, a.y), (b.x, b.y), width, color))
            elif kind == "qu":
                q = it[1]
                pts = [q.ul * m, q.ur * m, q.lr * m, q.ll * m]
                for i in range(4):
                    a, b = pts[i], pts[(i + 1) % 4]
                    ex.segs.append(Seg((a.x, a.y), (b.x, b.y), width, color))
            elif kind == "c":
                ps = [(p.x, p.y) for p in (q * m for q in it[1:])]
                flat = _bezier(*ps)
                arc = _arc_from_bezier(*ps) if len(curves) == 1 else None
                if arc:
                    ex.arcs.append(Arc(ps[0], ps[3], arc[0], arc[1], flat, width, color))
                else:
                    ex.curves.append((flat, width, color))
    return ex


def _is_black(c):
    return max(c) < 0.15


def _is_red(c):
    return c[0] > 0.7 and c[1] < 0.3 and c[2] < 0.3


def _scale_from_dimensions(page: pymupdf.Page, segs) -> int | None:
    """Drawing scale from dimension texts (mm) next to red dimension lines."""
    reds = [s for s in segs if _is_red(s.color) and s.length > 5]
    ratios = []
    rot = page.rotation_matrix  # segments from extract() are in rotated page space
    for wx0, wy0, wx1, wy1, text, *_ in page.get_text("words"):
        if not (text.isascii() and text.isdigit()) or not 50 <= int(text) <= 30000:
            continue
        r = pymupdf.Rect(wx0, wy0, wx1, wy1) * rot
        x0, y0, x1, y1 = r.x0, r.y0, r.x1, r.y1
        cx, cy = (x0 + x1) / 2, (y0 + y1) / 2
        horiz = (x1 - x0) >= (y1 - y0)
        reach = 2.5 * min(x1 - x0, y1 - y0) + 2
        best, bd = None, reach
        for s in reds:
            dx, dy = s.b[0] - s.a[0], s.b[1] - s.a[1]
            if horiz != (abs(dx) >= abs(dy)) or min(abs(dx), abs(dy)) > 0.05 * s.length:
                continue
            along, perp = (cx, cy) if horiz else (cy, cx)
            lo, hi = sorted((s.a[0], s.b[0]) if horiz else (s.a[1], s.b[1]))
            line = (s.a[1] + s.b[1]) / 2 if horiz else (s.a[0] + s.b[0]) / 2
            if lo <= along <= hi and abs(perp - line) < bd:
                best, bd = s, abs(perp - line)
        if best:
            ratios.append(int(text) / best.length)
    if len(ratios) < 3:
        return None
    # most labels sit on their own line; take the densest ratio, not the mean of noisy matches
    lr = np.log(np.array(ratios) / PT_MM)
    votes = [(np.abs(lr - v) < 0.02).sum() for v in lr]
    i = int(np.argmax(votes))
    if votes[i] < 2:  # no two labels agree: matches are unreliable
        return None
    scale = float(np.exp(lr[i]))
    near = min(SCALES, key=lambda s: abs(math.log(scale / s)))
    return near if abs(math.log(scale / near)) < 0.02 else max(1, round(scale))


def _is_blue(c):
    return c[2] > 0.5 and c[0] < 0.5


class Raster:
    def __init__(self, w, h, res=RES):
        self.res = res
        self.shape = (int(math.ceil(h * res)) + 2, int(math.ceil(w * res)) + 2)

    def blank(self):
        return np.zeros(self.shape, np.uint8)

    def px(self, p):
        return (int(round(p[0] * self.res * 16)), int(round(p[1] * self.res * 16)))

    def line(self, img, a, b, thick=1):
        cv2.line(img, self.px(a), self.px(b), 255, max(1, int(thick)), cv2.LINE_8, shift=4)

    def poly(self, img, pts, thick=1):
        for i in range(len(pts) - 1):
            self.line(img, pts[i], pts[i + 1], thick)


def _choose_scale(door_radii_pt):
    if not door_radii_pt:
        return 50
    r = float(np.median(door_radii_pt))
    best = min(SCALES, key=lambda s: abs(math.log(r * PT_MM * s / 1000 / 0.85)))
    return best


def _largest_rect(mask):
    """Largest axis-aligned rectangle of True cells (histogram method)."""
    h, w = mask.shape
    heights = np.zeros(w, int)
    best = (0, 0, 0, 0, 0)
    for y in range(h):
        heights = np.where(mask[y], heights + 1, 0)
        stack = []
        for x in range(w + 1):
            cur = heights[x] if x < w else 0
            start = x
            while stack and stack[-1][1] >= cur:
                sx, sh = stack.pop()
                area = sh * (x - sx)
                if area > best[0]:
                    best = (area, sx, y - sh + 1, x, y + 1)
                start = sx
            stack.append((start, cur))
    return best


def _decompose(cell_mask, xs, ys, min_area):
    """Split a rectilinear region (grid cells) into rectangles, biggest real area first."""
    mask = cell_mask.copy()
    xs, ys = np.asarray(xs, float), np.asarray(ys, float)
    rects = []
    while mask.any():
        area, x0, y0, x1, y1 = _largest_rect_weighted(mask, xs, ys)
        if area < min_area:
            break
        mask[y0:y1, x0:x1] = False
        rects.append((xs[x0], ys[y0], xs[x1], ys[y1]))
    return rects


def _largest_rect_weighted(mask, xs, ys):
    """Largest rectangle by real area on a non-uniform grid."""
    h, w = mask.shape
    best = (0, 0, 0, 0, 0)
    rows = np.where(mask.any(axis=1))[0]
    for y0 in rows:
        col_ok = np.ones(w, bool)
        for y1 in range(y0 + 1, h + 1):
            col_ok = col_ok & mask[y1 - 1]
            if not col_ok.any():
                break
            hgt = ys[y1] - ys[y0]
            padded = np.concatenate(([False], col_ok, [False]))
            edges = np.flatnonzero(padded[1:] != padded[:-1])
            starts, ends = edges[0::2], edges[1::2]
            widths = xs[ends] - xs[starts]
            k = int(np.argmax(widths))
            area = widths[k] * hgt
            if area > best[0]:
                best = (area, int(starts[k]), int(y0), int(ends[k]), int(y1))
    return best


def _snap_axis(vals, tol):
    vals = sorted(vals)
    groups = []
    for v in vals:
        if groups and v - groups[-1][-1] <= tol:
            groups[-1].append(v)
        else:
            groups.append([v])
    return [float(np.mean(g)) for g in groups]


def _mask_to_rects(mask, tol_px, min_area_px):
    """Approximate a wall mask by axis-aligned rectangles."""
    rects = []
    n, lab, stats, _ = cv2.connectedComponentsWithStats(mask, connectivity=8)
    for i in range(1, n):
        x, y, bw, bh, area = stats[i]
        if area < min_area_px:
            continue
        comp = (lab[y:y + bh, x:x + bw] == i).astype(np.uint8)
        cs, _ = cv2.findContours(comp, cv2.RETR_LIST, cv2.CHAIN_APPROX_NONE)
        vx, vy = [0.0, float(bw)], [0.0, float(bh)]
        for cnt in cs:
            ap = cv2.approxPolyDP(cnt, tol_px, True).reshape(-1, 2).astype(float)
            vx += list(ap[:, 0])
            vy += list(ap[:, 1])
        gx = _snap_axis(vx, tol_px * 1.5)
        gy = _snap_axis(vy, tol_px * 1.5)
        if len(gx) < 2 or len(gy) < 2:
            continue
        ii = cv2.integral(comp)
        gxi = np.clip(np.round(gx).astype(int), 0, bw)
        gyi = np.clip(np.round(gy).astype(int), 0, bh)
        cells = np.zeros((len(gy) - 1, len(gx) - 1), bool)
        for j in range(len(gy) - 1):
            for k in range(len(gx) - 1):
                x0, x1, y0, y1 = gxi[k], gxi[k + 1], gyi[j], gyi[j + 1]
                if x1 <= x0 or y1 <= y0:
                    continue
                s = ii[y1, x1] - ii[y0, x1] - ii[y1, x0] + ii[y0, x0]
                cells[j, k] = s > 0.5 * (x1 - x0) * (y1 - y0)
        for r in _decompose(cells, np.array(gx) + x, np.array(gy) + y, min_area_px * 0.25):
            rects.append(r)
    return rects


def _thin_components(free, max_half_px):
    """Enclosed free-space components that are thin (wall cores between double lines)."""
    n, lab, stats, _ = cv2.connectedComponentsWithStats(free, connectivity=4)
    dist = cv2.distanceTransform(free, cv2.DIST_L2, 3)
    out = np.zeros_like(free)
    h, w = free.shape
    for i in range(1, n):
        x, y, bw, bh, area = stats[i]
        if x == 0 or y == 0 or x + bw >= w or y + bh >= h:
            continue
        if area < 4:
            continue
        comp = lab[y:y + bh, x:x + bw] == i
        if dist[y:y + bh, x:x + bw][comp].max() <= max_half_px:
            out[y:y + bh, x:x + bw][comp] = 255
    return out


def parse_pdf(data: bytes, page_index: int = 0, scale: int | None = None) -> dict:
    doc = pymupdf.open(stream=data, filetype="pdf")
    page = doc[page_index]
    ex = extract(page)
    R = Raster(ex.page_w, ex.page_h)

    door_arcs = [a for a in ex.arcs if _is_black(a.color)]
    radii = [a.radius for a in door_arcs]
    # discard tiny arcs (chairs, fixtures): doors are the larger ones
    if radii:
        big = max(radii)
        door_arcs = [a for a in door_arcs if a.radius > big * 0.55]
    scale = scale or _scale_from_dimensions(page, ex.segs) or _choose_scale([a.radius for a in door_arcs])
    m_per_pt = PT_MM * scale / 1000.0

    # --- classify segments ---
    widths = sorted({round(s.width, 2) for s in ex.segs if _is_black(s.color)})
    bold_w = max(widths) if widths else 1
    for s in ex.segs:
        if _is_blue(s.color):
            s.kind = "blue_window" if s.color[0] > 0.2 else "overhead"
        elif _is_red(s.color):
            s.kind = "dim"  # dimension lines are annotations, not furniture
        elif _is_black(s.color) and s.width >= bold_w * 0.9 and bold_w > 0.5:
            s.kind = "bold"
        else:
            s.kind = "thin"

    # door leaves: thin-ish lines ending at a door hinge
    door_lines = set()
    for a in door_arcs:
        for i, s in enumerate(ex.segs):
            if s.kind != "thin" or abs(s.width - a.width) > 0.02:
                continue
            if min(math.dist(s.a, a.center), math.dist(s.b, a.center),
                   math.dist(s.a, a.p0), math.dist(s.b, a.p0),
                   math.dist(s.a, a.p3), math.dist(s.b, a.p3)) < a.radius * 0.12:
                door_lines.add(i)
    for i in door_lines:
        ex.segs[i].kind = "door"

    # hatch candidates: thin diagonal lines in dense families
    hatch_img = R.blank()
    diag = []
    for i, s in enumerate(ex.segs):
        if s.kind == "thin" and s.length > 0.5:
            an = s.angle
            if min(abs(an - 45), abs(an - 135)) < 3:
                diag.append(i)
                R.line(hatch_img, s.a, s.b)
    sp = int(6 * R.res)
    k = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (sp, sp))
    hatched = cv2.morphologyEx(hatch_img, cv2.MORPH_CLOSE, k)
    hatched = cv2.morphologyEx(hatched, cv2.MORPH_OPEN, cv2.getStructuringElement(cv2.MORPH_RECT, (sp, sp)))
    for i in diag:
        s = ex.segs[i]
        mx = ((s.a[0] + s.b[0]) / 2 * R.res, (s.a[1] + s.b[1]) / 2 * R.res)
        yy, xx = int(mx[1]), int(mx[0])
        if 0 <= yy < hatched.shape[0] and 0 <= xx < hatched.shape[1] and hatched[yy, xx]:
            s.kind = "hatch"

    bold = R.blank()
    for s in ex.segs:
        if s.kind == "bold":
            R.line(bold, s.a, s.b, 2)

    # --- walls mask ---
    hatch_only = R.blank()
    for s in ex.segs:
        if s.kind == "hatch":
            R.line(hatch_only, s.a, s.b, 2)
    hatch_area = cv2.morphologyEx(hatch_only, cv2.MORPH_CLOSE, k)
    free = cv2.bitwise_not(cv2.bitwise_or(bold, hatch_area))
    max_wall_half = 0.18 / m_per_pt * R.res  # partitions up to ~36 cm without hatch
    cores = _thin_components(free, max_wall_half)
    walls = cv2.bitwise_or(cv2.bitwise_or(bold, hatch_area), cores)
    # hatch areas are bounded by bold lines; fill tiny gaps between them
    walls = cv2.morphologyEx(walls, cv2.MORPH_CLOSE, cv2.getStructuringElement(cv2.MORPH_RECT, (5, 5)))

    openings_px = []  # (type, hinge/start px, end px, extra)

    def wall_extent(pt, nrm, max_px):
        """Return (t_min, t_max) of wall mask along normal at point pt (px)."""
        ts = []
        for t in range(-int(max_px), int(max_px) + 1):
            x, y = int(round(pt[0] + nrm[0] * t)), int(round(pt[1] + nrm[1] * t))
            if 0 <= y < walls.shape[0] and 0 <= x < walls.shape[1] and walls[y, x]:
                ts.append(t)
        if not ts:
            return None
        # keep the run nearest to 0
        ts.sort()
        runs, cur = [], [ts[0]]
        for t in ts[1:]:
            if t - cur[-1] <= 2:
                cur.append(t)
            else:
                runs.append(cur)
                cur = [t]
        runs.append(cur)
        run = min(runs, key=lambda r: min(abs(r[0]), abs(r[-1])))
        return run[0], run[-1]

    def best_extent(probes, nrm):
        """Thinnest plausible wall cross-section among probes (ignores gaps and wall junctions)."""
        found = []
        for pr in probes:
            e = wall_extent(pr, nrm, max_thick)
            if e and e[0] <= 2 and e[1] >= -2 and e[0] > -max_thick + 2 and e[1] < max_thick - 2:
                found.append(e)
        if not found:
            return None
        plausible = [e for e in found if e[1] - e[0] >= min_thick]
        pool = plausible or found
        return min(pool, key=lambda e: e[1] - e[0]) if plausible else max(pool, key=lambda e: e[1] - e[0])

    px_m = R.res / m_per_pt  # raster pixels per metre
    max_thick = 0.45 * px_m
    min_thick = 0.06 * px_m
    steps = [int(px_m * k) for k in (0.02, 0.05, 0.1, 0.15)]
    ext_len = 0.12 * px_m
    doors = []
    for a in door_arcs:
        c = np.array(a.center) * R.res
        # closed endpoint lies on the wall line; open endpoint has the leaf line
        cand = []
        for p in (a.p0, a.p3):
            leaf = any(s.kind == "door" and math.dist(s.a, p) < a.radius * 0.15 or
                       s.kind == "door" and math.dist(s.b, p) < a.radius * 0.15
                       for s in ex.segs if abs(math.dist(s.a, s.b) - a.radius) < a.radius * 0.25)
            cand.append((leaf, p))
        closed = [p for leaf, p in cand if not leaf]
        opened = [p for leaf, p in cand if leaf]
        if len(closed) != 1:
            # fallback: endpoint nearer to wall pixels
            def wall_near(p):
                q = np.array(p) * R.res
                x, y = int(q[0]), int(q[1])
                r = 6
                return walls[max(0, y - r):y + r, max(0, x - r):x + r].sum()
            cl = max((a.p0, a.p3), key=wall_near)
            closed = [cl]
            opened = [a.p3 if cl == a.p0 else a.p0]
        cp = np.array(closed[0]) * R.res
        op = np.array(opened[0]) * R.res
        d = cp - c
        L = np.linalg.norm(d)
        if L < 1:
            continue
        d /= L
        nrm = np.array([-d[1], d[0]])
        ext = best_extent([c - d * k for k in steps] + [cp + d * k for k in steps], nrm)
        if ext is None:
            ext = (-6, 6)
        t0, t1 = ext
        poly = np.array([c + nrm * t0 - d * ext_len, cp + nrm * t0 + d * ext_len, cp + nrm * t1 + d * ext_len, c + nrm * t1 - d * ext_len])
        cv2.fillPoly(walls, [np.round(poly).astype(np.int32)], 255)
        side = float(np.sign(np.dot(op - c, nrm))) or 1.0
        doors.append({
            "hinge": c / R.res, "closed": cp / R.res, "side": side,
            "center": (c + cp) / 2 / R.res + nrm * ((t0 + t1) / 2) / R.res,
            "width_pt": L / R.res, "thick_pt": (t1 - t0) / R.res,
        })

    # windows: clusters of blue window geometry
    blue = R.blank()
    for s in ex.segs:
        if s.kind == "blue_window":
            R.line(blue, s.a, s.b, 2)
    bk = int(0.12 / m_per_pt * R.res) | 1
    blue_d = cv2.dilate(blue, cv2.getStructuringElement(cv2.MORPH_RECT, (bk, bk)))
    n, lab, stats, _ = cv2.connectedComponentsWithStats(blue_d)
    windows = []
    for i in range(1, n):
        x, y, bw, bh, area = stats[i]
        x, y, bw, bh = x + bk // 2, y + bk // 2, bw - bk + 1, bh - bk + 1
        if max(bw, bh) < 0.4 / m_per_pt * R.res:
            continue
        horiz = bw >= bh
        cx, cy = x + bw / 2, y + bh / 2
        span = max(bw, bh) / R.res
        parallel = 0
        offsets = []
        for sg in ex.segs:
            if sg.kind != "blue_window":
                continue
            if not (x / R.res - 1 <= min(sg.a[0], sg.b[0]) and max(sg.a[0], sg.b[0]) <= (x + bw) / R.res + 1 and
                    y / R.res - 1 <= min(sg.a[1], sg.b[1]) and max(sg.a[1], sg.b[1]) <= (y + bh) / R.res + 1):
                continue
            along = abs(sg.b[0] - sg.a[0]) if horiz else abs(sg.b[1] - sg.a[1])
            if along >= 0.3 * span:
                parallel += 1
                offsets.append(sg.a[1] if horiz else sg.a[0])
        if DEBUG:
            print('cluster', x / R.res, y / R.res, bw / R.res, bh / R.res, parallel)
        if parallel < 2 or max(offsets) - min(offsets) < 2.0:
            continue
        d = np.array([1.0, 0]) if horiz else np.array([0, 1.0])
        nrm = np.array([-d[1], d[0]])
        length = bw if horiz else bh
        # a window sits in a wall gap: wall must exist beyond both ends
        c0 = np.array([cx, cy])
        exts = []
        for endsign in (-1, 1):
            exts.append(best_extent([c0 + d * endsign * (length / 2 + k) for k in steps], nrm))
        if DEBUG:
            print('window', cx / R.res, cy / R.res, length / R.res, exts)
        if not all(exts):
            continue
        t0, t1 = min(exts, key=lambda e: e[1] - e[0])
        a0 = np.array([cx, cy]) - d * length / 2
        a1 = np.array([cx, cy]) + d * length / 2
        a0, a1 = a0 - d * ext_len * 0.5, a1 + d * ext_len * 0.5
        poly = np.array([a0 + nrm * t0, a1 + nrm * t0, a1 + nrm * t1, a0 + nrm * t1])
        cv2.fillPoly(walls, [np.round(poly).astype(np.int32)], 255)
        windows.append({
            "center": (np.array([cx, cy]) + nrm * (t0 + t1) / 2) / R.res,
            "dir": d, "width_pt": length / R.res, "thick_pt": (t1 - t0) / R.res,
        })

    # --- wall rectangles ---
    walls_c = cv2.morphologyEx(walls, cv2.MORPH_OPEN, cv2.getStructuringElement(cv2.MORPH_RECT, (3, 3)))
    rects_px = _mask_to_rects(walls_c, tol_px=min(0.03 / m_per_pt, 1.2) * R.res,  # stay below thin window walls

                              min_area_px=(0.08 / m_per_pt * R.res) ** 2)

    if DEBUG:
        cv2.imwrite('/tmp/dbg_walls.png', walls)
    # --- rooms ---
    free = cv2.bitwise_not(walls)
    free = cv2.erode(free, np.ones((3, 3), np.uint8))
    n, lab, stats, _ = cv2.connectedComponentsWithStats(free, connectivity=4)
    room_polys_px = []
    h, w = free.shape
    for i in range(1, n):
        x, y, bw, bh, area = stats[i]
        if x <= 1 or y <= 1 or x + bw >= w - 1 or y + bh >= h - 1:
            continue
        if area * (m_per_pt / R.res) ** 2 < 1.0:
            continue
        comp = (lab == i).astype(np.uint8) * 255
        comp = cv2.dilate(comp, np.ones((3, 3), np.uint8))
        cs, _ = cv2.findContours(comp, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        cnt = max(cs, key=cv2.contourArea)
        approx = cv2.approxPolyDP(cnt, 0.04 / m_per_pt * R.res, True).reshape(-1, 2)
        room_polys_px.append((approx.astype(float), area))

    # exclude rooms that are really outside (e.g. enclosed by page frame): keep all for now

    # --- furniture clusters from remaining thin geometry ---
    furn_img = R.blank()
    furn_geo = []
    for s in ex.segs:
        if s.kind == "thin":
            furn_geo.append([s.a, s.b])
    for flat, wdt, col in ex.curves:
        if _is_black(col):
            furn_geo.append(flat)
    for a in ex.arcs:
        if a not in door_arcs and _is_black(a.color):
            furn_geo.append(a.pts)
    for g in furn_geo:
        R.poly(furn_img, g, 3)
    wall_d = cv2.dilate(walls, np.ones((3, 3), np.uint8))
    furn_img = cv2.bitwise_and(furn_img, cv2.bitwise_not(wall_d))
    n, lab, stats, _ = cv2.connectedComponentsWithStats(furn_img, connectivity=8)
    clusters = []
    parts = []  # pieces of L/U-shaped runs (kitchen counters); they never swallow the items they wrap around
    min_side = 0.3 / m_per_pt * R.res
    for i in range(1, n):
        x, y, bw, bh, area = stats[i]
        if max(bw, bh) < 0.15 / m_per_pt * R.res:
            continue
        box = [x / R.res, y / R.res, (x + bw) / R.res, (y + bh) / R.res]
        if bw * bh * (m_per_pt / R.res) ** 2 > 1.0:
            # lines plus every small area they enclose together with the walls (counter cells, table tops)
            mg = int(0.3 / m_per_pt * R.res)
            X0, Y0 = max(0, x - mg), max(0, y - mg)
            X1, Y1 = min(lab.shape[1], x + bw + mg), min(lab.shape[0], y + bh + mg)
            comp_m = (lab[Y0:Y1, X0:X1] == i).astype(np.uint8) * 255
            barrier = cv2.bitwise_or(comp_m, wall_d[Y0:Y1, X0:X1])
            hn, hlab, hst, _ = cv2.connectedComponentsWithStats(cv2.bitwise_not(barrier), connectivity=4)
            filled_m = comp_m.copy()
            max_hole = 2.5 / (m_per_pt / R.res) ** 2
            for j in range(1, hn):
                hx, hy, hw_, hh, harea = hst[j]
                if hx > 0 and hy > 0 and hx + hw_ < X1 - X0 and hy + hh < Y1 - Y0 and harea < max_hole:
                    filled_m[hlab == j] = 255
            filled = filled_m[y - Y0:y - Y0 + bh, x - X0:x - X0 + bw]
            if DEBUG:
                print('furn', [round(v) for v in box], round(filled.mean() / 255, 2))
            if filled.mean() < 0.6 * 255:
                pieces = [r for r in _mask_to_rects(filled, tol_px=min(0.03 / m_per_pt, 1.2) * R.res, min_area_px=min_side ** 2)
                          if min(r[2] - r[0], r[3] - r[1]) >= min_side * 0.8]
                if pieces:
                    parts += [[(x + r[0]) / R.res, (y + r[1]) / R.res, (x + r[2]) / R.res, (y + r[3]) / R.res] for r in pieces]
                    continue
        clusters.append(box)
    # small icons drawn with 45° strokes (fridge snowflake) can be mistaken for hatching
    icon_strokes = [[s.a, s.b] for s in ex.segs if s.kind == "hatch" and s.length * m_per_pt < 0.3]
    clusters = _recognise_symbols(_merge_contained(clusters) + parts, furn_geo + icon_strokes, m_per_pt)

    # --- convert to metres ---
    all_pts = [p for r in rects_px for p in ((r[0], r[1]), (r[2], r[3]))]
    if not all_pts:
        raise ValueError("No walls found in this PDF. Use it as a tracing overlay instead.")
    minx = min(p[0] for p in all_pts) / R.res
    miny = min(p[1] for p in all_pts) / R.res
    margin = 0.5

    def M(xpt, ypt):
        return [round((xpt - minx) * m_per_pt + margin, 3), round((ypt - miny) * m_per_pt + margin, 3)]

    wall_objs = []
    for (x0, y0, x1, y1) in rects_px:
        x0, y0, x1, y1 = x0 / R.res, y0 / R.res, x1 / R.res, y1 / R.res
        wpt, hpt = x1 - x0, y1 - y0
        if wpt >= hpt:
            a, b, t = M(x0, (y0 + y1) / 2), M(x1, (y0 + y1) / 2), hpt * m_per_pt
        else:
            a, b, t = M((x0 + x1) / 2, y0), M((x0 + x1) / 2, y1), wpt * m_per_pt
        if math.dist(a, b) < 0.02:
            continue
        wall_objs.append({"id": _id("w"), "a": a, "b": b, "thickness": round(t, 3)})

    def host_wall(pt, direction):
        best, bd = None, 1e9
        for wobj in wall_objs:
            a, b = np.array(wobj["a"]), np.array(wobj["b"])
            ab = b - a
            L = np.linalg.norm(ab)
            if L < 1e-6:
                continue
            u = ab / L
            if abs(abs(np.dot(u, direction)) - 1) > 0.05:
                continue
            t = np.dot(np.array(pt) - a, u)
            if t < -0.05 or t > L + 0.05:
                continue
            v = np.array(pt) - a
            dist = abs(u[0] * v[1] - u[1] * v[0])
            if dist < bd and dist <= wobj["thickness"] / 2 + 0.05:
                best, bd = (wobj, t), dist
        return best

    openings = []
    for dd in doors:
        center = M(*dd["center"])
        dvec = np.array(dd["closed"]) - np.array(dd["hinge"])
        dvec /= np.linalg.norm(dvec)
        width = round(dd["width_pt"] * m_per_pt, 3)
        hw = host_wall(center, dvec)
        o = {"id": _id("o"), "type": "door", "width": width, "height": 2.1, "sill": 0.0}
        if hw:
            wobj, t = hw
            u = np.array(wobj["b"]) - np.array(wobj["a"])
            u /= np.linalg.norm(u)
            o.update({"wallId": wobj["id"], "offset": round(float(t), 3)})
            # hinge at wall-start side if hinge is before centre along wall direction
            hinge_t = float(np.dot(np.array(M(*dd["hinge"])) - np.array(wobj["a"]), u))
            o["hinge"] = "start" if hinge_t < t else "end"
            nrm = np.array([-u[1], u[0]])
            # side: +1 swings to wall-normal side
            open_dir = np.array([-dvec[1], dvec[0]]) * dd["side"]
            o["swing"] = 1 if np.dot(open_dir, nrm) > 0 else -1
        else:
            continue
        openings.append(o)
    for ww in windows:
        center = M(*ww["center"])
        hw = host_wall(center, ww["dir"])
        if not hw:
            continue
        wobj, t = hw
        openings.append({"id": _id("o"), "type": "window", "wallId": wobj["id"], "offset": round(float(t), 3),
                         "width": round(ww["width_pt"] * m_per_pt, 3), "height": 1.5, "sill": 0.85})

    rooms = []
    for poly, area in sorted(room_polys_px, key=lambda r: -r[1]):
        pts = [M(p[0] / R.res, p[1] / R.res) for p in poly]
        rooms.append({"id": _id("r"), "name": "", "polygon": pts})
    _name_rooms(rooms)

    furniture = []
    for (x0, y0, x1, y1), known, axis in clusters:
        a, b = M(x0, y0), M(x1, y1)
        wdt, dep = b[0] - a[0], b[1] - a[1]
        cx, cy = (a[0] + b[0]) / 2, (a[1] + b[1]) / 2
        # outline path in local metres (centred)
        paths = []
        crosses = 0
        side = min(x1 - x0, y1 - y0)
        for g in furn_geo + icon_strokes:
            if all(x0 - 0.5 <= p[0] <= x1 + 0.5 and y0 - 0.5 <= p[1] <= y1 + 0.5 for p in g):
                pts = [M(*p) for p in g]
                paths.append("M" + " L".join(f"{p[0] - cx:.3f} {p[1] - cy:.3f}" for p in pts))
                if len(g) == 2:
                    dx, dy, ln = abs(g[1][0] - g[0][0]), abs(g[1][1] - g[0][1]), math.dist(g[0], g[1])
                    crosses += min(dx, dy) > 0.3 * ln and ln > 0.9 * side
        ftype, height = _guess_furniture(wdt, dep)
        if crosses >= 2 and min(wdt, dep) >= 0.3:
            ftype, height = "wardrobe", 2.2  # a box with an X is a tall cabinet in plan drawings
        if known:
            ftype, height = known, APPLIANCE_H[known]
        rot = _wall_side((x0, y0, x1, y1), walls, R.res, axis) if ftype in FACING else 0
        if rot in (90, 270):
            wdt, dep = dep, wdt
        if rot:
            c, s_ = math.cos(math.radians(rot)), math.sin(math.radians(rot))
            # outline was drawn unrotated; express it in the item's own frame
            paths = ["M" + " L".join(f"{(px * c + py * s_):.3f} {(-px * s_ + py * c):.3f}"
                                     for px, py in (map(float, q.split()) for q in p[1:].split(" L")))
                     for p in paths]
        furniture.append({
            "id": _id("f"), "type": ftype, "x": round(cx, 3), "y": round(cy, 3), "rotation": rot,
            "width": round(wdt, 3), "depth": round(dep, 3), "height": height,
            "outline": " ".join(paths)[:20000],
        })
    _washers_in_bathrooms(furniture, rooms)

    page_origin = M(0, 0)
    overlay = {
        "x": page_origin[0], "y": page_origin[1],
        "width": round(ex.page_w * m_per_pt, 3), "height": round(ex.page_h * m_per_pt, 3),
    }
    return {
        "scale": scale,
        "metersPerPoint": m_per_pt,
        "walls": wall_objs,
        "openings": openings,
        "rooms": rooms,
        "furniture": furniture,
        "overlay": overlay,
        "stats": {"walls": len(wall_objs), "doors": sum(o["type"] == "door" for o in openings),
                  "windows": sum(o["type"] == "window" for o in openings), "rooms": len(rooms),
                  "furniture": len(furniture)},
    }



# --- appliance / fixture symbols inside furniture outlines ---

APPLIANCE_H = {"stove": 0.9, "oven": 0.9, "dishwasher": 0.85, "fridge": 1.85, "kitchen_sink": 0.9,
               "kitchen_base": 0.9, "toilet": 0.75, "basin": 0.85, "washing_machine": 0.85, "table_round": 0.75, "table": 0.75}
FACING = {"stove", "oven", "dishwasher", "fridge", "kitchen_sink", "kitchen_base", "toilet", "basin", "washing_machine"}


def _bbox(pts):
    xs, ys = [p[0] for p in pts], [p[1] for p in pts]
    return min(xs), min(ys), max(xs), max(ys)


def _chains(items, tol=0.4):
    """Group polylines that share endpoints (circles drawn as 4 arcs, outlines drawn as segments)."""
    par = list(range(len(items)))

    def find(i):
        while par[i] != i:
            par[i] = par[par[i]]
            i = par[i]
        return i
    ends = [(g[0], g[-1]) for g in items]
    for i in range(len(items)):
        for j in range(i + 1, len(items)):
            if any(math.dist(p, q) < tol for p in ends[i] for q in ends[j]):
                par[find(i)] = find(j)
    groups = {}
    for i in range(len(items)):
        groups.setdefault(find(i), []).append(items[i])
    return list(groups.values())


def _clumps(items, gap=1.0):
    """Group small strokes that sit close together (one drawn icon)."""
    boxes = [_bbox(g) for g in items]
    par = list(range(len(items)))

    def find(i):
        while par[i] != i:
            par[i] = par[par[i]]
            i = par[i]
        return i
    for i, a in enumerate(boxes):
        for j in range(i + 1, len(boxes)):
            b = boxes[j]
            if a[0] - gap <= b[2] and b[0] - gap <= a[2] and a[1] - gap <= b[3] and b[1] - gap <= a[3]:
                par[find(i)] = find(j)
    groups = {}
    for i in range(len(items)):
        groups.setdefault(find(i), []).append(items[i])
    return list(groups.values())


def _ellipse(group):
    pts = [p for g in group for p in g]
    if len(pts) < 12:
        return None
    x0, y0, x1, y1 = _bbox(pts)
    rx, ry = (x1 - x0) / 2, (y1 - y0) / 2
    if min(rx, ry) < 0.5:
        return None
    cx, cy = (x0 + x1) / 2, (y0 + y1) / 2
    if all(abs(((p[0] - cx) / rx) ** 2 + ((p[1] - cy) / ry) ** 2 - 1) < 0.2 for p in pts):
        return (x0, y0, x1, y1)
    return None


def _seg_dist(p, a, b):
    ab = (b[0] - a[0], b[1] - a[1])
    L2 = ab[0] ** 2 + ab[1] ** 2 or 1e-9
    t = max(0.0, min(1.0, ((p[0] - a[0]) * ab[0] + (p[1] - a[1]) * ab[1]) / L2))
    return math.dist(p, (a[0] + t * ab[0], a[1] + t * ab[1]))


def _steep(a, b):
    """Slanted stroke (not axis-aligned), so icons match in any quarter-turn."""
    return not _flat(a, b)


def _flat(a, b):
    ang = math.degrees(math.atan2(b[1] - a[1], b[0] - a[0])) % 180
    return ang < 8 or ang > 172 or 82 <= ang <= 98


def _classify_box(box, items, mpp):
    """Recognise what a furniture outline is from the symbol drawn inside it."""
    x0, y0, x1, y1 = box
    W, D = (x1 - x0) * mpp, (y1 - y0) * mpp
    lo, hi = sorted((W, D))
    m = 0.8

    def on_border(g):
        return all(abs(p[0] - x0) < m or abs(p[0] - x1) < m or abs(p[1] - y0) < m or abs(p[1] - y1) < m for p in g)
    inner = [g for g in items if not on_border(g)]
    if not inner:
        return None
    groups = _chains(inner)
    ells, others = [], []
    for g in groups:
        e = _ellipse(g)
        (ells if e else others).append(e or g)
    size = lambda b: ((b[2] - b[0]) * mpp, (b[3] - b[1]) * mpp)
    drains = [e for e in ells if max(size(e)) < 0.08]
    burners = [e for e in ells if 0.08 <= min(size(e)) and max(size(e)) <= 0.32 and max(size(e)) < 1.3 * min(size(e))]
    bowls = [e for e in ells if min(size(e)) >= 0.2]
    if len(burners) >= 3 and hi <= 1.0:
        return "stove"
    if bowls and any(b[0] <= d[0] and b[1] <= d[1] and d[2] <= b[2] and d[3] <= b[3] for b in bowls for d in drains):
        return "basin"
    if bowls and min(size(bowls[0])) >= 0.5 and len(ells) == 1:
        return "table_round" if max(size(bowls[0])) < 1.15 * min(size(bowls[0])) else "table"
    small = [s for g in groups for s in g if max(size(_bbox(s))) < 0.3]
    for g in _clumps(small):
        segs = [s for s in g if len(s) == 2]
        curves = [s for s in g if len(s) > 2]
        bx = _bbox([p for s in g for p in s])
        gw, gh = size(bx)
        if max(gw, gh) > 0.4:
            continue
        # snowflake: horizontal, vertical and both diagonals crossing at one point
        mids = [((s[0][0] + s[1][0]) / 2, (s[0][1] + s[1][1]) / 2, round((math.degrees(math.atan2(s[1][1] - s[0][1], s[1][0] - s[0][0])) % 180) / 45) % 4)
                for s in segs if math.dist(*s) * mpp > 0.2 * max(gw, gh)]
        for mx, my, _ in mids:
            if len({k for ax, ay, k in mids if math.hypot(ax - mx, ay - my) < 1.0}) == 4:
                return "fridge"
        # lightning bolt: steep - flat - steep zigzag
        if not curves and len(segs) >= 3:
            for s in segs:
                if _flat(*s) and math.dist(*s) * mpp < 0.15:
                    nb = [t for t in segs if t is not s and _steep(*t) and min(_seg_dist(q, *s) for q in t) < 0.4]
                    # zigzag: the slanted strokes leave the flat one on opposite sides (a pull's bevels don't)
                    dx, dy = s[1][0] - s[0][0], s[1][1] - s[0][1]
                    sides = set()
                    for t in nb:
                        far = max(t, key=lambda q: _seg_dist(q, *s))
                        sides.add((far[0] - s[0][0]) * dy - (far[1] - s[0][1]) * dx > 0)
                    if len(sides) == 2:
                        return "oven"
        # water drop: two steep lines meeting at an apex, closed by a curve
        if curves and len(segs) == 2 and _steep(*segs[0]) and _steep(*segs[1]) and \
                any(math.dist(p, q) < 0.4 for p in segs[0] for q in segs[1]):
            return "dishwasher"
    # finely drawn rounded bowl filling the outline, without a drain: toilet
    if 0.28 <= lo <= 0.55 and 0.35 <= hi <= 0.85 and not drains:
        for g in others:
            gw, gh = size(_bbox([p for s in g for p in s]))
            if len(g) >= 40 and gw >= 0.7 * W and gh >= 0.7 * D:
                return "toilet"
    # sink: large inner basin outline with a narrow tap
    if 0.4 <= lo <= 0.75 and hi <= 1.6 and not ells:
        rects = [_bbox([p for s in g for p in s]) for g in others]
        tap = any(min(size(r)) < 0.06 and 0.08 <= max(size(r)) <= 0.4 for r in rects)
        basin = any(size(r)[0] * size(r)[1] >= 0.35 * W * D for r in rects)
        if tap and basin:
            return "kitchen_sink"
    return None


def _split_run(box, items, mpp):
    """Cut a counter/cabinet run into its units along full-depth divider lines."""
    x0, y0, x1, y1 = box
    horiz = (x1 - x0) >= (y1 - y0)
    depth = (y1 - y0) if horiz else (x1 - x0)
    a0, a1 = (x0, x1) if horiz else (y0, y1)
    cuts = []
    for g in items:
        if len(g) != 2:
            continue
        (px, py), (qx, qy) = g
        if horiz and abs(px - qx) < 0.3 and abs(py - qy) >= 0.85 * depth:
            cuts.append((px + qx) / 2)
        elif not horiz and abs(py - qy) < 0.3 and abs(px - qx) >= 0.85 * depth:
            cuts.append((py + qy) / 2)
    edges = [a0]
    for c in sorted(cuts):
        if c - edges[-1] >= 0.25 / mpp and a1 - c >= 0.25 / mpp:
            edges.append(c)
    edges.append(a1)
    return [[e0, y0, e1, y1] if horiz else [x0, e0, x1, e1] for e0, e1 in zip(edges, edges[1:])]


def _wall_side(box, wall_mask, res, axis=None):
    """Rotation (deg) that puts the back of an item against its nearest wall."""
    x0, y0, x1, y1 = (int(v * res) for v in box)
    h, w = wall_mask.shape
    g = int(0.6 * res) + 3
    strips = {
        0: wall_mask[max(0, y0 - g):max(0, y0 - 1), x0:x1],      # wall above -> front faces down
        180: wall_mask[min(h, y1 + 1):min(h, y1 + g), x0:x1],    # wall below
        270: wall_mask[y0:y1, max(0, x0 - g):max(0, x0 - 1)],    # wall left
        90: wall_mask[y0:y1, min(w, x1 + 1):min(w, x1 + g)],     # wall right
    }
    keep = {"h": (0, 180), "v": (90, 270)}.get(axis, tuple(strips))  # units of a run face across it
    score = {k: (s.mean() if s.size else 0) for k, s in strips.items() if k in keep}
    best = max(score, key=score.get)
    return best if score[best] > 0 else 0


def _join_runs(boxes, gap):
    """Re-join pieces of one counter run that the raster split (same depth, touching ends)."""
    boxes = [(list(b), [b]) for b in boxes]
    merged = True
    while merged:
        merged = False
        for i, a in enumerate(boxes):
            a, pa = a
            for j in range(i + 1, len(boxes)):
                b, pb = boxes[j]
                same_row = abs(a[1] - b[1]) < 1 and abs(a[3] - b[3]) < 1 and -1 < max(a[0], b[0]) - min(a[2], b[2]) < gap
                same_col = abs(a[0] - b[0]) < 1 and abs(a[2] - b[2]) < 1 and -1 < max(a[1], b[1]) - min(a[3], b[3]) < gap
                if same_row or same_col:
                    boxes[i] = ([min(a[0], b[0]), min(a[1], b[1]), max(a[2], b[2]), max(a[3], b[3])], pa + pb)
                    del boxes[j]
                    merged = True
                    break
            if merged:
                break
    return boxes


def _recognise_symbols(clusters, furn_geo, mpp):
    """Returns [(box, type|None)] with counter runs split into typed units and symbol icons absorbed."""
    inside = lambda g, b: all(b[0] - 1.5 <= p[0] <= b[2] + 1.5 and b[1] - 1.5 <= p[1] <= b[3] + 1.5 for p in g)
    out, containers = [], []
    for box, parts in _join_runs(clusters, 0.15 / mpp):
        geo = [g for g in furn_geo if inside(g, box)]
        lo = min(box[2] - box[0], box[3] - box[1]) * mpp
        hi = max(box[2] - box[0], box[3] - box[1]) * mpp
        if 0.4 <= lo <= 0.75 and hi >= 0.9:
            cells = _split_run(box, geo, mpp)
            if len(cells) > 1:
                typed = [(c, _classify_box(c, [g for g in geo if inside(g, c)], mpp)) for c in cells]
                if any(t for _, t in typed):
                    axis = "h" if box[2] - box[0] >= box[3] - box[1] else "v"
                    out += [(c, t or "kitchen_base", axis) for c, t in typed]
                    containers += cells
                    continue
        typed = [(b, _classify_box(b, [g for g in furn_geo if inside(g, b)], mpp)) for b in parts]
        if len(parts) > 1 and not any(t for _, t in typed):
            t = _classify_box(box, geo, mpp)
            if t:  # one symbol spans the joined pieces (e.g. a sink across two fragments)
                typed = [(box, t)]
        for b, t in typed:
            out.append((b, t, None))
            if t:
                containers.append(b)
    contained = lambda b, c: b is not c and b[0] >= c[0] - 1 and b[1] >= c[1] - 1 and b[2] <= c[2] + 1 and b[3] <= c[3] + 1
    return [(b, t, a) for b, t, a in out if not any(contained(b, c) for c in containers if c is not b)]



def _washers_in_bathrooms(furniture, rooms):
    """A square box with an X next to a toilet or basin is a washing machine, not a wardrobe."""
    def room_of(f):
        for r in rooms:
            if cv2.pointPolygonTest(np.array(r["polygon"], np.float32), (f["x"], f["y"]), False) >= 0:
                return r["id"]
        return None
    wet = {room_of(f) for f in furniture if f["type"] in ("toilet", "basin", "shower", "bathtub")} - {None}
    for f in furniture:
        if f["type"] == "wardrobe" and 0.45 <= min(f["width"], f["depth"]) and max(f["width"], f["depth"]) <= 0.75 \
                and room_of(f) in wet:
            f["type"], f["height"] = "washing_machine", APPLIANCE_H["washing_machine"]

def _merge_contained(boxes):
    boxes = sorted(boxes, key=lambda b: -(b[2] - b[0]) * (b[3] - b[1]))
    out = []
    for b in boxes:
        for o in out:
            if b[0] >= o[0] - 1 and b[1] >= o[1] - 1 and b[2] <= o[2] + 1 and b[3] <= o[3] + 1:
                break
        else:
            out.append(b)
    return out


def _guess_furniture(w, d):
    lo, hi = sorted([w, d])
    if 1.3 <= lo <= 2.1 and 1.85 <= hi <= 2.3:
        return "bed", 0.5
    if lo < 0.7 and hi >= 1.6:
        return "cabinet", 0.9
    if lo < 0.75 and hi >= 0.9:
        return "cabinet", 0.9
    if 0.7 <= lo <= 1.2 and 1.2 <= hi <= 2.4:
        return "table", 0.75
    if hi <= 0.6:
        return "chair", 0.85
    if lo >= 1.2 and lo * hi >= 2.5:
        # Large outlines without a recognisable footprint are usually rugs or zone markings, not solid blocks.
        return "rug", 0.01
    return "generic", 0.75


def polygon_area(pts):
    a = 0.0
    for i in range(len(pts)):
        x1, y1 = pts[i]
        x2, y2 = pts[(i + 1) % len(pts)]
        a += x1 * y2 - x2 * y1
    return abs(a) / 2


def _name_rooms(rooms):
    for i, r in enumerate(rooms):
        area = polygon_area(r["polygon"])
        xs = [p[0] for p in r["polygon"]]
        ys = [p[1] for p in r["polygon"]]
        w, h = max(xs) - min(xs), max(ys) - min(ys)
        lo, hi = sorted([w, h])
        if i == 0:
            name = "Living room"
        elif area < 2.5:
            name = "Storage"
        elif lo < 1.6 and hi / max(lo, 0.1) > 2.2:
            name = "Hallway"
        elif area < 6:
            name = "Bathroom"
        else:
            name = "Room"
        r["name"] = name
    seen = {}
    for r in rooms:
        seen[r["name"]] = seen.get(r["name"], 0) + 1
    count = {}
    for r in rooms:
        if seen[r["name"]] > 1:
            count[r["name"]] = count.get(r["name"], 0) + 1
            r["name"] = f'{r["name"]} {count[r["name"]]}'


def render_overlay_png(data: bytes, page_index: int = 0, dpi: int = 150) -> bytes:
    doc = pymupdf.open(stream=data, filetype="pdf")
    pix = doc[page_index].get_pixmap(dpi=dpi, alpha=True)
    return pix.tobytes("png")
