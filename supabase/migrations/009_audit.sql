-- =============================================================================
-- 009_audit.sql — journal des actions sensibles (palier 5)
-- =============================================================================
-- L'audit courant (§2.2, point 4) constatait qu'aucune trace n'existait au-delà
-- des changements de statut : « pas de trace de qui a modifié un prix, un accès
-- ou un montant ». `order_status_history` et `order_price_history` couvrent
-- l'atelier et les tarifs d'une ligne ; tout le reste — comptes, rôles,
-- abonnement, remboursements, clôtures, catalogue, dépenses — ne laissait rien.
--
-- Cette migration ajoute UNE table `public.audit_log`, écrite uniquement par
-- des déclencheurs `security definer` :
--   • le client ne peut pas écrire dans le journal (aucune politique
--     d'insertion) — un journal que l'on peut falsifier ne vaut rien ;
--   • le journal ne peut être ni modifié ni supprimé, même par le propriétaire ;
--   • il ne se lit que par le propriétaire du pressing concerné.
--
-- Pourquoi stocker un code d'action (`tenant_users.update`) plutôt qu'une phrase
-- toute faite ? Le libellé français vit dans l'interface, où il peut évoluer
-- sans migration ; la base garde une clé stable, filtrable et testable.
--
-- Pourquoi figer `actor_email` et `actor_role` à l'écriture ? Un rôle change
-- justement ce que l'on journalise : relire l'état courant plus tard donnerait
-- une réponse fausse. Le journal doit dire « qui, avec quel rôle, ce jour-là ».
-- =============================================================================

begin;

-- =============================================================================
-- 1. TABLE
-- =============================================================================
create table if not exists public.audit_log (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.tenants (id) on delete cascade,

  -- `on delete set null` : la trace d'un départ reste lisible, sans clé
  -- étrangère morte. L'adresse et le rôle, figés ci-dessous, suffisent alors.
  actor_id    uuid references auth.users (id) on delete set null,
  actor_email text,
  actor_role  text,

  -- Code stable : `<table>.<insert|update|delete>`.
  action      text not null,
  -- Nom de la table d'origine et identifiant de la ligne touchée.
  entity      text not null,
  entity_id   uuid,
  -- Colonnes réellement modifiées, sous la forme `{ colonne: { avant, apres } }`.
  details     jsonb not null default '{}'::jsonb,

  created_at  timestamptz not null default now()
);

comment on table public.audit_log is
  'Journal des actions sensibles : qui, avec quel rôle, quoi, quand. Écrit uniquement par déclencheur, en lecture seule côté client.';

-- Tri de lecture de l'écran : le plus récent d'abord. `id` complète le tri car
-- deux événements peuvent partager le même horodatage (même transaction).
create index if not exists audit_log_tenant_date_idx
  on public.audit_log (tenant_id, created_at desc, id desc);

create index if not exists audit_log_tenant_action_idx
  on public.audit_log (tenant_id, action);

-- =============================================================================
-- 2. RLS — LECTURE PROPRIÉTAIRE, ÉCRITURE PAR DÉCLENCHEUR UNIQUEMENT
-- =============================================================================
alter table public.audit_log enable row level security;

-- Le journal expose la trésorerie et les décisions de gestion : propriétaire
-- seul. L'éditeur garde son propre accès par la console de supervision.
drop policy if exists audit_select_owner on public.audit_log;
create policy audit_select_owner on public.audit_log
  for select to authenticated
  using (
    tenant_id = public.current_tenant_id()
    and public.current_tenant_role() = 'owner'
  );

-- Aucune politique d'insertion, de mise à jour ni de suppression : la RLS
-- refuse tout, et les déclencheurs `security definer` écrivent en tant que
-- propriétaire de la table. C'est volontaire — un journal modifiable n'a
-- aucune valeur en cas de litige.
revoke all on public.audit_log from anon, authenticated;
grant select on public.audit_log to authenticated;

-- =============================================================================
-- 3. DÉCLENCHEUR GÉNÉRIQUE
-- =============================================================================
/**
 * Journalise une écriture sur une table sensible.
 *
 * Un seul déclencheur générique plutôt que six fonctions : la logique
 * (comparer avant/après, ignorer les horodatages, choisir l'action) est la même
 * partout, et un nouveau contrôle s'ajoute en trois lignes.
 *
 * `order_status_history` et `order_price_history` restent la source de vérité du
 * parcours d'une commande : ce déclencheur ne s'applique donc PAS à `orders`,
 * qui écrirait une ligne à chaque scan d'atelier et noierait le journal.
 */
create or replace function public.audit_row_change()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_apres     jsonb;
  v_avant     jsonb;
  v_changes   jsonb := '{}'::jsonb;
  v_colonne   text;
  v_tenant    uuid;
  v_entite    uuid;
  v_action    text := tg_table_name || '.' || lower(tg_op);
  v_role      text;
  v_email     text;
begin
  if tg_op = 'DELETE' then
    v_apres := null;
    v_avant := to_jsonb(old);
  else
    v_apres := to_jsonb(new);
    v_avant := case when tg_op = 'UPDATE' then to_jsonb(old) else null end;
  end if;

  -- `tenants` ne porte pas de colonne `tenant_id` : c'est sa propre clé. Sans
  -- ce cas particulier, la table qui décrit le pressing serait la seule à ne
  -- jamais rien journaliser.
  if tg_table_name = 'tenants' then
    v_tenant := nullif(coalesce(v_apres, v_avant) ->> 'id', '')::uuid;
  else
    v_tenant := nullif(coalesce(v_apres, v_avant) ->> 'tenant_id', '')::uuid;
  end if;

  -- Table sans `tenant_id` (les formules, par exemple) : le journal est
  -- cloisonné par pressing, une telle ligne n'aurait pas de propriétaire.
  if v_tenant is null then
    return case when tg_op = 'DELETE' then old else new end;
  end if;

  -- Suppression d'un pressing : la cascade supprime ses comptes rattachés, et
  -- le journal part avec. Écrire une ligne à ce moment violerait la clé
  -- étrangère, puisque le pressing n'existe déjà plus.
  if not exists (select 1 from public.tenants t where t.id = v_tenant) then
    return case when tg_op = 'DELETE' then old else new end;
  end if;

  v_entite := nullif(coalesce(v_apres, v_avant) ->> 'id', '')::uuid;

  if v_avant is null then
    -- Création : on ne garde que les colonnes porteuses d'information.
    v_changes := coalesce(v_apres, '{}'::jsonb)
      - 'tenant_id' - 'id' - 'created_at' - 'updated_at' - 'created_by';
  else
    for v_colonne in select jsonb_object_keys(v_apres) loop
      -- Bruit technique : ces colonnes changent à chaque écriture et
      -- n'apprennent rien à un gérant.
      continue when v_colonne in ('updated_at', 'version', 'status_reason');

      if (v_apres -> v_colonne) is distinct from (v_avant -> v_colonne) then
        v_changes := v_changes || jsonb_build_object(
          v_colonne,
          jsonb_build_object('avant', v_avant -> v_colonne, 'apres', v_apres -> v_colonne)
        );
      end if;
    end loop;

    -- Aucun changement métier (retouche d'horodatage seule) : rien à écrire.
    if v_changes = '{}'::jsonb then
      return new;
    end if;
  end if;

  -- Le rôle courant n'a de sens que dans le pressing concerné : un éditeur qui
  -- rattache un compte depuis la console n'a pas de rôle dans ce pressing.
  v_role := case
              when v_tenant = public.current_tenant_id()
                then public.current_tenant_role()
              else null
            end;

  select u.email into v_email from auth.users u where u.id = auth.uid();

  insert into public.audit_log
    (tenant_id, actor_id, actor_email, actor_role, action, entity, entity_id, details)
  values
    (v_tenant, auth.uid(), v_email, v_role, v_action, tg_table_name, v_entite, v_changes);

  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

comment on function public.audit_row_change() is
  'Journalise une écriture sensible dans audit_log, sans permettre au client d''écrire dans le journal.';

revoke all on function public.audit_row_change() from public, anon, authenticated;

-- =============================================================================
-- 4. TABLES SURVEILLÉES
-- =============================================================================
-- Choix de périmètre : ce qui engage de l'argent, des droits ou l'identité du
-- pressing. Les mouvements de stock et les statuts de commande sont exclus —
-- ils sont fréquents, déjà tracés, et noieraient les décisions de gestion.
do $$
declare
  t text;
  surveillees text[] := array[
    'tenants',           -- nom, téléphone du pressing
    'tenant_users',      -- rattachements et rôles
    'subscriptions',     -- formule, échéance, suspension
    'payment_refunds',   -- remboursements
    'cash_sessions',     -- clôtures de caisse
    'catalog_entries',   -- prestations et tarifs
    'expenses'           -- dépenses
  ];
begin
  foreach t in array surveillees loop
    execute format('drop trigger if exists trg_audit_%I on public.%I', t, t);
    execute format(
      'create trigger trg_audit_%I after insert or update or delete on public.%I
         for each row execute function public.audit_row_change()',
      t, t
    );
  end loop;
end;
$$;

commit;
