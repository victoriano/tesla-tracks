# Notes for AI agents

- **Asked to install / self-host Tesla Tracks for someone?** Follow
  [`web/public/agent-setup.md`](web/public/agent-setup.md) (also served at `/agent-setup.md` by every
  instance, e.g. https://tracks.victoriano.me/agent-setup.md). It lists what to ask the person and which
  steps need their approval.
- **Working on the code?** Python (uv) in `src/tesla_tracks` with tests in `tests/` (`uv run pytest`,
  `uv run ruff check`); the dashboard is Next.js in `web/` (`npm run lint && npm run build`).
- Never commit secrets: `.env`, `secrets/`, `certs/`, `data/` and `demo-data/` are git-ignored.
