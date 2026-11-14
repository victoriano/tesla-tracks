"""`tesla-tracks` command line: one-time setup with Tesla, and the long-running ingester."""

from __future__ import annotations

import json
import logging
import time
from pathlib import Path

import typer
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import ec

from . import fleet, process, storage
from .settings import Settings

app = typer.Typer(no_args_is_help=True, add_completion=False, help=__doc__)
REPO = Path(__file__).resolve().parents[2]


def _settings() -> Settings:
    return Settings()


def _print(obj) -> None:
    typer.echo(json.dumps(obj, indent=2, default=str))


@app.command()
def keygen(force: bool = typer.Option(False, help="Overwrite an existing key pair")) -> None:
    """Create the app's EC (prime256v1) key pair in TT_SECRETS_DIR."""
    s = _settings()
    if s.private_key.exists() and not force:
        raise typer.BadParameter(f"{s.private_key} exists (use --force to replace; the car must be re-paired)")
    s.secrets_dir.mkdir(parents=True, exist_ok=True)
    key = ec.generate_private_key(ec.SECP256R1())
    s.private_key.write_bytes(
        key.private_bytes(serialization.Encoding.PEM, serialization.PrivateFormat.TraditionalOpenSSL,
                          serialization.NoEncryption())
    )  # fmt: skip
    s.private_key.chmod(0o600)
    s.public_key.write_bytes(
        key.public_key().public_bytes(serialization.Encoding.PEM, serialization.PublicFormat.SubjectPublicKeyInfo)
    )
    well_known = REPO / "public" / ".well-known" / "appspecific"
    well_known.mkdir(parents=True, exist_ok=True)
    (well_known / "com.tesla.3p.public-key.pem").write_bytes(s.public_key.read_bytes())
    typer.echo(f"Wrote {s.private_key} (keep it secret, back it up), {s.public_key} and a copy under public/.")
    typer.echo(f"Serve the public key at https://{s.app_domain or '<domain>'}"
               "/.well-known/appspecific/com.tesla.3p.public-key.pem")  # fmt: skip


@app.command()
def register() -> None:
    """Register the app's domain with Fleet API in your region (needs the public key online)."""
    s = _settings()
    _print(fleet.register_partner(s))
    _print(fleet.registered_public_key(s))


@app.command()
def login(
    print_url: bool = typer.Option(False, "--print-url", help="Only print the authorization URL (non-interactive)"),
    redirect_url: str = typer.Option("", "--redirect-url", help="Finish login with the URL Tesla redirected to"),
) -> None:
    """OAuth login as the car owner. Interactive by default; agents can use --print-url then --redirect-url."""
    s = _settings()
    state_file = s.secrets_dir / "oauth-state"
    if redirect_url:
        expected = state_file.read_text().strip() if state_file.exists() else ""
        if expected and f"state={expected}" not in redirect_url:
            raise typer.BadParameter("state mismatch: use the URL from the latest --print-url")
        data = fleet.exchange_code(s, redirect_url)
        state_file.unlink(missing_ok=True)
        typer.echo(f"Logged in. Tokens saved to {s.tokens_file} (scopes: {data.get('scope', '?')}).")
        return
    url, state = fleet.authorize_url(s)
    if print_url:
        s.secrets_dir.mkdir(parents=True, exist_ok=True)
        state_file.write_text(state)
        typer.echo(url)
        return
    typer.echo("1. Open this URL, sign in to Tesla and accept the permissions:\n")
    typer.echo(url + "\n")
    typer.echo("2. You'll land on your redirect URI (a 404 page there is fine). Copy the full URL.")
    redirected = typer.prompt("Paste it here")
    if f"state={state}" not in redirected and "://" in redirected:
        raise typer.BadParameter("state mismatch: use the URL from this login attempt")
    data = fleet.exchange_code(s, redirected)
    typer.echo(f"Logged in. Tokens saved to {s.tokens_file} (scopes: {data.get('scope', '?')}).")


