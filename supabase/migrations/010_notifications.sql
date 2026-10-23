-- =============================================================================
-- 010_notifications.sql — prévenir le client (WhatsApp / appel)
-- =============================================================================
-- Constat de terrain : la commande est prête, le client ne le sait pas. Le
-- linge reste des semaines en rayon, le pressing perd sa place et le client
-- rappelle pour demander « où en est ma commande ? ».
--
-- Le MVP n'envoie aucun message lui-même : il n'y a ni fournisseur SMS, ni API
-- WhatsApp Business, ni budget par message. Le comptoir ouvre WhatsApp avec un
-- texte déjà écrit et l'envoie depuis son propre numéro — le client reçoit donc
-- un message d'un numéro qu'il connaît, et il répond.
--
-- Cette table ne stocke pas des envois techniques mais une **preuve de
-- sollicitation** : qui, quand, par quel canal, avec quel texte. Elle sert à
-- trois choses :
--   • ne pas relancer deux fois le même client pour la même situation ;
--   • savoir ce qui a été dit, en cas de contestation ;
--   • compter, plus tard, l'effet des relances sur les retraits.
--
-- Choix de conception :
--   • **immuable** — aucune politique de mise à jour ni de suppression : une
--     ligne dit ce qui s'est passé, elle ne se réécrit pas ; une nouvelle
--     situation produit une nouvelle ligne ;
--   • `order_id` nullable — un message hors commande (annonce, fermeture
--     exceptionnelle) reste possible sans FK inventée ;
--   • le téléphone est recopié au moment de l'envoi : un numéro corrigé plus
--     tard ne doit pas réécrire l'historique.
-- =============================================================================

begin;

-- =============================================================================
-- 1. TABLE
-- =============================================================================
create table if not exists public.notifications (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      uuid not null references public.tenants (id) on delete cascade,
  order_id       uuid,

  -- `whatsapp` et `appel` sont les deux seuls canaux réellement disponibles
  -- sans fournisseur payant. `sms` viendra le jour où un compte SMS existera :
  -- la contraignante l'acceptera alors sans migration destructrice.
  channel        text not null check (channel in ('whatsapp', 'appel', 'sms')),

  -- Le motif détermine le texte : « prête » n'est pas « en retard ».
  reason         text not null check (reason in ('pret', 'retard', 'relance')),

  customer_name  text not null check (char_length(btrim(customer_name)) between 1 and 120),
  customer_phone text not null check (char_length(btrim(customer_phone)) between 6 and 24),
  message        text not null check (char_length(btrim(message)) between 1 and 1000),

  sent_by        uuid default auth.uid() references auth.users (id) on delete set null,
  created_at     timestamptz not null default now(),

  -- FK composite : une notification ne peut pas désigner la commande d'un
  -- autre pressing, même en forgeant la requête.
  constraint notifications_order_fk
    foreign key (order_id, tenant_id) references public.orders (id, tenant_id)
    on delete cascade
);

create index if not exists notifications_tenant_idx
  on public.notifications (tenant_id, created_at desc);

-- C'est cette lecture qui décide « qui reste à prévenir » : la dernière
-- notification d'une commande, comparée à sa date de modification.
create index if not exists notifications_order_idx
  on public.notifications (order_id, created_at desc);

alter table public.notifications enable row level security;

-- =============================================================================
-- 2. POLITIQUES
-- =============================================================================
drop policy if exists notifications_select_tenant on public.notifications;
create policy notifications_select_tenant on public.notifications
  for select to authenticated
  using (tenant_id = public.current_tenant_id());

-- Le comptoir prévient ; l'atelier n'a pas à écrire au client au nom du
-- pressing, et le propriétaire garde la main sur la relation commerciale.
drop policy if exists notifications_insert_counter on public.notifications;
create policy notifications_insert_counter on public.notifications
  for insert to authenticated
  with check (
    tenant_id = public.current_tenant_id()
    and public.current_tenant_role() in ('owner', 'receptionist')
  );

-- Abonnement échu : on n'écrit plus. La lecture reste ouverte, comme partout.
drop policy if exists abonnement_insert_notifications on public.notifications;
create policy abonnement_insert_notifications on public.notifications
  as restrictive for insert
  with check (public.tenant_writable(tenant_id));

-- Aucune politique d'update ni de delete : le journal est immuable. Le
-- `grant` ci-dessous le confirme au niveau des privilèges, ce qui rend la
-- règle lisible sans lire les politiques.
grant select, insert on public.notifications to authenticated;

-- =============================================================================
-- 3. AUTEUR DÉDUIT DU JETON
-- =============================================================================
-- Un client ne choisit pas qui l'a prévenu : `sent_by` vient du JWT, jamais du
-- corps de la requête. Même logique que `stamp_issue_author` (migration 005).
create or replace function public.stamp_notification_author()
returns trigger
language plpgsql
as $$
begin
  if auth.uid() is not null then
    new.sent_by := auth.uid();
  end if;

  return new;
end;
$$;

drop trigger if exists trg_notifications_author on public.notifications;
create trigger trg_notifications_author
  before insert on public.notifications
  for each row execute function public.stamp_notification_author();

-- =============================================================================
-- 4. COMMENTAIRE
-- =============================================================================
comment on table public.notifications is
  'Clients prévenus par WhatsApp ou appel : preuve de sollicitation, immuable.';

commit;
