# Budget Lens

A personal finance dashboard for Israeli bank and credit-card data: transaction
import, categorisation, monthly cash-flow tracking, and a map of where the money
actually goes.

Built with Vite, TypeScript, React, Tailwind CSS and shadcn/ui on top of
Supabase (Postgres + Auth + Edge Functions), deployed on Vercel.

## Heads-up before you run this

This is a single-owner application. Every financial table is protected by
row-level security and scoped to the signed-in user, and **no real financial
data is committed to this repository** — see [SECURITY.md](./SECURITY.md) for
what that means in practice and how to report a problem.

If you fork it, you are bootstrapping an empty database against your own
Supabase project. Nothing here contains anyone else's transactions.

## Getting started

Requires Node.js 20+ (install via [nvm](https://github.com/nvm-sh/nvm#installing-and-updating)).

```sh
git clone <your fork url>
cd budget-lens
npm install
cp .env.example .env      # fill in your own Supabase project values
npm run dev
```

`.env` is gitignored and must never be committed. `.env.example` documents which
values are public client config (the `VITE_*` anon keys, safe in the browser) and
which are server-side secrets that belong in Supabase Edge Function secrets or
Vercel environment variables — never in the repo.

## Database

Schema lives in `supabase/migrations/` and is applied with the Supabase CLI:

```sh
supabase link --project-ref <your-project-ref>
supabase db push
```

Two settings are environment-specific rather than baked into migrations:

- **Owner address** — the account promoted to `owner`. It lives in the
  `app_config` row rather than in a migration, and `public.owner_email()` reads
  it. Set it once per database:

  ```sql
  insert into public.app_config (id, settings)
  values ('auth', jsonb_build_object('owner_email', 'you@example.com'))
  on conflict (id) do update
  set settings = public.app_config.settings || excluded.settings, updated_at = now();
  ```

- `public.sftp_connections` — seed your own row if you use the SFTP import.

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` | Vite dev server |
| `npm run build` | Production build |
| `npm run lint` | ESLint |
| `npm test` | Vitest unit tests |
| `npm run bank-sync` | Local bank/credit-card scraper sync (needs `.env.local` credentials) |
| `npm run foodmap:extract` | Pull food transactions from Supabase to a local, gitignored CSV |
| `npm run foodmap:geocode` | Resolve merchants to coordinates (Google Places; `--osm` or `--mock` also work) |
| `npm run foodmap:publish` | Upload the generated feed to the owner's `food_map_feed` row |
| `npm run foodmap:e2e` | End-to-end contract check for the food-map pipeline |

### Food map data flow

The food map is personal spending geography, so it never ships as a static
asset. The pipeline runs locally (or in the `foodmap-rescan` workflow) and its
outputs stay out of git:

```
Supabase transactions
  → 1-extract   → data/food-transactions.csv     (gitignored)
  → 2-geocode   → data/food-places.local.json    (gitignored)
  → 4-publish   → public.food_map_feed row       (RLS: owner only)
  → /food-map   reads it with the signed-in user's session
```

## Deployment

Vercel builds `dist/` and serves the API routes in `api/`. Supabase Edge
Functions in `supabase/functions/` deploy with `supabase functions deploy`.
Configure every secret listed in `.env.example` in the corresponding dashboard,
not in the repository.

## License

MIT — see [LICENSE](./LICENSE).
