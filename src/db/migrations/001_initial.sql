-- 001_initial: the engine's core schema. Conventions and their reasons: docs/decisions/0006-data-model-conventions.md.
-- No fandom data lives here; a site's own values come from site/site.json and site/migrations/.
-- Ordered so every foreign key points at a table that already exists.
-- Runs inside one transaction (src/db/migrate.js); never add begin/commit here.

create extension if not exists pg_trgm;

-- Generic speaker roles; must equal ROLES in src/domain/constants.js (test/db/constants.test.js).
create domain speaker_role as text check (value in ('host', 'fan', 'speaker', 'crowd'));

-- ---------------------------------------------------------------------------
-- users first: every created_by / updated_by / deleted_by points here
-- ---------------------------------------------------------------------------

create table users (
  id text primary key,
  display_name text,
  role text not null default 'member' check (role in ('owner', 'member', 'system')),
  blocked_at timestamptz,
  meta jsonb not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by text,
  updated_by text,
  deleted_at timestamptz,
  deleted_by text
);
insert into users (id, display_name, role, created_by) values ('system', 'system', 'system', 'system');

-- ---------------------------------------------------------------------------
-- text-coded lookups: extend by inserting rows, no migration needed
-- ---------------------------------------------------------------------------

create table platforms (code text primary key);
insert into platforms values ('x'), ('instagram'), ('tiktok'), ('youtube'), ('weverse'), ('telegram');

