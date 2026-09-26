<script setup>
import { computed } from 'vue'
import { all, state, setView } from '../../store.js'
import { monthLabel, shortDate, todayStr } from '../../lib/format.js'
import { minutesLabel } from '../../lib/payroll.js'
import { monthProgress, loyalty, serviceMix, milestones } from '../../lib/staffStats.js'
import { clients } from '../../store.js'

/** Staff: her own month, client loyalty, services and milestones. Counts only — no rands, no comparisons. */
const today = todayStr()
const me = computed(() => state.employees[0])
const p = computed(() => monthProgress(all.value, state.monthStartDay, today))
const l = computed(() => loyalty(all.value, me.value?.id, p.value.month))
const s = computed(() => serviceMix(all.value, p.value.month))
const m = computed(() => milestones(all.value, today, me.value?.pay?.engaged))
const due = computed(() => clients.value.filter((c) => c.due).length)
const monthName = computed(() => monthLabel(p.value.month).split(' ')[0])
const plural = (n, w) => `${n.toLocaleString('en-ZA')} ${w}${n === 1 ? '' : 's'}`
</script>

<template>
  <div class="stats-stack">
    <!-- Celebrations first -->
    <div v-if="m.anniversary?.today" class="card celebrate">🎉 <b>Happy {{ m.anniversary.years }}-year anniversary</b> at the salon today!</div>
    <div v-if="m.recent" class="card celebrate">🎉 You reached <b>{{ m.reached.toLocaleString('en-ZA') }} appointments</b> on {{ shortDate(m.reachedOn) }}!</div>
    <div v-if="m.bestIsNow" class="card celebrate">🔥 <b>Your best week ever</b> — {{ m.thisWeek }} appointments so far!</div>
    <div v-for="c in m.clientMoments" :key="c.name + c.date" class="card celebrate">💕 <b>{{ c.name }}</b>'s {{ c.visits }}th visit with you ({{ shortDate(c.date) }})</div>

    <section class="card">
      <div class="card-title"><h3>{{ monthName }} so far</h3></div>
      <div class="stat-grid">
        <div><b>{{ p.count }}</b><span>appointments</span>
          <small v-if="p.prevSame || p.count" :class="p.change > 0 ? 'green' : p.change < 0 ? 'orange' : ''">{{ p.change > 0 ? '↑ ' + p.change : p.change < 0 ? '↓ ' + -p.change : 'same as' }} {{ p.change ? 'vs' : '' }} last month</small>
        </div>
        <div><b>{{ p.daysWorked }}</b><span>days worked</span><small v-if="p.busiest">busiest: {{ p.busiest }}</small></div>
        <div><b>{{ p.unpaid }}</b><span>still unpaid</span><small>{{ p.unpaid ? 'follow up 💌' : 'all paid ✓' }}</small></div>
        <div><b>{{ p.overtimeMinutes ? minutesLabel(p.overtimeMinutes) : '0 h' }}</b><span>overtime</span><small>this month</small></div>
      </div>
    </section>

    <section class="card">
      <div class="card-title"><h3>Your clients</h3><span class="hint">{{ monthName }}</span></div>
      <div class="stat-grid three">
        <div><b>{{ l.newClients }}</b><span>new</span></div>
        <div><b>{{ l.returning }}</b><span>2nd / 3rd visit</span></div>
        <div><b>{{ l.regulars }}</b><span>regulars</span></div>
      </div>
      <div class="stat-lines">
        <div v-if="l.lastMonthNew">💕 <b>{{ l.cameBack }}</b> of last month's {{ l.lastMonthNew }} new client{{ l.lastMonthNew === 1 ? '' : 's' }} came back</div>
        <div v-if="l.rebook.pct !== null">🔁 <b>{{ l.rebook.pct }}%</b> of last month's clients have been back ({{ l.rebook.back }} of {{ l.rebook.seen }})</div>
        <button v-if="due" class="link-btn" style="padding: 0" @click="setView('my-clients')">⏰ {{ plural(due, 'client') }} due for a fill →</button>
      </div>
    </section>

    <section v-if="s.top.length" class="card">
      <div class="card-title"><h3>Your services</h3><span class="hint">{{ monthName }}</span></div>
      <div class="hbars">
        <div v-for="x in s.top" :key="x.name" class="hbar">
          <div class="top-line"><span class="who">{{ x.name }}</span><span class="amount">{{ x.count }}×</span></div>
          <div class="track"><div class="fill" :style="{ width: (x.count / s.max) * 100 + '%', background: 'var(--series-1)' }" /></div>
        </div>
      </div>
      <p v-if="s.firsts.length" class="muted-note" style="margin: 12px 0 0 !important">✨ New for you this month: {{ s.firsts.join(', ') }}</p>
    </section>

    <section class="card">
      <div class="card-title"><h3>Milestones</h3></div>
      <div class="stat-lines">
        <div>🏆 <b>{{ plural(m.total, 'appointment') }}</b> with the salon<template v-if="m.next"> · {{ m.toGo.toLocaleString('en-ZA') }} to go to {{ m.next.toLocaleString('en-ZA') }}</template></div>
        <div v-if="m.best.count">🔥 Best week: <b>{{ m.best.count }}</b> appointments (week of {{ shortDate(m.best.start) }} {{ m.best.start.slice(0, 4) }}) · this week: {{ m.thisWeek }}</div>
        <div v-if="m.anniversary">🌸 With the salon for <b>{{ m.anniversary.years ? plural(m.anniversary.years, 'year') : '' }}{{ m.anniversary.years && m.anniversary.months ? ', ' : '' }}{{ m.anniversary.months || !m.anniversary.years ? plural(m.anniversary.months, 'month') : '' }}</b></div>
      </div>
    </section>
  </div>
</template>
