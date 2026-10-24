-- =============================================================================
-- 011_superadmin_single.sql — un seul compte éditeur de la plateforme
-- =============================================================================
-- Le rôle « super-administrateur » est une liste blanche distincte des rôles
-- owner/receptionist/artisan des pressings. L'index impose à PostgreSQL une
-- seule ligne possible : aucun pressing client ne peut s'ajouter lui-même,
-- et aucune seconde identité d'éditeur ne peut être provisionnée par erreur.
-- Un transfert s'effectue en remplaçant l'identifiant de cette ligne via le
-- provisionnement service_role, jamais depuis le navigateur.
-- =============================================================================

create unique index if not exists platform_admins_singleton
  on public.platform_admins ((true));

comment on index public.platform_admins_singleton is
  'Un seul compte peut administrer la plateforme SaaS à la fois.';
