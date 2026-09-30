/**
 * Database tables (Cloudflare D1), shared by the app and the Worker.
 * Each record travels as an object with these column names.
 */
export const TABLES = {
  employees: ['id', 'name', 'phone', 'active', 'pay', 'created_at', 'updated_at'],
  appointments: ['id', 'date', 'month', 'employee_id', 'employee_name', 'client', 'service', 'amount', 'method', 'status',
    'paid_on', 'notes', 'overtime', 'length', 'created_at', 'updated_at', 'created_by', 'updated_by'],
  services: ['id', 'name', 'price', 'active', 'prices', 'created_at', 'updated_at'],
  leave: ['id', 'employee_id', 'employee_name', 'type', 'from_date', 'to_date', 'hours', 'notes', 'created_at', 'updated_at', 'status'],
  payslips: ['id', 'employee_id', 'employee_name', 'month', 'pay_date', 'gross', 'paye', 'uif', 'deductions', 'net', 'details',
    'created_at', 'updated_at'],
  // Clients' cell numbers; id = the client's name key (clientKey in stats.js). quiet_note, when set,
  // dismisses the client from the "gone quiet" win-back list (the note says why).
  client_info: ['id', 'name', 'phone', 'created_at', 'updated_at', 'updated_by', 'quiet_note'],
  // Payments toward an appointment (partial settlements, split tenders, voucher redemptions).
  payments: ['id', 'appointment_id', 'date', 'amount', 'method', 'voucher_id', 'note', 'created_at', 'updated_at', 'created_by', 'updated_by'],
  // Gift vouchers: sold for cash now, redeemed later (maybe by someone else) as a "Voucher" tender.
  vouchers: ['id', 'code', 'amount', 'balance', 'buyer', 'buyer_key', 'sold_on', 'method', 'status', 'note', 'created_at', 'updated_at', 'created_by', 'updated_by'],
}

/** History entries keep the records as they were before each change, by kind. */
export const KIND_TABLE = { appts: 'appointments', emps: 'employees', svcs: 'services', leave: 'leave', pays: 'payslips', cinfo: 'client_info', pmts: 'payments', vchr: 'vouchers' }

/** Payslip details kept per employee: [key, label, kind]. */
export const PAY_FIELDS = [
  ['fullName', 'Full Name'], ['code', 'Employee Code'], ['idNumber', 'ID Number'], ['address', 'Address'],
  ['engaged', 'Date Engaged', 'date'], ['taxNumber', 'Tax Number'], ['bankName', 'Bank Name'],
  ['accountType', 'Account Type'], ['accountNumber', 'Account Number'], ['branchCode', 'Branch Code'],
  ['salaryLabel', 'Salary Label'], ['basic', 'Basic Salary', 'num'], ['commissionPct', 'Commission %', 'num'],
  ['commissionOn', 'Commission On'], ['threshold', 'Commission Above', 'num'], ['overtimePct', 'Overtime Commission %', 'num'],
  ['leavePerYear', 'Annual Leave Hours / Year', 'num'], ['hoursPerDay', 'Hours / Day', 'num'],
  ['leaveOpening', 'Leave Balance (days)', 'num'], ['leaveFrom', 'Leave Balance On', 'date'],
  ['daysPerWeek', 'Days / Week', 'num'], ['sickUsed', 'Sick Hours Used Before', 'num'], ['owner', 'Owner', 'bool'],
  ['loginEmail', 'Login Email'],
]

/** Company details for payslips: [key, setting name]. */
export const COMPANY_FIELDS = [
  ['name', 'Company Name'], ['type', 'Company Type'], ['registration', 'Registration Number'],
  ['address', 'Company Address'], ['payeRef', 'PAYE Reference'], ['uifRef', 'UIF Reference'],
  // For client invoices / statements
  ['phone', 'Salon Phone'], ['email', 'Salon Email'], ['bank', 'Invoice Bank'], ['bankHolder', 'Invoice Account Name'],
  ['bankAccount', 'Invoice Account Number'], ['bankBranch', 'Invoice Branch Code'],
]
export const MONTH_START_SETTING = 'Month starts on day'
export const LEAVE_TYPES = ['Annual', 'Sick', 'Family', 'Maternity', 'Unpaid']
/** Leave from the owner is approved straight away; staff requests wait for her. */
export const LEAVE_STATUS = { requested: 'Waiting', approved: 'Approved', declined: 'Declined' }
/** Staff may add and change their own appointments in the current and previous business month, until their
 * payslip for that month is saved; they can delete ones they added themselves within this many hours. */
export const STAFF_DELETE_HOURS = 24
export const METHODS = ['Cash', 'Card', 'EFT']
/**
 * Payment status. "Written off": not paid and not owed any more (e.g. a redo, a gift, a client who won't
 * pay). It stays on record, but counts as R0 everywhere (takings, owed, commission); the amount is kept.
 */
export const WRITTEN_OFF = 'Written off'
export const STATUSES = ['Unpaid', 'Paid', WRITTEN_OFF]
export const statusOf = (s) => (s === 'Paid' || s === WRITTEN_OFF ? s : 'Unpaid')

/** What staff may change about themselves. */
export const STAFF_EDITABLE = ['phone', 'address']

/** Visit numbers worth celebrating. Staff are told on the visit before, so they can plan a treat. */
export const MILESTONES = [10, 25, 50, 75, 100, 150, 200, 250, 300, 400, 500]
