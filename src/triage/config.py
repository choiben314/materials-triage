"""The two config files: policy.yaml (site admin) and user.yaml (scientist defaults)."""

from __future__ import annotations

import hashlib
import os
from functools import lru_cache
from pathlib import Path
from types import SimpleNamespace

import yaml
from dotenv import load_dotenv


def resolve(path: str | Path) -> Path:
    return Path(os.environ.get("TRIAGE_HOME", os.getcwd())).resolve() / path


@lru_cache(maxsize=1)
def settings() -> SimpleNamespace:
    load_dotenv(resolve(".env"))
    pol, usr = resolve("config/policy.yaml").read_bytes(), resolve("config/user.yaml").read_bytes()
    return SimpleNamespace(policy=yaml.safe_load(pol), user=yaml.safe_load(usr),
                           fingerprint=hashlib.sha256(pol + usr).hexdigest()[:12])
