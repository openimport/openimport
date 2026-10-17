/** A contacts schema and a CRM export whose headers don't look like the field names. */
import { defineSchema, field, sourceFromString } from '@openimport/core'

export const schema = defineSchema({
  fields: {
    firstName: field.string({ required: true }),
    lastName: field.string({ required: true }),
    email: field.email({ unique: true }),
    phone: field.string(),
    company: field.string(),
    customerNumber: field.string({ description: 'Our customer ID, e.g. K-10023' }),
    status: field.enum(['lead', 'customer', 'churned']),
    signupDate: field.date({ label: 'Signup date' }),
  },
})

// Headers a person understands at a glance, but that don't look like the field names.
export const file = sourceFromString(
  [
    'Vorname;Nachname;Kontakt;Mobil;Firma;KDNR;Spalte 7;seit',
    'Anna;Müller;anna.mueller@stadtwerke.de;+49 151 2345678;Stadtwerke Nord;K-10023;Bestandskunde;15.03.2021',
    'Lukas;Schmidt;l.schmidt@energie-ag.de;+49 160 9876543;Energie AG;K-10024;Interessent;02.11.2023',
    'Mia;Weber;mia@solar-koch.de;+49 172 5551234;Solar & Koch;K-10031;Gekündigt;30.06.2019',
  ].join('\n'),
  'crm-export.csv',
)
