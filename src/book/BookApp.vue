<script setup>
/**
 * The clients' booking page. Made to be very easy: one question per screen, big buttons, plain words.
 *   Home → Choose treatment(s) → Who (or "anyone") → Time ("next available" first) → Confirm (sign in
 *   with email + a 6-digit code the first time) → Done (add to calendar).
 * Signed in: her next appointments (change time / cancel), her visits (paid / unpaid, invoices), her details.
 */
import { computed, onMounted, reactive, ref } from 'vue'
import * as api from './api.js'
import { fmt, fmt0 } from '../lib/format.js'
import { dayName, lengthLabel, toMin, toTime } from '../lib/booking.js'
import { pushSupported, isIos, isInstalled, currentSubscription, subscribePush, unsubscribePush } from '../lib/push.js'

const screen = ref('loading') // loading | home | services | who | time | confirm | done | visits | account | error
const info = ref(null)
const me = ref(null) // overview when signed in
const busy = ref(false)
const error = ref('')
const flash = ref('')

const pick = reactive({ services: [], who: 'any', slot: null, notes: '' })
const moving = ref(null) // a booking whose time is being changed

onMounted(async () => {
  try {
    info.value = await api.info()
    if (api.signedIn()) await loadMe()
    screen.value = 'home'
  } catch (err) {
    error.value = err.message
    screen.value = 'error'
  }
})
async function loadMe() {
  try {
    me.value = await api.me()
  } catch (err) {
    if (err instanceof api.SignInNeeded) me.value = null
    else throw err
  }
}
function go(s) {
  error.value = ''
  screen.value = s
  window.scrollTo({ top: 0 })
}
const reload = () => window.location.reload()
function say(msg) {
  flash.value = msg
  setTimeout(() => (flash.value = ''), 3500)
}

/* ---------- 1. treatments ---------- */
const groups = computed(() => {
  const by = new Map()
  for (const s of info.value?.services || []) {
    const c = s.category || 'Treatments'
    if (!by.has(c)) by.set(c, [])
    by.get(c).push(s)
  }
  return [...by.entries()].sort((a, b) => a[0].localeCompare(b[0]))
})
const chosen = computed(() => pick.services.map((id) => info.value.services.find((s) => s.id === id)).filter(Boolean))
const toggle = (s) => {
  const i = pick.services.indexOf(s.id)
  if (i >= 0) pick.services.splice(i, 1)
  else pick.services.push(s.id)
}
const priceText = (s) => (s.priceFrom == null ? '' : s.priceFrom === s.priceTo ? fmt0(s.priceFrom) : `${fmt0(s.priceFrom)} – ${fmt0(s.priceTo)}`)
const lenText = (s) => (s.minutesFrom === s.minutesTo ? lengthLabel(s.minutesFrom) : `${lengthLabel(s.minutesFrom)} – ${lengthLabel(s.minutesTo)}`)
function startBooking() {
  moving.value = null
  Object.assign(pick, { services: [], who: 'any', slot: null, notes: '' })
  go('services')
}

/* ---------- 2. who ---------- */
const team = computed(() => (info.value?.team || []).filter((e) => chosen.value.every((s) => s.staff.includes(e.id))))
function toWho() {
  if (team.value.length <= 1) { pick.who = team.value[0]?.id || 'any'; toTime2() } else go('who')
}
function choose(who) {
  pick.who = who
  toTime2()
}

/* ---------- 3. time ---------- */
const days = ref([])
const next = ref(null)
const day = ref('')
const until = ref('')
async function toTime2() {
  go('time')
  busy.value = true
  days.value = []
  next.value = null
  try {
    const ids = moving.value ? moving.value.services.map((s) => s.id) : pick.services
    const r = await api.times({ services: ids, who: moving.value ? moving.value.employeeId : pick.who, days: 14, next: true })
    days.value = r.days
    next.value = r.next
    until.value = r.until
    day.value = r.days[0]?.date || ''
  } catch (err) {
    error.value = err.message
  } finally {
    busy.value = false
  }
}
async function moreDays() {
  const last = days.value[days.value.length - 1]?.date
  if (!last) return
  busy.value = true
  try {
    const from = new Date(last + 'T12:00:00Z')
    from.setUTCDate(from.getUTCDate() + 1)
    const ids = moving.value ? moving.value.services.map((s) => s.id) : pick.services
    const r = await api.times({ services: ids, who: moving.value ? moving.value.employeeId : pick.who, from: from.toISOString().slice(0, 10), days: 14 })
    days.value = days.value.concat(r.days)
    if (!r.days.length) say('No more open times yet.')
  } catch (err) {
    error.value = err.message
  } finally {
    busy.value = false
  }
}
const dayTimes = computed(() => days.value.find((d) => d.date === day.value)?.times || [])
const partOf = (t) => (toMin(t.time) < 12 * 60 ? 'Morning' : toMin(t.time) < 17 * 60 ? 'Afternoon' : 'Evening')
const byPart = computed(() => ['Morning', 'Afternoon', 'Evening'].map((p) => ({ p, times: dayTimes.value.filter((t) => partOf(t) === p) })).filter((x) => x.times.length))
function takeTime(date, t) {
  pick.slot = { date, ...t }
  go('confirm')
}

