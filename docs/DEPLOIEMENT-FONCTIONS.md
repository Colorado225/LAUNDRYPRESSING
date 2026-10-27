# Déployer les Edge Functions et tester le paiement sans compte marchand

**Objet :** comment envoyer `cinetpay-init`, `cinetpay-status` et
`cinetpay-webhook` sur le projet Supabase, et comment exercer le parcours de
paiement complet **en mode essai**,
sans identifiants CinetPay réels. À lire avant toute mise en production : le
mode essai encaisse de l'argent fictif, il ne doit jamais rester actif chez un
client.

---

## 1. En une phrase

Un script (`npm run deploy:fonctions`) assemble chaque fonction en **un seul
fichier** — imports `_shared` inclus — puis l'envoie par l'API d'administration
Supabase, et un simulateur local (`npm run simulateur`) joue le rôle de CinetPay
pour tester de bout en bout sans compte marchand.

---

## 2. Pourquoi un script plutôt que la CLI Supabase

La CLI suppose un projet « lié » (`supabase link` interactif, mot de passe de
base, fichiers temporaires). Le script s'en tient à un seul jeton,
`SUPABASE_ACCESS_TOKEN`, déjà utilisé par `npm run setup`.

L'API d'administration attend **le source complet** de la fonction dans le corps
de la requête :

| Opération | Requête |
| --- | --- |
| Créer | `POST /v1/projects/{ref}/functions` — corps `{ slug, name, body, verify_jwt }` |
| Mettre à jour | `PATCH /v1/projects/{ref}/functions/{slug}` — même corps |
| Pousser des secrets | `POST /v1/projects/{ref}/secrets` — `[{ name, value }]` |

Or un import relatif (`../_shared/http.ts`) ne résout rien dans ce corps : le
dossier `_shared` n'est pas envoyé. D'où l'assembleur maison
(`scripts/lib/bundle.mjs`, une soixantaine de lignes) qui :

- résout les imports relatifs, dépendances d'abord, chaque module **une seule
  fois** ;
- retire ces imports du source assemblé ;
- **conserve** les imports distants (`npm:@supabase/supabase-js@2`) que Deno
  résout seul ;
- refuse un import circulaire au lieu de boucler indéfiniment.

Il ne renomme rien : deux modules ne doivent pas exporter le même nom. Un test
(`scripts/bundle.test.mjs`) vérifie l'absence de doublon, l'absence d'import
relatif résiduel et la présence de `Deno.serve(`.

---

## 3. Prérequis

Dans `.env` (jamais commité) :

```bash
SUPABASE_ACCESS_TOKEN=sbp_…
VITE_SUPABASE_URL=https://<ref>.supabase.co   # suffit à déduire le <ref>
# ou SUPABASE_PROJECT_REF=<ref>
```

Les secrets CinetPay lus dans `.env` et poussés automatiquement :
`CINETPAY_API_KEY`, `CINETPAY_SITE_ID`, `CINETPAY_SECRET_KEY`,
`CINETPAY_BASE_URL`, `CINETPAY_MODE`, `CINETPAY_NOTIFY_URL`, `APP_ENV`,
`APP_URL`. Les valeurs ne sont **jamais** affichées dans le journal : un log
de déploiement fuite vite.

---

## 4. Commandes

```bash
npm run deploy:fonctions -- --verifier   # assemble, écrit supabase/functions/.build/, aucun appel réseau
npm run deploy:fonctions                 # crée ou met à jour les deux fonctions
npm run deploy:fonctions -- --sans-secrets   # déploie sans toucher aux secrets
npm run deploy:fonctions -- --secrets-seulement
```

**Les secrets sont poussés par défaut.** Après avoir renseigné dans `.env`
les identifiants CinetPay requis (`CINETPAY_API_KEY`, `CINETPAY_SITE_ID`,
`CINETPAY_SECRET_KEY`) et l'adresse publique de l'application (`APP_URL`),
aucun changement de code ni copier-coller dans le Dashboard ne sera nécessaire.

Pour la première mise en service de cette version, la nouvelle migration
`012_cinetpay_atomic.sql` doit aussi être appliquée avant que le webhook utilise
la finalisation atomique. La voie automatisée est `npm run setup`, qui lit `.env`,
applique les migrations en attente, déploie les deux fonctions et pousse les
secrets. **Attention : cette commande peut aussi créer/rattacher le compte
propriétaire** si `SEED_OWNER_EMAIL` et `SEED_OWNER_PASSWORD` sont renseignés ;
elle écrit sur Supabase et doit donc être lancée seulement après vérification
et autorisation explicite du projet cible.

