# Recette sur un projet Supabase réel

**Objet :** ce que la machine ne peut pas vérifier, et comment le vérifier en
45 minutes sur un vrai projet, avant de livrer à un pressing.

**Ce qui est déjà vérifié sans Supabase :**

| Contrôle | Commande | Résultat |
| --- | --- | --- |
| Types, style, tests, build | `npm run typecheck && npm run lint && npm test && npm run build` | 518 tests, 34 fichiers |
| Schéma, RLS, rôles, abonnement | `npm run sql:verify` | 174 contrôles sur PostgreSQL 16.2 |
| Recette technique du projet déployé | `npm run recette` | 7 contrôles en lecture seule |

**Ce qui reste à faire par un humain :** le provisionnement réel, le paiement
CinetPay de bout en bout, l'installation de la PWA sur une tablette Android et
le parcours complet au comptoir. Aucune de ces étapes n'a pu être exécutée dans
l'environnement de développement : aucun identifiant de projet, aucun compte
marchand.

---

## 0 bis. État du projet de recette (23/10/2026)

Un projet Supabase réel existe désormais : `phjstsydxvggtduohfrl`
(région `eu-west-1`, PostgreSQL 17). Il a été provisionné **par le connecteur
Supabase**, sans mot de passe de base transmis.

| Élément | État constaté |
| --- | --- |
| Migrations appliquées | `001_init` → `008_inscription`, horodatées dans `supabase_migrations.schema_migrations` |
| Schéma `public` | 20 tables, 3 vues, 33 fonctions, 66 politiques RLS |
| Formules | `essentiel` 15 000, `pro` 35 000, `reseau` 75 000 FCFA |
| Données | **aucune** : pas de pressing, pas de compte, pas de jeu de démonstration |
| `site_url` | `http://localhost:5173` (+ `uri_allow_list` correspondante) |
| Confirmation e-mail | **activée** (`mailer_autoconfirm = false`) |
| Longueur de mot de passe | 6 côté serveur (l'application en exige 8) |

### Recette d'isolation exécutée sur ce projet (23/10/2026)

`supabase/tests/recette_reelle.sql` a été collé dans le SQL Editor du projet et
exécuté **en entier**. Il crée deux pressings et trois comptes, puis se place
dans la peau de chacun en rejouant les jetons que PostgREST fabrique. Tout finit
par `ROLLBACK` : aucune trace ne subsiste.

| Contrôle | Résultat |
| --- | --- |
| 1.1 – 1.5 | propriétaire A : pressing courant correct, 1 commande visible, **0 commande du voisin**, son journal lisible, celui de B invisible |
| 2.1 – 2.2 | propriétaire B : symétrique, 1 commande, journal de A invisible |
| 3.1 – 3.3 | artisan A : fait avancer une commande, **montant refusé (42501)**, journal inaccessible |
| 4.1 – 4.2 | anonyme : lecture des commandes **et** création de pressing refusées |
| 5.1 – 5.3 | abonnement échu : état `expired`, **lecture encore possible**, écriture refusée |
| 6.1 | propriétaire d'un pressing : console de supervision refusée |

Relevé complémentaire, pour la trace : sous le jeton du propriétaire A,
`current_tenant_id()` renvoie bien le pressing A, `select count(*) from orders`
donne **1**, et le filtre sur le pressing B donne **0**.

**Deux limites connues, à traiter avant une démonstration :**

1. **Droits `anon` sur les fonctions.** Supabase accorde par défaut l'exécution
   à `anon` sur les fonctions du schéma `public` ; un `revoke … from public` ne
   retire pas ce droit explicite. Constaté ici : `has_function_privilege('anon',
   'create_tenant_for_user', 'execute')` valait `true`. Les fonctions refusent
   d'elles-mêmes un appel sans session, mais la migration `008` révoque
   désormais explicitement ce droit. À rejouer sur tout nouveau projet.
2. **Envoi d'e-mails.** Le SMTP intégré est plafonné à quelques messages par
   heure : au-delà, l'inscription ne reçoit plus son lien de confirmation.
   Configurer un SMTP propre (Resend, Brevo…) avant une démonstration à
   plusieurs comptes, ou désactiver temporairement la confirmation.

**Créer le premier compte :** l'inscription libre de l'application suffit —
elle crée le pressing, rattache le compte comme propriétaire et ouvre un essai
de 14 jours. Aucun passage par `npm run setup` n'est nécessaire.

---

## 0. Préparation (5 min)

1. Créer un projet Supabase neuf (région la plus proche : `eu-west-3` ou
   `eu-central-1`).
2. Remplir `.env` à partir de `.env.example` :

```bash
VITE_SUPABASE_URL=https://<ref>.supabase.co
VITE_SUPABASE_ANON_KEY=...        # Project Settings → API
SUPABASE_ACCESS_TOKEN=sbp_...     # Account → Access Tokens
SUPABASE_DB_PASSWORD=...
SUPABASE_SERVICE_ROLE_KEY=...     # Project Settings → API
APP_URL=https://<domaine-de-recette>
SEED_OWNER_EMAIL=patron@recette.ci
SEED_OWNER_PASSWORD=<mot de passe solide>
SEED_TENANT_NAME=Pressing Recette
PLATFORM_ADMIN=true               # seulement si ce compte doit superviser
```

3. `npm ci`, puis `npm run setup`.

**Attendu :** six étapes vertes, dont « Webhook en ligne ». En cas d'échec, le
script indique l'étape ; `--dry-run` montre ce qu'il ferait.

> `PLATFORM_ADMIN=true` inscrit le compte propriétaire dans `platform_admins`.
> À ne jamais laisser à `true` sur l'installation d'un client.

---

## 1. Recette technique automatique (2 min)

```bash
npm run recette
```

Sept contrôles en lecture seule :

| Contrôle | Attendu |
| --- | --- |
| API REST joignable | HTTP 200 |
| `orders` refusée à l'anonyme | 401/403 ou code `42501` |
| Schéma complet | 20 tables présentes |
| Formules commerciales | 3 formules actives |
| `my_subscription` déployée | tout sauf 404 |
| `platform_admins` fermée au public | 401/403 ou `42501` |
| Webhook CinetPay déployé | tout sauf 404 |

Un échec affiche la cause et la correction à appliquer. Le script **n'écrit
rien** : il peut tourner sur la base d'un client.

---

## 2. Contrôles SQL à la main (5 min)

Dans **SQL Editor**, exécuter ces requêtes et comparer aux résultats attendus.
Elles sont toutes en lecture.

```sql
-- a) RLS active partout (attendu : 0 ligne avec rowsecurity = false)
select tablename
from   pg_tables
where  schemaname = 'public' and not rowsecurity;

-- b) Volume des politiques (attendu : 66)
select count(*) from pg_policies where schemaname = 'public';

-- c) Aucun pressing sans abonnement après activation commerciale (attendu : 1)
select count(*)
from   public.tenants t
where  not exists (select 1 from public.subscriptions s where s.tenant_id = t.id);

-- d) Lecture de l'abonnement (attendu : state = active, writable = true)
select public.my_subscription();

-- e) Vue des dépenses bien filtrée (attendu : 0 ligne pour un non-propriétaire)
set local role authenticated;
select count(*) from public.expense_totals;
```

Si (a) renvoie une table, **arrêter** : la RLS est désactivée sur cette table.

---

## 3. Parcours fonctionnel dans le navigateur (20 min)

Ouvrir `APP_URL` sur l'ordinateur, puis sur la tablette.

| # | Action | Attendu |
| --- | --- | --- |
| 1 | Se connecter avec le compte propriétaire | Tableau de bord, nom du pressing en en-tête |
| 2 | Se déconnecter, tenter un mauvais mot de passe | Message « E-mail ou mot de passe incorrect » |
| 3 | « Recevoir un lien de réinitialisation » | E-mail reçu, lien ouvrant `/reinitialisation`, nouveau mot de passe accepté |
| 4 | Créer une commande en trois étapes | Fiche ouverte, QR code affiché, badge « En attente » puis « Synchronisé » |
| 5 | Passer la tablette en mode avion, créer une commande | Commande enregistrée, badge orange, aucune erreur |
| 6 | Retirer le mode avion, attendre 60 s | Badge vert, commande visible dans Supabase (`select * from orders`) |
| 7 | Scanner l'étiquette depuis `/atelier` | Commande reconnue, statut avancé, historique de scan affiché |
| 8 | Encaisser 2 000 FCFA en espèces sur 5 000 | Reste dû 3 000, reçu imprimable correct |
| 9 | Fermer la caisse du jour | Écart nul si espèces déclarées = encaissées |
| 10 | Créer un réceptionniste (console ou SQL), se connecter avec lui | Ni Dépenses ni Tableau de bord visibles |
| 11 | Essayer `/depenses` en URL directe avec ce compte | Écran « Accès réservé », aucune donnée |
| 12 | Créer un artisan, ouvrir `/commandes/nouvelle` | « Création réservée au comptoir » |
| 13 | Renouveler l'abonnement (+30 j) depuis `/supervision` | Bandeau disparaît, écritures possibles |
| 14 | Forcer une échéance passée en SQL (`update subscriptions set current_period_end = current_date - 30`) | Bandeau rouge, **toute écriture refusée** (commande, encaissement), lecture toujours possible |
| 15 | Ouvrir `/support`, envoyer une demande | Demande visible dans `/supervision`, réponse reçue côté pressing |

> L'étape 14 est la plus importante : elle prouve que le blocage est côté
> serveur et non un simple masquage d'interface. Un appel direct à l'API doit
> aussi échouer (voir §5).

---

## 4. Paiement CinetPay de bout en bout (10 min)

Prérequis : clés CinetPay de test (`CINETPAY_API_KEY`, `CINETPAY_SITE_ID`,
`CINETPAY_SECRET_KEY`), `APP_URL` accessible depuis internet.

1. Créer une commande de 5 000 FCFA.
2. **Payer par Mobile Money** → guichet CinetPay → valider sur le téléphone.
3. **Attendu :** retour sur `/paiement/retour`, statut « Paiement confirmé »,
   commande « Payée », ligne dans `payment_transactions` avec
   `signature_verified = true`.
4. Vérifier l'idempotence : rejouer la notification (bouton « Rejouer » du
   back-office CinetPay, ou `curl` du webhook avec la même signature).
   **Attendu :** aucune seconde ligne, aucun double encaissement.
