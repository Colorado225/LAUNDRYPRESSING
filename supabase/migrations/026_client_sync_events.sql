-- 026 — Journal des incidents de synchronisation côté poste (diagnostic)
--
-- Problème visé : une commande saisie au comptoir peut être écrite dans
-- IndexedDB puis refusée par le serveur (RLS, jeton expiré, contrainte). Le
-- refus ne laisse AUCUNE trace : la base reste vide, l'appareil garde la
-- commande « en attente », et personne ne peut dire pourquoi.
--
-- Cette migration ajoute un journal d'événements envoyé par le poste lui-même
-- après un échec d'envoi. Le pressing peut lire ses propres événements (RLS sur
-- `current_tenant_id()`), les autres pressings ne voient rien, et l'insertion
-- passe par une fonction `security definer` : un appareil dont les droits
-- d'écriture sur `orders` sont insuffisants peut malgré tout consigner l'erreur.
--
-- La fonction ne lève jamais d'exception : un journal de diagnostic ne doit pas
-- empêcher le comptoir de travailler.

create table if not exists public.client_sync_events (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.tenants(id) on delete cascade,
  user_id     uuid,
  order_id    uuid,
  kind        text not null check (kind in ('push_error', 'push_ok', 'push_conflict', 'probe')),
  message     text,
  details     jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now()
);

create index if not exists client_sync_events_tenant_created_idx
  on public.client_sync_events (tenant_id, created_at desc);

alter table public.client_sync_events enable row level security;

drop policy if exists client_sync_events_select on public.client_sync_events;
create policy client_sync_events_select on public.client_sync_events
  for select using (tenant_id = public.current_tenant_id());

-- Aucune écriture directe : tout passe par la fonction ci-dessous, qui décide
-- elle-même du pressing et de l'utilisateur (impossible de falsifier un autre
-- pressing en envoyant un `tenant_id`).
revoke all on public.client_sync_events from anon, authenticated;
grant select on public.client_sync_events to authenticated;

create or replace function public.log_client_sync(
  p_kind     text,
  p_message  text default null,
  p_order_id uuid default null,
  p_details  jsonb default '{}'::jsonb
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tenant uuid := public.current_tenant_id();
begin
  if v_tenant is null then
    return;
  end if;

  insert into public.client_sync_events (tenant_id, user_id, order_id, kind, message, details)
  values (
    v_tenant,
    auth.uid(),
    p_order_id,
    case when p_kind in ('push_error', 'push_ok', 'push_conflict', 'probe') then p_kind else 'push_error' end,
    left(coalesce(p_message, ''), 2000),
    coalesce(p_details, '{}'::jsonb)
  );
exception
  when others then
    -- Journalisation best-effort : on n'interrompt jamais l'appelant.
    null;
end;
$$;

revoke all on function public.log_client_sync(text, text, uuid, jsonb) from public;
grant execute on function public.log_client_sync(text, text, uuid, jsonb) to authenticated;

comment on table public.client_sync_events is
  'Journal des tentatives d''envoi et de leurs refus, écrit par les postes hors ligne (diagnostic).';
