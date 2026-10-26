import { beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '@/db/localDb'
import {
  createTenantActivity,
  createTenantCategory,
  createTenantService,
  createWeightTier,
  deleteTenantCategory,
  duplicateTenantService,
  fetchTenantServiceConfiguration,
  importSuggestedCatalog,
} from '@/services/tenantServices'
import { LAUNDRY_GRID_SUGGESTION } from '@/constants/laundryCatalogSuggestions'
import { createOrderLocal, toSupabaseOrderItem } from '@/db/ordersRepository'
import { createOrderSchema } from '@/schemas/order'

/**
 * Catalogue commercial en mode démonstration (sans Supabase) : catégories,
 * prestations multi-mode, paliers de poids, import de grille et snapshots
 * figés sur les lignes de commande.
 */
vi.mock('@/lib/env', () => ({ isSupabaseConfigured: false }))

const TENANT = '11111111-1111-4111-8111-111111111111'

beforeEach(async () => {
  await db.tenantActivities.clear()
  await db.tenantServiceCategories.clear()
  await db.tenantServices.clear()
  await db.weightTiers.clear()
  await db.orders.clear()
  await db.orderItems.clear()
})

describe('configuration du catalogue en mode démonstration', () => {
  it('crée une activité puis une catégorie rattachée', async () => {
    await createTenantActivity(TENANT, 'Blanchisserie')
    const config1 = await fetchTenantServiceConfiguration(TENANT)
    const activite = config1.activities[0]!
    expect(activite.name).toBe('Blanchisserie')

    await createTenantCategory(TENANT, activite.id, 'Forfaits au poids')
    const config2 = await fetchTenantServiceConfiguration(TENANT)
    expect(config2.categories).toHaveLength(1)
    expect(config2.categories[0]).toMatchObject({
      activityId: activite.id,
      name: 'Forfaits au poids',
      isActive: true,
    })

    await expect(createTenantCategory(TENANT, activite.id, ' forfaits au poids ')).rejects.toThrow()
  })

  it('accepte un prix de référence à la pièce et à la paire', async () => {
    await createTenantActivity(TENANT, 'Pressing')
    const activite = (await fetchTenantServiceConfiguration(TENANT)).activities[0]!

    await createTenantService(TENANT, activite.id, 'Chemise repassée', 'PIECE', 500)
    await createTenantService(TENANT, activite.id, 'Chaussettes', 'PAIR', 250)

    const config = await fetchTenantServiceConfiguration(TENANT)
    expect(config.services).toHaveLength(2)
    expect(config.services.map((service) => service.unitPrice)).toEqual([500, 250])
    expect(config.services.every((service) => service.isActive && service.pricingMode === 'FIXED')).toBe(true)
  })

  it('refuse un devis avec prix ou unité pièce, et un forfait non fixe', async () => {
    await createTenantActivity(TENANT, 'Pressing')
    const activite = (await fetchTenantServiceConfiguration(TENANT)).activities[0]!

    await expect(
      createTenantService(TENANT, activite.id, 'Devis invalide', 'PIECE', 1000, { pricingMode: 'QUOTE' }),
    ).rejects.toThrow(/devis/)
    await expect(
      createTenantService(TENANT, activite.id, 'Forfait invalide', 'PACKAGE', null, { pricingMode: 'FROM' }),
    ).rejects.toThrow(/forfait/)

    await createTenantService(TENANT, activite.id, 'Nettoyage canapé sur devis', 'FLAT', null, {
      pricingMode: 'QUOTE',
    })
    const config = await fetchTenantServiceConfiguration(TENANT)
    expect(config.services[0]).toMatchObject({ billingUnit: 'FLAT', pricingMode: 'QUOTE', unitPrice: null })
  })

  it('gère les paliers de poids et refuse un palier hors forfait', async () => {
    await createTenantActivity(TENANT, 'Blanchisserie')
    const activite = (await fetchTenantServiceConfiguration(TENANT)).activities[0]!
    await createTenantService(TENANT, activite.id, 'Laver repasser', 'PACKAGE')
    const forfait = (await fetchTenantServiceConfiguration(TENANT)).services[0]!

    await createWeightTier(TENANT, forfait.id, '10 kg', 10, 15000)
    await createWeightTier(TENANT, forfait.id, '15 kg', 15, 22000)
    await expect(createWeightTier(TENANT, forfait.id, '20 kg', 20, 0)).rejects.toThrow()

    const config = await fetchTenantServiceConfiguration(TENANT)
    expect(config.tiers).toHaveLength(2)
    expect(config.tiers[0]).toMatchObject({ label: '10 kg', weightKg: 10, priceFcfa: 15000 })

    await createTenantService(TENANT, activite.id, 'Lavage au kilo', 'KG', 1500)
    const kilo = (await fetchTenantServiceConfiguration(TENANT)).services.find(
      (service) => service.billingUnit === 'KG',
    )!
    await expect(createWeightTier(TENANT, kilo.id, '5 kg', 5, 5000)).rejects.toThrow(/forfait/)
  })

  it('duplique une prestation avec ses paliers', async () => {
    await createTenantActivity(TENANT, 'Blanchisserie')
    const activite = (await fetchTenantServiceConfiguration(TENANT)).activities[0]!
    await createTenantService(TENANT, activite.id, 'Laver plier', 'PACKAGE')
    const forfait = (await fetchTenantServiceConfiguration(TENANT)).services[0]!
    await createWeightTier(TENANT, forfait.id, '10 kg', 10, 12000)

    await duplicateTenantService(TENANT, forfait.id)
    const config = await fetchTenantServiceConfiguration(TENANT)
    expect(config.services).toHaveLength(2)
    expect(config.services.map((service) => service.serviceName)).toContain('Laver plier (copie)')
    expect(config.tiers).toHaveLength(2)
  })

  it('supprimer une catégorie détache les prestations sans les détruire', async () => {
    await createTenantActivity(TENANT, 'Blanchisserie')
    const activite = (await fetchTenantServiceConfiguration(TENANT)).activities[0]!
    await createTenantCategory(TENANT, activite.id, 'Linge de maison')
    const categorie = (await fetchTenantServiceConfiguration(TENANT)).categories[0]!
    await createTenantService(TENANT, activite.id, 'Couette', 'PIECE', 3000, {
      categoryId: categorie.id,
      pricingMode: 'FROM',
    })

    await deleteTenantCategory(TENANT, categorie.id)
    const config = await fetchTenantServiceConfiguration(TENANT)
    expect(config.categories).toHaveLength(0)
    expect(config.services).toHaveLength(1)
    expect(config.services[0]!.categoryId).toBeNull()
  })

  it('importe la grille type puis est idempotent', async () => {
    const premier = await importSuggestedCatalog(TENANT, LAUNDRY_GRID_SUGGESTION)
    expect(premier.activitiesCreated).toBe(2)
    expect(premier.servicesCreated).toBe(LAUNDRY_GRID_SUGGESTION.services.length)
    expect(premier.tiersCreated).toBe(6)
    expect(premier.categoriesCreated).toBe(5)

    const config = await fetchTenantServiceConfiguration(TENANT)
    const forfait = config.services.find((service) => service.billingUnit === 'PACKAGE')!
    expect(forfait).toBeDefined()
    expect(config.tiers.filter((tier) => tier.tenantServiceId === forfait.id)).toHaveLength(3)

    const second = await importSuggestedCatalog(TENANT, LAUNDRY_GRID_SUGGESTION)
    expect(second.activitiesCreated).toBe(0)
    expect(second.servicesCreated).toBe(0)
    expect(second.tiersCreated).toBe(0)
    const apres = await fetchTenantServiceConfiguration(TENANT)
    expect(apres.services).toHaveLength(LAUNDRY_GRID_SUGGESTION.services.length)
  })
})

describe('forfait poids figé sur une commande', () => {
  it('valide le schéma d’une ligne forfaitaire et rejette un prix falsifié', () => {
    const ligne = {
      label: 'Laver repasser — 10 kg',
      price: 15000,
      quantity: 1,
      unitPrice: 15000,
      billingUnit: 'PACKAGE' as const,
      pricingMode: 'FIXED' as const,
      priceStatus: 'CONFIRMED' as const,
      packageSnapshot: {
        tierId: 'aaaaaaaa-0000-4000-8000-000000000001',
        label: '10 kg',
        weightKg: 10,
        priceFcfa: 15000,
        serviceName: 'Laver repasser (forfait poids)',
      },
    }
    expect(createOrderSchema.shape.items.safeParse([ligne]).success).toBe(true)

    const falsifiee = { ...ligne, price: 1000, unitPrice: 1000 }
    const resultat = createOrderSchema.shape.items.safeParse([falsifiee])
    expect(resultat.success).toBe(false)
  })

  it('enregistre la commande locale et produit un snapshot filaire snake_case', async () => {
    const { order, items } = await createOrderLocal(TENANT, {
      customerName: 'Fatou Diallo',
      customerPhone: '0700000003',
      items: [
        {
          label: 'Laver repasser — 10 kg',
          price: 15000,
          quantity: 1,
          unitPrice: 15000,
          billingUnit: 'PACKAGE',
          pricingMode: 'FIXED',
          priceStatus: 'CONFIRMED',
          serviceName: 'Laver repasser (forfait poids)',
          activityNameSnapshot: 'Blanchisserie',
          categoryNameSnapshot: 'Forfaits au poids',
          packageSnapshot: {
            tierId: 'aaaaaaaa-0000-4000-8000-000000000001',
            label: '10 kg',
            weightKg: 10,
            priceFcfa: 15000,
            serviceName: 'Laver repasser (forfait poids)',
          },
        },
      ],
    })

    expect(order.totalAmount).toBe(15000)
    const ligne = items[0]!
    expect(ligne.billingUnit).toBe('PACKAGE')
    expect(ligne.packageSnapshot?.priceFcfa).toBe(15000)
    expect(ligne.categoryNameSnapshot).toBe('Forfaits au poids')

    const filaire = toSupabaseOrderItem(ligne)
    expect(filaire.billing_unit).toBe('PACKAGE')
    expect(filaire.package_snapshot).toEqual({
      tier_id: 'aaaaaaaa-0000-4000-8000-000000000001',
      label: '10 kg',
      weight_kg: 10,
      price_fcfa: 15000,
      service_name: 'Laver repasser (forfait poids)',
    })
    expect(filaire.category_name_snapshot).toBe('Forfaits au poids')
  })

  it('accepte les nouveaux types de linge dans la composition d’un lot', () => {
    const ligne = {
      label: 'Lot familial',
      price: 1500,
      quantity: 1,
      unitPrice: 1500,
      billingUnit: 'KG' as const,
      pricingMode: 'FIXED' as const,
      priceStatus: 'CONFIRMED' as const,
      serviceName: 'Lavage au kilo',
      garmentDetails: [
        { type: 'COUETTE' as const, quantity: 1 },
        { type: 'CHAUSSETTES' as const, quantity: 4 },
        { type: 'LINGE_DE_MAISON' as const, quantity: 2 },
      ],
    }
    expect(createOrderSchema.shape.items.safeParse([ligne]).success).toBe(true)
  })
})
