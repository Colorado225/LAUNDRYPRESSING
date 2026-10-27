import { describe, expect, it } from "vitest";
import { existsSync } from "node:fs";
import { join } from "node:path";
import {
  GARMENT_GRID,
  GARMENT_IMAGE,
  getGarmentImage,
} from "@/constants/garmentImages";
import { GARMENT_TYPES } from "@/constants/garmentTypes";

/**
 * La grille du comptoir référence des fichiers de `public/images/`.
 * Un renommage d'image ne provoque aucune erreur de compilation : la tuile
 * s'affiche simplement vide en atelier. Ces tests transforment ce défaut
 * silencieux en échec de CI.
 */

const DOSSIER_IMAGES = join(process.cwd(), "public", "images");

describe("icônes de vêtements", () => {
  it("chaque type de vêtement a une image", () => {
    for (const { value } of GARMENT_TYPES) {
      expect(GARMENT_IMAGE[value], `type sans image : ${value}`).toBeTruthy();
    }
  });

  it("tous les fichiers référencés existent réellement", () => {
    for (const fichier of Object.values(GARMENT_IMAGE)) {
      expect(
        existsSync(join(DOSSIER_IMAGES, fichier)),
        `image absente de public/images : ${fichier}`,
      ).toBe(true);
    }
  });

  it("aucun fichier n’est associé à deux types différents", () => {
    const fichiers = Object.values(GARMENT_IMAGE);
    expect(new Set(fichiers).size).toBe(fichiers.length);
  });

  it("la grille ne propose que des types connus, sans doublon", () => {
    const types = GARMENT_GRID.map((entree) => entree.type);
    expect(new Set(types).size).toBe(types.length);
    for (const type of types) {
      expect(GARMENT_IMAGE[type]).toBeTruthy();
    }
  });

  it("le chemin public est cohérent avec le nom de fichier", () => {
    expect(getGarmentImage("DRAP")).toBe("/images/manche-longue.png");
  });
});
