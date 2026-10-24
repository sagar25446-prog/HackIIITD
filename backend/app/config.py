"""Runtime settings, read from environment variables or the project's .env file."""
from __future__ import annotations

import os
from dataclasses import dataclass, field
from pathlib import Path

from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parents[2]  # jaagruk/
load_dotenv(ROOT / ".env")

DATA_DIR = Path(__file__).resolve().parent / "data"
VAR_DIR = ROOT / "var"
VAR_DIR.mkdir(exist_ok=True)


def _bool(name: str, default: bool) -> bool:
    v = os.getenv(name)
    return default if v is None else v.strip().lower() in {"1", "true", "yes", "on"}


@dataclass(frozen=True)
class Settings:
    tinyfish_api_key: str | None = os.getenv("TINYFISH_API_KEY") or None
    anthropic_api_key: str | None = os.getenv("ANTHROPIC_API_KEY") or None
    anthropic_model: str = os.getenv("ANTHROPIC_MODEL", "claude-opus-5-5")
    # live: always call TinyFish · replay: only use recorded real runs · auto: live, fall back to replay on failure
    tinyfish_mode: str = os.getenv("TINYFISH_MODE", "auto").lower()
    public_base_url: str | None = os.getenv("PUBLIC_BASE_URL") or None  # needed for Monitor webhooks
    db_path: Path = field(default_factory=lambda: Path(os.getenv("JAAGRUK_DB", str(VAR_DIR / "jaagruk.db"))))
    agent_max_steps: int = int(os.getenv("AGENT_MAX_STEPS", "30"))
    # exit country for TinyFish browsers/agents; Indian government portals often block foreign IPs
    proxy_country: str | None = (os.getenv("TINYFISH_PROXY_COUNTRY", "IN").strip().upper() or None)
    agent_max_seconds: int = int(os.getenv("AGENT_MAX_SECONDS", "180"))
    allow_stealth_retry: bool = _bool("ALLOW_STEALTH_RETRY", True)

    @property
    def live_enabled(self) -> bool:
        return bool(self.tinyfish_api_key) and self.tinyfish_mode in {"live", "auto"}


settings = Settings()
