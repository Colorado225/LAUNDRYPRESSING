import type { OrderGarmentType } from "@/types/database";

/**
 * Icônes de vêtements de la grille tactile du comptoir.
 *
 * Les fichiers vivent dans `public/images/`. Les noms sont ceux fournis par
 * l'illustrateur (`tile000`… `tile027`) : ils ne sont PAS parlants, d'où cette
 * table de correspondance qui fait foi. Ne jamais référencer un nom de fichier
 * ailleurs : passer par `GARMENT_IMAGE` ou `getGarmentImage()`.
 *
 * Les images sont des tuiles carrées de 375×374 px avec fond de couleur. Elles
 * sont affichées en 56 px : le fichier source reste lourd pour un usage en
 * atelier sur réseau lent, voir la note de performance dans le README.
 *
 * Les noms de fichiers sont volontairement sans espace ni accent : une URL
 * contenant un espace est mal résolue en HTML et complique le débogage d'une
 * tuile vide en atelier (`Manche Longe.png` a été renommée).
 */

/** Nom de fichier (sans dossier) associé à chaque type de vêtement. */
export const GARMENT_IMAGE: Readonly<Record<OrderGarmentType, string>> = {
  CHEMISE: "tile002.png",
  T_SHIRT: "tile001.png",
  PANTALON: "tile006.png",
  JEAN: "tile013.png",
  ROBE: "tile015.png",
  JUPE: "tile010.png",
  VESTE: "tile009.png",
  COSTUME: "Jacket.png",
  BOUBOU: "tile027.png",
  DRAP: "manche-longue.png",
  SERVIETTE: "tile012.png",
  AUTRE: "tile019.png",
};

/**
 * Types proposés à la grille du comptoir, dans l'ordre d'affichage.
 *
 * L'ordre n'est pas alphabétique : il suit l'usage réel d'un pressing
 * d'Abidjan — le chemisier et le pantalon partent tous les jours, le costume
 * et le boubou sont occasionnels.
 */
export const GARMENT_GRID: ReadonlyArray<{
  type: OrderGarmentType;
  label: string;
  /** Favori affiché en premier, sur une rangée dédiée. */
  favori?: boolean;
}> = [
  { type: "CHEMISE", label: "Chemise", favori: true },
  { type: "PANTALON", label: "Pantalon", favori: true },
  { type: "T_SHIRT", label: "T-shirt", favori: true },
  { type: "JEAN", label: "Jean", favori: true },
  { type: "VESTE", label: "Veste", favori: true },
  { type: "ROBE", label: "Robe", favori: true },
  { type: "JUPE", label: "Jupe" },
  { type: "COSTUME", label: "Costume" },
  { type: "BOUBOU", label: "Boubou" },
  { type: "DRAP", label: "Drap" },
  { type: "SERVIETTE", label: "Serviette" },
  { type: "AUTRE", label: "Autre" },
];

/** Chemin public d'une icône, utilisable directement dans un `src` d'image. */
export function getGarmentImage(type: OrderGarmentType): string {
  return `/images/${GARMENT_IMAGE[type]}`;
}
