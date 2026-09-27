<script setup>
import { computed, ref } from 'vue'
import BaseModal from './BaseModal.vue'
import { all, state, closeModal, employeeColor, toast } from '../store.js'
import { fmt0 } from '../lib/format.js'
import { yearReview, reviewText } from '../lib/review.js'

/**
 * The year in review — for the salon (owner, with rands) or for a team member (her own year, no rands).
 */
const staff = computed(() => state.role === 'staff')
const years = computed(() => [...new Set(all.value.map((a) => Number(a.month.slice(0, 4))))].sort((a, b) => b - a).slice(0, 6))
const now = new Date()
// Jan–Feb: last year is the one to look back on; otherwise this year so far.
const year = ref(now.getMonth() < 2 && years.value.includes(now.getFullYear() - 1) ? now.getFullYear() - 1 : years.value[0])
const soFar = computed(() => year.value === now.getFullYear() && now.getMonth() < 11)
const r = computed(() => yearReview(all.value, year.value, { employees: staff.value ? [] : state.employees, withMoney: !staff.value }))
const who = computed(() => (staff.value ? (state.me?.name || state.employees[0]?.name || '').split(' ')[0] : 'Little Lash Lounge'))
const pct = (c) => (c == null ? '' : `${c >= 0 ? '↑' : '↓'} ${Math.abs(Math.round(c * 100))}% on ${year.value - 1}`)

async function share() {
  const text = reviewText(r.value, staff.value ? `${who.value} at Little Lash Lounge` : 'Little Lash Lounge')
  try {
    if (navigator.share) await navigator.share({ text })
    else {
      await navigator.clipboard.writeText(text)
      toast('Copied — paste it anywhere')
    }
  } catch { /* cancelled */ }
}
</script>

<template>
  <BaseModal :title="staff ? `Your ${year}` : `${year} in review`" @close="closeModal">
    <div class="chips inline" style="margin: -6px 0 12px; flex-wrap: wrap">
      <button v-for="y in years" :key="y" class="chip small" :class="{ active: y === year }" @click="year = y">{{ y }}</button>
    </div>
    <div v-if="!r" class="empty">Nothing recorded in {{ year }}.</div>
    <div v-else class="review">
      <section class="rv-card rv-hero">
        <small>{{ soFar ? `${year} so far` : `Your ${year}` }}{{ staff ? '' : ' at Little Lash Lounge' }}</small>
        <b>{{ r.visits.toLocaleString('en-ZA') }}</b>
        <span>appointments</span>
        <em v-if="!soFar && r.lastVisits">{{ staff ? pct(r.lastVisits ? (r.visits - r.lastVisits) / r.lastVisits : null) : '' }}</em>
      </section>

      <section v-if="!staff" class="rv-card">
        <small>Takings</small>
        <b>{{ fmt0(r.total) }}</b>
        <span v-if="!soFar && r.change != null">{{ pct(r.change) }}</span>
      </section>

      <div class="rv-pair">
        <section class="rv-card"><small>Clients</small><b>{{ r.clients.toLocaleString('en-ZA') }}</b><span>{{ staff ? 'you looked after' : 'came in' }}</span></section>
        <section class="rv-card"><small>New faces</small><b>{{ r.newClients }}</b><span>first visit {{ staff ? 'with you' : 'ever' }}</span></section>
      </div>

      <section v-if="r.cameBack" class="rv-card soft"><small>Welcome back</small><b>{{ r.cameBack }}</b><span>clients came back after 6+ months away 🌸</span></section>

      <div class="rv-pair">
        <section v-if="r.busiestMonth" class="rv-card"><small>Busiest month</small><b class="word">{{ r.busiestMonth.label }}</b><span>{{ r.busiestMonth.visits }} appointments</span></section>
        <section v-if="r.busiestWeekday" class="rv-card"><small>Favourite day</small><b class="word">{{ r.busiestWeekday.label }}</b><span>{{ r.busiestWeekday.visits }} appointments</span></section>
      </div>
      <section v-if="r.biggestDay" class="rv-card soft"><small>Biggest day</small><b class="word">{{ r.biggestDay.label }}</b><span>{{ r.biggestDay.visits }} appointments in one day 🔥</span></section>

      <section v-if="r.loyal.length" class="rv-card list-card">
        <small>Most loyal clients 👑</small>
        <ol><li v-for="c in r.loyal" :key="c.name"><span>{{ c.name }}</span><b>{{ c.visits }} visits</b></li></ol>
      </section>

      <section v-if="r.milestones.length" class="rv-card list-card soft">
        <small>Loyalty milestones 🎉</small>
        <ol><li v-for="m in r.milestones.slice(0, 8)" :key="m.name + m.milestone"><span>{{ m.name }}</span><b>{{ m.label }} visit{{ staff ? " with you" : "" }}</b></li></ol>
        <span v-if="r.milestones.length > 8">+ {{ r.milestones.length - 8 }} more</span>
      </section>

      <section v-if="r.topServices.length" class="rv-card list-card">
        <small>Top services</small>
        <ol><li v-for="s in r.topServices" :key="s.name"><span>{{ s.name }}</span><b>{{ s.n }}</b></li></ol>
      </section>

      <section v-if="r.team.length > 1" class="rv-card list-card">
        <small>The team</small>
        <ol class="plain">
          <li v-for="p in r.team" :key="p.id">
            <span><i class="swatch-dot" :style="{ background: employeeColor(p.id) }" /> {{ p.name }}</span>
            <b>{{ p.visits }} appts · {{ p.clients }} clients<template v-if="p.total != null"> · {{ fmt0(p.total) }}</template></b>
          </li>
        </ol>
      </section>

      <section v-if="r.favMethod && !staff" class="rv-card soft"><small>How clients paid</small><b class="word">{{ r.favMethod.label }}</b><span>{{ r.favMethod.share }}% of appointments</span></section>

      <button class="btn wide" style="margin-top: 6px" @click="share">Share {{ staff ? 'my' : 'our' }} year ✨</button>
      <p class="muted-note" style="text-align: center">Sharing leaves out client names{{ staff ? '' : ' and money' }}.</p>
    </div>
  </BaseModal>
</template>
