# Brancher une base PostgreSQL gérée (Neon ou autre)

**Objet :** ce que le projet sait faire avec une base PostgreSQL gérée, ce
qu'il **ne peut pas** en faire, et pourquoi. À lire avant de coller une chaîne
de connexion dans un fichier du dépôt.

---

## 1. En une phrase

La base gérée sert de **cible de schéma et de vérification** — migrations,
RLS, 167 contrôles SQL — et **non** de backend direct pour l'application : le
navigateur ne peut pas détenir un mot de passe de base, et Neon ne fournit ni
PostgREST ni `auth.uid()`.

---

## 2. Ce qui est branché

| Commande | Effet | Écrit ? |
| --- | --- | --- |
| `npm run db:etat` | Inventaire : version du serveur, nombre de tables, politiques RLS, migrations appliquées, tables sans RLS | **Non** |
| `npm run db:push` | Applique, dans l'ordre, le socle local, les migrations `001`→`007` et le jeu de démonstration | Oui |
| `npm run db:verifier` | Rejoue les 7 fichiers de tests SQL (`isolation`, `roles`, paliers 1 à 4) dans une transaction annulée à la fin | **Non** (tout est annulé) |

Le suivi est assuré par la table `public._pressing_migrations` : un fichier déjà
appliqué n'est jamais rejoué. `--dry-run` affiche le plan sans écrire,
`--force` passe outre l'avertissement « base déjà initialisée ».

```bash
# dans .env (jamais commité)
DATABASE_URL=postgresql://utilisateur:motdepasse@hote/base?sslmode=require

npm run db:etat       # lecture seule, sûr sur n'importe quelle base
npm run db:push       # crée le schéma (base vierge uniquement)
npm run db:verifier   # 167 contrôles
```

**Sortie attendue après `db:push` puis `db:verifier` :**

```
Tables      : 20 dans le schéma public
Politiques  : 66 règles RLS
Sans RLS    : 0 table(s)
✓ 167 contrôles SQL réussis sur 10 fichiers.
```

Le script refuse de s'exécuter si `DATABASE_URL` est absente, affiche toujours
l'URL **mot de passe masqué**, et s'arrête net si un fichier échoue (chaque
fichier est appliqué dans une transaction : rien n'est laissé à moitié fait).

---

## 3. Ce qui n'est **pas** branché, et pourquoi

L'application n'utilise pas cette base directement. Trois raisons, dans
l'ordre de gravité :

1. **Un navigateur ne garde pas de secret.** Toute variable `VITE_*` finit dans
   le bundle JavaScript, lisible par n'importe quel visiteur. Mettre
   `DATABASE_URL` dedans reviendrait à publier le mot de passe administrateur de
   la base. C'est la raison pour laquelle `db.mjs` lit `.env` côté machine et
   que le préfixe `VITE_` est refusé partout ailleurs.
2. **Neon n'expose pas PostgREST.** L'application interroge une API REST générée
   par PostgREST, avec un JWT par utilisateur que les politiques RLS lisent via
   `auth.uid()`. Neon ne fournit ni PostgREST, ni GoTrue (authentification), ni
   les Edge Functions Deno (`cinetpay-init`, `cinetpay-webhook`). Brancher
   l'interface dessus demanderait d'écrire une couche API complète — un autre
   produit, pas une case à cocher.
3. **Le schéma dépend de Supabase.** `00_bootstrap.sql` recrée les rôles
   `anon` / `authenticated` / `service_role` et le schéma `auth` **pour les
   tests**. Sur un vrai projet Supabase ils existent déjà, et `db:push` n'a pas
   à être lancé (le déploiement passe par `npm run setup`).

Autrement dit : Neon convient pour **vérifier les migrations et la RLS hors de
Supabase** (par exemple en préproduction, ou pour prouver une isolation sur une
base managée), pas pour faire tourner le pressing.

---

## 4. Pagination des listes alimentées par le serveur

Les commandes et les clients restent entièrement locaux (Dexie) : leur
pagination est une découpe d'affichage, sans réseau (`paginate`).

La liste des **dépenses**, elle, vient du serveur et grandit chaque semaine :
elle est paginée **par curseur** (`decouperPageCurseur`, `filtreCurseur` dans
`src/lib/pagination.ts`, `listExpensesPage` dans `expenseService.ts`).

- Le tri est **total** : `created_at` décroissant puis `id` décroissant. Un tri
  sur l'horodatage seul n'est pas stable quand deux dépenses partagent la même
  seconde.
- La requête demande `limite + 1` lignes : la ligne supplémentaire indique
  seulement s'il existe une suite, sans `count(*)` à chaque page.
- Le filtre envoyé est
  `created_at.lt.V, and(created_at.eq.V, id.lt.I)`, c'est-à-dire « strictement
  après la dernière ligne vue ». Aucun `offset` : une dépense saisie entre deux
  pages ne provoque ni doublon ni trou.

Le jour où les commandes passeront au serveur, la même mécanique s'appliquera :
seule la source change, les helpers restent.

---

## 5. Sécurité — à faire une fois

Une chaîne de connexion partagée dans une conversation ou un ticket doit être
considérée comme compromise : **régénérez le mot de passe du rôle** (Neon →
*Roles* → *Reset password*) avant la mise en production, et ne collez jamais
l'URL complète dans un message. `scripts/db.mjs` la masque à l'affichage, mais
cela ne protège que les journaux.

---

## 6. Vérification effectuée et limite de l'environnement de développement

`db.mjs` a été exécuté de bout en bout sur un **PostgreSQL 16.2** local :

| Étape | Résultat |
| --- | --- |
| `db:push` | 9 fichiers appliqués, sans erreur |
| `db:etat` | 20 tables, 66 politiques, 0 table sans RLS, 9/9 migrations |
| `db:verifier` | **167 contrôles** sur 10 fichiers (`isolation` 9, `palier1` 10, `palier2` 23, `palier2_complement` 23, `palier3` 17, `palier4` 30, `roles` 11, `inscription` 11, `audit` 17, `recette_reelle` 16) |

En revanche, la connexion à une base **distante** n'a pas pu être exercée depuis
l'environnement de développement utilisé ici : la sortie réseau y est filtrée
(les paquets vers `*.neon.tech:5432` sont rejetés). Les commandes ci-dessus sont
prêtes ; lancez-les depuis une machine qui a l'accès réseau.
