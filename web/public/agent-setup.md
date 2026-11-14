# Tesla Tracks — setup guide for AI agents

You are an AI agent (Claude Code, Codex, Cursor, …) helping a person self-host
[Tesla Tracks](https://github.com/victoriano/tesla-tracks) on **their own server**: Tesla's official
Fleet Telemetry streams their car's data to their server, an ingester stores it as Parquet, and a
small dashboard shows drives, charges and tire pressures.

Work through the phases in order. Each phase ends with a check; do not move on until it passes.

## Ground rules

- **Ask before you act** on anything that costs money, registers accounts or apps, publishes,
  changes DNS, opens firewall ports, or edits an existing web server config. Show what you will do
  and wait for a yes.
- **Never invent values.** Ask for every domain, region, account, VIN or price you do not know.
- **Secrets** (private key, client secret, OAuth tokens, dashboard passwords) never go to git, chat,
  logs or commit messages. Keep them in `secrets/` and `.env` (mode 600) and, if the person uses a
  password manager CLI (1Password `op`, Bitwarden `bw`…), offer to store a copy there.
- Steps that only the person can do are marked **👤 Person**. Explain them clearly, then wait.
- If a step fails, read the error, fix the cause and re-run. Report what you changed.

## Phase 0 — ask first

Ask these questions in one message and wait for the answers:

1. **Server**: which Linux server should run it, and how do you reach it (e.g. `ssh myserver`)?
   It needs Docker (with compose), a public IPv4 and about 2 GB free disk. Can you use `sudo` there?
2. **Domain**: which domain or subdomain will you use? Two hostnames are needed:
   - `TELEMETRY_HOSTNAME`, e.g. `tesla.example.com`: public key + the car's stream on port 4443.
     It must **not** sit behind a TLS-terminating proxy (on Cloudflare: *DNS only*, grey cloud).
   - `WEB_HOSTNAME`, e.g. `tracks.example.com`: the dashboard.
   Who manages the DNS (Cloudflare, registrar…)? May you create the records, or will they?
3. **Web server**: does the server already run Caddy, nginx or Traefik on ports 80/443? If not, the
   bundled Caddy (compose profile `caddy`) will be used.
4. **Tesla**: which region is the car in (`eu`, `na`, `cn`)? Does the Tesla account have
   multi-factor authentication on (required by Tesla)? Firmware must be 2024.26 or newer.
5. **Dashboard access**: who should be able to sign in (usernames)? Do they want the public demo for
   visitors with sign-in for real data (recommended), or the dashboard only behind a password?
6. **Optional**: an S3-compatible bucket (Cloudflare R2, S3, MinIO) to mirror the Parquet files?
   Preferred time zone, locale and currency (`TZ`, `TT_LOCALE`, `TT_CURRENCY`)?

Tell the person what this costs: Tesla bills Fleet API usage per signal with a monthly credit for
individuals (about $10). One car streaming only changed values normally stays within it, but Tesla
**requires a payment method** on the developer account. Everything else is free (Let's Encrypt).

## Phase 1 — get the code onto the server

```bash
ssh <server>
git clone https://github.com/victoriano/tesla-tracks ~/tesla-tracks && cd ~/tesla-tracks
cp .env.example .env && chmod 600 .env
mkdir -p secrets certs data && chmod 700 secrets certs
curl -LsSf https://astral.sh/uv/install.sh | sh   # if uv is missing
uv sync
```

Fill `.env` with what you learned: `TESLA_REGION`, `TESLA_APP_DOMAIN` and `TELEMETRY_HOSTNAME`
(the same host), `TESLA_REDIRECT_URI=https://<TELEMETRY_HOSTNAME>/auth/callback`, `WEB_HOSTNAME`,
`TZ`, `TT_LOCALE`, `TT_CURRENCY`, `TT_UID`/`TT_GID` (`id -u`, `id -g`).

**Check:** `uv run tesla-tracks --help` lists the commands.

## Phase 2 — key pair

```bash
uv run tesla-tracks keygen
```

This writes `secrets/private-key.pem` (never share; it identifies the app to the car) and the public
key under `public/.well-known/appspecific/com.tesla.3p.public-key.pem`. Offer to back up the private
key in the person's password manager.

## Phase 3 — DNS, TLS and the public key  *(ask before changing DNS or web server config)*

1. DNS: `A` records for `TELEMETRY_HOSTNAME` (DNS only, no proxy) and `WEB_HOSTNAME` → server IP.
2. Serve the public key and get a Let's Encrypt certificate for `TELEMETRY_HOSTNAME`:
   - **Bundled Caddy:** `docker compose --profile caddy up -d caddy` (uses `deploy/Caddyfile`).
   - **Existing Caddy:** add a site block like the one in `deploy/Caddyfile` that serves
     `/.well-known/appspecific/*` from a directory Caddy can read (copy the key to e.g.
     `/srv/tesla-tracks/.well-known/appspecific/`), answers `/auth/callback` with any 200 page, and
     forces Let's Encrypt with `tls { issuer acme }`. Back up the Caddyfile first, run
     `caddy validate`, then reload. Caddy ≤ 2.6 spells the directive `basicauth`, newer `basic_auth`.
   - **nginx/Traefik:** equivalent config; certbot works too.
3. Open TCP **4443** in the host firewall (`ufw allow 4443/tcp`) and any cloud firewall.

**Check:**
`curl https://<TELEMETRY_HOSTNAME>/.well-known/appspecific/com.tesla.3p.public-key.pem` returns the key,
and the certificate issuer is Let's Encrypt.

## Phase 4 — Tesla developer app  👤 Person (guide them)

Ask the person to sign in at <https://developer.tesla.com> with the Tesla account that owns the car
(or let you drive their browser if you can) and create a Fleet API application:

- Account type: personal ("just for me"); accept the Fleet API agreement.
- Name / description / purpose: e.g. "Personal self-hosted logger for my own car using Fleet
  Telemetry; data stays on my server".
- OAuth grant: **Authorization code and machine-to-machine**.
- Allowed origin: `https://<TELEMETRY_HOSTNAME>`; redirect URI: `https://<TELEMETRY_HOSTNAME>/auth/callback`.
- Scopes: vehicle information, vehicle location, vehicle commands (configuring telemetry may need
  it; Tesla Tracks never sends commands) and vehicle charging management.
- **Billing**: add a payment method and set a monthly billing limit (e.g. a few euros/dollars). With
  no payment method the limit is 0 and the app gets disabled.

Ask them to paste the **client ID** and **client secret** into `.env` themselves, or give them to you
through a secure channel (not plain chat if avoidable). Then:

```bash
set -a; . ./.env; set +a
uv run tesla-tracks register      # registers TELEMETRY_HOSTNAME in the chosen region
```

**Check:** the output shows the registered domain and the same public key.

## Phase 5 — sign in as the car owner

```bash
uv run tesla-tracks login --print-url
```

👤 Person: open the URL, sign in to Tesla, tick all requested permissions, approve. They land on
`https://<TELEMETRY_HOSTNAME>/auth/callback?code=…`; ask them to send you that full URL. Then:

```bash
uv run tesla-tracks login --redirect-url '<the URL they sent>'
uv run tesla-tracks vehicles      # note the VIN; do not paste it publicly
```

Tokens live in `secrets/tokens.json` and refresh automatically (refresh tokens rotate; keep the file).

## Phase 6 — start the stack

```bash
deploy/sync-certs.sh <path to the cert/fullchain> <path to the key>   # e.g. Caddy's certificate files
docker compose up -d --build fleet-telemetry ingester web
```

Install a daily job (cron or systemd timer) that runs `deploy/sync-certs.sh` with the same arguments:
fleet-telemetry only reads its certificate at start-up, and the script restarts it after renewals.

**Check:** `openssl s_client -connect <TELEMETRY_HOSTNAME>:4443 -servername <TELEMETRY_HOSTNAME>`
from another machine shows the certificate and asks for a client certificate.

## Phase 7 — virtual key and streaming  👤 Person

```bash
uv run tesla-tracks pair-url
```

Ask the person to open that link **on their phone, near the car**, confirm in the Tesla app and
approve on the car's screen with the key card. Meanwhile send the streaming configuration; it is
retried until the key is there:

```bash
uv run tesla-tracks telemetry-config --vin <VIN> --wait-hours 48
uv run tesla-tracks telemetry-status <VIN>        # wait for "synced": true
```

The CA sent to the car includes the roots in `telemetry/ca.pem` plus the intermediates of
`certs/fullchain.pem` (required by Tesla's checker). The configuration expires after 360 days:
schedule a reminder to re-run `telemetry-config`.

**Check:** after the next drive, `docker compose logs ingester` shows received records and the
dashboard lists the drive. Verify on the first drive that the distance matches the car's trip meter.

## Phase 8 — dashboard access  *(ask before exposing it)*

The `web` container listens on `127.0.0.1:3000` only. Put it behind the reverse proxy **with
authentication**:

- **Password only:** `basic_auth` on `WEB_HOSTNAME` (hash with `caddy hash-password`).
- **Public demo + sign-in (recommended):** visitors see made-up data, signed-in users the real
  dashboard on the same hostname. Run `deploy/refresh-demo.sh`, start
  `docker compose --profile demo up -d web-demo`, set `TT_AUTH_LINKS=1` in `.env`, and use the
  commented site block at the end of `deploy/Caddyfile` (generate a session secret with
  `openssl rand -hex 32`, one password per user). Note: `redir * / 302`, not `redir / 302`.
  Schedule `deploy/refresh-demo.sh` daily.

Store each generated password in the person's password manager, not in chat.

**Check:** a visitor gets the demo (or a 401), `/login` with each user shows the real dashboard,
`/logout` returns to the demo.

## Phase 9 — optional extras

- **S3/R2 mirror:** set `S3_BUCKET`, `S3_ENDPOINT_URL`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`
  (a token limited to that bucket) and restart the ingester.
- **Tire pressures:** set `TT_TIRE_RECOMMENDED_BAR` to the value on the car's door pillar.

## Finish

Report to the person: URLs, which users can sign in and where their passwords are stored, what runs
on the server (containers and scheduled jobs), what is still pending on their side (usually pairing
or the first drive), and that the streaming configuration must be renewed within a year.
