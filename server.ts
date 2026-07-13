import { staticPlugin } from '@elysiajs/static'
import { Elysia, t } from 'elysia'

const API_KEY = Bun.env.GOOGLE_MAPS_API_KEY
const PORT = Number(Bun.env.PORT || 3001)
const PLACES_URL = 'https://places.googleapis.com/v1/places:searchText'
const FIELD_MASK = [
  'places.id',
  'places.displayName',
  'places.formattedAddress',
  'places.nationalPhoneNumber',
  'places.internationalPhoneNumber',
  'places.websiteUri',
  'places.googleMapsUri',
  'places.businessStatus',
  'nextPageToken'
].join(',')

export const SEARCHES = {
  'Real estate': 'real estate agencies',
  Clinic: 'medical clinics'
} as const

export const CITIES = ['Jeddah', 'Khobar', 'Riyadh'] as const
const EMAIL_RE = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi
const CONTACT_RE = /contact|about|اتصل|تواصل|من[\s_-]*نحن/i

type Category = keyof typeof SEARCHES
type City = (typeof CITIES)[number]

type GooglePlace = {
  id?: string
  displayName?: { text?: string }
  formattedAddress?: string
  nationalPhoneNumber?: string
  internationalPhoneNumber?: string
  websiteUri?: string
  googleMapsUri?: string
  businessStatus?: string
}

export type Lead = {
  category: Category
  city: City
  businessName: string
  phone: string
  hasWebsite: boolean
  website: string
  email: string
  address: string
  googleMaps: string
  businessStatus: string
  placeId: string
}

export function placeToLead(place: GooglePlace, category: Category, city: City): Lead {
  const website = place.websiteUri || ''
  return {
    category,
    city,
    businessName: place.displayName?.text || '',
    phone: place.internationalPhoneNumber || place.nationalPhoneNumber || '',
    hasWebsite: Boolean(website),
    website,
    email: '',
    address: place.formattedAddress || '',
    googleMaps: place.googleMapsUri || '',
    businessStatus: place.businessStatus || '',
    placeId: place.id || ''
  }
}

export function extractEmails(source: string) {
  const decoded = source
    .replaceAll('&commat;', '@')
    .replaceAll('&#64;', '@')
    .replaceAll('&period;', '.')
    .replaceAll('&#46;', '.')
  return [...new Set((decoded.match(EMAIL_RE) || [])
    .map((email) => email.toLowerCase().replace(/[.,;:]$/, ''))
    .filter((email) => !/\.(png|jpe?g|gif|webp|svg)$/i.test(email))
    .filter((email) => !email.endsWith('@example.com')))]
}

function safeWebsite(raw: string) {
  try {
    const url = new URL(raw)
    const host = url.hostname.toLowerCase()
    if (!['http:', 'https:'].includes(url.protocol)) return null
    if (host === 'localhost' || host.endsWith('.local')) return null
    if (/^(127\.|10\.|192\.168\.|169\.254\.)/.test(host)) return null
    const match = host.match(/^172\.(\d+)\./)
    if (match && Number(match[1]) >= 16 && Number(match[1]) <= 31) return null
    return url
  } catch {
    return null
  }
}

async function fetchHtml(raw: string) {
  const url = safeWebsite(raw)
  if (!url) return { html: '', url: null }
  try {
    const response = await fetch(url, {
      redirect: 'follow',
      headers: { 'user-agent': 'Leadline/1.0 (public contact finder)' },
      signal: AbortSignal.timeout(8000)
    })
    if (!response.ok || !response.headers.get('content-type')?.includes('text/html')) {
      return { html: '', url }
    }
    const html = (await response.text()).slice(0, 1_000_000)
    return { html, url: safeWebsite(response.url) || url }
  } catch {
    return { html: '', url }
  }
}

