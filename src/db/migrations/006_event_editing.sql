-- 006_event_editing: schema support for the owner's event-editing admin. An event can be
-- merged into another (`merged_into`), and once any entry in an event has published, that
-- event's address stops moving (`address_locked_at`, set by `lock_event_address` below) --
-- a published URL is never recalled. The slug check widens to also accept the two-part
-- dated address (`yyyy-mm-dd/tag`) a locked event's slug takes (Task 3).
-- Conventions: docs/decisions/0006-data-model-conventions.md.
-- Runs inside one transaction (src/db/migrate.js); never add begin/commit here.

alter table events add column merged_into bigint references events(id);
alter table events add column address_locked_at timestamptz;

-- events.slug was created inline in 001, so its check is auto-named (`\d events` names it
-- events_slug_check in both PGlite and Postgres).
alter table events drop constraint events_slug_check;
alter table events add constraint events_slug_check
  check (slug ~ '^[a-z0-9-]+$' or slug ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}/[a-z0-9-]+$');

-- AFTER INSERT/UPDATE on items: the first time an entry settles into "published, not
-- deleted, in an event", that event's address_locked_at is stamped once and never again.
-- Only an unlocked event is updated: a publish into an already-locked event takes no lock on
-- the event row (so it can't deadlock with a merge or move, which lock events before items)
-- and leaves its updated_at/updated_by alone.
create function lock_event_address() returns trigger
language plpgsql as $$
begin
  if new.review_state = 'published' and new.deleted_at is null and new.event_id is not null then
    update events set address_locked_at = now() where id = new.event_id and address_locked_at is null;
  end if;
  return null;
end;
$$;

create trigger lock_event_address after insert or update of review_state, event_id, deleted_at on items
  for each row execute function lock_event_address();
