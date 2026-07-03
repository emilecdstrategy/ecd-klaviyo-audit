alter table clients
  add column if not exists email text not null default '';
