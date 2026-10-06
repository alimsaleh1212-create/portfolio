#!/usr/bin/env python3
"""Scan the Climb for text contrast and the Hiker's clearance at quarter steps of the journey.

Needs the stack up (default http://localhost:8080, or pass the base URL), `agent-browser`, and
Pillow. For each journey position from 0 to 6 in quarter steps it scrolls the page there, waits
for the camera and the Hiker to settle, records what the Hiker overlaps, then hides the text
(keeping every background, scrim and card), captures the screen, and measures each text
rectangle's worst background pixels against the text's colour (WCAG contrast).

  [SCAN_U=3.5,3.75,...] python3 scripts/scan.py WIDTH HEIGHT [BASE_URL] [OUT_DIR]

Start the browser with software WebGL, as in CLAUDE.md. Prints one line per position and the
minimum contrast at the end; writes scan-WIDTH.json in OUT_DIR (default: the current folder).
"""
import json, math, os, re, subprocess, sys, time
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
W, H = int(sys.argv[1]), int(sys.argv[2])
BASE = sys.argv[3] if len(sys.argv) > 3 else "http://localhost:8080"
# SCAN_TIER=still scans the still tier (no scene to probe: it waits for the pictures instead).
TIER = os.environ.get("SCAN_TIER", "full")
OUT = sys.argv[4] if len(sys.argv) > 4 else "."
os.environ.setdefault("AGENT_BROWSER_ARGS", "--no-sandbox,--use-angle=swiftshader,--enable-unsafe-swiftshader,--ignore-gpu-blocklist")
PAGE_JS = open(os.path.join(HERE, "scan-text.js")).read()
HIDE = ("var s=document.createElement('style');s.id='hide-text';s.textContent="
        "'*{color:transparent!important;-webkit-text-fill-color:transparent!important;text-shadow:none!important;caret-color:transparent!important}"
        "pre{display:none!important}';document.head.appendChild(s);1")
UNHIDE = "document.getElementById('hide-text').remove();1"

def ab(*args):
    out = subprocess.run(["agent-browser", *args], capture_output=True, text=True, timeout=120).stdout.strip()
    return out

def ev(js):
    out = ab("eval", js)
    try:
        return json.loads(out)
    except json.JSONDecodeError:
        return out

def lum(c):
    def f(v):
        v /= 255
        return v / 12.92 if v <= 0.03928 else ((v + 0.055) / 1.055) ** 2.4
    return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2])

def ratio(a, b):
    la, lb = lum(a), lum(b)
    hi, lo = max(la, lb), min(la, lb)
    return (hi + 0.05) / (lo + 0.05)

def parse_color(s):
    m = re.findall(r"[\d.]+", s)
    r, g, b = (float(x) for x in m[:3])
    a = float(m[3]) if len(m) > 3 else 1.0
    return r, g, b, a

def settle():
    if TIER == "still":
        time.sleep(1.2)
        return
    last, same = None, 0
    for _ in range(40):
        cur = ev("var h=window.probeHiker().hiker;h?h.journey.toFixed(4)+' '+h.walking.toFixed(3):''")
        same = same + 1 if cur == last else 0
        last = cur
        if same >= 3:
            break
        time.sleep(0.5)
    time.sleep(0.5)

ab("set", "viewport", str(W), str(H))
ab("open", f"{BASE}/?tier={TIER}&debug")
for _ in range(40 if TIER != "still" else 0):
    if ev("var p=window.probeHiker&&window.probeHiker();p&&p.hiker&&p.hiker.world[1]!==0?'ok':''") == "ok":
        break
    time.sleep(0.7)
tops = ev("['top','trailhead','long-approach','steep-switch','ridge','high-camp','summit'].map(k=>k==='top'?0:document.getElementById(k).getBoundingClientRect().top+scrollY)")
results, worst = [], (99, None)
STEPS = [float(x) for x in os.environ["SCAN_U"].split(",")] if os.environ.get("SCAN_U") else [i / 4 for i in range(25)]
for u in STEPS:
    k = min(5, int(u))
    y = tops[k] + (tops[k + 1] - tops[k]) * (u - k)
    ev(f"scrollTo(0,{y});1")
    settle()
    page = json.loads(ev(PAGE_JS))
    ev(HIDE)
    time.sleep(0.8)
    shot = os.path.join(OUT, f"scan-{W}-{u:g}.png")
    ab("screenshot", shot)
    ev(UNHIDE)
    img = Image.open(shot).convert("RGB")
    scale = img.size[0] / W
    low = (99, "")
    for t in page["texts"]:
        if (t["r"][1] + t["r"][3]) / 2 > H or t["text"] == "Skip to content" or t.get("covered"):
            continue  # visually hidden until focused, or under a fixed bar
        l, tp, r, b = (int(v * scale) for v in t["r"])
        l, tp, r, b = max(0, l), max(0, tp), min(img.size[0], r), min(img.size[1], b)
        if r - l < 2 or b - tp < 2:
            continue
        px = list(img.crop((l, tp, r, b)).getdata())
        cr, cg, cb, ca = parse_color(t["color"])
        ratios = []
        for p in px:
            fg = (cr * ca + p[0] * (1 - ca), cg * ca + p[1] * (1 - ca), cb * ca + p[2] * (1 - ca))
            ratios.append(ratio(fg, p))
        ratios.sort()
        worst_px = ratios[max(0, int(len(ratios) * 0.005))]  # 0.5th percentile: ignores a lone star
        t["contrast"] = round(worst_px, 2)
        if worst_px < low[0]:
            low = (worst_px, f"{t['text']!r} at {t['r']}")
    h = page["hiker"]
    results.append({"u": u, "scrollY": page["scrollY"], "min_contrast": round(low[0], 2), "where": low[1], "hiker": h, "texts": page["texts"]})
    if low[0] < worst[0]:
        worst = (low[0], f"u={u} {low[1]}")
    print(f"u={u:<5} scroll={page['scrollY']:<5} min contrast {low[0]:.2f} {low[1]:<40} hiker {h and (h['x'], h['footY'], h['height'], h['state'])}", flush=True)
json.dump(results, open(os.path.join(OUT, f"scan-{W}.json"), "w"))
print(f"MINIMUM at {W}: {worst[0]:.2f} ({worst[1]})")
