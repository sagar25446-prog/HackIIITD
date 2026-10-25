"""One command to run JAAGRUK: builds the PWA if needed, then serves API + app on http://localhost:8000.

python run.py            # live TinyFish if TINYFISH_API_KEY is set, else recorded real runs
python run.py --replay   # force replay of recorded real TinyFish runs (no network needed)
python run.py --dev      # API only, with reload (run `npm run dev` in frontend/ separately)
python run.py --host 0.0.0.0   # also serve other devices on your network (they can use your TinyFish key)
"""

from __future__ import annotations

import argparse
import os
import shutil
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent


def build_frontend() -> None:
    fe = ROOT / "frontend"
    if (fe / "dist" / "index.html").exists() or not (fe / "package.json").exists():
        return
    npm = shutil.which("npm")
    if not npm:
        print("npm not found — serving the API only. Install Node 20+ to build the app.")
        return
    if not (fe / "node_modules").exists():
        subprocess.run([npm, "install"], cwd=fe, check=True)
    subprocess.run([npm, "run", "build"], cwd=fe, check=True)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--replay", action="store_true")
    ap.add_argument("--dev", action="store_true")
    ap.add_argument("--port", type=int, default=8000)
    # Only this computer by default: paid TinyFish runs must not be reachable from a shared Wi-Fi.
    ap.add_argument("--host", default="127.0.0.1")
    a = ap.parse_args()
    if a.replay:
        os.environ["TINYFISH_MODE"] = "replay"
    sys.path.insert(0, str(ROOT / "backend"))
    if not a.dev:
        build_frontend()
    import uvicorn

    uvicorn.run(
        "app.main:app",
        host=a.host,
        port=a.port,
        reload=a.dev,
        app_dir=str(ROOT / "backend"),
        reload_dirs=[str(ROOT / "backend")] if a.dev else None,
    )


if __name__ == "__main__":
    main()
