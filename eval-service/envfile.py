"""
Minimal .env loader so the judge key can live in one gitignored file (eval-service/.env) instead of
being exported in every shell. Real environment variables always win; nothing is ever logged.
"""

import os
from pathlib import Path

DEFAULT_PATH = Path(__file__).parent / ".env"


def load_env(path: Path = DEFAULT_PATH) -> list[str]:
    """Sets any KEY=VALUE from the file that is not already set. Returns the names it set (never the values)."""
    if not path.is_file():
        return []
    loaded = []
    for raw in path.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        key = key.strip().removeprefix("export ").strip()
        value = value.strip().strip("'\"")
        if key and value and key not in os.environ:
            os.environ[key] = value
            loaded.append(key)
    return loaded
