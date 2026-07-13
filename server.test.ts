import { describe, expect, test } from 'bun:test'
import { extractEmails, placeToLead } from './server'

describe('lead helpers', () => {
  test('extracts and deduplicates public emails', () => {
    expect(extractEmails('Sales@Clinic.sa sales@clinic.sa logo@site.com.png')).toEqual(['sales@clinic.sa'])
  })

  test('normalizes a Google place', () => {
    const lead = placeToLead({
      id: 'abc',
      displayName: { text: 'Health Clinic' },
      internationalPhoneNumber: '+966 12 345 6789',
      websiteUri: 'https://clinic.sa'
    }, 'Clinic', 'Jeddah')
    expect(lead.phone).toBe('+966 12 345 6789')
    expect(lead.hasWebsite).toBe(true)
  })
})
