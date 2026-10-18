-- Avvisi condivisi: cronologia append-only, identità e verifica assegnate dal server.
create table if not exists public.production_phase_notices (
  id uuid primary key,
  company_id uuid not null references public.companies(id),
  job_id text not null,
  phase_id text not null,
  phase_name text not null,
  body text not null check (length(body) between 1 and 2000),
  author_id uuid not null references auth.users(id),
  author_name text not null,
  author_role text not null,
  created_at timestamptz not null default clock_timestamp(),
  reviewed_by uuid references auth.users(id),
  reviewed_name text,
  reviewed_at timestamptz
);
create index if not exists production_phase_notices_job on public.production_phase_notices(company_id,job_id,created_at);
alter table public.production_phase_notices enable row level security;
revoke all on public.production_phase_notices from public,anon,authenticated;

create or replace function public.production_phase_notices_action(
  p_company_id uuid, p_job_id text, p_action text default 'list',
  p_phase_id text default null, p_body text default null, p_notice_id uuid default null
) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare member_role text; member_name text; operator_name text; job jsonb; phase jsonb; existing production_phase_notices%rowtype;
begin
  select role,display_name into member_role,member_name from company_members
    where company_id=p_company_id and user_id=auth.uid() and active;
  if member_role is null or member_role not in ('owner','office','production') then raise exception 'Accesso aziendale richiesto'; end if;
  select j into job from erp_snapshots s,jsonb_array_elements(coalesce(s.payload->'jobs','[]')) j
    where s.company_id=p_company_id and j->>'id'=p_job_id;
  if job is null then raise exception 'Commessa non disponibile'; end if;
  if member_role='production' then
    select o->>'name' into operator_name from production_profiles pp join erp_snapshots s on s.company_id=pp.company_id,
      jsonb_array_elements(coalesce(s.payload->'plannerSettings'->'operators','[]')) o
      where pp.company_id=p_company_id and pp.user_id=auth.uid() and o->>'id'=pp.operator_id and coalesce((o->>'active')::boolean,false);
    if operator_name is null or not exists(select 1 from production_live_jobs where company_id=p_company_id and job_id=p_job_id)
      then raise exception 'Profilo operatore o commessa non abilitati'; end if;
    member_name:=operator_name;
  end if;
  if p_action='add' then
    if job->>'status' in ('Consegnata','Annullata') then raise exception 'La commessa è chiusa: gli avvisi restano consultabili'; end if;
    if p_notice_id is null or p_body is null or length(btrim(p_body)) not between 1 and 2000 then raise exception 'Scrivi un avviso da 1 a 2000 caratteri'; end if;
    select ph into phase from jsonb_array_elements(coalesce(job->'phases','[]')) ph where ph->>'id'=p_phase_id;
    if phase is null or coalesce((phase->>'notRequired')::boolean,false) then raise exception 'Scegli una fase prevista per questa vettura'; end if;
    insert into production_phase_notices(id,company_id,job_id,phase_id,phase_name,body,author_id,author_name,author_role)
      values(p_notice_id,p_company_id,p_job_id,p_phase_id,phase->>'name',btrim(p_body),auth.uid(),coalesce(nullif(member_name,''),'Utente aziendale'),member_role)
      on conflict(id) do nothing;
    select * into existing from production_phase_notices where id=p_notice_id;
    if existing.company_id<>p_company_id or existing.job_id<>p_job_id or existing.author_id<>auth.uid() or existing.phase_id<>p_phase_id or existing.body<>btrim(p_body)
      then raise exception 'Identificativo avviso già utilizzato'; end if;
  elsif p_action='review' then
    if member_role not in ('owner','office') then raise exception 'Solo l’ufficio può verificare gli avvisi'; end if;
    update production_phase_notices set reviewed_by=auth.uid(),reviewed_name=coalesce(nullif(member_name,''),'Ufficio'),reviewed_at=clock_timestamp()
      where id=p_notice_id and company_id=p_company_id and job_id=p_job_id and reviewed_at is null;
    if not exists(select 1 from production_phase_notices where id=p_notice_id and company_id=p_company_id and job_id=p_job_id) then raise exception 'Avviso non disponibile'; end if;
  elsif p_action<>'list' or p_action is null then raise exception 'Comando avvisi non valido'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('id',id,'phaseId',phase_id,'phaseName',phase_name,'body',body,
    'authorName',author_name,'authorRole',author_role,'createdAt',created_at,'reviewedName',reviewed_name,'reviewedAt',reviewed_at) order by created_at,id)
    from production_phase_notices where company_id=p_company_id and job_id=p_job_id),'[]'::jsonb);
end $$;
revoke all on function public.production_phase_notices_action(uuid,text,text,text,text,uuid) from public,anon;
grant execute on function public.production_phase_notices_action(uuid,text,text,text,text,uuid) to authenticated;
