import { describe, expect, it } from 'vitest'
import {
  articlesDuParcours,
  CATEGORIES_BLANCHISSERIE,
  CATEGORIES_PRESSING,
  filtrerArticles,
  parcoursDepuisActivite,
  parcoursDepuisPrestation,
  servicesALaPiece,
  servicesAuKilo,
  servicesDuParcours,
} from '@/lib/orderServices'
import type { TenantServiceOffering } from '@/services/tenantServices'
import { existsSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Règles du parcours de commande : quelles catégories, quels articles, et quel
 * parcours correspond à une activité réellement configurée.
 *
 * Ces règles décident de l'écran que voit le réceptionniste : une erreur ici
 * envoie du linge de lit dans le parcours pressing, ou masque une prestation
 * existante. D'où des tests explicites, y compris sur les cas mal formés
 * (activité sans code, nom sans accent).
 */

function prestation(partiel: Partial<TenantServiceOffering> = {}): TenantServiceOffering {
  return {
    id: 'service-1',
    tenantId: 'tenant-1',
    activityId: 'activity-1',
    activityName: 'Pressing',
    activityCode: 'pressing',
    serviceName: 'Lavage et repassage',
    billingUnit: 'PIECE',
    unitPrice: null,
    sortOrder: 0,
    ...partiel,
  }
}

describe('grille d’articles du parcours', () => {
  it('propose les vêtements du quotidien en pressing, sans linge de lit', () => {
    const articles = articlesDuParcours('pressing')
    const types = articles.map((article) => article.type)

    expect(types).toContain('CHEMISE')
    expect(types).toContain('COSTUME')
    expect(types).not.toContain('DRAP')
    expect(articles.find((article) => article.type === 'CHEMISE')?.libelle).toBe('Chemise')
  })

  it('propose draps et serviettes en blanchisserie', () => {
    const articles = articlesDuParcours('blanchisserie')
    const types = articles.map((article) => article.type)

    expect(types).toContain('DRAP')
    expect(types).toContain('SERVIETTE')
    // Les uniformes du personnel réutilisent les types existants.
    expect(types).toContain('CHEMISE')
    expect(articles.find((article) => article.type === 'DRAP')?.categorie).toBe('Linge de lit')
  })

  it('n’affiche jamais deux fois le même article', () => {
    for (const parcours of ['pressing', 'blanchisserie'] as const) {
      const types = articlesDuParcours(parcours).map((article) => article.type)
      expect(new Set(types).size).toBe(types.length)
    }
  })

  it('référence des icônes réellement présentes dans public/images', () => {
    for (const parcours of ['pressing', 'blanchisserie'] as const) {
      for (const article of articlesDuParcours(parcours)) {
        expect(article.image.startsWith('/images/'), article.image).toBe(true)
        const fichier = join(process.cwd(), 'public', article.image.replace(/^\//, ''))
        expect(existsSync(fichier), `icône absente : ${article.image}`).toBe(true)
      }
    }
  })

  it('ne déclare aucune catégorie vide', () => {
    for (const categorie of [...CATEGORIES_PRESSING, ...CATEGORIES_BLANCHISSERIE]) {
      expect(categorie.types.length, categorie.id).toBeGreaterThan(0)
    }
  })
})

describe('recherche d’article', () => {
  const articles = articlesDuParcours('pressing')

  it('ignore la casse et les accents', () => {
    expect(filtrerArticles(articles, 'cHeMiSe').map((article) => article.type)).toEqual(['CHEMISE'])
    expect(filtrerArticles(articles, 'vetements').length).toBe(0)
  })

  it('cherche aussi dans le nom de la catégorie', () => {
    const resultats = filtrerArticles(articles, 'costumes')
    expect(resultats.map((article) => article.type)).toEqual(
      expect.arrayContaining(['COSTUME', 'VESTE']),
    )
  })

  it('renvoie tout quand la recherche est vide', () => {
    expect(filtrerArticles(articles, '   ')).toHaveLength(articles.length)
  })
})

describe('classement des activités du pressing', () => {
  it('suit le code du référentiel quand il existe', () => {
    expect(parcoursDepuisActivite('blanchisserie', 'Peu importe')).toBe('blanchisserie')
    expect(parcoursDepuisActivite('pressing', 'Peu importe')).toBe('pressing')
    expect(parcoursDepuisActivite('repassage', 'Peu importe')).toBe('pressing')
    expect(parcoursDepuisActivite('cuir', null)).toBe('pressing')
  })

  it('retombe sur le nom pour une activité créée librement', () => {
    expect(parcoursDepuisActivite(null, 'Blanchisserie du Plateau')).toBe('blanchisserie')
    expect(parcoursDepuisActivite(null, 'Repassage express')).toBe('pressing')
    expect(parcoursDepuisActivite(undefined, 'Retouches')).toBe('pressing')
    expect(parcoursDepuisActivite(null, 'BLANCHISSERIE')).toBe('blanchisserie')
  })

  it('avoue quand il ne sait pas classer, plutôt que de deviner', () => {
    expect(parcoursDepuisActivite(null, 'Divers')).toBeNull()
    expect(parcoursDepuisActivite(null, null)).toBeNull()
  })

  it('classe une prestation par son activité', () => {
    expect(parcoursDepuisPrestation(prestation())).toBe('pressing')
    expect(
      parcoursDepuisPrestation(
        prestation({ activityCode: 'blanchisserie', activityName: 'Blanchisserie', serviceName: 'Linge au kilo', billingUnit: 'KG' }),
      ),
    ).toBe('blanchisserie')
  })
})

describe('prestations proposées au comptoir', () => {
  const services = [
    prestation({ id: 'a', serviceName: 'Lavage et repassage' }),
    prestation({ id: 'b', serviceName: 'Repassage seul', sortOrder: 1 }),
    prestation({ id: 'c', activityCode: 'blanchisserie', activityName: 'Blanchisserie', serviceName: 'Linge au kilo', billingUnit: 'KG', unitPrice: 1500 }),
  ]

  it('ne garde que les prestations du parcours demandé', () => {
    expect(servicesDuParcours(services, 'pressing').map((service) => service.id)).toEqual(['a', 'b'])
    expect(servicesDuParcours(services, 'blanchisserie').map((service) => service.id)).toEqual(['c'])
  })

  it('sépare ce qui se facture au kilo de ce qui se facture à la pièce', () => {
    expect(servicesAuKilo(services).map((service) => service.id)).toEqual(['c'])
    expect(servicesALaPiece(services).map((service) => service.id)).toEqual(['a', 'b'])
  })

  it('tolère un catalogue vide', () => {
    expect(servicesDuParcours([], 'pressing')).toEqual([])
    expect(servicesAuKilo([])).toEqual([])
  })
})
