# Rapport — Phase 2 : Client — recherche téléphone + historique

**Date :** 27/10/2026  
**Branche :** `feature/workflow-commande-comptoir`

---

## Objectif

Taper `+225 07 00 00 01` à l'étape « Client » → afficher "Awa Ndiaye — 4 commandes précédentes" et pré-remplir le nom client.

---

## Fichiers modifiés

### 1. `src/lib/customerSuggestions.ts`

Ajout de deux fonctions :

| Fonction | Rôle |
|---|---|
| `countPreviousOrders(orders, phone)` | Compte le nombre de commandes locales pour un numéro normalisé (gère `+225`, espaces, tirets). Retourne 0 si < 3 chiffres. |
| `lastCustomerNameByPhone(orders, phone)` | Retourne le nom le plus récent associé au numéro, ou `''` si inconnu. |

### 2. `src/pages/OrderForm.tsx`

- **Import** : `suggestCustomersByPhone`, `countPreviousOrders`, `lastCustomerNameByPhone`
- **Nouveaux états** :
  - `previousOrderCount` : nombre de commandes précédentes
  - `suggestedName` : nom le plus récent trouvé
- **Effet côté client** (`useEffect` sur `customerPhone`) : quand le téléphone atteint ≥ 3 chiffres, calcule le nombre de commandes précédentes et le nom suggéré. Pré-remplit `customerName` automatiquement s'il est vide et qu'un client est connu.
- **Affichage sous le champ téléphone** :
  - Si client connu avec historique : puce `Awa Ndiaye — 4 commandes précédentes`
  - Bouton « Utiliser ce nom » pour pré-remplir manuellement
  - Sinon, message existant « Un client connu utilise déjà ce numéro. »

### 3. `src/test/customerSuggestions.test.ts`

Ajout de 4 nouveaux tests (7 tests au total dans ce fichier) :

- `countPreviousOrders` : comptage malgré les formats (`+225`, espaces), retour 0 pour inconnu/trop court
- `lastCustomerNameByPhone` : nom le plus récent, chaîne vide pour inconnu

---

## Validations

| Vérification | Résultat |
|---|---|
| `vitest run src/test/customerSuggestions.test.ts` | ✅ 7 / 7 passés |
| `vitest run` (suite complète) | ✅ 674 / 674 passés (670 + 4 nouveaux) |
| `tsc --noEmit` | ✅ Aucune erreur |
| `npm run build` | ✅ Build production réussi |

---

## Comportement utilisateur (étape Client)

1. L'utilisateur tape `+225 07 00 00 01` (≥ 3 chiffres)
2. L'app affiche : `Awa Ndiaye — 4 commandes précédentes`
3. Le champ « Nom » est pré-rempli avec `Awa Ndiaye` (éditable)
4. Bouton « Utiliser ce nom » disponible pour confirmer

---

## Suivant

**Phase 3** : Grille d'icônes — quantité + état par pièce (Bon état / Tache), compteur "10 pièces".
