# Abbode Cropper

Batch product-image cropper. Upload a folder (one product), set output dimensions,
describe the framing in plain English, watch the detection visualizer, QC in a
carousel, then rerun with feedback or manually nudge flagged images. Download as ZIP.

- Detection: background-distance + saturation mask → morphological opening →
  largest component → optional mirror-symmetry axis ("front face" centering).
- Instruction parsing: Claude (claude-sonnet-4-6) via ANTHROPIC_API_KEY; keyword
  fallback if unset.
- Auth: NextAuth v5 Google, restricted to @shopabbode.com. `AUTH_DISABLED=true` for local dev.
- Deploy target: Google Cloud Run (Dockerfile included, listens on $PORT).

## Local
cp .env.example .env.local   # AUTH_DISABLED=true is enough to start
npm install
npm run dev

## Cloud Run
gcloud run deploy abbode-cropper --source . --region us-east1 \
  --allow-unauthenticated --memory 2Gi --cpu 2
Then wire OAuth (see chat walkthrough) and redeploy with env vars set.

Notes: works best on plain/studio backgrounds; images are processed in memory,
nothing is stored server-side; one image per request keeps well under Cloud Run's
32 MB request cap.