5. Vérifier le refus d'un montant falsifié : appeler `cinetpay-init` avec un
   `amount` différent du total — le serveur doit relire la commande en base et
   facturer le solde réel.

---

## 5. Contrôles de sécurité côté API (5 min)

Avec la **clé anonyme** (celle du navigateur), dans un terminal :

```bash
ANON=...; URL=https://<ref>.supabase.co

# a) Commandes : doit être refusé (401 / 42501)
curl -s -o /dev/null -w "%{http_code}\n" "$URL/rest/v1/orders?select=*" -H "apikey: $ANON"

# b) Liste des éditeurs : doit être refusée
curl -s -o /dev/null -w "%{http_code}\n" "$URL/rest/v1/platform_admins?select=*" -H "apikey: $ANON"

# c) Dépenses : doit renvoyer un tableau vide, jamais les lignes d'un autre rôle
curl -s "$URL/rest/v1/expenses?select=*" -H "apikey: $ANON"

# d) En-tête de boutique forgé : ne doit rien donner de plus
curl -s "$URL/rest/v1/orders?select=id" -H "apikey: $ANON" -H "x-tenant-id: 00000000-0000-0000-0000-000000000000"
```

Et avec le **JWT d'un réceptionniste** (récupéré via la connexion dans le
navigateur, onglet Réseau) :

