# Backlog — hors périmètre du MVP

Ce fichier recense les fonctionnalités **volontairement exclues** du MVP
(`v0.1.0-mvp`) et reportées en version 2, conformément au cahier des charges
`RESTRUCTURATION.md` (§ périmètre strict : commandes, QR code, offline-first,
paiement Mobile Money).

Toute demande hors de ces quatre modules est refusée en MVP et consignée ici.

> **État historique — ne pas utiliser comme référence du périmètre courant.**
> La révision du 26 octobre 2026 a supprimé le catalogue tarifaire et les
> modèles commerciaux (migration 020). Les anciennes mentions ci-dessous
> décrivent des fonctionnalités antérieures ; le périmètre actuel et les
> contrôles à jour sont dans [`AUDIT-COURANT.md`](AUDIT-COURANT.md) et le
> [`README`](../README.md).

---

## 1. Paiement

| Fonctionnalité | Raison du report |
| --- | --- |
| Remboursement / annulation CinetPay | L'API de remboursement exige un compte marchand vérifié et une gestion comptable des reversements. Les remboursements **espèces** sont, eux, gérés (palier 2). |
| Paiement par carte bancaire | Hors périmètre Mobile Money du MVP. |
| Réconciliation comptable automatique | Nécessite un export vers un outil comptable, hors périmètre. |
| Prélèvement automatique de l'abonnement | Le règlement de l'abonnement se fait auprès de l'éditeur, qui enregistre la période réglée (décision du palier 4). |

## 2. Gestion du pressing

| Fonctionnalité | Raison du report |
| --- | --- |
| Gestion des employés (pointage, plannings) | Hors périmètre. Les **rôles**, eux, existent depuis le palier 1 et le rattachement des comptes depuis le palier 4. |
| Livraison / tournées | Hors périmètre. |
| Bons de réduction et fidélité | Nécessite un moteur de promotions ; le module clients (palier 3) en est le préalable. |
| Suivi du coût des consommables par prestation | **Implémenté et vérifié automatiquement (lot 3)** — une sortie peut être imputée à une ligne de commande ; le coût unitaire connu est figé et la marge après consommables imputés est estimée. Les recettes de consommation automatiques par prestation et les sorties non imputées restent hors calcul ; une recette métier sur de vraies sorties reste à effectuer. |
| Comparaison de périodes et export des rapports | **Implémenté et vérifié automatiquement (lot 3)** — comparaison de périodes égales et export CSV de la synthèse, des variations, des jours, des statuts et des prestations. La recette utilisateur reste à effectuer. |
| Performance et charge de travail par employé | **Charge actuelle et activité agrégées dans Rapports** — commandes ouvertes, retards, commandes créées sur la période et livrées parmi celles-ci, avec export CSV. Le modèle actuel ne garde pas l'historique des réattributions ni les horodatages de chaque étape : une vraie mesure de productivité/délai individuel nécessite un journal d'affectation et de transitions, qui reste à concevoir. |

## 3. Plateforme

| Fonctionnalité | Raison du report |
| --- | --- |
| Notifications SMS / WhatsApp au client | Coût par message et dépendance à un fournisseur non imposé. |
| Application mobile native (Android/iOS) | La PWA installable couvre le besoin de saisie en atelier. |
| Synchronisation temps réel entre appareils (Realtime) | Le MVP synchronise à la demande et au retour du réseau. |
| Import / export CSV | Hors périmètre. |
| Réinitialisation du mot de passe par e-mail | En MVP, le propriétaire recrée un mot de passe depuis Supabase. Un flux « mot de passe oublié » demande un écran dédié et un modèle d'e-mail personnalisé. |
| Création de comptes depuis la console de supervision | Exigerait la clé `service_role` dans le navigateur : proscrit. L'éditeur crée le compte dans Supabase Auth puis le rattache. |
| Verrouillage de la tablette après inactivité | Utile pour un appareil partagé en atelier : nécessite une gestion de session avancée. |
| Facturation automatique des abonnements | Le palier 4 enregistre les périodes réglées ; aucun prélèvement n'est automatisé. |

## 4. Marquage QR

| Fonctionnalité | Raison du report |
| --- | --- |
| QR codes pour les tickets clients (en plus de l'étiquette linge) | Un seul QR par commande en V1. |
| Codes-barres 1D | Le QR suffit. |

## 5. Technique / dette identifiée

| Sujet | Détail |
| --- | --- |
| Couverture de code | Pas encore mesurée (pas de `@vitest/coverage-v8`) ; à activer avec un seuil minimum. |
| Validation UX sur tablette physique | Premier essai terrain signalé comme effectué le 24/10/2026 ; la prochaine itération porte sur l'atelier (file filtrable, échéances prioritaires). Aucun suivi télémétrique n'est ajouté. |
| Audit Lighthouse automatisé | Non exécutable dans l'environnement de développement (aucun navigateur). À rejouer sur le déploiement HTTPS, idéalement dans la CI. |
| `deno check` sur les Edge Functions | Aucun binaire Deno dans l'environnement de développement : validation par relecture + `esbuild` uniquement. |
| Pagination **serveur** des commandes | Les commandes lisent Dexie et sont paginées côté rendu (20 par page). Les dépenses, elles, sont déjà paginées par curseur côté serveur ; la même mécanique servira quand les commandes passeront au serveur. |
| Recette sur un projet Supabase réel | **Faite le 23/10 pour le schéma, l'isolation et les rôles** (`recette_reelle.sql`, deux pressings, trois comptes). Edge Functions déployées et paiement CinetPay de bout en bout restent non testés. Le schéma et les règles RLS le sont sur PostgreSQL 16 (175 contrôles) ; `npm run recette` couvre 7 contrôles du projet déployé. La marche à suivre humaine est dans `docs/RECETTE-SUPABASE.md`. |
| Demandes de support hors ligne | Aucune file d'attente dédiée : une demande nécessite une connexion. |
| Connexion à une base gérée **distante** | `scripts/db.mjs` a été validé sur un PostgreSQL 16.2 local ; l'environnement de développement filtre la sortie réseau, la connexion à un hôte distant n'a donc pas pu être exercée. Marche à suivre : `docs/NEON.md`. |
| Rapports côté serveur | Les rapports lisent IndexedDB : une autre tablette n'apparaît qu'après synchronisation. Une agrégation SQL (vue matérialisée + `rpc`) deviendra utile au-delà de quelques milliers de commandes. |
