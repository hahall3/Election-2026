# Kentucky Election Dashboard 2026 — Election 2026 Initiative

1. Settings → Pages → **Source: GitHub Actions** (required — the workflow publishes with `actions/deploy-pages@v4`; "Deploy from branch" will not work).
2. Settings → Actions → General → Workflow permissions → **Read and write**.
3. Actions tab → "Update and Deploy Dashboard" → **Run workflow** to refresh immediately.

The workflow runs every 5 minutes across 8 matrix workers (`scripts/fetch.mjs`), merges shards into `data/races.json` (`scripts/merge.mjs`), and deploys `dist/` to GitHub Pages. The page re-reads `data/races.json` every 60 seconds.

Scope: U.S. Senate, U.S. House, and Governor races nationwide, plus all Kentucky state/county/local races. Races that no longer match the selection rules are pruned automatically on the next successful run.

Data: civicapi.org (attribution is in the footer).
