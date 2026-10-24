import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const racine = process.cwd()
const configuration = readFileSync(resolve(racine, 'vite.config.ts'), 'utf8')

function dimensionsPng(path: string): [number, number] {
  const contenu = readFileSync(resolve(racine, path))
  expect(contenu.subarray(0, 8)).toEqual(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
  return [contenu.readUInt32BE(16), contenu.readUInt32BE(20)]
}

describe('contrat PWA', () => {
  it('conserve la mise à jour automatique et le manifeste français installable', () => {
    expect(configuration).toContain("registerType: 'autoUpdate'")
    expect(configuration).toContain("name: 'Pressing Pro — Gestion de pressing'")
    expect(configuration).toContain("lang: 'fr'")
    expect(configuration).toContain("display: 'standalone'")
    expect(configuration).toContain("start_url: '/'")
    expect(configuration).toContain("purpose: 'maskable'")
  })

  it('conserve la navigation hors ligne et exclut les appels API du fallback SPA', () => {
    expect(configuration).toContain("navigateFallback: '/index.html'")
    expect(configuration).toContain('navigateFallbackDenylist: [/^\\/api/]')
    expect(configuration).toContain("handler: 'NetworkOnly'")
    expect(configuration).toContain("'**/*.{js,css,html,svg,png,ico,woff2}'")
  })

  it('fournit de vrais PNG aux dimensions déclarées par Chrome', () => {
    expect(dimensionsPng('public/pwa-192x192.png')).toEqual([192, 192])
    expect(dimensionsPng('public/pwa-512x512.png')).toEqual([512, 512])
    expect(dimensionsPng('public/maskable-512x512.png')).toEqual([512, 512])
    expect(dimensionsPng('public/apple-touch-icon.png')).toEqual([180, 180])
  })
})
