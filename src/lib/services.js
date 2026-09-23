/** Several services on one appointment are stored in one cell, joined with " + ". */
export const SEP = ' + '
export const splitServices = (s) => String(s || '').split(/\s*\+\s*/).map((x) => x.trim()).filter(Boolean)
export const joinServices = (list) => [...new Set(list.map((x) => x.trim()).filter(Boolean))].join(SEP)
/** "Lash  Fill " and "lash fill" are the same service. */
export const serviceKey = (name) => String(name || '').trim().toLowerCase().replace(/\s+/g, ' ')
