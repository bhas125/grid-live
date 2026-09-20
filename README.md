# GRID

Tennessee county situation monitor — map, news, markets, crime, sit briefs.

- Latest build: https://daisy-opal-arch-summit.grok.me
- Production domain: https://grid.blastpad.app

## UX preview playtest

Use the **Vercel Preview URL on the PR** — not production, not `grid.blastpad.app`.

1. Open the Preview URL from the pull request.
2. Hard-refresh once (`Cmd/Ctrl-Shift-R`) so the new ops strip and cluster rings load.
3. Pass the existing Google 404 gate the same way as production.
4. Turn on **Crime**. YTD stays the default. Snapshot data prefers live `https://grid.blastpad.app/crime-tn.json`.

Included in this preview:

- Persistent HOM / SHT / LEAD ops bar **under the map** (no flash of zeros on load)
- First-run dismissible tips (localStorage)
- **HOM only** chip (clears SHT)
- Always-visible **STATE** when a county is drilled
- Crime pin/cluster hits beat Roads; larger phone tap targets
- Motion-style ripple clusters (HOM red / SHT amber) with a center count
- Clamped `√n` bubble scale so YTD metros cannot eat the map
- TODAY empty-state one-liner
- Light 150ms popup scale/opacity — no Lottie
- Metro agency chips (MEM / NASH / CHAT / REST) removed

Do not promote this preview to production. Palette, Lead purple, YTD default, gate, and the crime merge pipeline are unchanged.

## Put this version on grid.blakehassler.com

DNS is already pointed at Vercel. No DNS change is required.
The existing Vercel project `grid` on team **bhas123's projects** owns that domain.

1. Install the Vercel GitHub App and grant it `bhas125/grid`:
   https://github.com/apps/vercel
2. Open the existing project:
   https://vercel.com/bhas123s-projects/grid
3. **Settings → Git → Connect Repository** → choose `bhas125/grid`.
4. **Deployments → Create Deployment** from branch `main`, environment **Production**.

That replaces the old static/patched build with this repo and keeps `grid.blakehassler.com`.

If Git is already connected to an older repo, disconnect it first, then connect `bhas125/grid` and redeploy production.