/* ---------- 4. confirm (and sign in) ---------- */
const auth = reactive({ step: 'email', email: api.saved().email || '', code: '', name: '', phone: '' })
const needsProfile = computed(() => me.value && (!me.value.client.name || !me.value.client.phone))
async function sendCode() {
  busy.value = true
  error.value = ''
  try {
    await api.sendCode(auth.email.trim())
    auth.step = 'code'
  } catch (err) {
    error.value = err.message
  } finally {
    busy.value = false
  }
}
async function verifyCode() {
  busy.value = true
  error.value = ''
  try {
    await api.verify(auth.email.trim(), auth.code)
    await loadMe()
    auth.name = me.value?.client.name || ''
    auth.phone = me.value?.client.phone || ''
    auth.step = 'email'
    auth.code = ''
  } catch (err) {
    error.value = err.message
  } finally {
    busy.value = false
  }
}
async function saveProfile() {
  busy.value = true
  error.value = ''
  try {
    me.value = await api.saveProfile(auth.name, auth.phone)
    if (screen.value === 'account') say('Saved ✓')
  } catch (err) {
    error.value = err.message
  } finally {
    busy.value = false
  }
}
const done = ref(null)
async function confirmBooking() {
  busy.value = true
  error.value = ''
  try {
    const r = moving.value
      ? await api.move(moving.value.id, pick.slot.date, pick.slot.time)
      : await api.book({ services: pick.services, who: pick.who, date: pick.slot.date, start: pick.slot.time, notes: pick.notes })
    me.value = r.overview
    done.value = r.booking
    go('done')
  } catch (err) {
    error.value = err.message
    if (/just taken/.test(err.message)) setTimeout(toTime2, 1200)
  } finally {
    busy.value = false
  }
}

/* ---------- done: add to calendar ---------- */
function addToCalendar(b) {
  const utc = (date, min) => {
    const d = new Date(`${date}T${toTime(min)}:00+02:00`)
    return d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '')
  }
  const s = toMin(b.start)
  const what = b.services.map((x) => x.name).join(' + ')
  const ics = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Little Lash Lounge//Booking//EN', 'BEGIN:VEVENT', `UID:${b.id}@littlelash`,
    `DTSTAMP:${utc(new Date().toISOString().slice(0, 10), 0)}`, `DTSTART:${utc(b.date, s)}`, `DTEND:${utc(b.date, s + b.minutes)}`,
    `SUMMARY:${info.value.salon}: ${what}`, `DESCRIPTION:With ${b.with}. ${info.value.phone ? 'Phone ' + info.value.phone : ''}`,
    'BEGIN:VALARM', 'TRIGGER:-PT2H', 'ACTION:DISPLAY', 'DESCRIPTION:Appointment soon', 'END:VALARM', 'END:VEVENT', 'END:VCALENDAR'].join('\r\n')
  const url = URL.createObjectURL(new Blob([ics], { type: 'text/calendar' }))
  Object.assign(document.createElement('a'), { href: url, download: 'little-lash-appointment.ics' }).click()
  setTimeout(() => URL.revokeObjectURL(url), 5000)
}

/* ---------- my appointments ---------- */
function changeTime(b) {
  moving.value = b
  pick.slot = null
  toTime2()
}
async function cancelBooking(b) {
  if (!window.confirm(`Cancel your appointment on ${dayName(b.date, true)} at ${b.start}?`)) return
  busy.value = true
  try {
    me.value = (await api.cancel(b.id)).overview
    say('Your appointment is cancelled.')
  } catch (err) {
    say(err.message)
  } finally {
    busy.value = false
  }
}

