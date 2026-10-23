#!/usr/bin/env bash
# =============================================================================
# sql-verify.sh — rejoue les migrations et les tests SQL sur une vraie base
# =============================================================================
# Ce script comble le trou laissé par les tests unitaires : il exécute
# réellement le schéma, les politiques RLS et les déclencheurs sur PostgreSQL.
# Il n'a besoin d'AUCUN compte Supabase : le fichier `00_bootstrap.sql` recrée
# les objets que Supabase fournit d'office (rôles, schéma `auth`, `auth.uid()`).
#
# Prérequis
#   - `psql` (PostgreSQL 15 ou plus) dans le PATH ;
#   - un rôle SUPERUTILISATEUR, car le script crée les rôles `anon`,
#     `authenticated` et `service_role`.
#
# Usage
#   ./scripts/sql-verify.sh
#   PGURL="postgresql://postgres:motdepasse@localhost:5432/postgres" ./scripts/sql-verify.sh
#
# Le script crée une base jetable, y applique tout, puis la supprime — même en
# cas d'échec. La base cible n'est jamais modifiée.
# =============================================================================

set -euo pipefail

RACINE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$RACINE"

PGURL="${PGURL:-postgresql://postgres@localhost:5432/postgres}"
BASE="pressing_verif_$$"

if ! command -v psql >/dev/null 2>&1; then
  echo "✗ psql introuvable. Installez PostgreSQL 15+ (paquet « postgresql-client »)." >&2
  exit 1
fi

version="$(psql "$PGURL" -tAc "show server_version" 2>/dev/null || true)"
if [ -z "$version" ]; then
  echo "✗ Connexion impossible à $PGURL" >&2
  echo "  Démarrez PostgreSQL ou renseignez PGURL." >&2
  exit 1
fi

majeure="${version%%.*}"
if [ "$majeure" -lt 15 ]; then
  echo "✗ PostgreSQL $version détecté : la version 15 est requise (vues security_invoker)." >&2
  exit 1
fi

nettoyage() {
  psql "$PGURL" -q -c "drop database if exists \"$BASE\";" >/dev/null 2>&1 || true
}
trap nettoyage EXIT

echo "PostgreSQL $version — base de travail : $BASE"
psql "$PGURL" -q -c "create database \"$BASE\";"

# Remplacer le nom de base dans l'URL en conservant hôte, port, socket et
# paramètres (`sslmode`, `host`…). Une simple substitution shell casserait les
# URL sans hôte (socket Unix), d'où le passage par `URL`.
URL_BASE="$(node -e '
  const [url, nom] = process.argv.slice(1);
  try {
    const u = new URL(url);
    u.pathname = "/" + nom;
    process.stdout.write(u.toString());
  } catch {
    // URL sans hôte (socket Unix, ex. « postgresql://user@/postgres?host=… ») :
    // le constructeur WHATWG la refuse, on remplace le dernier segment.
    const coupe = url.indexOf("?");
    const avant = coupe === -1 ? url : url.slice(0, coupe);
    const apres = coupe === -1 ? "" : url.slice(coupe);
    process.stdout.write(avant.slice(0, avant.lastIndexOf("/") + 1) + nom + apres);
  }
' "$PGURL" "$BASE")"

FICHIERS=(
  "supabase/tests/local/00_bootstrap.sql"
  "supabase/migrations/001_init.sql"
  "supabase/migrations/002_payments.sql"
  "supabase/migrations/003_palier1.sql"
  "supabase/migrations/004_palier2.sql"
  "supabase/migrations/005_palier2_complement.sql"
  "supabase/migrations/006_palier3.sql"
  "supabase/migrations/007_palier4.sql"
  "supabase/migrations/008_inscription.sql"
  "supabase/seed.sql"
  "supabase/tests/isolation.sql"
  "supabase/tests/palier1.sql"
  "supabase/tests/palier2.sql"
  "supabase/tests/palier2_complement.sql"
  "supabase/tests/palier3.sql"
  "supabase/tests/palier4.sql"
  "supabase/tests/roles.sql"
  "supabase/tests/inscription.sql"
)

ECHECS=0
for fichier in "${FICHIERS[@]}"; do
  sortie="$(psql "$URL_BASE" -v ON_ERROR_STOP=1 -q -f "$fichier" 2>&1)" || {
    echo "✗ $fichier"
    echo "$sortie" | sed 's/^/    /'
    ECHECS=$((ECHECS + 1))
    break
  }
  echo "✓ $fichier"
  # Les NOTICE portent les contrôles : on les résume sans le bruit psql.
  echo "$sortie" | grep -o "OK[^$]*" | sed 's/^/    /' || true
done

if [ "$ECHECS" -ne 0 ]; then
  echo "✗ Vérification SQL interrompue." >&2
  exit 1
fi

echo "✓ Toutes les vérifications SQL sont passées."
