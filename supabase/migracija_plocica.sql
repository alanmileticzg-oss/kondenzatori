-- Dodatna polja s natpisne pločice (13.11.2026).
-- Pokrenuti jednom u Supabase SQL editoru PRIJE objave nove verzije aplikacije.
-- (Isto je uključeno u schema.sql, pa se može pokrenuti i cijeli schema.sql.)
alter table public.capacitors add column if not exists power_kvar  double precision;   -- snaga [kVAr] (AC)
alter table public.capacitors add column if not exists energy_j    double precision;   -- energija [J] (DC)
alter table public.capacitors add column if not exists phases      smallint check (phases in (1, 3));
alter table public.capacitors add column if not exists bil_kv      text default '';    -- AC/BIL [kV], npr. "50/125"
alter table public.capacitors add column if not exists int_fuse    boolean;            -- unutarnji osigurači
alter table public.capacitors add column if not exists weight_kg   double precision;   -- masa [kg]

-- pregled caps_v treba ponovno izraditi da vidi nove stupce
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
revoke all on public.caps_v from anon;
grant select on public.caps_v to authenticated;
