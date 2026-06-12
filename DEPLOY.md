# Deploying — web on Vercel, API on Render

The platform ships as two deployables from this one repo:

- **`apps/web`** (Next.js 15) → **Vercel**. Proxies `/api/v1/*` and `/graphql` to the API via rewrites; socket.io connects directly from the browser.
- **`apps/api`** (NestJS — REST + GraphQL + socket.io on one port) → **Render** via [render.yaml](render.yaml). Migrations run on every boot; the real-2026 dataset auto-seeds only when the database is empty.

Deploy the API first (the web app needs its URL).

## 0. Prerequisites

- A Postgres database. The Supabase project you already use for auth also provides one (Project Settings → Database → Connection string, use the **pooler** URI for serverless-friendly limits).
- The repo pushed to GitHub/GitLab.

## 1. API → Render

1. Render dashboard → **New → Blueprint** → pick this repo. It reads [render.yaml](render.yaml) and creates the `fifa-api` web service.
2. Fill in the env vars it prompts for:

   | Var | Value |
   |---|---|
   | `DATABASE_URL` | Postgres connection string (**required** — without it data lives on ephemeral disk and is wiped every deploy) |
   | `WEB_ORIGINS` | `https://<your-app>.vercel.app` (comma-separate extras, e.g. a custom domain) |
   | `SUPABASE_URL` | `https://<project>.supabase.co` |
   | `ADMIN_EMAILS` | emails auto-promoted to admin on first Supabase sign-in |
   | `JWT_PRIVATE_KEY` / `JWT_PUBLIC_KEY` | optional but recommended — PEM contents for the local RS256 keypair (generator one-liner is in render.yaml). If unset, every deploy mints new keys and logs out local-auth (ops/admin) sessions. Supabase sign-ins are unaffected. |

3. Deploy. First boot: migrate → seed (~30 s) → serve. Health check: `https://<service>.onrender.com/health`. Swagger at `/docs`, GraphQL at `/graphql`.

Notes:
- The **free** plan sleeps after 15 min idle (first request takes ~1 min) and its CPU makes large Monte Carlo runs crawl — `starter` or above recommended since simulation is the product.
- Re-seeding from scratch: empty the DB (or just `delete from countries;`) and redeploy — the boot script reseeds when `countries` is empty.

## 2. Web → Vercel

1. Vercel → **Add New → Project** → import the repo.
2. **Root Directory: `apps/web`** (Vercel auto-detects the npm workspace and installs from the repo root; [apps/web/vercel.json](apps/web/vercel.json) builds `@fifa/shared` before `next build`).
3. Environment variables:

   | Var | Value |
   |---|---|
   | `API_INTERNAL_URL` | `https://<service>.onrender.com` — rewrite target for `/api/v1` + `/graphql` |
   | `NEXT_PUBLIC_WS_URL` | same Render URL — socket.io connects browser→API directly (websockets don't proxy through Vercel rewrites) |
   | `NEXT_PUBLIC_SUPABASE_URL` | `https://<project>.supabase.co` |
   | `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase publishable/anon key |

4. Deploy, then set Render's `WEB_ORIGINS` to the final Vercel URL (and any custom domain) if you guessed it earlier.

## 3. Supabase checklist

- **Auth → URL Configuration**: add the Vercel URL as Site URL / redirect URL so confirmation emails land back on production.
- Email confirmation is ON for this project — sign-ups get a session only after confirming (the UI handles the "check your inbox" state).

## 4. Smoke test

1. `https://<service>.onrender.com/health` → ok.
2. Open the Vercel app → simulator → run a match sim (exercises the REST rewrite).
3. Check the home page live strip / leaderboards update without reload (exercises the direct websocket — if it doesn't connect, `WEB_ORIGINS` on Render doesn't match the page origin).
4. Sign in via Supabase; confirm your `ADMIN_EMAILS` account lands as admin (profile shows role).

## Local parity

`npm run setup` (build packages + migrate + seed) then `node scripts/start-prod.mjs` boots the exact production path against your local `.env`.
