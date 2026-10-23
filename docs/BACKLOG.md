# Backlog — hors périmètre du MVP

Ce fichier recense les fonctionnalités **volontairement exclues** du MVP
(`v0.1.0-mvp`) et reportées en version 2, conformément au cahier des charges
`RESTRUCTURATION.md` (§ périmètre strict : commandes, QR code, offline-first,
paiement Mobile Money).

Toute demande hors de ces quatre modules est refusée en MVP et consignée ici.

---

## 1. Paiement

| Fonctionnalité | Raison du report |
| --- | --- |
| Remboursement / annulation CinetPay | L'API de remboursement exige un compte marchand vérifié et une gestion comptable des reversements. |
| Paiement partiel / acompte | Le modèle suppose un règlement unique de la commande ; un acompte imposerait un suivi de solde et une facturation intermédiaire. |
| Paiement à la livraison (espèces) | Le MVP ne gère que le Mobile Money ; l'encaissement en espèces reste manuel, hors application. |
| Paiement par carte bancaire | Hors périmètre Mobile Money du MVP. |
| Réconciliation comptable automatique | Nécessite un export vers un outil comptable, hors périmètre. |

## 2. Gestion du pressing

| Fonctionnalité | Raison du report |
| --- | --- |
| Tarification / grille de prix par type de vêtement | Le MVP saisit un montant libre ; une grille paramétrable exige un module de catalogue. |
| Gestion des clients (fiche, historique, fidélité) | Le MVP ne conserve que le nom et le téléphone saisis sur la commande. |
| Gestion des employés (rôles, pointage, plannings) | Le contrôle d'accès se limite à l'appartenance à un pressing. |
| Gestion de stock (produits, consommables) | Hors des quatre modules imposés. |
| Livraison / tournées | Hors périmètre. |
| Impression de reçus de caisse | Seule l'étiquette QR 80 mm est imprimée. |

## 3. Plateforme

| Fonctionnalité | Raison du report |
| --- | --- |
| Tableau de bord propriétaire (revenus, volumes, graphiques) | Le MVP affiche la liste filtrée des commandes. |
| Notifications SMS / WhatsApp au client | Coût par message et dépendance à un fournisseur non imposé. |
| Abonnement SaaS facturé aux pressings | Module de facturation hors périmètre (le paiement CinetPay porte sur les commandes, pas sur l'abonnement). |
| Multi-boutiques par pressing / gestion de franchises | Le modèle tenant ↔ pressing est 1‑1 en V1. |
| Application mobile native (Android/iOS) | La PWA installable couvre le besoin de saisie en atelier. |
| Synchronisation temps réel entre appareils (Realtime) | Le MVP synchronise à la demande et au retour du réseau. |
| Import / export CSV | Hors périmètre. |
| Journal d'audit consultable dans l'interface | Les données existent (`order_status_history`) mais l'écran est reporté. |
| Réinitialisation du mot de passe par e-mail | En MVP, le propriétaire recrée un mot de passe depuis Supabase. Un flux « mot de passe oublié » demande un écran dédié et un modèle d'e-mail personnalisé. |
| Sélecteur multi-pressing | `resolveTenantForUser` retient le premier rattachement ; un utilisateur ne gère qu'une boutique en V1. |
| Navigation restreinte par rôle | Le rôle est affiché mais tous les onglets restent visibles ; la RLS bloque déjà les écritures interdites. |
| Verrouillage de la tablette après inactivité | Utile pour un appareil partagé en atelier : nécessite une gestion de session avancée. |

## 4. Marquage QR

| Fonctionnalité | Raison du report |
| --- | --- |
| QR codes pour les tickets clients (en plus de l'étiquette linge) | Un seul QR par commande en V1. |
| Codes-barres 1D | Le QR suffit. |

## 5. Technique / dette identifiée

| Sujet | Détail |
| --- | --- |
| Exécution des tests en intégration continue | 58 tests Vitest existent (`npm test`) mais aucun workflow CI n'est encore branché : à faire lors de la mise en production. |
| Audit Lighthouse automatisé | Non exécutable dans l'environnement de développement (aucun navigateur). À rejouer sur le déploiement HTTPS, idéalement dans la CI. |
| Couverture de code | Pas encore mesurée (pas de `@vitest/coverage-v8`) ; à activer avec un seuil minimum. |
| `deno check` sur les Edge Functions | Aucun binaire Deno dans l'environnement de développement : validation par relecture + `esbuild` uniquement. |
| Authentification complète | `TenantGate` permet de choisir un pressing à la main ; la connexion Supabase réelle arrive en phase 5. |
| Pagination de la liste des commandes | Chargement local complet via Dexie ; à revoir au‑delà de quelques centaines de commandes. |
