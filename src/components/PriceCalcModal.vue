<script setup>
import { computed, reactive, ref } from 'vue'
import BaseModal from './BaseModal.vue'
import { all, state, closeModal, employeeColor } from '../store.js'
import { fmt0, monthLabel, shiftMonth, currentMonth } from '../lib/format.js'
import { splitServices, serviceKey } from '../lib/services.js'

/**
 * "What if I change my prices?" From the last three full months: how many visits there were and
 * what they brought in, so a price change can be seen per month and per year — for the whole salon
 * and per team member. Per service too, when services were recorded on the appointments.
 */
const props = defineProps({ focus: { type: String, default: '' } }) // a service key to start with
const MONTHS = 3
const now = currentMonth(state.monthStartDay)
const months = Array.from({ length: MONTHS }, (_, i) => shiftMonth(now, -(i + 1)))
const period = `${monthLabel(months[MONTHS - 1]).split(' ')[0]} – ${monthLabel(months[0])}`
const recent = computed(() => all.value.filter((a) => months.includes(a.month)))
const visits = computed(() => recent.value.length / MONTHS)
const takings = computed(() => recent.value.reduce((s, a) => s + a.amount, 0) / MONTHS)
const avgVisit = computed(() => (visits.value ? takings.value / visits.value : 0))

// Everyone's change: rands per visit, or a percentage (typing one clears the other).
const perVisit = ref('')
const pct = ref('')
const num = (v) => parseFloat(String(v ?? '').replace(',', '.')) || 0
const extraFor = (count, total) => (num(pct.value) ? (total * num(pct.value)) / 100 : count * num(perVisit.value))
const extraMonth = computed(() => extraFor(visits.value, takings.value))

const team = computed(() => {
  const map = new Map()
  for (const a of recent.value) {
    const t = map.get(a.employeeId) || { id: a.employeeId, name: state.employees.find((e) => e.id === a.employeeId)?.name || a.employeeName, count: 0, total: 0 }
    t.count++
    t.total += a.amount
    map.set(a.employeeId, t)
  }
  return [...map.values()].sort((a, b) => b.total - a.total)
})

/* Per service, only when services were written on most appointments. */
const services = computed(() => {
  const map = new Map()
  for (const a of recent.value) {
    const tokens = splitServices(a.service)
    for (const t of tokens) {
      const k = serviceKey(t)
      const e = map.get(k) || { key: k, name: t, count: 0, revenue: 0 }
      e.count++
      e.revenue += a.amount / tokens.length
      map.set(k, e)
    }
  }
  const names = new Map(state.services.map((s) => [serviceKey(s.name), s.name]))
  return [...map.values()]
    .map((e) => ({ ...e, name: names.get(e.key) || e.name, perMonth: e.count / MONTHS, avg: e.revenue / e.count }))
    .filter((e) => e.perMonth >= 0.5)
    .sort((a, b) => (b.key === props.focus) - (a.key === props.focus) || b.perMonth - a.perMonth)
})
const withServices = computed(() => recent.value.filter((a) => a.service).length)
const servicesKnown = computed(() => recent.value.length && withServices.value / recent.value.length >= 0.3)
const plus = reactive({})
const serviceExtra = computed(() => services.value.reduce((s, r) => s + r.perMonth * num(plus[r.key]), 0))
const count = (n) => (n >= 10 ? Math.round(n) : Math.round(n * 10) / 10)
const signed = (n) => (n >= 0 ? '+' : '−') + fmt0(Math.abs(n)).replace('-', '')
</script>

<template>
  <BaseModal title="Price change calculator" @close="closeModal">
    <p class="muted-note" style="margin-top: -6px !important">
      Based on {{ period }}: about <b>{{ Math.round(visits) }}</b> visits a month at <b>{{ fmt0(avgVisit) }}</b> on average ({{ fmt0(takings) }} a month).
    </p>

    <div class="pc-choose">
      <label class="pc-input big"><span>+R</span><input v-model="perVisit" type="number" inputmode="decimal" placeholder="0" aria-label="Rands more per visit" @input="pct = ''"><small>per visit</small></label>
      <span class="pc-or">or</span>
      <label class="pc-input big"><span>+</span><input v-model="pct" type="number" inputmode="decimal" placeholder="0" aria-label="Percent more" @input="perVisit = ''"><small>%</small></label>
    </div>

    <div class="calc-result">
      <div><span>Extra a month</span><b>{{ signed(extraMonth) }}</b></div>
      <div><span>Extra a year</span><b>{{ signed(extraMonth * 12) }}</b></div>
    </div>

    <template v-if="team.length > 1 && extraMonth">
      <h4 class="section-label">Per team member (a month)</h4>
      <div class="list">
        <div v-for="t in team" :key="t.id" class="list-row">
          <i class="swatch-dot" :style="{ background: employeeColor(t.id) }" />
          <div class="grow"><div class="title">{{ t.name }}</div><div class="meta">≈ {{ count(t.count / MONTHS) }} visits a month</div></div>
          <div class="right"><div class="big">{{ signed(extraFor(t.count / MONTHS, t.total / MONTHS)) }}</div></div>
        </div>
      </div>
    </template>

    <template v-if="servicesKnown">
      <h4 class="section-label">Or per service</h4>
      <div class="list price-calc">
        <div v-for="r in services" :key="r.key" class="list-row" :class="{ focus: r.key === focus }">
          <div class="grow">
            <div class="title">{{ r.name }}</div>
            <div class="meta">≈ {{ count(r.perMonth) }} a month · usually {{ fmt0(r.avg) }}<template v-if="num(plus[r.key])"> · {{ signed(r.perMonth * num(plus[r.key])) }}/month</template></div>
          </div>
          <label class="pc-input"><span>+R</span><input v-model="plus[r.key]" type="number" inputmode="decimal" :aria-label="`Increase for ${r.name}`" placeholder="0"></label>
        </div>
      </div>
      <div v-if="serviceExtra" class="calc-result" style="margin-top: 10px">
        <div><span>These services: a month</span><b>{{ signed(serviceExtra) }}</b></div>
        <div><span>A year</span><b>{{ signed(serviceExtra * 12) }}</b></div>
      </div>
    </template>
    <p v-else class="muted-note">Services aren't written on most recent appointments, so this works per visit. Add the services when recording appointments to see it per service too.</p>

    <p class="muted-note">Assumes clients keep coming as often as they did. Team members on commission also earn their share of the extra.</p>
  </BaseModal>
</template>