@app.command()
def vehicles() -> None:
    """List vehicles on the account."""
    _print(fleet.api(_settings(), "GET", "/api/1/vehicles"))


@app.command("pair-url")
def pair_url() -> None:
    """Print the link that installs the app's virtual key on the car."""
    s = _settings()
    typer.echo(f"https://tesla.com/_ak/{s.app_domain}")
    typer.echo("Open it on the phone with the Tesla app, near the car, and approve with the key card.")


@app.command("telemetry-config")
def telemetry_config(
    vin: list[str] = typer.Option(..., help="VIN(s) to configure"),
    fields_file: Path = typer.Option(REPO / "telemetry" / "fields.json"),
    ca_file: Path = typer.Option(REPO / "telemetry" / "ca.pem", help="Root CAs of the server certificate"),
    chain_file: Path = typer.Option(REPO / "certs" / "fullchain.pem", help="Server chain; intermediates are added"),
    exp_days: int = typer.Option(360, help="Config expiry; re-run before it lapses"),
    dry_run: bool = typer.Option(False, help="Print the config instead of sending it"),
    wait_hours: float = typer.Option(
        0, help="If the car lacks the virtual key yet, retry every 10 min for this many hours (pair meanwhile)"
    ),
) -> None:
    """Sign the streaming config with the app key and send it to the car(s)."""
    s = _settings()
    config = fleet.build_telemetry_config(s, fields_file, ca_file, exp_days, chain_file)
    if dry_run:
        _print({**config, "ca": f"{config['ca'].count('BEGIN CERTIFICATE')} certificates"})
        return
    token = fleet.sign_config(s, config)
    deadline = time.time() + wait_hours * 3600
    while True:
        result = fleet.push_telemetry_config(s, vin, token)
        _print(result)
        missing = (result.get("response") or {}).get("skipped_vehicles", {}).get("missing_key") or []
        if not missing or time.time() > deadline:
            return
        typer.echo(f"{len(missing)} car(s) without the virtual key yet; retrying in 10 min (pair it now)...")
        time.sleep(600)


@app.command("telemetry-status")
def telemetry_status(vin: str) -> None:
    """Show the car's streaming config (synced?) and recent streaming errors."""
    s = _settings()
    _print(fleet.api(s, "GET", f"/api/1/vehicles/{vin}/fleet_telemetry_config"))
    _print(fleet.api(s, "GET", f"/api/1/vehicles/{vin}/fleet_telemetry_errors"))


@app.command("telemetry-delete")
def telemetry_delete(vin: str) -> None:
    """Stop streaming from the car."""
    _print(fleet.api(_settings(), "DELETE", f"/api/1/vehicles/{vin}/fleet_telemetry_config"))


@app.command()
def run() -> None:
    """Run the ingester (ZMQ -> Parquet, processing, compaction, optional S3/R2 mirror)."""
    from . import ingest

    ingest.run(_settings())


@app.command("process")
def process_cmd() -> None:
    """Recompute drives, charges and positions from raw data."""
    _print(process.run(_settings().data_dir))


@app.command()
def compact() -> None:
    """Merge small raw Parquet files per day."""
    typer.echo(f"compacted {storage.compact(_settings().raw_dir)} day partitions")


@app.command()
def demo(days: int = typer.Option(30)) -> None:
    """Write FAKE telemetry for a demo car into TT_DATA_DIR and process it (to try the dashboard)."""
    from . import demo as demo_mod

    s = _settings()
    typer.echo(f"wrote {demo_mod.generate(s.data_dir, days)} synthetic rows for VIN {demo_mod.VIN}")
    _print(process.run(s.data_dir))


@app.command()
def sync() -> None:
    """Mirror Parquet files to the S3/R2 bucket now."""
    from .objectstore import Mirror

    mirror = Mirror.from_env(_settings().data_dir)
    if not mirror:
        raise typer.BadParameter("S3_BUCKET is not set")
    _print(mirror.sync())


def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
    try:
        app()
    except fleet.FleetError as exc:
        typer.secho(str(exc), fg="red", err=True)
        raise SystemExit(1) from exc
