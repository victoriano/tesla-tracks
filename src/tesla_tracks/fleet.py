"""Minimal Tesla Fleet API client: partner token, user OAuth with rotating refresh tokens, telemetry config."""

from __future__ import annotations

import json
import os
import re
import secrets
import shutil
import subprocess
import tempfile
import time
from pathlib import Path
from urllib.parse import parse_qs, urlencode, urlparse

import httpx

from .settings import Settings

AUTH_URL = "https://auth.tesla.com/oauth2/v3/authorize"
TOKEN_URL = "https://fleet-auth.prd.vn.cloud.tesla.com/oauth2/v3/token"
SCOPES = "openid offline_access vehicle_device_data vehicle_location vehicle_cmds vehicle_charging_cmds"
VEHICLE_COMMAND_IMAGE = os.environ.get("VEHICLE_COMMAND_IMAGE", "tesla/vehicle-command:0.4.1")


class FleetError(RuntimeError):
    pass


def _check(resp: httpx.Response) -> dict:
    if resp.status_code >= 400:
        raise FleetError(f"{resp.request.method} {resp.request.url} -> {resp.status_code}: {resp.text}")
    return resp.json() if resp.content else {}


def _require(value: str, name: str) -> str:
    if not value:
        raise FleetError(f"{name} is not set (see .env.example)")
    return value


# -- partner (app) level ---------------------------------------------------------------------------
def partner_token(s: Settings) -> str:
    resp = httpx.post(
        TOKEN_URL,
        data={
            "grant_type": "client_credentials",
            "client_id": _require(s.client_id, "TESLA_CLIENT_ID"),
            "client_secret": _require(s.client_secret, "TESLA_CLIENT_SECRET"),
            "scope": "openid vehicle_device_data vehicle_cmds vehicle_charging_cmds",
            "audience": s.api_base,
        },
        timeout=30,
    )
    return _check(resp)["access_token"]


def register_partner(s: Settings) -> dict:
    token = partner_token(s)
    resp = httpx.post(
        f"{s.api_base}/api/1/partner_accounts",
        headers={"Authorization": f"Bearer {token}"},
        json={"domain": _require(s.app_domain, "TESLA_APP_DOMAIN")},
        timeout=30,
    )
    return _check(resp)


def registered_public_key(s: Settings) -> dict:
    token = partner_token(s)
    resp = httpx.get(
        f"{s.api_base}/api/1/partner_accounts/public_key",
        params={"domain": s.app_domain},
        headers={"Authorization": f"Bearer {token}"},
        timeout=30,
    )
    return _check(resp)


# -- user OAuth --------------------------------------------------------------------------------------
def authorize_url(s: Settings) -> tuple[str, str]:
    state = secrets.token_urlsafe(16)
    query = urlencode(
        {
            "response_type": "code",
            "client_id": _require(s.client_id, "TESLA_CLIENT_ID"),
            "redirect_uri": _require(s.redirect_uri, "TESLA_REDIRECT_URI"),
            "scope": SCOPES,
            "state": state,
            "prompt_missing_scopes": "true",
        }
    )
    return f"{AUTH_URL}?{query}", state


def _save_tokens(s: Settings, data: dict) -> None:
    data = dict(data)
    data["obtained_at"] = int(time.time())
    s.tokens_file.parent.mkdir(parents=True, exist_ok=True)
    tmp = s.tokens_file.with_suffix(".tmp")
    fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, "w") as fh:
        json.dump(data, fh)
    tmp.replace(s.tokens_file)


def exchange_code(s: Settings, redirected_url_or_code: str) -> dict:
    text = redirected_url_or_code.strip()
    code = parse_qs(urlparse(text).query).get("code", [text])[0] if "://" in text else text
    resp = httpx.post(
        TOKEN_URL,
        data={
            "grant_type": "authorization_code",
            "client_id": s.client_id,
            "client_secret": s.client_secret,
            "code": code,
            "audience": s.api_base,
            "redirect_uri": s.redirect_uri,
        },
        timeout=30,
    )
    data = _check(resp)
    _save_tokens(s, data)
    return data


