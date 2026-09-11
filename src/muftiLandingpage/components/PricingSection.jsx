import React, { useState, useMemo, useEffect } from 'react'
import * as Icons from 'lucide-react'
import useInView from '../hooks/useInView'
import { formatNaira } from '../utils/helpers'
import API from '../../api/axios'

const FALLBACK_SERVICES = [
  { id: 'wash-fold', name: 'Wash & Fold', price: 1500, category: { id: 'laundry', name: 'Laundry' } },
  { id: 'dry-cleaning', name: 'Dry Cleaning', price: 3000, category: { id: 'dry-cleaning', name: 'Dry Cleaning' } },
  { id: 'native-wear-care', name: 'Native Wear Care', price: 2500, category: { id: 'special-care', name: 'Special Care' } },
  { id: 'steam-press', name: 'Steam & Press', price: 2000, category: { id: 'pressing', name: 'Pressing' } },
  { id: 'stain-removal', name: 'Stain Removal', price: 1000, category: { id: 'special-care', name: 'Special Care' } },
  { id: 'household-items', name: 'Household Items', price: 4000, category: { id: 'household', name: 'Household' } }
]

const FALLBACK_CATEGORIES = [
  { id: 'laundry', label: 'Laundry' },
  { id: 'dry-cleaning', label: 'Dry Cleaning' },
  { id: 'special-care', label: 'Special Care' },
  { id: 'pressing', label: 'Pressing' },
  { id: 'household', label: 'Household' }
]

