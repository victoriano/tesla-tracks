"""Runtime settings, read from environment variables (see .env.example)."""

from __future__ import annotations

import os
from dataclasses import dataclass, field
from pathlib import Path

REGION_BASE_URLS = {
    "eu": "https://fleet-api.prd.eu.vn.cloud.tesla.com",
    "na": "https://fleet-api.prd.na.vn.cloud.tesla.com",
    "cn": "https://fleet-api.prd.cn.vn.cloud.tesla.cn",
}


def _env(name: str, default: str = "") -> str:
    return os.environ.get(name, default).strip()


@dataclass(frozen=True)
class Settings:
    data_dir: Path = field(default_factory=lambda: Path(_env("TT_DATA_DIR", "./data")).resolve())
    secrets_dir: Path = field(default_factory=lambda: Path(_env("TT_SECRETS_DIR", "./secrets")).resolve())
    zmq_endpoint: str = field(default_factory=lambda: _env("TT_ZMQ_ENDPOINT", "tcp://127.0.0.1:5284"))
    flush_seconds: int = field(default_factory=lambda: int(_env("TT_FLUSH_SECONDS", "60")))
    process_seconds: int = field(default_factory=lambda: int(_env("TT_PROCESS_SECONDS", "120")))

    # Tesla developer app
    client_id: str = field(default_factory=lambda: _env("TESLA_CLIENT_ID"))
    client_secret: str = field(default_factory=lambda: _env("TESLA_CLIENT_SECRET"))
    region: str = field(default_factory=lambda: _env("TESLA_REGION", "eu"))
    app_domain: str = field(default_factory=lambda: _env("TESLA_APP_DOMAIN"))
    redirect_uri: str = field(default_factory=lambda: _env("TESLA_REDIRECT_URI"))

    # Where the car streams to
    telemetry_hostname: str = field(default_factory=lambda: _env("TELEMETRY_HOSTNAME"))
    telemetry_port: int = field(default_factory=lambda: int(_env("TELEMETRY_PORT", "4443")))

    @property
    def api_base(self) -> str:
        return REGION_BASE_URLS[self.region]

    @property
    def raw_dir(self) -> Path:
        return self.data_dir / "raw"

    @property
    def derived_dir(self) -> Path:
        return self.data_dir / "derived"

    @property
    def state_dir(self) -> Path:
        return self.data_dir / "state"

    @property
    def private_key(self) -> Path:
        return self.secrets_dir / "private-key.pem"

    @property
    def public_key(self) -> Path:
        return self.secrets_dir / "public-key.pem"

    @property
    def tokens_file(self) -> Path:
        return self.secrets_dir / "tokens.json"
