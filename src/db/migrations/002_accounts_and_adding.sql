-- 002_accounts_and_adding: sessions, rate limits, line-level speaker fixes, item edits,
-- plus the translation kind's `subbed` and `pending` columns (Plan 2a).
-- Conventions: docs/decisions/0006-data-model-conventions.md.
-- No fandom data lives here; a site's own values come from site/site.json and site/migrations/.
-- Ordered so every foreign key points at a table that already exists (001_initial).
-- Runs inside one transaction (src/db/migrate.js); never add begin/commit here.

-- ---------------------------------------------------------------------------
-- sessions: web sign-in cookies, keyed by the token's hash so a leaked table
-- never exposes live tokens. NOT audited: session churn would flood the log.
-- ---------------------------------------------------------------------------

create table sessions (
  token_hash text primary key,
  user_id text not null references users(id),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null
);
create index sessions_user on sessions (user_id);

-- ---------------------------------------------------------------------------
-- rate_limits: database-backed counters (Plan 2a Task 3). NOT audited: churn.
-- `window_start` is the row's window, floored to the window length by the
-- service; the app role never stores a raw IP (see test 'ip subjects are hashed').
-- ---------------------------------------------------------------------------

create table rate_limits (
  key text not null,
  window_start timestamptz not null,
  hits integer not null,
  primary key (key, window_start)
);

-- ---------------------------------------------------------------------------
-- translation kind: the "already subbed" flag and the "held for approval" part flag.
-- Added to the existing translations / translation_parts tables (001), so no
-- new tables here; the columns default to false and existing rows keep today's behaviour.
-- ---------------------------------------------------------------------------

alter table translations add column subbed boolean not null default false;
alter table translation_parts add column pending boolean not null default false;

-- ---------------------------------------------------------------------------
-- translation_line_fixes: per-entry, line-level speaker overrides, stored
-- BESIDE the verbatim text (translation_parts.body is never rewritten).
--   line   = the index among that part's non-blank lines (how splitLines counts)
--   as_kind 'plain'  -> neither person_id nor role may be set
--   as_kind 'speech' -> exactly one of person_id or role must be set
-- Audited with row key item_id, like the rest of the translation kind.
-- ---------------------------------------------------------------------------

create table translation_line_fixes (
  item_id bigint not null references translations(item_id),
  position smallint not null,
  line smallint not null,
  as_kind text not null check (as_kind in ('speech', 'plain')),
  person_id bigint references people(id),
  role speaker_role,
  created_at timestamptz not null default now(),
  created_by text references users(id),
  primary key (item_id, position, line),
  check (as_kind = 'plain' and person_id is null and role is null
      or as_kind = 'speech' and (person_id is null) <> (role is null))
);

-- ---------------------------------------------------------------------------
-- item_edits: one row per editing change, holding the before/after JSON and an
-- optional revert link. Audited with row key id (it is an entity in its own right).
-- ---------------------------------------------------------------------------

create table item_edits (
  id bigint generated always as identity primary key,
  item_id bigint not null references items(id),
  before jsonb not null,
  after jsonb not null,
  reverts bigint references item_edits(id),
  created_at timestamptz not null default now(),
  created_by text references users(id)
);
create index item_edits_item on item_edits (item_id);

-- ---------------------------------------------------------------------------
-- audit triggers for the new audited tables. Same pattern as 001: entity tables
-- key by id, child/kind tables by their parent, so one item's whole history is
-- one row_key lookup. sessions and rate_limits are intentionally absent.
-- ---------------------------------------------------------------------------

do $$
declare
  t record;
begin
  for t in
    select * from (values
      ('item_edits', 'id'),
      ('translation_line_fixes', 'item_id')
    ) as audited (table_name, key_column)
  loop
    execute format(
      'create trigger %I before insert or update on %I for each row execute function set_common()',
      t.table_name || '_set_common', t.table_name);
    execute format(
      'create trigger %I after insert or update or delete on %I for each row execute function write_audit(%L)',
      t.table_name || '_audit', t.table_name, t.key_column);
  end loop;
end;
$$;
