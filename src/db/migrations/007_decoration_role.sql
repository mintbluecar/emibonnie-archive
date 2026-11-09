-- 007_decoration_role: a fifth speaker role, 'decoration', for an emoji a translator only
-- ever writes attached to another one (🐰💙 is one person, 🦊💙 another): it names nobody,
-- so lines drop it from a run of emoji (src/kinds/translation/presenter.js). Must equal
-- ROLES in src/domain/constants.js (test/db/constants.test.js).
-- Conventions: docs/decisions/0006-data-model-conventions.md.
-- Runs inside one transaction (src/db/migrate.js); never add begin/commit here.

-- speaker_role was created in 001 with an unnamed check, auto-named speaker_role_check.
alter domain speaker_role drop constraint speaker_role_check;
alter domain speaker_role add constraint speaker_role_check
  check (value in ('host', 'fan', 'speaker', 'crowd', 'decoration'));
