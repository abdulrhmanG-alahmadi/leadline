import './style.css'

let leads = []
const $ = (selector) => document.querySelector(selector)
const form = $('#searchForm')
const resultsBody = $('#resultsBody')
const emptyState = $('#emptyState')
const exportButton = $('#exportButton')
const formMessage = $('#formMessage')
const searchButton = form.querySelector('button[type="submit"]')

const escapeHtml = (value = '') => String(value).replace(/[&<>'"]/g, (char) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
}[char]))

function selected(name) {
  return [...form.querySelectorAll(`input[name="${name}"]:checked`)].map((input) => input.value)
}

function updateEstimate() {
  const searches = selected('category').length * selected('city').length
  $('#resultEstimate').textContent = `up to ${searches * Number($('#pages').value) * 20} results`
}

function filteredLeads() {
  const query = $('#filterInput').value.trim().toLowerCase()
  const website = $('#websiteFilter').value
  return leads.filter((lead) => {
    const text = `${lead.businessName} ${lead.city} ${lead.phone} ${lead.email}`.toLowerCase()
    return (!query || text.includes(query))
      && (website === 'all' || (website === 'yes') === lead.hasWebsite)
  })
}

function render() {
  const shown = filteredLeads()
  resultsBody.innerHTML = shown.map((lead) => `
    <tr>
      <td data-label="Business"><div class="business-cell"><span>${lead.category === 'Clinic' ? '+' : '⌂'}</span><div><b>${escapeHtml(lead.businessName)}</b><small>${escapeHtml(lead.category)}</small></div></div></td>
      <td data-label="City"><span class="city-pill">${escapeHtml(lead.city)}</span></td>
      <td data-label="Phone">${lead.phone ? `<a href="tel:${escapeHtml(lead.phone)}">${escapeHtml(lead.phone)}</a>` : '<span class="muted">Not listed</span>'}</td>
      <td data-label="Website">${lead.website ? `<a class="external-link" href="${escapeHtml(lead.website)}" target="_blank" rel="noopener">Visit site ↗</a>` : '<span class="no-badge">No website</span>'}</td>
      <td data-label="Email">${lead.email ? `<a href="mailto:${escapeHtml(lead.email.split(';')[0])}">${escapeHtml(lead.email)}</a>` : '<span class="muted">—</span>'}</td>
      <td>${lead.googleMaps ? `<a class="map-link" href="${escapeHtml(lead.googleMaps)}" target="_blank" rel="noopener" aria-label="Open ${escapeHtml(lead.businessName)} in Google Maps">↗</a>` : ''}</td>
    </tr>`).join('')

  emptyState.hidden = shown.length > 0
  resultsBody.hidden = shown.length === 0
  $('#businessCount').textContent = leads.length || '—'
  $('#phoneCount').textContent = leads.length ? leads.filter((lead) => lead.phone).length : '—'
  $('#websiteCount').textContent = leads.length ? leads.filter((lead) => lead.website).length : '—'
  $('#emailCount').textContent = leads.length ? leads.filter((lead) => lead.email).length : '—'
  exportButton.disabled = shown.length === 0
}

form.addEventListener('change', updateEstimate)
$('#filterInput').addEventListener('input', render)
$('#websiteFilter').addEventListener('change', render)

form.addEventListener('submit', async (event) => {
  event.preventDefault()
  const categories = selected('category')
  const cities = selected('city')
  if (!categories.length || !cities.length) {
    formMessage.textContent = 'Select at least one business type and city.'
    return
  }

  searchButton.disabled = true
  searchButton.classList.add('loading')
  searchButton.querySelector('span').textContent = $('#scanEmails').checked ? 'Finding contacts…' : 'Searching Google…'
  formMessage.textContent = 'Keep this page open while the search runs.'

  try {
    const response = await fetch('/api/search', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ categories, cities, pages: Number($('#pages').value), scanEmails: $('#scanEmails').checked })
    })
    const data = await response.json()
    if (!response.ok) throw new Error(data.error || 'Search failed.')
    leads = data.leads
    formMessage.textContent = `Found ${leads.length} unique businesses.`
    render()
  } catch (error) {
    formMessage.textContent = error.message
  } finally {
    searchButton.disabled = false
    searchButton.classList.remove('loading')
    searchButton.querySelector('span').textContent = 'Find businesses'
  }
})

exportButton.addEventListener('click', () => {
  const rows = filteredLeads()
  const columns = [
    ['Category', 'category'], ['City', 'city'], ['Business name', 'businessName'],
    ['Phone', 'phone'], ['Has website', (lead) => lead.hasWebsite ? 'Yes' : 'No'],
    ['Website', 'website'], ['Email', 'email'], ['Address', 'address'],
    ['Google Maps', 'googleMaps'], ['Status', 'businessStatus'], ['Place ID', 'placeId']
  ]
  const quote = (value) => `"${String(value ?? '').replaceAll('"', '""')}"`
  const csv = [columns.map(([label]) => quote(label)).join(','), ...rows.map((lead) =>
    columns.map(([, key]) => quote(typeof key === 'function' ? key(lead) : lead[key])).join(',')
  )].join('\r\n')
  const url = URL.createObjectURL(new Blob(['\ufeff', csv], { type: 'text/csv;charset=utf-8' }))
  const link = Object.assign(document.createElement('a'), { href: url, download: `leadline-${new Date().toISOString().slice(0, 10)}.csv` })
  link.click()
  URL.revokeObjectURL(url)
})

fetch('/api/health').then((response) => response.json()).then(({ configured }) => {
  const status = $('#apiStatus')
  status.classList.add(configured ? 'ready' : 'error')
  status.lastChild.textContent = configured ? ' API connected' : ' API key missing'
}).catch(() => {
  $('#apiStatus').classList.add('error')
  $('#apiStatus').lastChild.textContent = ' API offline'
})

updateEstimate()
render()
