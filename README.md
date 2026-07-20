# Sugarcane Farm Manager

Offline-first PWA for Philippine sugarcane smallholders, with Supabase-backed
cloud sync via Netlify Functions.

## Deploy
Connect this repo to Netlify (Site configuration → Build & deploy → Link repository).
No build command is required for the frontend (`index.html` is served as-is);
Netlify will detect and bundle `functions/` automatically via `netlify.toml`.

Required Netlify environment variables:
- `SUPABASE_URL`
- `SUPABASE_SERVICE_KEY`
- `SECRETS_SCAN_ENABLED=false`
