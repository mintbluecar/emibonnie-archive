-- 005_import_review: the review states Plan 3 needs (an attached follow-up row)
-- and the deletion reason a skipped import row uses. No new tables.
-- Conventions: docs/decisions/0006-data-model-conventions.md.
-- Runs inside one transaction (src/db/migrate.js); never add begin/commit here.

insert into deleted_reasons values ('import_skipped');

-- import_rows.state was created inline in 001, so its check is auto-named.
alter table import_rows drop constraint import_rows_state_check;
alter table import_rows add constraint import_rows_state_check
  check (state in ('queued', 'fetched', 'needs_speakers', 'check', 'published', 'skipped', 'failed', 'attached'));

create index import_rows_job_state on import_rows (job_id, state);
