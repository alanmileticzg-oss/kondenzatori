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
-- koraci projekta: Ispitivanja završena → Poslani DRAFT (stupac closed) → Poslani izvještaji → Fakturiran
alter table public.projects add column if not exists tests_done       boolean not null default false;
alter table public.projects add column if not exists tests_done_date  date;
alter table public.projects add column if not exists report_sent      boolean not null default false;
alter table public.projects add column if not exists report_sent_date date;

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
  disposition     text check (disposition in ('teardown','zbrinjavanje','spremanje','vraceno')),
  disposition_date date,
  location        text default '',
  created_at      timestamptz not null default now()
);
-- dopune za baze napravljene ranijom verzijom
alter table public.capacitors add column if not exists frequency_hz double precision;
-- dodatni podaci s natpisne pločice
alter table public.capacitors add column if not exists power_kvar  double precision;   -- snaga [kVAr] (AC)
alter table public.capacitors add column if not exists energy_j    double precision;   -- energija [J] (DC)
alter table public.capacitors add column if not exists phases      smallint check (phases in (1, 3));  -- broj faza
alter table public.capacitors add column if not exists bil_kv      text default '';    -- AC/BIL [kV], npr. "50/125"
alter table public.capacitors add column if not exists int_fuse    boolean;            -- unutarnji osigurači (null = nije navedeno)
alter table public.capacitors add column if not exists weight_kg   double precision;   -- masa [kg]

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

drop view if exists public.projects_v;
create view public.projects_v with (security_invoker = on) as
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

-- =====================================================================
-- DOPUNA: administratori (upravljanje korisnicima, brisanje, fakturiranje)
-- =====================================================================
-- ---------- administratori ----------------------------------------------
create table if not exists public.app_admins (
  user_id     uuid primary key references auth.users(id) on delete cascade,
  created_at  timestamptz not null default now()
);
alter table public.app_admins enable row level security;
drop policy if exists "citanje" on public.app_admins;
create policy "citanje" on public.app_admins for select to authenticated using (true);
revoke all on public.app_admins from anon;
grant select on public.app_admins to authenticated;

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$ select exists (select 1 from public.app_admins where user_id = auth.uid()) $$;
revoke execute on function public.is_admin() from public, anon;
grant execute on function public.is_admin() to authenticated;

-- prvog administratora upisati ručno (zamijeniti e-mail):
-- insert into public.app_admins(user_id) select id from auth.users where lower(email) = 'ime@domena.hr' on conflict do nothing;

-- ---------- samo administrator: brisanje i fakturiranje ------------------
do $$
declare t text;
begin
  foreach t in array array['projects','capacitors'] loop
    execute format('drop policy if exists "prijavljeni" on public.%I', t);
    execute format('drop policy if exists "citanje" on public.%I', t);
    execute format('drop policy if exists "upis" on public.%I', t);
    execute format('drop policy if exists "izmjena" on public.%I', t);
    execute format('drop policy if exists "brisanje admin" on public.%I', t);
    execute format('create policy "citanje" on public.%I for select to authenticated using (true)', t);
    execute format('create policy "upis" on public.%I for insert to authenticated with check (true)', t);
    execute format('create policy "izmjena" on public.%I for update to authenticated using (true) with check (true)', t);
    execute format('create policy "brisanje admin" on public.%I for delete to authenticated using (public.is_admin())', t);
  end loop;
end $$;

create or replace function public.check_invoice_admin()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if public.is_admin() then return new; end if;
  if tg_op = 'INSERT' then
    if new.invoiced then raise exception 'Samo administrator može označiti projekt kao fakturiran.'; end if;
  elsif new.invoiced is distinct from old.invoiced
     or new.invoice_no is distinct from old.invoice_no
     or new.invoice_date is distinct from old.invoice_date then
    raise exception 'Samo administrator može mijenjati podatke o fakturiranju.';
  end if;
  return new;
end $$;
drop trigger if exists projects_invoice_admin on public.projects;
create trigger projects_invoice_admin before insert or update on public.projects
for each row execute function public.check_invoice_admin();

create or replace function public.delete_project(p_id bigint)
returns void
language plpgsql
security invoker
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'Samo administrator može brisati projekte.';
  end if;
  delete from public.capacitors where project_id = p_id;
  delete from public.projects where id = p_id;
end $$;

drop policy if exists "slike brisanje" on storage.objects;
create policy "slike brisanje" on storage.objects for delete to authenticated using (bucket_id = 'slike' and public.is_admin());

-- DOPUNA: završni korak "Vraćeno klijentu"
do $$ declare c text; begin
  for c in select conname from pg_constraint
           where conrelid = 'public.capacitors'::regclass and contype = 'c' and pg_get_constraintdef(oid) ilike '%disposition%'
  loop execute format('alter table public.capacitors drop constraint %I', c); end loop;
end $$;
alter table public.capacitors add constraint capacitors_disposition_check
  check (disposition in ('teardown','zbrinjavanje','spremanje','vraceno'));
