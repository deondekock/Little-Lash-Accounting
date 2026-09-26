/**
 * Database tables (Cloudflare D1), shared by the app and the Worker.
 * Each record travels as an object with these column names.
 */
export const TABLES = {
  employees: ['id', 'name', 'phone', 'active', 'pay', 'created_at', 'updated_at'],
  appointments: ['id', 'date', 'month', 'employee_id', 'employee_name', 'client', 'service', 'amount', 'method', 'status',
    'paid_on', 'notes', 'overtime', 'length', 'created_at', 'updated_at'],
  services: ['id', 'name', 'price', 'active', 'prices', 'created_at', 'updated_at'],
  leave: ['id', 'employee_id', 'employee_name', 'type', 'from_date', 'to_date', 'hours', 'notes', 'created_at', 'updated_at', 'status'],
  payslips: ['id', 'employee_id', 'employee_name', 'month', 'pay_date', 'gross', 'paye', 'uif', 'deductions', 'net', 'details',
    'created_at', 'updated_at'],
}

/** History entries keep the records as they were before each change, by kind. */
export const KIND_TABLE = { appts: 'appointments', emps: 'employees', svcs: 'services', leave: 'leave', pays: 'payslips' }

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
]
export const MONTH_START_SETTING = 'Month starts on day'
export const LEAVE_TYPES = ['Annual', 'Sick', 'Family', 'Maternity', 'Unpaid']
/** Leave from the owner is approved straight away; staff requests wait for her. */
export const LEAVE_STATUS = { requested: 'Waiting', approved: 'Approved', declined: 'Declined' }
/** What staff may change about themselves. */
export const STAFF_EDITABLE = ['phone', 'address']
