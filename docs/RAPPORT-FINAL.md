# Rapport final — Pressing Pro MVP `v0.1.0-mvp`

Date : 23 octobre 2026 · Périmètre : `RESTRUCTURATION.md` (4 modules)

---

## 1. En une phrase

L'application permet à un pressing d'Abidjan d'enregistrer une commande, d'imprimer
une étiquette QR, de la faire avancer à l'atelier **sans réseau**, et d'encaisser
en Mobile Money — chaque pressing ne voyant que ses propres données.

---

## 2. Ce qui fonctionne

| Module | État | Vérification |
| --- | --- | --- |
| **Commandes** | Création, liste, recherche, filtres, fiche, changement de statut | Tests Vitest `useCreateOrder` (6) + usage |
| **Offline-first** | Dexie, file d'attente, synchro auto, indicateur vert/orange/rouge | Tests `syncEngine` (11) — dont échec partiel et idempotence |
| **QR Code** | Génération, étiquette 80 mm, scan caméra, saisie manuelle | Tests `qrService` (18), dont lecture de l'en-tête PNG 512 px |
| **Mobile Money** | Wave, Orange Money, MTN MoMo, Moov Money via CinetPay | Revue + transpilation ; **aucun paiement réel** |
| **Multi-tenant** | RLS sur 6 tables, révocation `anon`, écritures serveur | Tests `tenantIsolation` (23) + script SQL fourni |
| **PWA / Auth** | Installable, connexion, session hors ligne, retour Android | Tests DOM en phase 5 (32) ; installation non testée sur appareil |
| **Qualité** | 58 tests automatisés, `typecheck`, `lint`, `build` verts | `npm test` |

**Chiffres du build** : bundle principal 204 kB (64 kB gzip), atelier chargé à la
demande (383 kB), précache PWA 39 fichiers / 1,19 Mo.

---

## 3. Ce qui n'a pas pu être vérifié ici

Ces points sont **bloquants pour une mise en production** et doivent être levés
avant l'ouverture au public :

1. **Migrations jamais exécutées** — aucun projet Supabase provisionné. La
   syntaxe est validée (analyseur PostgreSQL `libpg_query` via `pglast` : 98
   instructions), mais l'exécution réelle reste à faire.
2. **Aucun paiement réel** — pas d'identifiants marchand CinetPay. Le flux complet
   (guichet → webhook → statut) n'a jamais tourné de bout en bout.
3. **Lighthouse non exécuté** — aucun navigateur Chrome/Chromium dans
   l'environnement. Les critères PWA ont été vérifiés statiquement (manifeste
   complet, service worker, HTTPS requis, icônes 192/512/maskable, `lang="fr"`)
   et les contrastes calculés (thème teal corrigé de 3,74:1 à 5,47:1).
4. **Installation sur Android physique** — critère de la phase 5 à rejouer sur la
   tablette cible.

---

## 4. Ce qui reste à faire en V2

Liste détaillée et priorisée dans `docs/BACKLOG.md`. Les trois chantiers les plus
structurants :

1. **Réinitialisation de mot de passe** — aujourd'hui le propriétaire recrée le
   mot de passe depuis Supabase.
2. **Tarification par type de vêtement** — le MVP saisit un montant libre ; une
   grille paramétrable éviterait les erreurs de prix au comptoir.
3. **Synchronisation temps réel** — le MVP rafraîchit sur action ou au retour du
   réseau ; Supabase Realtime permettrait de suivre plusieurs tablettes en direct.

Également : remboursements, paiement partiel, multi-boutiques, tableau de bord
propriétaire, notifications SMS.

---

## 5. Coût réel

### 5.1 Consommé pendant le développement

**0 FCFA.** Aucune ressource cloud n'a été provisionnée : pas de projet Supabase,
pas d'identifiants CinetPay, pas de déploiement. Tout le travail a été réalisé en
local, avec des tests automatisés à la place d'un environnement réel.

### 5.2 Coût d'exploitation prévisionnel

**CinetPay** (paiements entrants, Côte d'Ivoire — grille publique, consultée le
23/10/2026 ; les tarifs réels dépendent du contrat et du volume) :

| Opérateur | Commission |
| --- | --- |
| Orange Money CI | 3,0 % |
| Wave CI | 2,0 % |
| Moov Money CI | 2,5 % |
| MTN MoMo CI | 1,8 % |
| Carte Visa / Mastercard | 3,5 % |

CinetPay annonce par ailleurs une fourchette de **1,5 % à 3,5 %** selon le volume
de transactions, et un abonnement annuel de l'ordre de **20 USD** est rapporté par
la presse spécialisée (à confirmer au contrat).

**Exemple de budget mensuel** — 300 commandes à 8 500 FCFA, répartition
50 % Orange Money / 25 % Wave / 20 % MTN / 5 % Moov :

- encaissements : 2 550 000 FCFA/mois ;
- commission moyenne pondérée : ≈ **2,5 %**, soit **≈ 63 500 FCFA/mois** ;
- Supabase **Free** (0 FCFA) suffit au démarrage (500 Mo, 500 000 invocations
  d'Edge Functions) ; passer à **Pro (25 USD/mois)** dès que des sauvegardes
  point-in-time sont nécessaires ;
- Vercel : offre **Hobby gratuite**, mais réservée aux usages non commerciaux →
  prévoir **Pro (20 USD/mois)** pour un service payant.

**Ordre de grandeur** : environ **0 à 45 USD/mois** d'infrastructure, plus
**2,5 % du chiffre d'affaires encaissé** en commissions Mobile Money. Une
intégration directe des opérateurs coûterait 1 à 2 %, mais imposerait quatre
intégrations à maintenir — hors périmètre du MVP.

---

## 6. Mise en production — liste de contrôle

1. Créer le projet Supabase, exécuter `001_init.sql`, `002_payments.sql`,
   puis `seed.sql` (facultatif).
2. Déployer `cinetpay-init` et `cinetpay-webhook --no-verify-jwt` ; poser les
   secrets (`CINETPAY_API_KEY`, `CINETPAY_SITE_ID`, `CINETPAY_SECRET_KEY`,
   `APP_URL`).
3. Créer le compte marchand CinetPay et renseigner l'URL de notification.
4. Déployer le front (`npm run build`) sur un hébergement HTTPS.
5. Exécuter `supabase/tests/isolation.sql` et lire les `NOTICE`.
6. Faire un paiement de 100 FCFA de bout en bout, puis le rejouer pour vérifier
   l'idempotence.
7. Rejouer le critère de la phase 5 sur la tablette Android réelle.
