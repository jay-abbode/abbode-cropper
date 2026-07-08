# Abbode Cropper

Batch product-image cropper. Upload a folder (one product), set output dimensions,
describe the framing in plain English, watch the detection visualizer, QC in a
carousel, then rerun with feedback or manually nudge flagged images. Download as ZIP.

- Detection: background-distance + saturation mask → morphological opening →
  largest component → optional mirror-symmetry axis ("front face" centering).
- Instruction parsing: Claude (claude-sonnet-4-6) via ANTHROPIC_API_KEY; keyword
  fallback if unset.
- Auth: NextAuth v5 Google, restricted to @shopabbode.com. `AUTH_DISABLED=true` for local dev.
- Deploy target: Vercel (connect the GitHub repo; no extra config).

## Local
cp .env.example .env.local   # AUTH_DISABLED=true is enough to start
npm install
npm run dev

## Vercel
Import the repo at vercel.com/new, add env vars (AUTH_DISABLED=true for a first
look, or the full auth set), deploy. Pushes to main auto-deploy.

Notes: works best on plain/studio backgrounds; images are processed in memory,
nothing is stored server-side. One image per request keeps each upload well under
Vercel's 4.5 MB function body limit (product JPGs run ~1–2 MB).