```bash
# e) Écriture de dépense : doit échouer en 42501
curl -s -X POST "$URL/rest/v1/expenses" -H "apikey: $ANON" -H "Authorization: Bearer $JWT_RECEPTION" \
  -H "Content-Type: application/json" -d '{"tenant_id":"<uuid>","label":"test","category":"autre","amount":1000,"spent_on":"2026-10-23"}'

# f) Encaissement sur un pressing échu (voir §3 étape 14) : doit échouer en 42501
curl -s -X POST "$URL/rest/v1/rpc/record_cash_payment" -H "apikey: $ANON" \
  -H "Authorization: Bearer $JWT" -H "Content-Type: application/json" \
  -d '{"p_order_id":"<uuid>","p_amount":1000}'
```

---

## 6. PWA sur tablette Android (5 min)

1. Ouvrir `APP_URL` dans Chrome Android.
2. Menu → **Installer l'application**. Vérifier l'icône et le nom.
3. Mode avion : ouvrir l'application installée → elle démarre, les commandes
   locales s'affichent, le badge passe en orange.
4. Scan caméra : autoriser l'accès, vérifier la lecture d'une étiquette à
   30 cm environ.
5. Bouton **Retour** Android : il ne doit pas quitter l'application depuis la
   fiche commande (il revient à la liste).

---

## 7. Ce qu'il faut consigner après la recette

| Élément | Valeur |
| --- | --- |
| Date et opérateur | |
| Référence du projet Supabase | |
| `npm run recette` | …/7 |
| Étapes 3.x échouées (le cas échéant) | |
| Paiement CinetPay (référence, montant) | |
| Version déployée (commit) | |
| Points bloquants restants | |

Une anomalie constatée doit devenir un test — dans `supabase/tests/` si elle est
côté base, dans `src/test/` si elle est côté application — avant d'être
corrigée. C'est la règle appliquée depuis le palier 1 : aucun défaut corrigé
sans test qui l'aurait attrapé.
