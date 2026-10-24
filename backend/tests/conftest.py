"""Tests run fully offline: TinyFish in replay mode (recorded real responses only), a throwaway database."""
import json
import os
import sys
import tempfile
from pathlib import Path

os.environ["TINYFISH_MODE"] = "replay"
os.environ["JAAGRUK_DB"] = str(Path(tempfile.mkdtemp()) / "test.db")
os.environ["ANTHROPIC_API_KEY"] = ""
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import pytest  # noqa: E402

DATA = Path(__file__).resolve().parents[1] / "app" / "data"


@pytest.fixture(scope="session")
def personas() -> dict:
    return {p["id"]: p["profile"] for p in json.loads((DATA / "personas.json").read_text(encoding="utf-8"))}
