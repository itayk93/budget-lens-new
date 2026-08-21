# Security

## Reporting a vulnerability

Please report security issues privately through GitHub's
[private vulnerability reporting](https://docs.github.com/en/code-security/security-advisories/guidance-on-reporting-and-writing-information-about-vulnerabilities/privately-reporting-a-security-vulnerability)
on this repository, rather than opening a public issue.

## What is and is not in this repository

This is a personal finance application. The repository contains **code and
schema only** — no transactions, no statements, no account identifiers, and no
credentials.

Specifically:

- **No secrets are committed.** Every key is read from the environment. `.env`
  and `.env.*` are gitignored (except `.env.example`, which contains only empty
  placeholders). The `VITE_*` values are Supabase anon/publishable config and are
  public by design; everything else is a server-side secret configured in
  Supabase or Vercel.
- **No financial data is committed.** The food-map pipeline generates real
  merchant names, coordinates and amounts, but those artifacts
  (`data/food-transactions.csv`, `data/food-places.local.json`,
  `data/geocode-*.json`) are gitignored and published only to an RLS-protected
  `food_map_feed` row readable by their owner.
- **Nothing personal is served from `/public`.** Anything placed there is
  world-readable without authentication.

Git history has been rewritten to remove financial data and personal
identifiers that were present in earlier commits.

## Access model

- Supabase Auth backs all sessions; every application route except `/login` and
  the landing page requires an authenticated user.
- Row-level security is enabled on the application tables, scoping rows to
  `auth.uid()`. Writes that must bypass RLS run in Edge Functions or server-side
  API routes with the service-role key, which is never exposed to the client.
- The service-role key exists only as a server-side secret. If you fork this
  project, generate your own — never reuse a key from anywhere else.

## If you fork this

1. Create your own Supabase project and run `supabase db push`.
2. Set the owner address in the `app_config` row (see the README) — no personal
   address is baked into any migration.
3. Generate fresh values for every secret in `.env.example`.
4. Keep `public/` free of anything derived from your real financial data.