export async function findPublicEmails(website: string) {
  const home = await fetchHtml(website)
  if (!home.html || !home.url) return []

  const emails = new Set(extractEmails(home.html))
  const hrefs = [...home.html.matchAll(/href\s*=\s*["']([^"']+)["']/gi)].map((match) => match[1])
  const contactPages: string[] = []

  for (const href of hrefs) {
    if (href.toLowerCase().startsWith('mailto:')) {
      extractEmails(href).forEach((email) => emails.add(email))
      continue
    }
    if (!CONTACT_RE.test(href)) continue
    const url = safeWebsite(new URL(href, home.url).href)
    if (url && url.hostname.replace(/^www\./, '') === home.url.hostname.replace(/^www\./, '')) {
      contactPages.push(url.href)
    }
  }

  for (const page of [...new Set(contactPages)].slice(0, 2)) {
    const result = await fetchHtml(page)
    extractEmails(result.html).forEach((email) => emails.add(email))
  }
  return [...emails].sort()
}

async function searchPlaces(apiKey: string, category: Category, city: City, pages: number) {
  const payload: Record<string, unknown> = {
    textQuery: `${SEARCHES[category]} in ${city}, Saudi Arabia`,
    pageSize: 20,
    languageCode: 'en',
    regionCode: 'SA'
  }
  const places: GooglePlace[] = []

  for (let page = 0; page < pages; page++) {
    const response = await fetch(PLACES_URL, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-goog-api-key': apiKey,
        'x-goog-fieldmask': FIELD_MASK
      },
      body: JSON.stringify(payload)
    })
    const data = await response.json() as {
      places?: GooglePlace[]
      nextPageToken?: string
      error?: { message?: string }
    }
    if (!response.ok) throw new Error(data.error?.message || `Google Places returned ${response.status}`)
    places.push(...(data.places || []))
    if (!data.nextPageToken) break
    payload.pageToken = data.nextPageToken
  }
  return places.map((place) => placeToLead(place, category, city))
}

async function addEmails(leads: Lead[]) {
  // ponytail: small batches avoid hammering sites; use a queue only if this grows beyond 360 leads.
  for (let index = 0; index < leads.length; index += 6) {
    await Promise.all(leads.slice(index, index + 6).map(async (lead) => {
      if (lead.website) lead.email = (await findPublicEmails(lead.website)).join('; ')
    }))
  }
}

const app = new Elysia()
  .get('/api/health', () => ({ configured: Boolean(API_KEY) }))
  .post('/api/search', async ({ body, set }) => {
    if (!API_KEY) {
      set.status = 503
      return { error: 'Google Places API key is not configured.' }
    }
    try {
      const searches = body.categories.flatMap((category) =>
        body.cities.map((city) => searchPlaces(API_KEY, category, city, body.pages))
      )
      const results = (await Promise.all(searches)).flat()
      const seen = new Set<string>()
      const leads = results.filter((lead) => lead.placeId && !seen.has(lead.placeId) && seen.add(lead.placeId))
      if (body.scanEmails) await addEmails(leads)
      return { leads, count: leads.length }
    } catch (error) {
      set.status = 502
      const message = error instanceof Error ? error.message : 'Search failed.'
      return {
        error: message.includes('referer <empty>')
          ? 'This key is browser-restricted. In Google Cloud, change Application restrictions for server use and keep Places API (New) under API restrictions.'
          : message
      }
    }
  }, {
    body: t.Object({
      categories: t.Array(t.Union([t.Literal('Real estate'), t.Literal('Clinic')]), { minItems: 1, maxItems: 2 }),
      cities: t.Array(t.Union(CITIES.map((city) => t.Literal(city))), { minItems: 1, maxItems: 3 }),
      pages: t.Integer({ minimum: 1, maximum: 3 }),
      scanEmails: t.Boolean()
    })
  })

if (Bun.env.NODE_ENV === 'production') {
  app
    .use(staticPlugin({ assets: 'dist', prefix: '/' }))
    .get('*', () => Bun.file('dist/index.html'))
}

if (import.meta.main) {
  app.listen(PORT)
  console.log(`Leadline API running on http://localhost:${PORT}`)
}

export default app