-- one row per kind folder in src/kinds/ (each kind's own migration inserts its row)
create table item_kinds (code text primary key);
insert into item_kinds values ('translation');

create table source_roles (code text primary key);
insert into source_roles values ('primary'), ('follow_up'), ('media'), ('quoted'), ('full_video');

create table added_via (code text primary key);
insert into added_via values ('submit'), ('notion'), ('paste'), ('cli'), ('telegram');

create table deleted_reasons (code text primary key);
insert into deleted_reasons values
  ('removed_by_account'), ('hidden_by_owner'), ('duplicate'), ('spam'), ('blocked_submitter'), ('erased');

create table link_relations (code text primary key);
insert into link_relations values ('follows_on');

create table item_person_roles (code text primary key);
insert into item_person_roles values ('present'), ('sharing'), ('about'), ('author');

-- owner-managed lists (small, so smallint ids)
create table categories (
  id smallint generated always as identity primary key,
  name text not null,
  deleted_at timestamptz,
  created_at timestamptz not null default now()
);
create unique index categories_name on categories (lower(name)) where deleted_at is null;

create table clients (
  id smallint generated always as identity primary key,
  name text not null,
  deleted_at timestamptz,
  created_at timestamptz not null default now()
);
create unique index clients_name on clients (lower(name)) where deleted_at is null;

-- runtime settings the owner can change without a deploy
create table settings (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now(),
  updated_by text references users(id)
);

-- ---------------------------------------------------------------------------
-- people & accounts
-- ---------------------------------------------------------------------------

create table people (
  id bigint generated always as identity primary key,
  display_name text not null,
  emoji text not null,
  colour text not null check (colour ~ '^#[0-9a-f]{6}$'),
  featured boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by text references users(id),
  updated_by text references users(id),
  deleted_at timestamptz,
  deleted_by text references users(id),
  meta jsonb not null default '{}'
);

create table person_aliases (
  person_id bigint not null references people(id),
  alias text not null check (alias = lower(alias)),
  created_at timestamptz not null default now(),
  created_by text references users(id),
  primary key (alias)
);
create index person_aliases_person on person_aliases (person_id);

create table accounts (
  id bigint generated always as identity primary key,
  platform text not null references platforms(code),
  external_id text,
  handle text not null,
  display_name text,
  person_id bigint references people(id),
  is_identity boolean not null default false,
  user_id text references users(id),
  opted_out_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by text references users(id),
  updated_by text references users(id),
  deleted_at timestamptz,
  deleted_by text references users(id),
  meta jsonb not null default '{}'
);
create unique index accounts_external on accounts (platform, external_id) where external_id is not null;
create unique index accounts_handle_only on accounts (platform, lower(handle)) where external_id is null and deleted_at is null;
create index accounts_handle on accounts (platform, lower(handle));
create unique index accounts_identity on accounts (person_id) where is_identity and deleted_at is null;
create index accounts_user on accounts (user_id);

-- ---------------------------------------------------------------------------
-- projects, events
-- ---------------------------------------------------------------------------

create table projects (
  id bigint generated always as identity primary key,
  slug text unique not null check (slug ~ '^[a-z0-9-]+$'),
  name text not null,
  starts_on date,
  ends_on date check (ends_on is null or starts_on is null or ends_on >= starts_on),
  category_id smallint references categories(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by text references users(id),
  updated_by text references users(id),
  deleted_at timestamptz,
  deleted_by text references users(id),
  meta jsonb not null default '{}'
);

create table events (
  id bigint generated always as identity primary key,
  slug text unique not null check (slug ~ '^[a-z0-9-]+$'),
  name text not null,
  occurred_on date not null,
  starts_at timestamptz,
  project_id bigint references projects(id),
  category_id smallint references categories(id),
  client_id smallint references clients(id),
  live_platform text references platforms(code),
  needs_review boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by text references users(id),
  updated_by text references users(id),
  deleted_at timestamptz,
  deleted_by text references users(id),
  meta jsonb not null default '{}'
);
create index events_occurred on events (occurred_on desc) where deleted_at is null;

create table event_people (
  event_id bigint not null references events(id),
  person_id bigint not null references people(id),
  role text not null default 'live' check (role in ('live', 'performer', 'guest')),
  created_at timestamptz not null default now(),
  created_by text references users(id),
  primary key (event_id, person_id, role)
);
create index event_people_person on event_people (person_id, event_id);

-- ---------------------------------------------------------------------------
-- tags
-- ---------------------------------------------------------------------------

create table tags (
  id bigint generated always as identity primary key,
  kind text not null check (kind in ('hashtag', 'keyword')),
  display text not null,
  norm text not null,
  ignored boolean not null default false,
  created_at timestamptz not null default now(),
  unique (kind, norm)
);

create table event_tags (
  event_id bigint not null references events(id),
  tag_id bigint not null references tags(id),
  created_at timestamptz not null default now(),
  created_by text references users(id),
  primary key (event_id, tag_id)
);
create index event_tags_tag on event_tags (tag_id);

-- ---------------------------------------------------------------------------
-- items: shared by every kind
-- ---------------------------------------------------------------------------

create table items (
  id bigint generated always as identity primary key,
  kind text not null references item_kinds(code),
  -- must equal PLACEMENTS in src/domain/constants.js
  placement text not null check (placement in ('event', 'shared_story', 'post', 'unsorted')),
  event_id bigint references events(id),
  category_id smallint references categories(id),
  client_id smallint references clients(id),
  credited_account_id bigint references accounts(id),
  occurred_on date not null,
  posted_at timestamptz,
  added_via text not null references added_via(code),
  -- must equal REVIEW_STATES in src/domain/constants.js
  review_state text not null default 'published' check (review_state in ('pending', 'published', 'rejected')),
  sort_key double precision not null,
  deleted_reason text references deleted_reasons(code),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by text references users(id),
  updated_by text references users(id),
  deleted_at timestamptz,
  deleted_by text references users(id),
  meta jsonb not null default '{}',
  -- lets kind tables and item_sources pin the item's kind with a composite foreign key
  unique (id, kind),
  check ((placement = 'event') = (event_id is not null)),
  check ((deleted_at is null) = (deleted_reason is null))
);
create index items_event on items (event_id, sort_key, id) where deleted_at is null;
create index items_account on items (credited_account_id);
create index items_created_by on items (created_by);
create index items_posted on items (posted_at desc) where deleted_at is null;

create table item_people (
  item_id bigint not null references items(id),
  person_id bigint not null references people(id),
  role text not null references item_person_roles(code),
  created_at timestamptz not null default now(),
  created_by text references users(id),
  primary key (item_id, person_id, role)
);
create index item_people_person on item_people (person_id, item_id);

create table item_tags (
  item_id bigint not null references items(id),
  tag_id bigint not null references tags(id),
  created_at timestamptz not null default now(),
  created_by text references users(id),
  primary key (item_id, tag_id)
);
create index item_tags_tag on item_tags (tag_id);

create table item_sources (
  id bigint generated always as identity primary key,
  item_id bigint not null,
  kind text not null,
  platform text not null references platforms(code),
  external_id text,
  url text not null check (url ~ '^https://'),
  role text not null references source_roles(code),
  position smallint not null default 0,
  account_id bigint references accounts(id),
  start_seconds int,
  media jsonb,
  -- the platform's edit window for this post; after it closes the post is re-fetched once
  editable_until timestamptz,
  edit_finalized_at timestamptz,
  last_refreshed_at timestamptz,
  status text not null default 'live' check (status in ('live', 'deleted', 'unavailable')),
  created_at timestamptz not null default now(),
  created_by text references users(id),
  foreign key (item_id, kind) references items (id, kind)
);
-- the same primary post may be archived once per kind (a translation and, say, a subtitle)
create unique index item_sources_primary_per_kind on item_sources (kind, platform, external_id) where role = 'primary';
create unique index item_sources_one_primary on item_sources (item_id) where role = 'primary';
create index item_sources_item on item_sources (item_id);

-- every version id of an edited post maps to its source, so any version counts as a duplicate
create table source_aliases (
  platform text not null references platforms(code),
  external_id text not null,
  source_id bigint not null references item_sources(id),
  primary key (platform, external_id)
);
create index source_aliases_source on source_aliases (source_id);

-- NOT audited: health-check churn would flood the audit log
create table source_checks (
  source_id bigint primary key references item_sources(id),
  checked_at timestamptz not null,
  consecutive_failures int not null default 0
);

create table item_links (
  from_item_id bigint not null references items(id),
  to_item_id bigint not null references items(id),
  relation text not null references link_relations(code),
  created_at timestamptz not null default now(),
  created_by text references users(id),
  primary key (from_item_id, to_item_id, relation)
);
create index item_links_to on item_links (to_item_id);

-- ---------------------------------------------------------------------------
-- translation kind
-- ---------------------------------------------------------------------------

create table translations (
  item_id bigint primary key,
  kind text not null default 'translation' check (kind = 'translation'),
  text_entered_manually boolean not null default false,
  foreign key (item_id, kind) references items (id, kind)
);

-- Each post's text is its own part: position 0 = the main post, 1..n = follow-ups (added at intake, by the
-- manual "check for follow-ups" button, or by attaching a pasted follow-up). Parts are only ever added, except
-- the one-time re-fetch after a post's edit window closes (item_sources.edit_finalized_at), which may update a
-- part's body; the audit log keeps the earlier wording.
create table translation_parts (
  item_id bigint not null references translations(item_id),
  position smallint not null,
  source_id bigint references item_sources(id),
  body text not null,
  created_at timestamptz not null default now(),
  created_by text references users(id),
  primary key (item_id, position)
);
create index translation_parts_body_trgm on translation_parts using gin (body gin_trgm_ops);

-- a speaker marker maps to a known person or to a generic role, never both
create table translation_speakers (
  item_id bigint not null references translations(item_id),
  marker text not null,
  person_id bigint references people(id),
  role speaker_role,
  check ((person_id is null) <> (role is null)),
  primary key (item_id, marker)
);
create index translation_speakers_person on translation_speakers (person_id);

-- NOT audited: a per-account suggestion cache, rewritten on every submit
create table speaker_memory (
  account_id bigint not null references accounts(id),
  marker text not null,
  person_id bigint references people(id),
  role speaker_role,
  check ((person_id is null) <> (role is null)),
  updated_at timestamptz not null default now(),
  primary key (account_id, marker)
);

-- ---------------------------------------------------------------------------
-- system
-- ---------------------------------------------------------------------------

create table reports (
  id bigint generated always as identity primary key,
  target_table text not null check (target_table in ('events', 'items', 'people', 'accounts')),
  target_id bigint not null,
  reason text not null check (length(reason) <= 2000),
  status text not null default 'open' check (status in ('open', 'resolved', 'dismissed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by text references users(id),
  updated_by text references users(id),
  deleted_at timestamptz,
  deleted_by text references users(id),
  meta jsonb not null default '{}'
);

create table import_jobs (
  id bigint generated always as identity primary key,
  source text not null check (source in ('notion', 'paste', 'telegram')),
  status text not null default 'queued' check (status in ('queued', 'running', 'done', 'failed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by text references users(id),
  updated_by text references users(id),
  deleted_at timestamptz,
  deleted_by text references users(id),
  meta jsonb not null default '{}'
);

-- NOT audited: queue state churn; the job itself and the items it publishes are audited
create table import_rows (
  id bigint generated always as identity primary key,
  job_id bigint not null references import_jobs(id),
  platform text not null references platforms(code),
  external_id text not null,
  overrides jsonb not null default '{}',
  state text not null default 'queued'
    check (state in ('queued', 'fetched', 'needs_speakers', 'check', 'published', 'skipped', 'failed')),
  item_id bigint references items(id),
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (job_id, platform, external_id)
);

-- Written only by write_audit() below. changes: insert = null; update = the changed columns' OLD values;
-- delete = the full old row.
create table audit_log (
  id bigint generated always as identity primary key,
  table_name text not null,
  row_key text not null,
  action text not null check (action in ('insert', 'update', 'delete')),
  actor text not null,
  at timestamptz not null default now(),
  changes jsonb
);
create index audit_log_row on audit_log (table_name, row_key);
create index audit_log_at on audit_log using brin (at);
revoke all on table audit_log from public;

-- ---------------------------------------------------------------------------
-- triggers
-- ---------------------------------------------------------------------------

-- BEFORE INSERT/UPDATE: stamps the bookkeeping columns the table actually has, from app.actor
-- (set by transaction() in src/db/client.js). Refuses the write when no actor is set: after a
-- transaction ends, current_setting('app.actor', true) reads '' rather than null, hence nullif.
create function set_common() returns trigger
language plpgsql as $$
declare
  actor text := nullif(current_setting('app.actor', true), '');
  cols jsonb := to_jsonb(new);
  patch jsonb := '{}';
begin
  if actor is null then
    raise exception 'app.actor not set: write inside db.transaction(fn, { actor })';
  end if;
  if tg_op = 'INSERT' and cols ? 'created_by' then
    patch := patch || jsonb_build_object('created_by', actor);
  end if;
  if cols ? 'updated_by' then
    patch := patch || jsonb_build_object('updated_by', actor);
  end if;
  if tg_op = 'UPDATE' and cols ? 'updated_at' then
    patch := patch || jsonb_build_object('updated_at', now());
  end if;
  return jsonb_populate_record(new, patch);
end;
$$;

-- AFTER INSERT/UPDATE/DELETE: one audit_log row per changed row, keyed by the column named in the
-- trigger's argument (default 'id'; child tables pass their parent's key). Updates store only the
-- changed columns' old values (ignoring updated_at/updated_by) and are skipped when nothing changed.
-- SECURITY DEFINER so the app role needs no write access to audit_log; search_path is pinned, and
-- audit_log is addressed in the audited table's own schema.
create function write_audit() returns trigger
language plpgsql security definer set search_path = pg_catalog, pg_temp as $$
declare
  actor text := nullif(current_setting('app.actor', true), '');
  key_column text := coalesce(tg_argv[0], 'id');
  row_data jsonb;
  diff jsonb;
begin
  if actor is null then
    raise exception 'app.actor not set: write inside db.transaction(fn, { actor })';
  end if;
  if tg_op = 'INSERT' then
    row_data := to_jsonb(new);
    diff := null;
  elsif tg_op = 'UPDATE' then
    row_data := to_jsonb(new);
    select jsonb_object_agg(o.key, o.value) into diff
    from jsonb_each(to_jsonb(old)) as o
    where o.key not in ('updated_at', 'updated_by')
      and o.value is distinct from row_data -> o.key;
    if diff is null then
      return null;
    end if;
  else
    row_data := to_jsonb(old);
    diff := row_data;
  end if;
  execute format(
    'insert into %I.audit_log (table_name, row_key, action, actor, changes) values ($1, $2, $3, $4, $5)',
    tg_table_schema)
  using tg_table_name, row_data ->> key_column, lower(tg_op), actor, diff;
  return null;
end;
$$;

-- Entity tables are keyed by their own id; child, join and kind tables by their parent, so one
-- item's (or event's, or person's) whole history is one row_key lookup.
-- NOT audited: tags, the lookup tables, categories, clients, source_aliases, source_checks,
-- import_rows, speaker_memory, audit_log.
do $$
declare
  t record;
begin
  for t in
    select * from (values
      ('users', 'id'),
      ('people', 'id'),
      ('accounts', 'id'),
      ('projects', 'id'),
      ('events', 'id'),
      ('items', 'id'),
      ('reports', 'id'),
      ('import_jobs', 'id'),
      ('settings', 'key'),
      ('person_aliases', 'person_id'),
      ('event_people', 'event_id'),
      ('event_tags', 'event_id'),
      ('item_people', 'item_id'),
      ('item_tags', 'item_id'),
      ('item_sources', 'item_id'),
      ('item_links', 'from_item_id'),
      ('translations', 'item_id'),
      ('translation_parts', 'item_id'),
      ('translation_speakers', 'item_id')
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

-- ---------------------------------------------------------------------------
-- the app's database role
-- ---------------------------------------------------------------------------

-- Grants a (login or group) role what the running app needs on this schema: read and write every
-- table, but never update, delete or truncate audit_log (write_audit() inserts as the owner) or
-- touch schema_migrations. Run as the schema owner after every migrate: select grant_app_role('app');
create function grant_app_role(app regrole) returns void
language plpgsql as $$
begin
  execute format('grant usage on schema %I to %s', current_schema(), app);
  execute format('grant select, insert, update, delete on all tables in schema %I to %s', current_schema(), app);
  execute format('grant usage, select on all sequences in schema %I to %s', current_schema(), app);
  execute format('revoke insert, update, delete, truncate on table audit_log from %s', app);
  execute format('revoke insert, update, delete, truncate on table schema_migrations from %s', app);
end;
$$;
