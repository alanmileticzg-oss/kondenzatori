-- Planirani početak ispitivanja (projekti)
-- Pokretanje: Supabase → SQL Editor → New query → zalijepiti → Run (sigurno i više puta)
alter table public.projects add column if not exists planned_start date;

-- pogled projects_v treba ponovno stvoriti da uključi novi stupac
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

revoke all on public.projects_v from anon;
grant select on public.projects_v to authenticated;
