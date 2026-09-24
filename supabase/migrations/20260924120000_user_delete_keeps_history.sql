-- Removing a team member failed with "Database error deleting user" as soon as
-- they had touched anything: every column pointing at a user was ON DELETE NO
-- ACTION, so one proposal history event was enough to block it. Their work and
-- history should outlive them, with only the "who" cleared, so those columns
-- become ON DELETE SET NULL (all of them are nullable). The profile row goes
-- with the account.

do $$
declare
  r record;
begin
  for r in
    select c.conname, c.conrelid::regclass as tbl, a.attname as col, c.confrelid::regclass as ref
    from pg_constraint c
    join pg_attribute a on a.attrelid = c.conrelid and a.attnum = c.conkey[1]
    where c.contype = 'f'
      and c.confdeltype = 'a'
      and c.connamespace = 'public'::regnamespace
      and c.confrelid in ('auth.users'::regclass, 'public.profiles'::regclass)
      and array_length(c.conkey, 1) = 1
  loop
    execute format('alter table %s drop constraint %I', r.tbl, r.conname);
    if r.tbl = 'public.profiles'::regclass and r.col = 'id' then
      execute format(
        'alter table %s add constraint %I foreign key (%I) references %s(id) on delete cascade',
        r.tbl, r.conname, r.col, r.ref);
    else
      execute format(
        'alter table %s add constraint %I foreign key (%I) references %s(id) on delete set null',
        r.tbl, r.conname, r.col, r.ref);
    end if;
  end loop;
end $$;
