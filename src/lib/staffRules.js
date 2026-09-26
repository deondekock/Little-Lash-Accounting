/** What a staff member may still change in the app (the Worker enforces the same rules). */
import { businessMonth, shiftMonth, todayStr } from './format.js'
import { STAFF_DELETE_HOURS } from './schema.js'

/** Business months she may add to / change: this one and last one, unless her payslip for it is saved. */
export function openMonths(startDay, payslips) {
  const cur = businessMonth(todayStr(), startDay)
  return [shiftMonth(cur, -1), cur].filter((m) => !payslips.some((p) => p.month === m))
}

/** Why she can't change this appointment ('' = she can). */
export function lockedReason(appt, startDay, payslips) {
  const cur = businessMonth(todayStr(), startDay)
  if (payslips.some((p) => p.month === appt.month)) return 'Your payslip for this month is done, so this can\'t be changed any more. Ask the owner if something is wrong.'
  if (![shiftMonth(cur, -1), cur].includes(appt.month)) return 'Older appointments can only be changed by the owner.'
  return ''
}

/** She added it herself in the last 24 hours, so she may delete it. */
export const canDelete = (appt, email) =>
  !!appt?.createdBy && appt.createdBy === email && Date.now() - Date.parse(appt.createdAt || 0) < STAFF_DELETE_HOURS * 3600e3
