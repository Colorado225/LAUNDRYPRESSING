-- =============================================================================
-- 008_inscription.sql — inscription libre d'un nouveau pressing
-- =============================================================================
-- Jusqu'ici, un pressing était créé par l'éditeur (`scripts/setup.mjs` avec la
-- clé `service_role`, ou la console de supervision). Un propriétaire ne pouvait
-- donc pas ouvrir son compte seul.
--
-- Cette migration ajoute UNE fonction, `create_tenant_for_user`, qui fait tenir
-- l'opération en une transaction : création du pressing + rattachement du
-- compte comme propriétaire + période d'essai.
--
-- Pourquoi une fonction `security definer` plutôt qu'une politique d'insertion ?
--   Une politique `for insert` sur `tenants` laisserait n'importe quel compte
--   authentifié insérer une ligne, puis une seconde sur `tenant_users` pour s'y
--   rattacher : entre les deux, l'état est incohérent, et la seconde politique
--   rouvrirait exactement la faille corrigée en 001 (auto-inscription comme
--   propriétaire d'un pressing tiers). Ici, l'insertion de `tenant_users` se fait
--   avec le rôle propriétaire de la fonction, et les valeurs sont imposées par
--   le code : `auth.uid()` et le rôle `owner`, jamais un paramètre.
--
-- Garde-fous :
--   - authentification obligatoire ;
--   - un compte ne peut pas créer un pressing s'il est déjà rattaché à un
--     autre (l'ajout à une équipe existante reste le fait du propriétaire ou de
--     l'éditeur) ;
--   - nom entre 2 et 80 caractères, téléphone ivoirien à 10 chiffres ou vide ;
--   - essai de 14 jours sur la formule la moins chère, si des formules existent.
-- =============================================================================

begin;

create or replace function public.create_tenant_for_user(
  p_name  text,
  p_phone text default null
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user     uuid := auth.uid();
  v_name     text := btrim(coalesce(p_name, ''));
  v_phone    text;
  v_tenant   uuid;
  v_plan     text;
begin
  if v_user is null then
    raise exception 'Connexion requise pour créer un pressing.'
      using errcode = '42501';
  end if;

  -- Un compte = un pressing créé par lui-même. Un réceptionniste invité ne peut
  -- donc pas s'en fabriquer un par erreur ; l'éditeur garde la main pour les
  -- cas particuliers (console de supervision).
  if exists (select 1 from public.tenant_users tu where tu.user_id = v_user) then
    raise exception 'Ce compte est déjà rattaché à un pressing.'
      using errcode = '23505';
  end if;

  if char_length(v_name) < 2 or char_length(v_name) > 80 then
    raise exception 'Le nom du pressing doit contenir entre 2 et 80 caractères.'
      using errcode = '22023';
  end if;

  -- Téléphone facultatif. On normalise comme le fait `normalize_phone` :
  -- chiffres seuls, indicatif 225 retiré, 10 chiffres attendus.
  if p_phone is not null and btrim(p_phone) <> '' then
    v_phone := regexp_replace(p_phone, '[^0-9]', '', 'g');
    if v_phone like '225%' and char_length(v_phone) > 10 then
      v_phone := substr(v_phone, 4);
    end if;
    if char_length(v_phone) <> 10 then
      raise exception 'Indiquez un numéro ivoirien à 10 chiffres.'
        using errcode = '22023';
    end if;
  end if;

  insert into public.tenants (name, phone)
  values (v_name, v_phone)
  returning id into v_tenant;

  insert into public.tenant_users (user_id, tenant_id, role)
  values (v_user, v_tenant, 'owner');

  -- Essai : la formule la moins chère, quatorze jours. S'il n'y a aucune
  -- formule (base non commercialisée), l'absence d'abonnement vaut « active »
  -- d'après `subscription_state` : le pressing reste utilisable.
  select code into v_plan
  from public.plans
  where is_active
  order by price_fcfa asc, sort_order asc
  limit 1;

  if v_plan is not null then
    insert into public.subscriptions (
      tenant_id, plan_code, status, started_on,
      current_period_end, trial_ends_on, notes
    )
    values (
      v_tenant, v_plan, 'trial', current_date,
      current_date + 14, current_date + 14, 'Inscription libre'
    );
  end if;

  return v_tenant;
end;
$$;

comment on function public.create_tenant_for_user(text, text) is
  'Inscription libre : crée le pressing, rattache le compte comme propriétaire et ouvre un essai de 14 jours.';

revoke all on function public.create_tenant_for_user(text, text) from public;
grant execute on function public.create_tenant_for_user(text, text) to authenticated;

-- -----------------------------------------------------------------------------
-- `revoke ... from public` ne suffit PAS sur Supabase.
-- -----------------------------------------------------------------------------
-- Supabase pose des privilèges par défaut explicites :
--   `alter default privileges in schema public grant all on functions to anon, authenticated, service_role`
-- Un `revoke ... from public` retire le droit implicite de PUBLIC mais laisse le
-- droit explicite d'`anon`. Constaté le 23/10 sur le projet de recette :
-- `has_function_privilege('anon', 'create_tenant_for_user', 'execute')` valait
-- `true` après application de cette migration.
--
-- Les fonctions refusent d'elles-mêmes un appel sans session (`auth.uid()` nul
-- ⇒ erreur 42501), donc aucun accès n'était ouvert. Mais un rôle anonyme n'a
-- rien à faire dans ces points d'entrée : on retire le droit explicitement.
-- `authenticated` conserve son `grant` ci-dessus.
revoke execute on function public.create_tenant_for_user(text, text) from anon;

commit;
