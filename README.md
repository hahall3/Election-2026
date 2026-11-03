# Kentucky Election Tracker (GitHub Pages)

1. Create a new GitHub repo and upload everything in this folder (keep the `.github` folder).
2. Settings → Pages → Deploy from branch → `main` / root. Your site appears at `https://<user>.github.io/<repo>/`.
3. Settings → Actions → General → Workflow permissions → **Read and write**.
4. Actions tab → "Update results" → **Run workflow** once to replace the sample data with live data.

The workflow refreshes `data/races.json` about every 5 minutes (GitHub may delay scheduled runs, and pauses them after 60 days without repo activity). The page re-reads the file every 60 seconds.
Change the date, races, or counties in `scripts/fetch.mjs` (top of file). Data: civicapi.org (attribution is in the footer).
