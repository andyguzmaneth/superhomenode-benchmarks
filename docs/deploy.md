# Deploying the explorer

The explorer is a **static site** in `site/`. `site/data/results.json` is committed,
so the site works even with no build step — a build just regenerates that bundle from
`results/`. No secrets or API keys are involved; connect the repo in your provider's
dashboard via GitHub OAuth.

## Cloudflare Pages

1. Pages → *Create a project* → *Connect to Git* → this repo, branch of your choice.
2. Build settings:
   - **Build command:** `node site/build-data.mjs`
   - **Build output directory:** `site`
   - (Framework preset: *None*.)
3. Deploy. Every push rebuilds.

## Vercel

`vercel.json` is already configured (`buildCommand` + `outputDirectory: site`). Just
*Import Project* → this repo. Or CLI: `vercel` then `vercel --prod`.

## Anything else / local

```bash
npm run build          # regenerate site/data/results.json
cd site && python3 -m http.server 8080   # http://localhost:8080
```

Any static host works — point it at `site/` after running the build.

## Note on data shown

Until a reference machine is designated (`docs/reference-machine.md`), deployed numbers
carry the `dev-vm … (NOT home-staker reference)` label and the explorer is showing
development data. That's fine for a preview URL; swap in authoritative results by
committing reference-machine runs.