`npm run deploy:fonctions` seul ne pousse que les secrets et les fonctions ; il
n'applique pas la migration SQL. Il convient pour les déploiements ultérieurs,
une fois la migration 012 déjà appliquée. Le jeton `SUPABASE_ACCESS_TOKEN` est
requis dans `.env` pour ces opérations. **Coller des valeurs dans `.env` ne
modifie pas le serveur Supabase** : une commande de déploiement reste nécessaire.

`--dry-run` est un synonyme de `--verifier`. Le dossier `.build/` est ignoré par
Git : c'est un artefact d'inspection, pas la source.

**Sortie attendue de `--verifier` :**

```
Fonctions assemblées :
  • cinetpay-init — 25.1 Ko, 4 module(s)
  • cinetpay-status — autonomie complète, aucun import
  • cinetpay-webhook — 23.9 Ko, 4 module(s)

• Vérification seule : fichiers écrits dans supabase/functions/.build/
  Aucun appel à l’API Supabase n’a été effectué.
```

### `verify_jwt` : deux réglages, pour deux raisons

| Fonction | `verify_jwt` | Pourquoi |
| --- | --- | --- |
| `cinetpay-init` | `true` | Appelée par l'application, avec la session du pressing. |
| `cinetpay-status` | `true` | Interrogée par l'application après connexion. Ne renvoie que des booléens et les **noms** des variables manquantes, jamais une valeur de secret. |
| `cinetpay-webhook` | `false` | L'appelant est CinetPay, qui ne peut pas fournir de JWT Supabase. Sa sécurité vient du HMAC (`x-token`) et de la reconfirmation du statut auprès de l'API. |

### `cinetpay-status` : pourquoi une troisième fonction

Le bouton « Payer par Mobile Money » ne doit pas être proposé quand le guichet
ne peut pas s'ouvrir. Or les clés marchandes vivent dans les secrets du projet,
que le navigateur ne peut pas lire. `cinetpay-status` répond donc :

```json
{ "configured": false, "mode": "production",
  "missing": ["CINETPAY_API_KEY", "CINETPAY_SITE_ID", "CINETPAY_SECRET_KEY"] }
```

L'application mémorise la réponse pour la session (10 minutes) et **masque le
bouton** quand `configured` vaut `false`. Si la sonde échoue (hors ligne,
fonction non déployée), l'état reste « inconnu » et le bouton est conservé : on
ne masque jamais une action qui pourrait fonctionner. Aucun paiement n'est
simulé dans aucun cas.

Conséquence pratique : après avoir collé les clés et relancé
`npm run deploy:fonctions`, le bouton réapparaît **au rechargement suivant**, en
attendant l'expiration du cache de session.

---

## 5. Le mode essai (`CINETPAY_MODE=test`)

**Ce qu'il faut comprendre d'abord :** l'API Checkout v2 n'a **pas** d'hôte de
bac à sable. CinetPay fournit des identifiants d'essai qui tapent la **même**
URL que la production (`https://api-checkout.cinetpay.com`). Le mode n'est donc
pas un commutateur d'environnement côté prestataire, c'est une décision locale :

- `test` — accepte une notification non signée (le statut est de toute façon
  reconfirmé par `/v2/payment/check`), et marque chaque transaction
  `payment_transactions.provider_payload.mode = "test"` ;
- `production` (défaut) — **refuse** une clé qui ressemble à un identifiant
  d'essai (`test`, `demo`, `exemple`, `simul`…). Mieux vaut une erreur au
  démarrage qu'un paiement fictif cru réel.

Le même garde-fou existe côté outillage : `npm run setup` signale une erreur
`CINETPAY_MODE` si ces deux conditions se contredisent, et un avertissement
(« paiements fictifs ») dès que le mode vaut `test`.

---

## 6. Le simulateur

```bash
npm run simulateur                                  # port 54321
PORT=54322 npm run simulateur                       # autre port
CINETPAY_SIM_SECRET=un-secret npm run simulateur    # notifications signées HMAC
```

Il reproduit **seulement** ce que nos fonctions utilisent :

| Route | Rôle |
| --- | --- |
| `POST /v2/payment` | Initialisation. Contrôles réels : identifiants, montant entier positif **multiple de 5**, `notify_url` et `return_url` présents, `transaction_id` unique (409 sinon). |
| `GET /paiement/:id` | Page de paiement fictive : « accepter » ou « refuser ». |
| `POST /v2/payment/check` | Statut : `PENDING`, `ACCEPTED` ou `REFUSED`. |
| `GET /` | Inventaire JSON des transactions de la session. |

