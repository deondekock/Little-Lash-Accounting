<script setup>
import { computed } from 'vue'
import { all, state, visitDays, employeeColor } from '../store.js'
import { shortDate, todayStr } from '../lib/format.js'
import { recentRebooking, REBOOK_DAYS } from '../lib/rebook.js'

/** Owner: the salon's rebooking rate and each team member's, side by side. */
const today = todayStr()
const salon = computed(() => recentRebooking(all.value, visitDays.value, { today }))
const team = computed(() =>
  state.employees
    .map((e) => ({ e, r: recentRebooking(all.value, visitDays.value, { employeeId: e.id, today }) }))
    .filter((x) => x.r.visits >= 5)
    .sort((a, b) => b.r.rate - a.r.rate),
)
const weeks = REBOOK_DAYS / 7
</script>

<template>
  <section class="card rebook">
    <div class="card-title"><h3>Clients coming back</h3><span class="hint">within {{ weeks }} weeks</span></div>
    <template v-if="salon.visits">
      <div class="rb-hero">
        <b>{{ salon.rate }}%</b>
        <span>of clients came back within {{ weeks }} weeks · new clients {{ salon.newRate ?? '—' }}{{ salon.newRate != null ? '%' : '' }}</span>
      </div>
      <div class="hbars">
        <div v-for="{ e, r } in team" :key="e.id" class="hbar">
          <div class="top-line">
            <span class="who"><i class="swatch-dot" :style="{ background: employeeColor(e.id) }" />{{ e.name }} <small>{{ r.visits }} visits</small></span>
            <span class="amount">{{ r.rate }}%</span>
          </div>
          <div class="track rb-track">
            <div class="fill" :style="{ width: r.herRate + '%', background: employeeColor(e.id) }" />
            <div class="fill rb-other" :style="{ width: r.rate - r.herRate + '%', '--c': employeeColor(e.id) }" />
          </div>
          <div class="sub">{{ r.herRate }}% came back to her · {{ r.rate - r.herRate }}% to someone else · new clients {{ r.newRate ?? '—' }}{{ r.newRate != null ? `% (${r.newBack} of ${r.newVisits})` : '' }}</div>
        </div>
      </div>
      <p class="muted-note" style="margin: 12px 0 0 !important">Visits {{ shortDate(salon.from) }} – {{ shortDate(salon.to) }}. Solid: back to the same person; lighter: back to someone else.</p>
    </template>
    <div v-else class="empty" style="padding: 14px">Not enough visits yet.</div>
  </section>
</template>