const PricingSection = React.memo(() => {
  const [cat, setCat] = useState('all')
  const [showAll, setShowAll] = useState(false) // Toggle state for expansion
  const [ref, inView] = useInView()
  const [services, setServices] = useState(FALLBACK_SERVICES)
  const [categories, setCategories] = useState(FALLBACK_CATEGORIES)
  const [loading, setLoading] = useState(true)

  // 1. Fetch data from backend
  useEffect(() => {
    const fetchData = async () => {
      try {
        setLoading(true)
        const servicesRes = await API.get('/services/public')
        const servicesData = Array.isArray(servicesRes.data) ? servicesRes.data : []
        setServices(servicesData.length ? servicesData : FALLBACK_SERVICES)

        // Fetch categories or extract from services
        const categoriesRes = await API.get('/categories')
          .catch(() => API.get('/categories/public'))
          .catch(() => {
            const uniqueCats = [...new Set(servicesData.map(s => s.category).filter(Boolean))]
            return { data: uniqueCats.map(cat => ({ id: cat.id || cat.name, name: cat.name })) }
          })

        const mappedCategories = categoriesRes.data?.map(c => ({
          id: c.id || c.name,
          label: c.name || c.label || c
        })) || FALLBACK_CATEGORIES

        setCategories(mappedCategories.length ? mappedCategories : FALLBACK_CATEGORIES)
      } catch (err) {
        console.error('Failed to fetch pricing data:', err)
        setServices(FALLBACK_SERVICES)
        setCategories(FALLBACK_CATEGORIES)
      } finally {
        setLoading(false)
      }
    }
    fetchData()
  }, [])

  // 2. Reset the "Show All" toggle whenever category changes
  // This keeps the UI tidy when the user switches categories
  useEffect(() => {
    setShowAll(false)
  }, [cat])

  // 3. Filter services by category
  const filtered = useMemo(() => {
    if (cat === 'all' || !services.length) return services
    return services.filter((s) => s.category?.id == cat)
  }, [cat, services])

  // 4. Limit the display to 6 items unless "Show All" is active
  const displayedServices = showAll ? filtered : filtered.slice(0, 6)

  return (
    <section id="pricing" ref={ref} className="relative overflow-hidden bg-slate-50 py-20 lg:py-28">
      {/* Background Decor */}
      <div className="pointer-events-none absolute top-0 right-0 h-96 w-96 rounded-full bg-mufti-blue-100/30 blur-3xl" />
      <div className="pointer-events-none absolute bottom-0 left-0 h-96 w-96 rounded-full bg-mufti-lime/10 blur-3xl" />

      <div className="relative z-10 mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        {/* Header */}
        <div className={`mx-auto mb-12 max-w-2xl text-center transition-all duration-700 ${inView ? 'translate-y-0 opacity-100' : 'translate-y-10 opacity-0'}`}>
          <span className="mb-4 inline-flex items-center gap-2 rounded-full border border-mufti-blue-100 bg-mufti-blue-50 px-4 py-1.5 text-sm font-semibold text-mufti-blue-600">
            <Icons.Tag className="h-4 w-4" /> Price List
          </span>
          <h2 className="mt-4 mb-4 text-3xl font-extrabold text-mufti-blue-950 sm:text-4xl lg:text-5xl">
            Transparent <span className="gradient-text">Pricing</span>
          </h2>
          <p className="text-lg text-slate-500">Fair prices for premium quality in Ibadan. No hidden charges.</p>
        </div>

        {/* Category Filter Tabs */}
        <div className="mb-10 flex flex-wrap justify-center gap-2">
          <button
            onClick={() => setCat('all')}
            className={`rounded-xl px-5 py-2.5 text-sm font-semibold transition-all duration-300 ${cat === 'all' ? 'bg-mufti-blue-500 text-white shadow-lg shadow-mufti-blue-500/20' : 'border border-slate-200 bg-white text-slate-600 hover:bg-mufti-blue-50'}`}
          >
            All Services
          </button>
          {categories.map((c) => (
            <button
              key={c.id}
              onClick={() => setCat(c.id)}
              className={`rounded-xl px-5 py-2.5 text-sm font-semibold transition-all duration-300 ${cat === c.id ? 'bg-mufti-blue-500 text-white shadow-lg shadow-mufti-blue-500/20' : 'border border-slate-200 bg-white text-slate-600 hover:bg-mufti-blue-50'}`}
            >
              {c.label}
            </button>
          ))}
        </div>

        {/* Individual Items Grid */}
        <div className="mx-auto grid max-w-5xl gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {loading ? (
            <div className="col-span-full flex justify-center py-12">
              <div className="h-8 w-8 animate-spin rounded-full border-4 border-slate-200 border-t-mufti-blue-500" />
            </div>
          ) : displayedServices.length > 0 ? (
            displayedServices.map((item) => (
              <div
                key={item.id}
                className="group flex items-center justify-between rounded-xl border border-white/40 bg-white/80 p-4 shadow-lg backdrop-blur-md transition-all duration-300 hover:-translate-y-1 hover:border-mufti-blue-200/50 hover:bg-white/90"
              >
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-mufti-blue-50 group-hover:bg-mufti-blue-100">
                    <Icons.Sparkles className="h-5 w-5 text-mufti-blue-500" />
                  </div>
                  <p className="text-sm font-bold text-slate-800">{item.name}</p>
                </div>
                <span className="text-lg font-bold text-mufti-blue-600">{formatNaira(item.price)}</span>
              </div>
            ))
          ) : (
            <div className="col-span-full py-12 text-center text-slate-500">No services found in this category.</div>
          )}
        </div>

        {/* ── The View All / Show Less Toggle ── */}
        {!loading && filtered.length > 6 && (
          <div className="mt-12 flex justify-center">
            <button
              onClick={() => setShowAll(!showAll)}
              className="group flex items-center gap-2 rounded-full border-2 border-mufti-blue-100 bg-white px-8 py-3 text-sm font-bold text-mufti-blue-600 transition-all hover:bg-mufti-blue-600 hover:text-white hover:shadow-xl hover:shadow-mufti-blue-500/20"
            >
              {showAll ? (
                <>Show Less <Icons.ChevronUp className="h-4 w-4" /></>
              ) : (
                <>View All {filtered.length} Services <Icons.ChevronDown className="h-4 w-4 transition-transform group-hover:translate-y-0.5" /></>
              )}
            </button>
          </div>
        )}

        {/* ── Replacement: Service Promise Bar ── */}
        <div className="mt-20 grid grid-cols-1 gap-6 sm:grid-cols-3">
          <div className="flex items-center gap-4 rounded-2xl bg-white p-6 shadow-sm border border-slate-100">
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-mufti-lime/20">
                <Icons.Zap className="h-6 w-6 text-mufti-lime-600" />
            </div>
            <div>
              <h4 className="font-bold text-mufti-blue-950">Express Delivery</h4>
              <p className="text-xs text-slate-500">24h turnaround available</p>
            </div>
          </div>
          <div className="flex items-center gap-4 rounded-2xl bg-white p-6 shadow-sm border border-slate-100">
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-mufti-blue-50">
                <Icons.Truck className="h-6 w-6 text-mufti-blue-500" />
            </div>
            <div>
              <h4 className="font-bold text-mufti-blue-950">Free Pickup</h4>
              <p className="text-xs text-slate-500">Orders above ₦5,000</p>
            </div>
          </div>
          <div className="flex items-center gap-4 rounded-2xl bg-white p-6 shadow-sm border border-slate-100">
             <div className="flex h-12 w-12 items-center justify-center rounded-full bg-green-50">
                <Icons.RotateCcw className="h-6 w-6 text-green-600" />
            </div>
            <div>
              <h4 className="font-bold text-mufti-blue-950">Clean Guarantee</h4>
              <p className="text-xs text-slate-500">Complimentary re-wash</p>
            </div>
          </div>
        </div>
      </div>
    </section>
  )
})

PricingSection.displayName = 'PricingSection'
export default PricingSection