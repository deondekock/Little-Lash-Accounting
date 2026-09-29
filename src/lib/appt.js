/**
 * Shaping a raw appointments row (snake_case, as stored in D1 or its array form) into the appointment
 * object the app and the stats work with. Shared by the client (backend-cf) and the Worker so both
 * always produce identical objects — the aggregates the Worker computes then match the client's exactly.
 */
import { statusOf, WRITTEN_OFF } from './schema.js'

const clean = (v) => (v === null || v === undefined ? '' : String(v).trim())

export function overtimeValue(v) {
  const s = String(v ?? '').trim()
  if (s.toLowerCase() === 'all') return 'all'
  const pct = /^(\d+(?:\.\d+)?)\s*%$/.exec(s) // new: share of the appointment (e.g. "50%")
  if (pct) return `${Math.min(100, Math.round(Number(pct[1])))}%`
  const n = Number(s) // older: minutes of overtime
  return n > 0 ? n : 0
}

/** A written-off appointment counts as R0 everywhere; its real amount is kept as `writtenOff`. */
export function toAppt(r) {
  const status = statusOf(r.status)
  const amount = Number(r.amount) || 0
  return {
    id: r.id, date: r.date, month: r.month || r.date.slice(0, 7), employeeId: clean(r.employee_id), employeeName: clean(r.employee_name),
    client: clean(r.client), service: clean(r.service), amount: status === WRITTEN_OFF ? 0 : amount, method: clean(r.method),
    ...(status === WRITTEN_OFF ? { writtenOff: amount } : {}),
    status, paidOn: clean(r.paid_on), notes: clean(r.notes),
    overtime: overtimeValue(r.overtime), length: Number(r.length) > 0 ? Number(r.length) : 0,
    createdBy: clean(r.created_by), updatedBy: clean(r.updated_by), createdAt: clean(r.created_at), rec: r,
  }
}