Chaque décision envoie la notification au `notify_url` en
`application/x-www-form-urlencoded`, exactement comme CinetPay, puis redirige
vers le `return_url` avec `transaction_id` et `simulateur=notifie` (ou
`notification_echouee` si le webhook est injoignable). Si `CINETPAY_SIM_SECRET`
est renseigné, le HMAC-SHA256 part dans l'en-tête **`x-token`** — jamais dans
`signature`, qui est un jeton de transaction et fait simplement partie du
message signé. C'est le piège classique de cette intégration.

Identifiants par défaut, surchargeables par `CINETPAY_SIM_API_KEY`,
`CINETPAY_SIM_SITE_ID`, `CINETPAY_SIM_BASE_URL` :

```
apikey=simulateur-test-key   site_id=123456
```

### Configuration côté application

```bash
CINETPAY_MODE=test
CINETPAY_BASE_URL=http://localhost:54321
CINETPAY_API_KEY=simulateur-test-key
CINETPAY_SITE_ID=123456
```

### Parcours d'essai

1. `npm run simulateur`, puis `npm run dev` dans un second terminal.
2. Ouvrir une commande, choisir « Payer par Mobile Money ».
3. La page du simulateur s'ouvre : accepter ou refuser.
4. Retour dans l'application ; la commande doit apparaître payée (ou en échec).
5. Contrôle : la transaction porte `provider_payload.mode = "test"`.

### Un garde-fou au déploiement

`npm run deploy:fonctions` avertit avant d'envoyer le code si `CINETPAY_MODE=test`
vise `localhost`/`127.0.0.1` : la fonction hébergée ne verra jamais ce
simulateur, et le bouton « Payer » échouera au lieu de rester simplement
inactif. Déployer sans identifiants CinetPay (bouton inactif, reste de
l'application intact) est souvent préférable en attendant un tunnel.

### La limite à connaître : `localhost` chez Supabase

Depuis une Edge Function **hébergée**, `localhost` désigne la machine de
Supabase, pas la vôtre : le simulateur y est injoignable. Deux options :

- **tester en local** (Supabase CLI / Docker), où `localhost` est partagé ;
- **exposer le simulateur** par un tunnel et mettre son URL publique dans
  `CINETPAY_BASE_URL` — en sachant que ce tunnel accepte alors des paiements
  fictifs pour quiconque connaît l'URL.

---

### Tant que CinetPay n'est pas installé : le paiement simulé

Le bouton « Payer par Mobile Money » reste actif, mais l'Edge Function répond
503 (`provider_not_configured`) — ou 404 si elle n'est pas déployée. L'application
ne montre alors **pas** d'erreur technique : elle enregistre un paiement
**simulé** (`pendingPayments.status = 'simulated'`, référence `SIM-…`) et affiche
un toast qui dit exactement ce qui s'est passé — rien n'a été encaissé, la
commande reste à régler. La simulation valide uniquement le parcours de l'écran,
pas le paiement réel.

Ce que la simulation ne fait **jamais** :

- modifier `orders.payment_status` : le serveur l'interdit au client
  (`guard_order_update`, migration 003) et une recette fictive fausserait le
  reste à encaisser ;
- partir vers Supabase : ce n'est pas une synchronisation.

Un vrai refus (droits, montant, réseau tombé) reste une erreur visible : seule
l'absence de CinetPay déclenche la simulation.

## 7. Ce qui reste hors de portée sans identifiants marchands

- Aucune fonction n'a encore été déployée sur le projet Supabase : le
  déploiement réel se fait au premier `npm run deploy:fonctions`, une fois
  `SUPABASE_ACCESS_TOKEN` présent dans `.env`.
- Le paiement CinetPay réel (vrai guichet, vrai HMAC de CinetPay, vrai
  encaissement) ne peut pas être exercé : il faut `CINETPAY_API_KEY`,
  `CINETPAY_SITE_ID` et `CINETPAY_SECRET_KEY` de production.
- Le webhook doit être joignable publiquement par CinetPay, et
  `CINETPAY_NOTIFY_URL` doit pointer vers
  `https://<ref>.supabase.co/functions/v1/cinetpay-webhook`.

Le jour où les identifiants arrivent : passer `CINETPAY_MODE=production`,
renseigner les trois identifiants, l’URL publique, puis `npm run deploy:fonctions` ; rejouer
un paiement réel de petit montant. Le garde-fou refusera la bascule si une clé
d'essai traîne encore.
