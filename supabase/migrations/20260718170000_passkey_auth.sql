create table if not exists public.passkey_credentials (
  credential_id text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  public_key text not null,
  counter bigint not null default 0,
  transports jsonb not null default '[]'::jsonb,
  device_name text,
  created_at timestamptz not null default now(),
  last_used_at timestamptz
);
create index if not exists passkey_credentials_user_id_idx
  on public.passkey_credentials(user_id);
create table if not exists public.passkey_challenges (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade,
  challenge text not null,
  purpose text not null check (purpose in ('registration', 'authentication')),
  expires_at timestamptz not null default (now() + interval '5 minutes'),
  used_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists passkey_challenges_lookup_idx
  on public.passkey_challenges(id, purpose, expires_at);
alter table public.passkey_credentials enable row level security;
alter table public.passkey_challenges enable row level security;
revoke all on public.passkey_credentials from anon, authenticated;
revoke all on public.passkey_challenges from anon, authenticated;
grant all on public.passkey_credentials to service_role;
grant all on public.passkey_challenges to service_role;
