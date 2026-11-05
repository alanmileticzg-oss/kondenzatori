-- =====================================================================
-- Praćenje kondenzatora — shema baze za Supabase
-- Pokretanje: Supabase → SQL Editor → New query → zalijepiti sve → Run
-- (sigurno se može pokrenuti i više puta)
-- =====================================================================

-- ---------- tablice ---------------------------------------------------
create table if not exists public.projects (
  id            bigint generated always as identity primary key,
  name          text not null unique,
  client        text default '',
  order_no      text default '',
  notes         text default '',
  closed        boolean not null default false,
  closed_date   date,
  invoiced      boolean not null default false,
  invoice_no    text default '',
  invoice_date  date,
  created_at    timestamptz not null default now()
);

create table if not exists public.capacitors (
  id              bigint generated always as identity primary key,
  code            text not null unique,
  project_id      bigint references public.projects(id),
  status          text not null default 'rezerviran'
                  check (status in ('rezerviran','zaprimljen','u_ispitivanju','zavrsen')),
  arrival_date    date,
  manufacturer    text default '',
  cap_type        text default '',
  serial_no       text default '',
  capacitance_uf  double precision,          -- normirano u µF (za filtriranje)
  cap_text        text default '',           -- kako je upisano, npr. "470 nF"
  voltage_v       double precision,          -- normirano u V
  volt_text       text default '',
  volt_kind       text default '',           -- AC / DC
  frequency_hz    double precision,          -- nazivna frekvencija
  extra           text default '',
  ocr_text        text,
  disposition     text check (disposition in ('teardown','zbrinjavanje','spremanje')),
  disposition_date date,
  location        text default '',
  created_at      timestamptz not null default now()
);
-- dopune za baze napravljene ranijom verzijom
alter table public.capacitors add column if not exists frequency_hz double precision;

create index if not exists capacitors_project_idx on public.capacitors(project_id);

create table if not exists public.events (
  id            bigint generated always as identity primary key,
  capacitor_id  bigint not null references public.capacitors(id) on delete cascade,
  ts            timestamptz not null default now(),
  kind          text not null check (kind in ('dolazak','pokus','napomena','zavrsetak','izmjena')),
  test_type     text,
  note          text default '',
  user_name     text default '',
  user_id       uuid default auth.uid()
);
create index if not exists events_cap_idx on public.events(capacitor_id);

create table if not exists public.photos (
  id            bigint generated always as identity primary key,
  capacitor_id  bigint not null references public.capacitors(id) on delete cascade,
  event_id      bigint references public.events(id) on delete set null,
  path          text not null,               -- putanja u Storage bucketu "slike"
  kind          text default 'ostalo',       -- plocica / ostalo
  created_at    timestamptz not null default now()
);
create index if not exists photos_cap_idx on public.photos(capacitor_id);

create table if not exists public.test_types (
  id      bigint generated always as identity primary key,
  name    text not null unique,
  active  boolean not null default true
);

insert into public.test_types(name) values
  ('OVT'), ('Mjerenje C i tgδ'), ('Toplinsko starenje'), ('Udarni napon'),
  ('Kratki spoj / pražnjenje'), ('Mjerenje izolacijskog otpora'), ('Vizualni pregled')
on conflict (name) do nothing;

-- ---------- brojevi naljepnica (K00001, K00002, ...) -------------------
create sequence if not exists public.cap_code_seq;

create or replace function public.reserve_codes(p_project bigint, p_count int)
returns setof text
language plpgsql
security invoker
set search_path = public
as $$
declare
  n    bigint;
  c    text;
  made int := 0;
begin
  if p_count < 1 or p_count > 500 then
    raise exception 'Broj naljepnica mora biti 1–500';
  end if;
  while made < p_count loop
    n := nextval('public.cap_code_seq');
    c := 'K' || lpad(n::text, 5, '0');
    if not exists (select 1 from public.capacitors where code = c) then
      insert into public.capacitors(code, project_id, status) values (c, p_project, 'rezerviran');
      made := made + 1;
      return next c;
    end if;
  end loop;
end $$;

-- ---------- brisanje projekta (s kondenzatorima; povijest i zapisi slika brišu se kaskadno)
create or replace function public.delete_project(p_id bigint)
returns void
language plpgsql
security invoker
set search_path = public
as $$
begin
  delete from public.capacitors where project_id = p_id;
  delete from public.projects where id = p_id;
end $$;

-- ---------- pregledi (views) -------------------------------------------
drop view if exists public.caps_v;
create view public.caps_v with (security_invoker = on) as
select c.*,
       p.name     as project_name,
       p.invoiced as project_invoiced,
       p.closed   as project_closed,
       (select string_agg(distinct e.test_type, ', ')
          from public.events e where e.capacitor_id = c.id and e.kind = 'pokus') as tests,
       (select ph.path from public.photos ph where ph.capacitor_id = c.id order by ph.id limit 1) as photo
from public.capacitors c
left join public.projects p on p.id = c.project_id;

create or replace view public.projects_v with (security_invoker = on) as
select p.*,
       count(c.id) filter (where c.status <> 'rezerviran')     as n,
       count(c.id) filter (where c.status = 'rezerviran')      as n_rez,
       count(c.id) filter (where c.status = 'zaprimljen')      as n_zap,
       count(c.id) filter (where c.status = 'u_ispitivanju')   as n_isp,
       count(c.id) filter (where c.status = 'zavrsen')         as n_zav,
       min(c.arrival_date)                                     as first_arrival
from public.projects p
left join public.capacitors c on c.project_id = p.id
group by p.id;

create or replace view public.events_v with (security_invoker = on) as
select e.*, c.code, p.name as project_name
from public.events e
join public.capacitors c on c.id = e.capacitor_id
left join public.projects p on p.id = c.project_id;

-- ---------- pristup: samo prijavljeni korisnici ------------------------
alter table public.projects   enable row level security;
alter table public.capacitors enable row level security;
alter table public.events     enable row level security;
alter table public.photos     enable row level security;
alter table public.test_types enable row level security;

do $$
declare t text;
begin
  foreach t in array array['projects','capacitors','events','photos','test_types'] loop
    execute format('drop policy if exists "prijavljeni" on public.%I', t);
    execute format('create policy "prijavljeni" on public.%I for all to authenticated using (true) with check (true)', t);
  end loop;
end $$;

revoke all on public.projects, public.capacitors, public.events, public.photos, public.test_types,
              public.caps_v, public.projects_v, public.events_v from anon;
grant select, insert, update, delete on public.projects, public.capacitors, public.events,
              public.photos, public.test_types to authenticated;
grant select on public.caps_v, public.projects_v, public.events_v to authenticated;
grant usage on sequence public.cap_code_seq to authenticated;
revoke execute on function public.reserve_codes(bigint, int) from public, anon;
grant execute on function public.reserve_codes(bigint, int) to authenticated;
revoke execute on function public.delete_project(bigint) from public, anon;
grant execute on function public.delete_project(bigint) to authenticated;

-- ---------- fotografije (Storage) --------------------------------------
insert into storage.buckets (id, name, public)
values ('slike', 'slike', false)
on conflict (id) do nothing;

drop policy if exists "slike citanje" on storage.objects;
drop policy if exists "slike upis"    on storage.objects;
drop policy if exists "slike brisanje" on storage.objects;
create policy "slike citanje" on storage.objects for select to authenticated using (bucket_id = 'slike');
create policy "slike upis"    on storage.objects for insert to authenticated with check (bucket_id = 'slike');
create policy "slike brisanje" on storage.objects for delete to authenticated using (bucket_id = 'slike');
