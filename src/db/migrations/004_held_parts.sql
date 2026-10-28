-- 004_held_parts: a held follow-up part the owner rejected stays hidden without
-- being deleted (the verbatim text is never destroyed), and leaves the waiting
-- list. Plan 2b's review of appended parts.
-- Conventions: docs/decisions/0006-data-model-conventions.md.
-- Runs inside one transaction (src/db/migrate.js); never add begin/commit here.

alter table translation_parts add column rejected boolean not null default false;