def user_token(s: Settings) -> str:
    """Return a valid user access token, refreshing (and persisting the rotated refresh token) if needed."""
    if not s.tokens_file.exists():
        raise FleetError("not logged in: run `tesla-tracks login` first")
    data = json.loads(s.tokens_file.read_text())
    if time.time() < data["obtained_at"] + data.get("expires_in", 0) - 300:
        return data["access_token"]
    resp = httpx.post(
        TOKEN_URL,
        data={
            "grant_type": "refresh_token",
            "client_id": s.client_id,
            "refresh_token": data["refresh_token"],
        },
        timeout=30,
    )
    fresh = _check(resp)
    _save_tokens(s, fresh)
    return fresh["access_token"]


def api(s: Settings, method: str, path: str, **kwargs) -> dict:
    resp = httpx.request(
        method,
        f"{s.api_base}{path}",
        headers={"Authorization": f"Bearer {user_token(s)}"},
        timeout=60,
        **kwargs,
    )
    return _check(resp)


# -- telemetry configuration --------------------------------------------------------------------------
_PEM_RE = re.compile(r"-----BEGIN CERTIFICATE-----.*?-----END CERTIFICATE-----", re.S)


def build_ca(ca_file: Path, chain_file: Path | None) -> str:
    """Root CAs plus the intermediates of the server's current chain (Tesla's own checker requires them)."""
    certs = _PEM_RE.findall(ca_file.read_text())
    if chain_file and chain_file.exists():
        for cert in _PEM_RE.findall(chain_file.read_text())[1:]:  # skip the leaf
            if cert not in certs:
                certs.insert(0, cert)
    return "\n".join(certs) + "\n"


def build_telemetry_config(
    s: Settings, fields_file: Path, ca_file: Path, exp_days: int, chain_file: Path | None = None
) -> dict:
    fields = json.loads(fields_file.read_text())
    fields = {k: v for k, v in fields.items() if not k.startswith("_")}
    return {
        "hostname": _require(s.telemetry_hostname, "TELEMETRY_HOSTNAME"),
        "port": s.telemetry_port,
        "ca": build_ca(ca_file, chain_file),
        "fields": fields,
        "alert_types": ["service"],
        "delivery_policy": "latest",
        "exp": int(time.time()) + exp_days * 86400,
    }


def sign_config(s: Settings, config: dict) -> str:
    """Sign with Tesla's own `tesla-jws` (Schnorr/P-256), from a local binary or the official Docker image."""
    if not s.private_key.exists():
        raise FleetError(f"missing {s.private_key}: run `tesla-tracks keygen` first")
    with tempfile.TemporaryDirectory() as tmp:
        cfg = Path(tmp) / "config.json"
        cfg.write_text(json.dumps(config))
        local = shutil.which("tesla-jws")
        if local:
            cmd = [local, "-key-file", str(s.private_key), "-fleet", "sign", "TelemetryClient", str(cfg)]
        else:
            cmd = [
                "docker", "run", "--rm", "--user", f"{os.getuid()}:{os.getgid()}",
                "-v", f"{s.private_key}:/keys/private-key.pem:ro",
                "-v", f"{tmp}:/work:ro",
                "--entrypoint", "tesla-jws", VEHICLE_COMMAND_IMAGE,
                "-key-file", "/keys/private-key.pem", "-fleet", "sign", "TelemetryClient", "/work/config.json",
            ]  # fmt: skip
        out = subprocess.run(cmd, check=False, capture_output=True, text=True)
        if out.returncode != 0:
            raise FleetError(f"tesla-jws failed: {out.stderr or out.stdout}")
        return out.stdout.strip()


def push_telemetry_config(s: Settings, vins: list[str], token: str) -> dict:
    return api(s, "POST", "/api/1/vehicles/fleet_telemetry_config_jws", json={"vins": vins, "token": token})
