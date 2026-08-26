-- Only agency addresses may become accounts.
--
-- The magic-link box passed shouldCreateUser: true, so signing in CREATED an
-- account for whatever address was typed. Three strangers ended up with
-- accounts that way: wick@biolabfarma.com.br, pwmarques@biolabfarma.com.br and
-- l.cohin@exzell.com, none invited, all confirmed. They could read nothing,
-- since RLS keys off a profile row they never had, but they held real sessions
-- and several functions accepted anyone authenticated.
--
-- The client now asks for an invited address on the agency domain, and this is
-- the same rule where it cannot be bypassed: a request straight to the auth API
-- never touches our frontend.
--
-- Fires on INSERT only, so existing accounts are untouched. To let a contractor
-- or a client in later, add their domain to the list in the function below and
-- to SIGN_IN_DOMAINS in src/lib/sign-in-policy.ts.
create or replace function public.enforce_sign_in_domain()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  allowed text[] := array['ecdigitalstrategy.com'];
begin
  if new.email is null or lower(split_part(new.email, '@', 2)) <> all (allowed) then
    raise exception 'Accounts are limited to ECD Digital Strategy addresses (got %)', coalesce(new.email, '<none>')
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

drop trigger if exists enforce_sign_in_domain on auth.users;
create trigger enforce_sign_in_domain
  before insert on auth.users
  for each row execute function public.enforce_sign_in_domain();
