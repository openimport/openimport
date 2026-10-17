import { defineSchema, field } from '@openimport/core'

export const contacts = defineSchema({
  id: 'contacts',
  name: 'Contacts',
  fields: {
    firstName: field.string({ required: true, aliases: ['given name'], examples: ['Ada'] }),
    lastName: field.string({ required: true, examples: ['Lovelace'] }),
    email: field.email({ required: true, unique: true, examples: ['ada@example.com'], description: 'Used to deduplicate contacts.' }),
    phone: field.string({ examples: ['+49 30 123456'] }),
    company: field.string({ examples: ['Analytical Engines Ltd'] }),
    status: field.enum(
      [
        { value: 'lead', label: 'Lead', aliases: ['interessent', 'prospect'] },
        { value: 'customer', label: 'Customer', aliases: ['kunde', 'client'] },
        { value: 'churned', label: 'Churned', aliases: ['gekündigt', 'ex-kunde'] },
      ],
      { required: true },
    ),
    signupDate: field.date({ label: 'Signup date' }),
    revenue: field.number({ min: 0, description: 'Annual revenue in EUR' }),
    newsletter: field.boolean({ label: 'Newsletter opt-in' }),
    tags: field.string({ multiple: true }),
    'address.street': field.string({ label: 'Street' }),
    'address.zip': field.string({ label: 'Postal code', pattern: '^\\d{4,5}$' }),
    'address.city': field.string({ label: 'City' }),
    'address.country': field.enum(
      [
        { value: 'DE', label: 'Germany', aliases: ['Deutschland'] },
        { value: 'AT', label: 'Austria', aliases: ['Österreich'] },
        { value: 'CH', label: 'Switzerland', aliases: ['Schweiz'] },
      ],
      { label: 'Country' },
    ),
  },
  validateRow: (row) =>
    row.status === 'customer' && row.revenue === undefined
      ? { field: 'revenue', code: 'revenue_required', message: 'Customers need a revenue value', severity: 'warning' }
      : undefined,
})