/* ---------- invoices ---------- */
const printing = ref(null)
function invoice(v) {
  printing.value = v
  setTimeout(() => { window.print(); setTimeout(() => (printing.value = null), 500) }, 50)
}

/* ---------- account: notifications ---------- */
const notif = ref(null)
const pushOn = ref(false)
async function openAccount() {
  auth.name = me.value.client.name
  auth.phone = me.value.client.phone
  go('account')
  try {
    notif.value = await api.notifySettings()
    pushOn.value = !!(await currentSubscription().catch(() => null))
  } catch { notif.value = null }
}
async function togglePush() {
  try {
    if (pushOn.value) {
      const ep = await unsubscribePush()
      if (ep) await api.unsubscribe(ep)
      pushOn.value = false
    } else {
      await api.subscribe(await subscribePush(notif.value.vapidKey))
      pushOn.value = true
      say('Reminders on for this phone ✓')
    }
  } catch (err) {
    say(err.message)
  }
}
async function toggleEmail() {
  const on = !notif.value.emailOn
  await api.setEmailNotify(on)
  notif.value.emailOn = on
}
function signOut() {
  api.signOut()
  me.value = null
  go('home')
}
const first = computed(() => (me.value?.client.name || '').split(' ')[0])
const total = computed(() => (pick.slot?.price != null ? fmt0(pick.slot.price) : ''))
</script>

