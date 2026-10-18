// Deterministic, realistically messy sample files.

function rng(seed: number) {
  return () => {
    seed = (seed * 1664525 + 1013904223) % 4294967296
    return seed / 4294967296
  }
}

const FIRST = [
  'Anna',
  'Lukas',
  'Mia',
  'Leon',
  'Emma',
  'Paul',
  'Sofia',
  'Jonas',
  'Lea',
  'Felix',
  'Hannah',
  'Noah',
  'Lina',
  'Elias',
  'Marie',
  'Ben',
  'Jürgen',
  'Zoë',
]
const LAST = [
  'Müller',
  'Schmidt',
  'Schneider',
  'Fischer',
  'Weber',
  'Meyer',
  'Wagner',
  'Becker',
  'Hoffmann',
  'Schäfer',
  'Koch',
  'Richter',
  'Klein',
  'Wolf',
]
const CITIES = [
  ['Berlin', '10115', 'Deutschland'],
  ['München', '80331', 'Deutschland'],
  ['Hamburg', '20095', 'Deutschland'],
  ['Köln', '50667', 'Deutschland'],
  ['Wien', '1010', 'Österreich'],
  ['Graz', '8010', 'Österreich'],
  ['Zürich', '8001', 'Schweiz'],
  ['Basel', '4051', 'Schweiz'],
]
const STREETS = ['Hauptstraße', 'Bahnhofstraße', 'Gartenweg', 'Lindenallee', 'Schillerstraße', 'Ringstraße']
const COMPANIES = ['Stadtwerke Nord', 'Energie AG', 'Solar & Co. KG', 'Wärmepumpen GmbH', 'Netzwerk Süd', '']
const STATUS = ['Kunde', 'Interessent', 'Kunde', 'Ex-Kunde', 'kunde', 'Lead']
const TAGS = ['PV', 'Wärmepumpe', 'Strom', 'Gas', 'E-Mobilität']

const pick = <T>(r: () => number, list: T[]) => list[Math.floor(r() * list.length)] as T

/** A German CRM export: title rows, semicolons, DD.MM.YYYY, comma decimals, Ja/Nein, typos. */
export function crmExportCsv(rows = 2500): File {
  const r = rng(42)
  const lines = ['CRM Export – Kontakte;;;;;;;;;;;', `Erstellt am 17.10.2026 von admin;;;;;;;;;;;`, ';;;;;;;;;;;']
  // The last two columns aren't in the schema: add them as custom fields in the mapping step.
  lines.push(
    'Vorname;Nachname;E-Mail-Adresse;Telefon;Firma;Status;Kunde seit;Umsatz (EUR);Newsletter;Schlagworte;Straße;PLZ;Ort;Land;Kundensegment;Treuepunkte',
  )
  for (let i = 0; i < rows; i++) {
    const first = pick(r, FIRST)
    const last = pick(r, LAST)
    const [city, zip, country] = pick(r, CITIES) as string[]
    let email = `${first}.${last}${i}@beispiel.de`.toLowerCase().replace(/ü/g, 'ue').replace(/ë/g, 'e')
    if (r() < 0.015) email = email.replace('@', ' at ')
    if (i > 10 && r() < 0.01) email = `${FIRST[0]?.toLowerCase()}.${LAST[0]?.toLowerCase()}3@beispiel.de`
    const day = String(1 + Math.floor(r() * 28)).padStart(2, '0')
    const month = String(1 + Math.floor(r() * 12)).padStart(2, '0')
    const year = 2015 + Math.floor(r() * 11)
    const revenue =
      r() < 0.2
        ? ''
        : (r() * 250000)
            .toFixed(2)
            .replace('.', ',')
            .replace(/\B(?=(\d{3})+(?!\d))/g, '.')
    const tags = Array.from({ length: Math.floor(r() * 3) }, () => pick(r, TAGS)).join(', ')
    lines.push(
      [
        r() < 0.01 ? '' : first,
        last,
        email,
        `+49 ${Math.floor(100 + r() * 899)} ${Math.floor(100000 + r() * 899999)}`,
        pick(r, COMPANIES),
        r() < 0.01 ? 'unbekannt' : pick(r, STATUS),
        r() < 0.005 ? '31.02.2020' : `${day}.${month}.${year}`,
        revenue,
        r() < 0.5 ? 'Ja' : 'Nein',
        tags,
        `${pick(r, STREETS)} ${1 + Math.floor(r() * 120)}`,
        zip,
        city,
        country,
        // Derived from the row number, so the random values above stay the same.
        ['A', 'B', 'C'][i % 3],
        (i * 37) % 1000,
      ].join(';'),
    )
  }
  return new File([lines.join('\r\n')], 'crm-export-kontakte.csv', { type: 'text/csv' })
}

/** Nested JSON from an API — the dataset lives at `$.data.customers`. */
export function customersJson(): File {
  const r = rng(7)
  const customers = Array.from({ length: 120 }, (_, i) => {
    const [city, zip, country] = pick(r, CITIES) as string[]
    return {
      id: `cus_${1000 + i}`,
      name: { given: pick(r, FIRST), family: pick(r, LAST) },
      contact: { email: `customer${i}@example.com`, mobile: `+43 ${Math.floor(600 + r() * 99)} ${Math.floor(1000000 + r() * 8999999)}` },
      lifecycle: pick(r, ['customer', 'lead', 'churned']),
      created_at: new Date(Date.UTC(2020, Math.floor(r() * 60), 1 + Math.floor(r() * 27))).toISOString(),
      billing_address: {
        line1: `${pick(r, STREETS)} ${1 + Math.floor(r() * 50)}`,
        postal_code: zip,
        city,
        country_code: country === 'Deutschland' ? 'DE' : country === 'Österreich' ? 'AT' : 'CH',
      },
      labels: Array.from({ length: Math.floor(r() * 3) }, () => pick(r, TAGS)),
    }
  })
  return new File([JSON.stringify({ meta: { page: 1, total: customers.length }, data: { customers } }, null, 2)], 'customers-api.json', {
    type: 'application/json',
  })
}

/** An XML export with attributes and nested elements. */
export function contactsXml(): File {
  const r = rng(99)
  const items = Array.from({ length: 60 }, (_, i) => {
    const [city, zip] = pick(r, CITIES) as string[]
    return `  <contact id="${i + 1}" status="${pick(r, ['customer', 'lead'])}">
    <name><first>${pick(r, FIRST)}</first><last>${pick(r, LAST)}</last></name>
    <email>xml${i}@example.org</email>
    <address><city>${city}</city><zip>${zip}</zip></address>
  </contact>`
  })
  return new File([`<?xml version="1.0" encoding="UTF-8"?>\n<export>\n${items.join('\n')}\n</export>`], 'contacts.xml', {
    type: 'application/xml',
  })
}

/** 50k clean rows to feel the performance. */
export function largeCsv(rows = 50000): File {
  const r = rng(1)
  const lines: string[] = ['first_name,last_name,email,company,status,signup_date,revenue']
  for (let i = 0; i < rows; i++) {
    lines.push(
      `${pick(r, FIRST)},${pick(r, LAST)},user${i}@example.com,${pick(r, COMPANIES) || 'Acme'},${pick(r, ['customer', 'lead'])},2024-0${1 + (i % 9)}-1${i % 9},${Math.round(r() * 100000)}`,
    )
  }
  return new File([lines.join('\n')], rows === 50000 ? 'large-50k.csv' : `large-${Math.round(rows / 1000)}k.csv`, { type: 'text/csv' })
}
