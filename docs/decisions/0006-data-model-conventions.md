# 0006: Data model conventions

## Context

The engine is a template: many sites pull its updates, and every schema change becomes a migration each of them must run (ADR 0004). The owner asked for a schema that needs few future changes and is normalised. The archive is also multi-platform (X, Instagram, TikTok, YouTube, Weverse, Telegram) and multi-kind (translations first, other item kinds later as plugins), it needs an edit log so mistakes can be undone, and it holds fans' contributions, so what is kept, and for how long, has to be deliberate.

These conventions apply to `src/db/migrations/001_initial.sql` and to every later migration, engine or site.

## Decision

1. **Common columns on every entity table.** `id bigint generated always as identity` (lookups use `smallint` ids or text codes), `created_at`, `updated_at`, `created_by`, `updated_by`, `deleted_at`, `deleted_by`, and `meta jsonb not null default '{}'`. `users` keeps a text `id` (the sign-in subject). Join tables carry only `created_at` and `created_by`.
   *Why:* every table answers "who changed this, when" the same way, so repos, the audit log and the owner tools need no per-table code, and new needs (a display extra, a soft delete) need no migration.
2. **Soft delete only.** The app never hard-deletes. The exceptions are the owner's erasure scripts (Plan 3, for a person's erasure request) and rewriting a join table's rows.
   *Why:* everyday mistakes are undone by clearing `deleted_at`; permalinks keep resolving to a "removed" page instead of a 404.
3. **The audit log is automatic and stores diffs.**
   - `set_common()` (BEFORE INSERT/UPDATE) stamps `updated_at`, and `created_by`/`updated_by` from `app.actor`, touching only the columns the table has. It **raises** when `app.actor` is missing or empty. `transaction(fn, { actor })` in `src/db/client.js` sets it with `set_config('app.actor', $1, true)`; after a transaction Postgres reads it back as `''`, not null, hence `nullif(…, '')`.
   - `write_audit()` (AFTER INSERT/UPDATE/DELETE) writes `audit_log`: `row_key` (text) from the column named by the trigger argument (default `id`), `action`, `actor`, and `changes` (insert: null; update: only the changed columns' **old** values, ignoring `updated_at`/`updated_by`, and **no row at all when nothing changed**; delete: the full old row).
   - It is attached to entity tables and to join and kind tables, keyed by their parent (`item_id`, `event_id`, `person_id`), so an item's whole history, speakers and people included, is one `row_key` lookup.
   - Not audited: `tags`, the lookups, `categories`, `clients`, `source_aliases`, `source_checks`, `import_rows`, `speaker_memory` (caches, queues and health-check churn).
   - `write_audit()` is `SECURITY DEFINER` with a pinned `search_path`, so the app's role needs no write access to `audit_log`. `grant_app_role(role)` grants the app role read/write on every table **except** `update`/`delete`/`truncate` on `audit_log` (and any write to `schema_migrations`); run it as the owner after each migrate.
   *Why:* the edit log comes free with every write, can't be skipped by forgetting a repo call, and stores only what changed, which keeps the table small. Writes with no known actor are refused.
4. **`meta` is only for display-only extras.** Anything filtered, joined, sorted, searched or unique gets a real column.
   *Why:* `meta` absorbs small additions without a migration, but anything queried needs a column for constraints and indexes.
5. **Values that will grow are lookup rows** with text codes as primary keys: `platforms`, `item_kinds`, `source_roles`, `added_via`, `deleted_reasons`, `link_relations`, `item_person_roles`. Closed sets stay as checks: `placement`, `review_state`, `status`, `action`. Speaker roles use the `speaker_role` domain. A test (`test/db/constants.test.js`) checks the checks, the domain and `item_kinds` against `src/domain/constants.js` and the kinds registry.
   *Why:* a new platform or kind is an `insert`, not an `alter`; a text code reads without a join.
6. **Relations are join tables** (people on items, tags, sources, links between items, speakers, event people).
   *Why:* multi-platform and multi-kind data stays in one shape; each relation can be audited and constrained on its own.
7. **Slugs are unique forever, including on deleted rows,** so permalinks are never reused. Other unique keys are partial on `deleted_at is null`, and repos **restore** a soft-deleted row instead of inserting a duplicate.
   *Why:* a shared link must never point at a different thing later.
8. **Timestamps are `timestamptz`; days are `date` in the site's time zone.** SQL derives a day only via `(ts at time zone $tz)::date`. Both drivers return `date` as the raw `'YYYY-MM-DD'` string and `bigint` as a JS number (an exact string beyond `Number.MAX_SAFE_INTEGER`), via the parsers registered in `src/db/common.js` and `src/db/client.js`.
   *Why:* the two drivers' defaults differ (`docs/spikes.md`, Step 2) and a `Date` for a calendar day shifts with the server's time zone.
9. **Ids are `generated always as identity`.** Restoring from a dump uses `pg_restore`, which handles identities. A manual JSON import must use `insert … overriding system value` and then `select setval(pg_get_serial_sequence('<table>', 'id'), max(id)) from <table>`.
   *Why:* the database, not the app, owns id assignment; this is the price for imports.

## Consequences

- New platforms, kinds, source roles and removal reasons need no schema change; most display additions need none either.
- Every write must go through `db.transaction(fn, { actor })`; a bare `db.query('insert …')` fails by design. Reads may use `db.query`.
- The audit log can grow; reports and audit rows are pruned after 12–24 months (Plan 3), and full erasure scripts cover the audit log too.
- Kind tables and `item_sources` pin their item's kind with a composite foreign key to `items (id, kind)`, so a translation row can't point at another kind's item; the same post can still be archived once per kind.
- `translation_parts` are append-only by convention (repos never rewrite them), except the one re-fetch after a post's edit window closes; the database doesn't enforce this, the audit log records it.
- On PGlite there is one connection: inside `transaction(fn)`, code must use `tx`, never the outer `db`, or it waits forever.
