# MAJ — Feuille de route Pressing Pro

**Dernière mise à jour :** 23 octobre 2026
**Branche de travail :** `arena/17b0abba-laundrypressing`
**Base :** `main` au commit `23551c7` (fusion de la PR #1)
**Référentiels :** `RESTRUCTURATION.md` (cahier des charges du MVP) et ce document

> Ce fichier consigne trois choses, dans cet ordre :
> 1. le texte d'audit reçu, **reproduit sans modification** ;
> 2. sa **vérification point par point contre le code réel** du dépôt ;
> 3. la **hiérarchie d'implémentation** qui en découle, avec ses critères de sortie.
>
> Chaque constat est rattaché à un fichier et, quand c'est utile, à une ligne
> précise. Un constat non vérifiable dans cet environnement est signalé comme
> tel : il n'est jamais présenté comme un fait établi.

## Sommaire

1. [Document source (verbatim)](#1-document-source-verbatim)
2. [Vérification des constats](#2-vérification-des-constats)
3. [Écarts assumés avec le document](#3-écarts-assumés-avec-le-document)
4. [Hiérarchie des implémentations](#4-hiérarchie-des-implémentations)
5. [Journal d'avancement](#5-journal-davancement)

---

## 1. Document source (verbatim)

*Texte fourni le 23 octobre 2026, reproduit **sans modification du contenu**.
Seule entorse : six liens d'images parasites (titres en japonais, espagnol,
indonésien et anglais, adresses `images.openai.com` sans rapport avec le
projet), introduits par le copier-coller, ont été retirés le 23 octobre 2026.
Aucun mot du texte d'audit n'a été modifié.
Seuls les niveaux de titres ont été décalés de deux crans (`#` → `###`) pour
que le document s'imbrique dans celui-ci et n'entre pas en collision avec son
sommaire.
Les liens d'images sont des artefacts de l'outil qui a produit l'analyse : ce
ne sont pas des sources documentaires ; seuls les liens vers le dépôt et le
cahier des charges sont exploitables.*

<!-- ===================== DÉBUT DU TEXTE SOURCE ===================== -->

### Audit technique et fonctionnel — LAUNDRYPRESSING

L’objectif est d’évaluer ton dépôt comme un véritable produit ERP de gestion de pressing, et pas uniquement comme une interface web : vérifier les fonctionnalités existantes, repérer les défauts techniques, identifier les risques métier et définir les améliorations prioritaires pour en faire une application fiable et commercialisable en Côte d’Ivoire.

Point important : l’analyse préliminaire du code consulté fait déjà ressortir plusieurs problèmes potentiels, notamment dans l’authentification, certains composants d’interface et la gestion des paiements. Je vais distinguer les défauts observés des fonctionnalités qui restent à vérifier, afin de ne pas présenter une hypothèse comme un fait établi.

#### 1. État réel du dépôt

J’ai vérifié le dépôt public et consulté sa structure, ses fichiers de configuration, les pages principales, les services, la synchronisation locale, le schéma Supabase, les fonctions de paiement et la documentation.

- Dépôt : [Colorado225/LAUNDRYPRESSING](https://github.com/Colorado225/LAUNDRYPRESSING?utm_source=chatgpt.com)
- Branche par défaut : `main`
- Cahier des charges : [RESTRUCTURATION.md](https://github.com/Colorado225/LAUNDRYPRESSING/blob/main/RESTRUCTURATION.md?utm_source=chatgpt.com)
- Rapport d’audit présent dans le dépôt : [docs/AUDIT.md](https://github.com/Colorado225/LAUNDRYPRESSING/blob/main/docs/AUDIT.md?utm_source=chatgpt.com)
- Liste des améliorations prévues : [docs/BACKLOG.md](https://github.com/Colorado225/LAUNDRYPRESSING/blob/main/docs/BACKLOG.md?utm_source=chatgpt.com)

##### Ce qui existe déjà dans le code

Socle applicatif moderne

React 19, TypeScript, Vite, Tailwind CSS 4, React Router, Zustand et Zod. L’application dispose de pages de commandes, de création de commande, de détail et d’atelier.

Données locales et synchronisation

Dexie/IndexedDB stocke les commandes sur l’appareil. Un moteur de synchronisation les envoie à Supabase au retour de la connexion.

Traçabilité des vêtements

Génération de QR codes, impression d’étiquettes et scan à l’atelier, avec une possibilité de recherche manuelle.

Paiement Mobile Money

Des fonctions Supabase Edge Functions sont prévues pour initier les paiements CinetPay et recevoir les notifications de paiement.

Fondations de sécurité multi-pressing

Le schéma PostgreSQL utilise des identifiants de pressing, des politiques RLS et des tables dédiées aux commandes, aux vêtements et aux transactions.

Mon premier constat : le dépôt a évolué au-delà d’un simple template d’interface. Il contient désormais une base d’architecture pour un MVP offline-first. En revanche, la présence du code ne prouve pas que tous les flux fonctionnent en production : la documentation du projet précise elle-même que les migrations et les paiements réels n’ont pas encore été validés sur des services cloud configurés.

#### 2. Les problèmes et risques prioritaires

J’utilise trois niveaux : P0 pour les blocages ou risques critiques, P1 pour les améliorations nécessaires avant une commercialisation sérieuse et P2 pour les évolutions ultérieures.

##### P0 — Vérifier l’intégration et la mise en production

Critique

Le principal risque est l’écart entre le code, la configuration et la documentation.

Le fichier [docs/AUDIT.md](https://github.com/Colorado225/LAUNDRYPRESSING/blob/main/docs/AUDIT.md?utm_source=chatgpt.com) décrit une ancienne version utilisant les pages JSX, une API Axios locale et une authentification cassée. La branche `main` que j’ai consultée contient désormais une nouvelle application TypeScript avec `src/main.tsx`, `src/App.tsx`, Supabase et des services dédiés.

Cela indique que ce rapport d’audit est au moins partiellement périmé par rapport au dépôt actuel. Il ne faut donc pas appliquer aveuglément ses anciennes conclusions ou réintroduire l’ancien code. Amélioration : auditer le commit courant, identifier tout code hérité encore utilisé, puis mettre à jour les rapports et les critères de validation.

##### P0 — Valider l’authentification réelle

Critique

Les nouveaux fichiers comprennent `AuthGate.tsx`, `authService.ts` et `tenantContext.ts`. Le système prévoit la restauration d’une session et la résolution du pressing associé à l’utilisateur.

Mais plusieurs scénarios restent à prouver sur une vraie instance Supabase :

- connexion, déconnexion et session expirée ;
- compte sans rattachement à un pressing ;
- révocation d’un accès pendant qu’une tablette est hors ligne ;
- changement de compte sur une tablette partagée ;
- impossibilité de consulter les données d’un autre pressing.

Amélioration : ajouter des tests d’intégration sur deux pressings réels de test, avec des comptes et des rôles différents.

##### P0 — Sécuriser les paiements avant de les activer

Critique

Les fonctions `cinetpay-init` et `cinetpay-webhook` contiennent plusieurs protections utiles : montant relu côté serveur, contrôle du statut auprès de CinetPay et gestion des notifications répétées.

Cependant, le webhook accepte explicitement un mode où `CINETPAY_SECRET_KEY` est absente et la signature HMAC n’est alors pas vérifiée. La vérification auprès de l’API du prestataire constitue une protection supplémentaire, mais je recommande d’exiger la signature en production si le contrat CinetPay la permet.

Il faut également vérifier que les mises à jour de la transaction et de la commande sont cohérentes en cas d’erreur ou de notifications simultanées.

Amélioration : imposer une configuration stricte en production, tester les notifications falsifiées, les doublons, les montants incorrects, les paiements concurrents et les réponses du prestataire indisponible.

##### P1 — Compléter la gestion des accès par rôle

Important

Le schéma prévoit les rôles `owner`, `receptionist` et `artisan`. Le backlog indique que la navigation n’est pas encore restreinte selon le rôle.

Cacher un onglet dans l’interface ne suffit pas : chaque action sensible doit être autorisée côté serveur et protégée par les politiques RLS.

Amélioration : définir une matrice d’autorisations et la tester : par exemple, l’artisan fait avancer les commandes, tandis que le propriétaire gère les paramètres et les accès. Le droit d’encaisser ou de consulter les montants doit être une décision explicite du produit.

##### P1 — Fiabiliser les opérations hors ligne

Important

L’architecture locale est adaptée aux coupures de réseau fréquentes, mais une commande peut être modifiée plusieurs fois avant sa synchronisation. La documentation signale notamment que seul l’état final d’une commande est transmis après une période hors ligne.

Amélioration : définir les règles de résolution des conflits, préserver l’historique des transitions, traiter les suppressions et annulations, et afficher clairement les opérations en attente ou en échec. Tester aussi la déconnexion pendant une synchronisation, le redémarrage de l’appareil et le changement de compte.

##### P1 — Vérifier le déploiement et la configuration

Important

Le projet possède un script de provisionnement, des variables d’environnement, des migrations SQL et des fonctions serveur. C’est une bonne base, mais ces éléments peuvent échouer à l’exécution malgré une compilation réussie.

Amélioration : tester le provisionnement sur un projet Supabase de test, vérifier les migrations dans l’ordre, contrôler les secrets sans les exposer, puis valider le parcours complet sur une URL HTTPS de préproduction.

#### 3. Les fonctionnalités à implémenter pour un véritable ERP de pressing

Le cahier des charges actuel limite volontairement le MVP aux commandes, aux QR codes, au mode hors ligne et au paiement Mobile Money. C’est cohérent pour une première version. Pour en faire ensuite un ERP SaaS vendable, je recommande de développer les modules suivants dans cet ordre.

Priorités fonctionnelles proposées pour le marché ivoirien.


V1.1 — Priorité maximale

1\. Catalogue des prestations et tarification

Aujourd’hui, la création de commande permet de saisir les articles et leurs prix. Le catalogue doit devenir une source de prix configurable.

- Types d’articles : chemise, pantalon, costume, robe, boubou, drap, couette, rideau.
- Prestations : lavage, nettoyage à sec, repassage seul, amidonnage, détachage, traitement délicat.
- Prix par article et prestation, avec tarif personnalisé autorisé uniquement aux rôles habilités.
- Enregistrement du prix appliqué à la commande afin que les modifications futures du catalogue ne changent jamais les anciennes factures.


V1.1 — Priorité maximale

2\. Encaissement, reçus et soldes

Le paiement Mobile Money ne remplace pas un véritable suivi de caisse.

- Paiement en espèces et Mobile Money.
- Acomptes et paiements partiels.
- Solde restant par commande.
- Reçu imprimable avec référence, téléphone, articles, prix, montant reçu et reste à payer.
- Journal des opérations, annulations et remboursements autorisés.
- Clôture de caisse quotidienne et rapprochement entre espèces déclarées et encaissements enregistrés.

Le paiement en espèces peut être ajouté sans dépendre d’une API de paiement.


V1.1 — Priorité maximale

3\. Workflow complet de traitement du linge

Le statut actuel peut couvrir les étapes principales, mais le processus opérationnel doit être plus explicite :

Réception → Tri → Lavage → Séchage → Repassage → Contrôle qualité → Prêt → Remis au client.

- Historique horodaté des changements de statut.
- Attribution des articles à un employé.
- Date de livraison prévue et alertes de retard.
- Contrôle des vêtements abîmés ou des réclamations à la réception.
- Interdiction des transitions incohérentes, sauf dérogation autorisée.


V1.2

4\. Fichier clients et fidélisation

- Fiche client avec téléphone et historique des commandes.
- Recherche rapide par téléphone ou référence.
- Historique des paiements et éventuelles réclamations.
- Détection des commandes en retard.
- Bons de réduction ou fidélité dans une version ultérieure.

Le téléphone doit être normalisé selon les formats utilisés en Côte d’Ivoire, sans supposer qu’il identifie toujours un client de manière unique.


V1.2

5\. Gestion des stocks et des dépenses

- Détergents, détachants, emballages, cintres et consommables.
- Entrées, sorties, ajustements et seuils d’alerte.
- Fournisseurs et prix d’achat.
- Dépenses : eau, électricité, loyer, transport, entretien des machines.
- Suivi du coût des consommables par prestation, si les données sont disponibles.

Cela permettra de mesurer une marge estimée, plutôt que de confondre encaissements et bénéfices.


V1.2

6\. Tableau de bord du propriétaire

- Chiffre d’affaires encaissé sur la journée et le mois.
- Commandes reçues, en cours, prêtes et en retard.
- Montants restant à encaisser.
- Prestations les plus vendues.
- Performance des employés et charge de travail.
- Comparaison des périodes et export des rapports.

Tous les indicateurs doivent provenir des données enregistrées et être calculés avec des règles explicites.

#### 4. Améliorations de l’architecture technique

Voici les changements que je recommande sans réécrire inutilement ce qui fonctionne déjà.

| Domaine                | Amélioration recommandée                                                                                                       |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| Base de données        | Contraintes, clés étrangères composites par pressing, index de recherche et migrations versionnées.                            |
| Isolation multi-tenant | Tester les politiques RLS sur chaque table et chaque opération, y compris les fonctions serveur.                               |
| Paiements              | Journal immuable des transactions, idempotence, contrôle des montants et traitement cohérent des notifications concurrentes.   |
| Synchronisation        | File d’attente persistante, reprise après erreur, résolution des conflits et visibilité de l’état de chaque opération.         |
| QR codes               | Identifiants non devinables, validation stricte, contrôle du pressing propriétaire et possibilité de réimprimer une étiquette. |
| Validation             | Schémas Zod partagés lorsque c’est pertinent, validations serveur obligatoires et messages d’erreur français.                  |
| Performance            | Chargement différé des pages, pagination dès que le volume le justifie et tests sur tablette Android d’entrée de gamme.         |
| Déploiement            | Environnements développement, préproduction et production séparés, secrets isolés et procédure de retour arrière.               |
| Qualité                | Tests automatisés dans une intégration continue et contrôles bloquants avant fusion.                                           |

##### Deux améliorations métier particulièrement importantes

A. Préserver l’historique des commandes. Une commande ne doit pas simplement remplacer son statut précédent. Chaque transition devrait conserver l’ancien statut, le nouveau statut, l’utilisateur, la date et, si nécessaire, un motif. Cela permet de savoir qui a marqué un vêtement comme prêt ou remis.

B. Distinguer le statut de la commande du statut du paiement. Un vêtement peut être prêt sans être payé, et une commande peut être partiellement réglée. Il faut donc conserver deux états indépendants, avec un calcul fiable du montant restant dû.

#### 5. Modèle de données cible

Le schéma actuel possède déjà les entités essentielles `tenants`, `tenant_users`, `orders`, `order_items`, `order_status_history` et `payment_transactions`. Je conserverais cette base et l’étendrais progressivement.

Pressing (`tenants`)

Configuration, devise, paramètres et abonnement

Utilisateurs

Rôles et rattachements

Clients

Coordonnées et historique

Catalogue

Articles, prestations et prix

Employés

Attributions et opérations

Commande

Articles, prix historiques, QR code et statut opérationnel

Historique des statuts

Transactions

Reçus

Stocks

Mouvements et fournisseurs

Caisse et rapports

Encaissements, dépenses et marges estimées

Chaque table métier devra être rattachée au pressing concerné et protégée contre l’accès inter-tenant. Pour les paiements, il faudra également prévoir des références uniques, une traçabilité des tentatives et une procédure de rapprochement en cas de notification tardive.

#### 6. Plan d’exécution recommandé

Je ne recommande pas de lancer toutes les nouvelles fonctionnalités simultanément. Il faut d’abord établir un état fiable du code existant, puis avancer par étapes vérifiables.

1. Étape 1 — Audit du commit courant

   Comparer l’application réellement chargée par Vite avec les fichiers hérités, relire les migrations, les fonctions Edge et les tests. Produire un inventaire précis des éléments actifs, obsolètes et manquants.
2. Étape 2 — Stabilisation technique

   Corriger les défauts confirmés, tester l’authentification, l’isolation des pressings et la synchronisation hors ligne. Aucun nouveau module métier tant que les scénarios fondamentaux ne sont pas validés.
3. Étape 3 — Préproduction réelle

   Configurer un projet Supabase de test, appliquer les migrations, tester le parcours de connexion et effectuer des essais de paiement avec les identifiants et l’environnement CinetPay appropriés.
4. Étape 4 — Finalisation du MVP

   Tester le cycle complet : réception d’un vêtement, impression du QR, traitement à l’atelier sans réseau, synchronisation et règlement. Valider l’application sur une tablette Android réelle.
5. Étape 5 — ERP commercial

   Implémenter le catalogue de prestations, la caisse et les reçus, puis les rôles, les clients et les tableaux de bord.
6. Étape 6 — SaaS multi-pressings

   Ajouter l’abonnement, la gestion des accès, la supervision technique et le support, puis les stocks et les analyses avancées selon les besoins des premiers clients.

#### 7. Ce qui reste à vérifier avant de conclure à une mise en production

Le dépôt contient un rapport indiquant une suite de tests et un build réussis à un moment donné. Je n’ai pas exécuté ces commandes moi-même sur le commit courant, et je n’ai pas accès à une instance Supabase ou à des identifiants marchands pour confirmer les flux réels.

Les vérifications suivantes sont donc indispensables :

- `npm ci`, `npm run typecheck`, `npm run lint`, `npm test` et `npm run build` sur la révision actuelle ;
- application effective des migrations à une base de test ;
- essais RLS avec au moins deux pressings et plusieurs rôles ;
- test de bout en bout du webhook de paiement ;
- test hors ligne prolongé, redémarrage de la tablette et reprise de synchronisation ;
- contrôle des variables d’environnement, des secrets et de la configuration HTTPS.

Ma recommandation finale : conserver l’architecture React/TypeScript + Supabase + IndexedDB et consolider d’abord son fonctionnement réel. Le meilleur investissement immédiat n’est pas d’ajouter beaucoup d’écrans : c’est de rendre fiables l’authentification, les commandes, les paiements et la synchronisation. Ensuite, le catalogue tarifaire et la caisse seront les deux extensions les plus utiles pour transformer le MVP en ERP commercial.

<!-- ====================== FIN DU TEXTE SOURCE ====================== -->

---

## 2. Vérification des constats

Méthode : chaque affirmation du document a été confrontée au code présent sur
`main` (`23551c7`). Les références `fichier:ligne` permettent de rejouer la
vérification.

### 2.1 Synthèse

| Constat du document | Verdict | Preuve |
| --- | --- | --- |
| `docs/AUDIT.md` est périmé | **Partiellement inexact** | C'est un instantané **daté** du commit `ae2903f`, titré « Phase 0 : audit du template ». Il documente le point de départ, pas l'état courant. Il doit être archivé, pas réécrit. |
| Du code hérité (Axios, JSX, API locale) subsiste | **Inexact** | `axios` : 0 occurrence dans `src/` et `package.json` ; fichiers `.jsx` : 0 ; `localhost:5000` : 0. Suppression au commit `b25de01`. |
| L'authentification reste à valider sur une vraie instance | **Exact** | `AuthGate.tsx`, `authService.ts`, `tenantContext.ts` existent ; aucun test d'intégration réel. Voir §4, palier 1. |
| Le webhook accepte l'absence de signature HMAC | **Exact, avec nuance** | `supabase/functions/cinetpay-webhook/index.ts:70` → `if (config.secretKey)`. Le statut est **toujours** reconfirmé auprès de CinetPay (`checkPayment`), et `payment_transactions.signature_verified` trace le mode dégradé. |
| La navigation n'est pas restreinte par rôle | **Exact, déjà connu** | `docs/BACKLOG.md:47`. Le rôle est stocké (`src/lib/tenantContext.ts:22`) mais aucune route ni action ne le consulte. La RLS bloque déjà les écritures interdites. |
| Seul l'état final d'une commande est transmis hors ligne | **Exact** | `src/sync/syncEngine.ts:98` → `upsert(..., { onConflict: 'id' })`, sans colonne `version` : dernier écrivain gagne, sans trace. |
| L'historique ne conserve pas l'ancien statut | **Exact** | `supabase/migrations/001_init.sql:86-97` : `status`, `changed_by`, `changed_at` — ni `previous_status`, ni motif. |
| Les QR codes devraient être non devinables | **Déjà satisfait** | `src/lib/ids.ts` (`buildQrString`) embarque l'UUID v4 du pressing **et** celui de la commande. Le QR n'est pas un secret ; la RLS interdit la lecture inter-pressing. Risque résiduel faible. |
| Prévoir la pagination | **Traité le 23/10, autrement** | La liste lit IndexedDB, donc une pagination serveur resterait du code mort. `src/lib/pagination.ts` découpe le rendu (20 par page) ; elle sera branchée côté serveur le jour d'un écran alimenté en direct. |
| Le déploiement n'est pas validé | **Exact** | `scripts/setup.mjs` n'a tourné qu'en `--dry-run` et contre un serveur HTTP simulé. |
| Catalogue, caisse, clients, stocks, tableau de bord absents | **Exact** | 6 tables seulement : `tenants`, `tenant_users`, `orders`, `order_items`, `order_status_history`, `payment_transactions`. |
| Nombre de politiques RLS | **Incohérence documentaire relevée** | Le `CHANGELOG` annonçait 16 politiques ; le décompte réel est **13** (12 dans `001_init.sql` + 1 dans `002_payments.sql`). Corrigé. |

### 2.2 Ce que le document omet, et qui est plus grave

1. **Aucune intégration continue.** Pas de `.github/workflows`. Les « contrôles
   bloquants avant fusion » ne sont pas à améliorer : ils n'existent pas.
2. **Double paiement possible.** `cinetpay-init` génère un `transaction_id`
   neuf à chaque appel ; la garde `already_paid`
   (`cinetpay-init/index.ts:116`) ne protège qu'**après** encaissement. Deux
   initiations avant paiement créent deux guichets CinetPay valides : le client
   peut payer deux fois, sans remboursement automatique.
3. **Écrasement concurrent des statuts.** Deux tablettes hors ligne modifiant
   la même commande : le dernier `upsert` gagne, sans conflit signalé ni trace
   de l'écrasement.
4. **Aucun journal des actions sensibles** au-delà des statuts : pas de trace
   de qui a modifié un prix, un accès ou un montant.

### 2.3 Ce qui est vrai et rassurant

- Le montant encaissé n'est jamais celui envoyé par le navigateur : il est relu
  en base (`cinetpay-init`), et le montant réellement débité est comparé au
  montant attendu dans le webhook.
- Les clés étrangères composites `(order_id, tenant_id)` empêchent qu'une ligne
  pointe vers la commande d'un autre pressing.
- Les UUID sont générés côté client : l'`upsert` est idempotent, rejouer une
  synchronisation ne duplique rien.
- La clé `service_role` ne sort jamais du serveur ; un garde-fou du script
  d'installation refuse même qu'elle soit préfixée `VITE_`.

---

## 3. Écarts assumés avec le document

Trois recommandations ne sont pas reprises telles quelles, avec justification :

| Recommandation | Décision | Justification |
| --- | --- | --- |
| « Identifiants QR non devinables » | **Non retenue** | Les identifiants sont déjà des UUID v4 ; le contenu du QR n'est pas un secret. Le risque réel (réimpression non contrôlée) est traité au palier 2 avec l'historique des impressions. |
| « Pagination dès que le volume le justifie » | **Appliquée côté rendu** | Aucune liste serveur n'existe, donc pas de pagination SQL. La liste des commandes est découpée en pages de 20 dans l'interface ; le filtre et la recherche portent sur la liste entière. |
| « Réécrire `docs/AUDIT.md` » | **Remplacée par l'archivage** | Ce document est la trace datée du point de départ (commit `ae2903f`). Le réécrire effacerait la preuve de l'ampleur de la reprise. Un bandeau d'archive et un audit courant séparé remplissent le même objectif sans perte d'information. |

---

## 4. Hiérarchie des implémentations

Les six étapes du document sont conservées, mais regroupées en **paliers** pour
tenir compte de l'état réel du code. Un palier n'est clos qu'après validation
explicite : aucun palier suivant n'est entamé sans elle.

### Correspondance avec le plan du document

| Document source | Palier retenu |
| --- | --- |
| Étape 1 — Audit du commit courant | **Palier 0** |
| Étape 2 — Stabilisation technique | **Palier 1** |
| Étape 3 — Préproduction réelle | **Palier 1** (critère de sortie) |
| Étape 4 — Finalisation du MVP | **Palier 1** (recette terrain) |
| Étape 5 — ERP commercial | **Paliers 2 et 3** |
| Étape 6 — SaaS multi-pressings | **Palier 4** |

### Palier 0 — Rendre l'état fiable

**Objectif :** que toute affirmation sur le dépôt soit vérifiable et que rien ne
puisse fusionner avec un build rouge.

- [x] `MAJ.md` : texte source, vérification, hiérarchie.
- [x] Archiver `docs/AUDIT.md` (bandeau explicite, commit audité).
- [x] `docs/AUDIT-COURANT.md` : inventaire actif / obsolète / manquant.
- [x] Intégration continue : `npm ci`, `typecheck`, `lint`, `test`, `build` sur
      chaque PR et sur `main`.

**Critère de sortie :** une PR dont le build, le lint ou les tests échouent est
bloquée par GitHub Actions.

État : le workflow est validé localement (`npm ci` puis les quatre contrôles,
tous verts). Sa première exécution réelle aura lieu à l'ouverture de la PR.
Pour que l'échec soit réellement **bloquant**, cocher « Require status checks
to pass before merging » dans Settings → Branches et sélectionner le job
« Types, style, tests et build » : ce réglage appartient au dépôt GitHub, il
n'est pas versionné.

### Palier 1 — Stabilisation technique (P0)

**Objectif :** aucun risque financier ou opérationnel silencieux.

- [x] **Paiement — un seul guichet ouvert** : une transaction `pending` ou
      `initiated` de moins de 15 min est réutilisée ; sinon elle est clôturée
      avant d'en ouvrir une autre. Un index unique partiel
      (`uniq_payment_open_per_order`) rend la règle infalsifiable, y compris
      en cas de requêtes concurrentes (réponse 23505 → on renvoie le guichet
      gagnant au lieu d'échouer).
- [x] **Paiement — signature obligatoire** : en production (défaut), le
      webhook refuse (503) toute notification si `CINETPAY_SECRET_KEY` manque.
      Le mode sans HMAC exige `APP_ENV=development`.
- [x] **Paiement — notifications concurrentes** : la bascule vers `paid` est un
      compare-and-set sur le statut lu ; la seconde notification ne touche
      aucune ligne et s'arrête.
- [x] **Synchronisation — verrou optimiste** : colonne `version`, trigger
      d'incrémentation limité aux champs métier, `update … eq('version', n)`.
      Zéro ligne touchée = conflit.
- [x] **Synchronisation — conflit visible et arbitrable** : bandeau dans la
      fiche commande, deux issues explicites (« garder mes modifications » /
      « prendre la version du serveur »), et badge « Conflit » dans la liste.
      Une commande en conflit n'est plus renvoyée automatiquement.
- [x] **Historique** : `previous_status` renseigné par le trigger.
- [ ] **Historique — motif de dérogation** : la colonne `reason` existe mais
      l'interface ne demande pas encore de motif (aucun écran de saisie).
- [x] **Rôles** : matrice `src/lib/permissions.ts`, garde-fou serveur
      `guard_order_update` (artisan interdit sur montants et coordonnées,
      `payment_status` réservé au serveur, réouverture d'une commande livrée
      réservée au propriétaire), navigation et montants masqués.
- [x] **Tests** : 128 tests, dont 15 sur le moteur de synchronisation (conflit,
      doublon 23505, échec partiel) et 8 sur la matrice de rôles.
- [ ] **Recette réelle** — projet Supabase de test : migrations, deux pressings,
      plusieurs rôles, paiement de bout en bout, mode avion prolongé.

**Critère de sortie :** les scénarios de l'étape 3 du document passent sur une
préproduction, sans double paiement ni écrasement silencieux.

État : les trois défauts de code sont corrigés et couverts par des tests
locaux ; la recette sur une base réelle reste à faire, faute d'identifiants
Supabase dans cet environnement.

### Palier 2 — Cœur ERP (V1.1)

- [x] Catalogue des prestations et tarification, **prix historisé** sur chaque
      ligne de commande — `004_palier2.sql`, écran Prestations, motif de
      dérogation journalisé (`order_price_history`).
- [x] Caisse : espèces, acomptes, solde dû, reçus imprimables, clôture
      journalière et rapprochement — `record_cash_payment`, écrans Caisse et
      Reçu, `close_cash_session`.
- [x] Workflow complet (tri, séchage, contrôle qualité), date de livraison
      prévue, alertes de retard — neuf statuts, `orders.due_date`, badge
      « En retard ».
- [x] Finitions de la même vague : attribution à un employé, réclamations et
      vêtements abîmés, remboursements encadrés, motif de transition
      (`005_palier2_complement.sql`).

### Palier 3 — V1.2

- [x] Clients et historique — `006_palier3.sql` (`customers`,
      `normalize_phone`, `attach_customer_to_order`), écran Clients, historique
      et total dépensé calculés hors ligne depuis les commandes locales.
- [x] Stocks, fournisseurs et dépenses — `stock_items`, grand livre
      `stock_movements` + `apply_stock_movement`, `suppliers`, `expenses`
      (propriétaire seul), vue `expense_totals`, écrans Stock et Dépenses.
- [x] Tableau de bord propriétaire — activité du jour, chiffre d'affaires,
      encours, retards, alertes de stock et dépenses du mois ; calculs locaux,
      compléments serveur marqués « hors ligne ».

### Palier 4 — SaaS

- [x] Abonnement — `007_palier4.sql` (`plans`, `subscriptions`,
      `subscription_state`, `tenant_writable`), écran `/abonnement` et bandeau
      d'échéance. Un abonnement échu ou suspendu ferme les écritures (RLS
      restrictives + déclencheurs) sans bloquer la lecture.
- [x] Multi-boutiques — en-tête `x-tenant-id` validé par `is_tenant_member`,
      rôle recalculé par boutique, sélecteur de boutique dans l'en-tête.
- [x] Supervision — `platform_admins` sans politique RLS, fonctions de console
      vérifiant `is_platform_admin()`, ouverture de boutique et rattachement de
      comptes bornés par la formule.
- [x] Support — demandes cloisonnées par pressing, réponse et clôture par
      l'éditeur.

---

## 5. Journal d'avancement

| Date | Palier | Action | Commit |
| --- | --- | --- | --- |
| 23/10/2026 | 0 | `MAJ.md`, archivage de `docs/AUDIT.md`, `docs/AUDIT-COURANT.md`, correction du décompte de politiques RLS | `1726cf7` |
| 23/10/2026 | 0 | Intégration continue : `npm ci`, types, style, tests, build sur chaque PR | `cc390d1` |
| 23/10/2026 | 0 | Imbrication du texte source dans le sommaire | `98e7bbf` |
| 23/10/2026 | 1 | Paiement : guichet unique, HMAC obligatoire en production, notifications concurrentes (`003_palier1.sql`, `cinetpay-init`, `cinetpay-webhook`) | `174c134` |
| 23/10/2026 | 1 | Synchronisation : verrou optimiste, conflits arbitrables, `previous_status` | `6fa254f` |
| 23/10/2026 | 1 | Rôles : matrice, garde-fou serveur, navigation et montants masqués | `387c8a2` |
| 23/10/2026 | 1 | Vérification SQL réelle : `scripts/sql-verify.sh` + 29 contrôles rejoués sur PostgreSQL 16, job CI dédié | `174c134` |
| 23/10/2026 | 1 | Retrait d'un lien d'image en japonais introduit par le copier-coller du texte source ; contrôle automatique de langue ajouté | `de6b73a` |
| 23/10/2026 | 2 | Catalogue, prix historisé, workflow en 8 étapes, caisse, reçu imprimable, clôture journalière (`004_palier2.sql`, 22 contrôles SQL) | `8170369` |
| 23/10/2026 | 2 | Écrans Caisse et Prestations, reçu 80 mm, badge « En retard », transitions filtrées par rôle | `9e2c33b` |
| 23/10/2026 | 2 | Encaissements et relecture distante couverts par 37 tests supplémentaires | `1c4e78b` |
| 23/10/2026 | 2 | Guichet Mobile Money : ne facturer que le reste à payer | `790f863` |
| 23/10/2026 | 2 | Attribution, réclamations, remboursements, tarif dérogatoire, motif de transition (`005_palier2_complement.sql`, 24 contrôles SQL) | `d87b673` |
| 23/10/2026 | 2 | Catalogue, caisse et workflow : 179 tests, 76 contrôles SQL, build vérifié | `c55c0de` |
| 23/10/2026 | 3 | Clients : fiche par téléphone, `normalize_phone`, rattachement automatique à la commande (`006_palier3.sql`, 17 contrôles SQL) | `fe2eda7` |
| 23/10/2026 | 3 | Stock : articles, seuils, grand livre immuable des mouvements, fournisseurs | `fe2eda7` |
| 23/10/2026 | 3 | Dépenses catégorisées réservées au propriétaire, vue `expense_totals` | `fe2eda7` |
| 23/10/2026 | 3 | Écrans Clients, Stock, Dépenses et Tableau de bord, capacités et navigation par rôle | `a93cb97` |
| 23/10/2026 | 3 | Documentation du palier 3, CHANGELOG 0.4.0 (203 tests, 93 contrôles SQL) | `e86bb60` |
| 23/10/2026 | 4 | Abonnement, multi-boutiques, supervision et support (`007_palier4.sql`, 28 contrôles SQL) | `e415eea` |
| 23/10/2026 | 4 | Écrans Abonnement, Support et Supervision, sélecteur de boutique, 18 tests (221 au total) | `f6a3a28` |
| 23/10/2026 | 4 | `PLATFORM_ADMIN` dans `.env` : compte éditeur inscrit à l'installation | `3ec6d96` |
| 23/10/2026 | 4 | Documentation du palier 4, CHANGELOG 0.5.0 (222 tests, 123 contrôles SQL) puis date locale de l'abonnement | `eae4fc2` |
| 23/10/2026 | MVP | `docs/CONFORMITE-MVP.md` : correspondance des douze écrans, réinitialisation du mot de passe, arguments de connexion, historique des scans | `ef19e27` |
| 23/10/2026 | MVP | Barre latérale en bureau, page Paramètres, CHANGELOG 0.5.1 | `8063ffb` |
| 23/10/2026 | MVP | Commande en trois étapes, étape de règlement, cinq dernières commandes sur le tableau de bord (227 tests) | `015bc31` |
| 23/10/2026 | MVP | Pagination de la liste des commandes (20 par page), 9 tests | `f884b8b` |
| 23/10/2026 | MVP | `npm run recette` : 7 contrôles en lecture seule du projet déployé, 9 tests | `dfcff54` |
| 23/10/2026 | MVP | Écran 11 : `/rapports` (7/30/90 j, comparaison, export CSV) et `src/lib/reporting.ts`, 23 tests | `a9ea06a` |
| 23/10/2026 | MVP | `scripts/db.mjs` : schéma et 123 contrôles SQL sur une base gérée (Neon), 15 tests | `74339b2` |

**Règle de tenue :** chaque ligne du journal indique le palier, l'action et le
commit ; une case n'est cochée qu'après vérification sur le commit concerné.
