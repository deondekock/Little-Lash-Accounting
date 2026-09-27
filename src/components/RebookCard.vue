<script setup>
import { computed } from 'vue'
import Sparkline from './charts/Sparkline.vue'
import { all, state, visitDays, employeeColor } from '../store.js'
import { shortDate, monthLabel, todayStr } from '../lib/format.js'
import { recentRebooking, rebookTrend, REBOOK_DAYS } from '../lib/rebook.js'

/**
 * Rebooking rate for one team member (staff: "you") — the % of her clients who came back within
 * 6 weeks, to her, and of her new clients — with the month-by-month trend. No rands.
 */
const props = defineProps({ employeeId: { type: String, required: true }, you: { type: Boolean, default: false } })
const today = todayStr()
const r = computed(() => recentRebooking(all.value, visitDays.value, { employeeId: props.employeeId, today }))
const trend = computed(() => rebookTrend(all.value, visitDays.value, { employeeId: props.employeeId, today, startDay: state.monthStartDay }).filter((m) => m.rate != null))
const weeks = REBOOK_DAYS / 7
const her = computed(() => (props.you ? 'you' : 'her'))
</script>

<template>
  <section class="card rebook">
    <div class="card-title"><h3>Clients coming back</h3><span class="hint">within {{ weeks }} weeks</span></div>
    <template v-if="r.visits">
      <div class="rb-hero">
        <b>{{ r.rate }}%</b>
        <span>of {{ you ? 'your' : 'her' }} clients came back to the salon within {{ weeks }} weeks</span>
      </div>
      <div class="stat-grid">
        <div><b>{{ r.herRate }}%</b><span>came back to {{ her }}</span><small>{{ r.backToHer }} of {{ r.visits }} visits</small></div>
        <div><b>{{ r.newRate ?? '—' }}<template v-if="r.newRate != null">%</template></b><span>new clients came back</span><small>{{ r.newBack }} of {{ r.newVisits }} new</small></div>
      </div>
      <div v-if="trend.length > 2" class="rb-trend">
        <Sparkline :values="trend.map((m) => m.rate)" :color="employeeColor(employeeId)" :width="220" :height="40" :label="`Came back within ${weeks} weeks, month by month`" />
        <small>{{ monthLabel(trend[0].month).split(' ')[0] }} – {{ monthLabel(trend[trend.length - 1].month).split(' ')[0] }}: {{ Math.min(...trend.map((m) => m.rate)) }}–{{ Math.max(...trend.map((m) => m.rate)) }}%</small>
      </div>
      <p class="muted-note" style="margin: 10px 0 0 !important">Visits {{ shortDate(r.from) }} – {{ shortDate(r.to) }} (recent visits count once {{ weeks }} weeks have passed).</p>
    </template>
    <div v-else class="empty" style="padding: 14px">Not enough visits yet — check back in a few weeks.</div>
  </section>
</template>
