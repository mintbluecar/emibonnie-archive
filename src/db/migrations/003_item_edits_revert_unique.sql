-- 003_item_edits_revert_unique: one revert row per edit, enforced by the database
-- so a concurrent second revert is a conflict rather than a lost fix (Plan 2a).
-- A partial unique index (not a column constraint) keeps every unreverted edit,
-- whose `reverts` is null, free to stay null.
-- Runs inside one transaction (src/db/migrate.js); never add begin/commit here.

create unique index item_edits_reverts_unique on item_edits (reverts) where reverts is not null;
