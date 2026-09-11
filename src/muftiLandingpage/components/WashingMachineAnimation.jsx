import React, { useState } from 'react'
import * as Icons from 'lucide-react'

/**
 * CSS-only animated washing machine for the Hero section.
 * Features spinning clothes, water effect, bubbles, and
 * floating info cards.
 */
const WashingMachineAnimation = React.memo(() => {
  // Pre-generate stable bubble styles once using lazy useState initialization to satisfy React's purity rules
  const [bubbles] = useState(() =>
    Array.from({ length: 6 }, (_, i) => ({
      id: i,
      width: `${6 + Math.random() * 8}px`,
      height: `${6 + Math.random() * 8}px`,
      left: `${15 + Math.random() * 70}%`,
      bottom: `${5 + Math.random() * 35}%`,
      animationDelay: `${i * 0.5}s`,
      animationDuration: `${3 + Math.random() * 3}s`,
    }))
  )

  return (
    <div className="relative h-72 w-72 sm:h-80 sm:w-80 lg:h-96 lg:w-96">
      {/* Outer glow */}
      <div className="absolute inset-0 animate-pulse-glow rounded-full bg-mufti-blue-400/10 blur-3xl" />

      {/* Machine body */}
      <div
        className="absolute inset-4 overflow-hidden rounded-3xl border border-white/60
                   bg-linear-to-br from-slate-100 to-slate-200 shadow-2xl sm:inset-6"
      >
        {/* Control panel */}
        <div className="absolute top-3 right-0 left-0 flex items-center justify-center gap-3 px-6">
          <div className="flex gap-1.5">
            <div className="h-2.5 w-2.5 animate-pulse rounded-full bg-green-400" />
            <div className="animation-delay-200 h-2.5 w-2.5 animate-pulse rounded-full bg-amber-400" />
            <div className="h-2.5 w-2.5 rounded-full bg-red-400" />
          </div>
          <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-slate-300">
            <div
              className="h-full w-3/4 animate-shimmer rounded-full bg-linear-to-r from-mufti-blue-400 to-mufti-lime"
              style={{ backgroundSize: '200% 100%' }}
            />
          </div>
          <div
            className="flex h-6 w-6 items-center justify-center rounded-full border-2
                       border-slate-200 bg-linear-to-br from-slate-300 to-slate-400"
          >
            <div className="-mt-1 h-2 w-0.5 rounded-full bg-mufti-blue-500" />
          </div>
        </div>

        {/* Door frame */}
        <div
          className="absolute inset-10 rounded-full bg-linear-to-br from-slate-200 to-slate-300
                     p-3 shadow-inner sm:inset-12 sm:p-4"
        >
          {/* Glass */}
          <div
            className="relative h-full w-full overflow-hidden rounded-full border-2 border-white/50
                       bg-linear-to-br from-blue-100/80 to-cyan-100/60 shadow-lg"
          >
            {/* Spinning clothes */}
            <div className="absolute inset-0 animate-spin-slow">
              <div className="absolute top-[15%] left-[30%] h-4 w-10 rotate-12 rounded-md bg-mufti-blue-400/60" />
              <div className="absolute top-[40%] right-[20%] h-3 w-8 -rotate-[20deg] rounded-md bg-rose-400/50" />
              <div className="absolute bottom-[25%] left-[20%] h-3.5 w-9 rotate-45 rounded-md bg-mufti-lime/50" />
              <div className="absolute right-[30%] bottom-[45%] h-3 w-7 -rotate-[30deg] rounded-md bg-amber-400/50" />
              <div className="absolute top-[60%] left-[45%] h-2.5 w-6 rotate-75 rounded-md bg-purple-400/40" />
            </div>

            {/* Water */}
            <div className="absolute right-0 bottom-0 left-0 h-2/5">
              <div className="absolute inset-0 bg-linear-to-t from-mufti-blue-400/25 to-transparent" />
              <div
                className="absolute top-0 right-0 left-0 h-4 animate-shimmer
                           bg-linear-to-r from-white/0 via-white/30 to-white/0"
                style={{ backgroundSize: '200% 100%' }}
              />
            </div>

            {/* Bubbles */}
            {bubbles.map((bubble) => (
              <div
                key={bubble.id}
                className="absolute animate-float rounded-full bg-white/40"
                style={{
                  width: bubble.width,
                  height: bubble.height,
                  left: bubble.left,
                  bottom: bubble.bottom,
                  animationDelay: bubble.animationDelay,
                  animationDuration: bubble.animationDuration,
                }}
              />
            ))}

            {/* Glass reflection */}
            <div className="absolute top-2 left-3 h-16 w-8 -rotate-12 rounded-full bg-white/20 blur-sm" />
          </div>
        </div>
      </div>

      {/* Floating cards */}
      <div
        className="absolute -top-2 -right-2 flex animate-bounce-gentle items-center gap-2
                   rounded-xl border border-slate-100 bg-white p-3 shadow-lg sm:-right-6"
      >
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-green-50">
          <Icons.Truck className="h-4 w-4 text-green-600" />
        </div>
        <div>
          <p className="text-xs font-bold text-slate-800">Free Pickup</p>
          <p className="text-[10px] text-slate-500">All locations</p>
        </div>
      </div>

      <div
        className="animation-delay-1000 absolute -bottom-2 -left-2 flex animate-bounce-gentle
                   items-center gap-2 rounded-xl border border-slate-100 bg-white p-3 shadow-lg sm:-left-6"
      >
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-mufti-blue-50">
          <Icons.Timer className="h-4 w-4 text-mufti-blue-600" />
        </div>
        <div>
          <p className="text-xs font-bold text-slate-800">24hr Express</p>
          <p className="text-[10px] text-slate-500">Same-day available</p>
        </div>
      </div>

      <div
        className="animation-delay-600 absolute -right-4 top-1/2 flex animate-float items-center
                   gap-2 rounded-xl bg-mufti-lime p-2.5 shadow-lg sm:-right-10"
      >
        <Icons.ShieldCheck className="h-4 w-4 text-mufti-blue-900" />
        <span className="pr-1 text-xs font-bold text-mufti-blue-900">
          Insured
        </span>
      </div>
    </div>
  )
})

WashingMachineAnimation.displayName = 'WashingMachineAnimation'
export default WashingMachineAnimation