<template>
  <div class="bk">
    <header class="bk-top">
      <button v-if="!['home', 'loading', 'error', 'done'].includes(screen)" class="bk-back" @click="go(screen === 'who' ? 'services' : screen === 'time' ? (moving ? 'home' : team.length > 1 ? 'who' : 'services') : screen === 'confirm' ? 'time' : 'home')">‹ Back</button>
      <div class="bk-brand" @click="go('home')">Little Lash <em>Lounge</em></div>
    </header>

    <main class="bk-main">
      <div v-if="screen === 'loading'" class="bk-center">Loading…</div>
      <div v-else-if="screen === 'error'" class="bk-center"><p>{{ error }}</p><button class="bk-btn" @click="reload">Try again</button></div>

      <!-- HOME -->
      <template v-else-if="screen === 'home'">
        <h1>{{ me && first ? `Hello, ${first}` : 'Welcome' }} ✨</h1>
        <p v-if="info.message" class="bk-note">{{ info.message }}</p>
        <template v-if="info.online">
          <button class="bk-btn bk-big" @click="startBooking">📅 Book an appointment</button>
        </template>
        <div v-else class="bk-card">Online booking is closed at the moment.<template v-if="info.phone"> Please phone or WhatsApp us on <a :href="`tel:${info.phone}`">{{ info.phone }}</a>.</template></div>

        <template v-if="me">
          <h2>Your appointments</h2>
          <div v-if="!me.upcoming.length" class="bk-card bk-muted">You have no appointments booked.</div>
          <div v-for="b in me.upcoming" :key="b.id" class="bk-card bk-appt">
            <div class="bk-when">{{ dayName(b.date, true) }}<br><b>{{ b.start }}</b></div>
            <div class="bk-what">{{ b.services.map((s) => s.name).join(' + ') }}<br><span class="bk-muted">with {{ b.with }} · {{ lengthLabel(b.minutes) }}</span></div>
            <div v-if="b.canChange" class="bk-row">
              <button class="bk-btn bk-soft" :disabled="busy" @click="changeTime(b)">Change time</button>
              <button class="bk-btn bk-plain" :disabled="busy" @click="cancelBooking(b)">Cancel</button>
            </div>
            <p v-else class="bk-muted bk-small">To change this appointment now, please phone us<template v-if="info.phone"> on <a :href="`tel:${info.phone}`">{{ info.phone }}</a></template>.</p>
          </div>
          <div class="bk-row" style="margin-top: 18px">
            <button class="bk-btn bk-soft" @click="go('visits')">🧾 My visits<template v-if="me.unpaid"> · {{ fmt(me.unpaid) }} to pay</template></button>
            <button class="bk-btn bk-soft" @click="openAccount">👤 My details</button>
          </div>
        </template>
        <p v-else class="bk-small bk-muted" style="margin-top: 24px">Booked before? You'll sign in with your email when you confirm.</p>
        <p v-if="info.phone" class="bk-small bk-muted">Questions? Phone or WhatsApp <a :href="`tel:${info.phone}`">{{ info.phone }}</a></p>
      </template>

      <!-- 1. TREATMENTS -->
      <template v-else-if="screen === 'services'">
        <p class="bk-step">Step 1 of 3</p>
        <h1>What would you like?</h1>
        <p class="bk-muted">Tap one or more.</p>
        <div v-for="[cat, list] in groups" :key="cat">
          <h2 v-if="groups.length > 1">{{ cat }}</h2>
          <button v-for="s in list" :key="s.id" class="bk-option" :class="{ on: pick.services.includes(s.id) }" :aria-pressed="pick.services.includes(s.id)" @click="toggle(s)">
            <span class="bk-tick">{{ pick.services.includes(s.id) ? '✓' : '' }}</span>
            <span class="bk-grow"><b>{{ s.name }}</b><small>{{ lenText(s) }}<template v-if="priceText(s)"> · {{ priceText(s) }}</template></small><small v-if="s.description" class="bk-desc">{{ s.description }}</small></span>
          </button>
        </div>
        <div class="bk-bar">
          <button class="bk-btn bk-big" :disabled="!pick.services.length" @click="toWho">{{ pick.services.length ? `Next (${pick.services.length} chosen)` : 'Choose a treatment' }}</button>
        </div>
      </template>

      <!-- 2. WHO -->
      <template v-else-if="screen === 'who'">
        <p class="bk-step">Step 2 of 3</p>
        <h1>Who would you like?</h1>
        <button class="bk-option" @click="choose('any')"><span class="bk-tick">⏱</span><span class="bk-grow"><b>Anyone</b><small>The earliest time</small></span></button>
        <button v-for="e in team" :key="e.id" class="bk-option" @click="choose(e.id)"><span class="bk-avatar">{{ e.name[0] }}</span><span class="bk-grow"><b>{{ e.name }}</b></span></button>
      </template>

      <!-- 3. TIME -->
      <template v-else-if="screen === 'time'">
        <p class="bk-step">{{ moving ? 'Change your time' : 'Step 3 of 3' }}</p>
        <h1>When?</h1>
        <p v-if="error" class="bk-error">{{ error }}</p>
        <div v-if="busy && !days.length" class="bk-center">Finding open times…</div>
        <template v-else>
          <div v-if="next" class="bk-card bk-next">
            <div class="bk-muted">The next open time</div>
            <div class="bk-next-when">{{ dayName(next.date, true) }}<br><b>{{ next.time }}</b></div>
            <div class="bk-muted">with {{ next.with }}</div>
            <button class="bk-btn bk-big" @click="takeTime(next.date, next)">Book this time</button>
          </div>
          <div v-else class="bk-card">Sorry, there are no open times<template v-if="until"> before {{ dayName(until, true) }}</template>.<template v-if="info.phone"> Please phone us on <a :href="`tel:${info.phone}`">{{ info.phone }}</a>.</template></div>

          <template v-if="days.length">
            <h2>Or choose another day</h2>
            <div class="bk-days">
              <button v-for="d in days" :key="d.date" class="bk-day" :class="{ on: d.date === day }" @click="day = d.date">
                <small>{{ dayName(d.date).split(' ')[0].replace(',', '') }}</small><b>{{ d.date.slice(8).replace(/^0/, '') }}</b><small>{{ dayName(d.date).split(' ')[2] }}</small>
              </button>
              <button class="bk-day bk-more" :disabled="busy" @click="moreDays">Later<br>days ›</button>
            </div>
            <div v-for="g in byPart" :key="g.p">
              <h3>{{ g.p }}</h3>
              <div class="bk-times">
                <button v-for="t in g.times" :key="t.time" class="bk-time" @click="takeTime(day, t)">{{ t.time }}</button>
              </div>
            </div>
          </template>
        </template>
      </template>

      <!-- 4. CONFIRM -->
      <template v-else-if="screen === 'confirm'">
        <h1>{{ moving ? 'Change to this time?' : 'Almost done' }}</h1>
        <div class="bk-card bk-summary">
          <div><span>When</span><b>{{ dayName(pick.slot.date, true) }} at {{ pick.slot.time }}</b></div>
          <div><span>With</span><b>{{ pick.slot.with }}</b></div>
          <div><span>For</span><b>{{ (moving ? moving.services : chosen).map((s) => s.name).join(' + ') }}</b></div>
          <div><span>Takes</span><b>{{ lengthLabel(pick.slot.minutes) }}</b></div>
          <div v-if="total && !moving"><span>Price</span><b>{{ total }}</b></div>
        </div>

        <!-- Sign in (first time only) -->
        <div v-if="!me" class="bk-card">
          <template v-if="auth.step === 'email'">
            <label class="bk-label" for="bk-email">Your email address</label>
            <input id="bk-email" v-model="auth.email" class="bk-input" type="email" inputmode="email" autocomplete="email" autocapitalize="off" placeholder="you@example.com" @keyup.enter="sendCode">
            <p class="bk-small bk-muted">We'll email you a 6-number code. No password needed.</p>
            <button class="bk-btn bk-big" :disabled="busy || !auth.email.includes('@')" @click="sendCode">{{ busy ? 'Sending…' : 'Email me a code' }}</button>
          </template>
          <template v-else>
            <label class="bk-label" for="bk-code">Type the code we emailed to {{ auth.email }}</label>
            <input id="bk-code" v-model="auth.code" class="bk-input bk-code" inputmode="numeric" autocomplete="one-time-code" maxlength="6" placeholder="••••••" @keyup.enter="verifyCode">
            <button class="bk-btn bk-big" :disabled="busy || auth.code.replace(/\D/g, '').length !== 6" @click="verifyCode">{{ busy ? 'Checking…' : 'Continue' }}</button>
            <p class="bk-small bk-muted">Can't find it? Look in your spam folder, or <button class="bk-link" @click="auth.step = 'email'">send a new code</button>.</p>
          </template>
        </div>
        <div v-else-if="needsProfile" class="bk-card">
          <p><b>Welcome!</b> Just once, please tell us:</p>
          <label class="bk-label" for="bk-name">Your name and surname</label>
          <input id="bk-name" v-model="auth.name" class="bk-input" autocomplete="name" autocapitalize="words">
          <label class="bk-label" for="bk-phone">Your cellphone number</label>
          <input id="bk-phone" v-model="auth.phone" class="bk-input" type="tel" autocomplete="tel" inputmode="tel">
          <button class="bk-btn bk-big" :disabled="busy" @click="saveProfile">Save</button>
        </div>
        <template v-else>
          <label v-if="!moving" class="bk-label" for="bk-notes">Anything we should know? (optional)</label>
          <input v-if="!moving" id="bk-notes" v-model="pick.notes" class="bk-input" maxlength="300">
          <button class="bk-btn bk-big" :disabled="busy" @click="confirmBooking">{{ busy ? 'Booking…' : moving ? 'Yes, change it' : 'Confirm booking' }}</button>
          <p class="bk-small bk-muted">Booking as {{ me.client.name }} · {{ me.client.phone }}. You can change or cancel up to {{ info.cancelHours }} hours before.</p>
        </template>
        <p v-if="error" class="bk-error">{{ error }}</p>
      </template>

      <!-- DONE -->
      <template v-else-if="screen === 'done'">
        <div class="bk-done">✓</div>
        <h1 style="text-align: center">{{ moving ? 'Your time is changed!' : "You're booked!" }}</h1>
        <div class="bk-card bk-summary">
          <div><span>When</span><b>{{ dayName(done.date, true) }} at {{ done.start }}</b></div>
          <div><span>With</span><b>{{ done.with }}</b></div>
          <div><span>For</span><b>{{ done.services.map((s) => s.name).join(' + ') }}</b></div>
        </div>
        <button class="bk-btn bk-soft bk-big" @click="addToCalendar({ ...done, id: done.id })">📅 Add to my calendar</button>
        <p class="bk-muted" style="text-align: center">We'll remind you the day before. See you soon 💕</p>
        <button class="bk-btn bk-big" @click="moving = null; go('home')">Done</button>
      </template>

      <!-- VISITS -->
      <template v-else-if="screen === 'visits'">
        <h1>My visits</h1>
        <div v-if="me.unpaid" class="bk-card bk-due">Still to pay: <b>{{ fmt(me.unpaid) }}</b></div>
        <div v-if="!me.visits.length" class="bk-card bk-muted">Your visits will show here after your appointments.</div>
        <div v-for="v in me.visits" :key="v.id" class="bk-card bk-visit">
          <div class="bk-grow"><b>{{ dayName(v.date, true) }}</b><small>{{ v.service || 'Appointment' }} · {{ v.with }}</small></div>
          <div class="bk-right"><b>{{ fmt(v.amount) }}</b><span class="bk-tag" :class="v.status === 'Paid' ? 'paid' : 'unpaid'">{{ v.status === 'Paid' ? 'Paid' : 'Not paid yet' }}</span>
            <button class="bk-link" @click="invoice(v)">Invoice</button></div>
        </div>
      </template>

      <!-- ACCOUNT -->
      <template v-else-if="screen === 'account'">
        <h1>My details</h1>
        <div class="bk-card">
          <label class="bk-label" for="ac-name">Name and surname</label>
          <input id="ac-name" v-model="auth.name" class="bk-input" autocomplete="name">
          <label class="bk-label" for="ac-phone">Cellphone</label>
          <input id="ac-phone" v-model="auth.phone" class="bk-input" type="tel" autocomplete="tel">
          <p class="bk-small bk-muted">Email: {{ me.client.email }}</p>
          <button class="bk-btn" :disabled="busy" @click="saveProfile">Save</button>
          <p v-if="error" class="bk-error">{{ error }}</p>
        </div>
        <h2>Reminders</h2>
        <div v-if="notif" class="bk-card">
          <div class="bk-switch-row">
            <span><b>Email me</b><small>Booking confirmations and a reminder the day before</small></span>
            <button class="switch" role="switch" :aria-checked="notif.emailOn" :disabled="!notif.emailReady" @click="toggleEmail"><span /></button>
          </div>
          <div class="bk-switch-row">
            <span><b>Notifications on this phone</b><small>{{ !pushSupported() ? (isIos() && !isInstalled() ? 'First add this page to your Home Screen (Share → Add to Home Screen).' : 'Not available on this browser.') : 'A pop-up reminder the day before' }}</small></span>
            <button class="switch" role="switch" :aria-checked="pushOn" :disabled="!pushSupported()" @click="togglePush"><span /></button>
          </div>
        </div>
        <button class="bk-btn bk-plain bk-big" @click="signOut">Sign out</button>
      </template>
    </main>

    <div v-if="flash" class="bk-flash" role="status">{{ flash }}</div>

    <!-- Invoice (printed / saved as PDF) -->
    <Teleport to="body">
      <div v-if="printing" class="print-root">
        <article class="payslip">
          <header>
            <div><div class="ps-company">{{ me.company['Company Name'] || info.salon }}</div><h1>Invoice</h1><div class="ps-month">{{ dayName(printing.date, true) }}</div></div>
            <div class="ps-right"><div><span>Invoice no.</span> {{ printing.id.slice(0, 8).toUpperCase() }}</div><div><span>Status</span> {{ printing.status === 'Paid' ? `Paid${printing.paidOn ? ' ' + printing.paidOn : ''} (${printing.method})` : 'Not paid yet' }}</div></div>
          </header>
          <div class="ps-cols">
            <section><h2>For</h2><dl><dt>Name</dt><dd>{{ me.client.name }}</dd><dt>Cellphone</dt><dd>{{ me.client.phone }}</dd><dt>Email</dt><dd>{{ me.client.email }}</dd></dl></section>
            <section><h2>From</h2><dl><dt>Salon</dt><dd>{{ me.company['Company Name'] || info.salon }}</dd><template v-if="me.company['Company Address']"><dt>Address</dt><dd><div v-for="(l, i) in me.company['Company Address'].split('\n')" :key="i">{{ l }}</div></dd></template><template v-if="info.phone"><dt>Phone</dt><dd>{{ info.phone }}</dd></template></dl></section>
          </div>
          <table class="ps-table"><thead><tr><th>Treatment</th><th /><th>With</th><th /></tr></thead>
            <tbody><tr><td>{{ printing.service || 'Appointment' }}</td><td /><td>{{ printing.with }}</td><td class="n">{{ fmt(printing.amount) }}</td></tr></tbody></table>
          <div class="ps-totals"><div class="net"><span>Total</span><b>{{ fmt(printing.amount) }}</b></div></div>
          <p class="ps-foot">Thank you for visiting us 💕</p>
        </article>
      </div>
    </Teleport>
  </div>
</template>
