<script setup>
import { computed } from 'vue'
import BaseModal from './BaseModal.vue'
import Sparkline from './charts/Sparkline.vue'
import { closeModal, openAppointment, employeeById, employeeColor } from '../store.js'
import { fmt, fmt0, dayLabel, shortDate } from '../lib/format.js'

const props = defineProps({ client: { type: Object, required: true } })
const c = computed(() => props.client)
const avg = computed(() => c.value.spend / Math.max(1, c.value.history.length))
const since = computed(() => new Date(c.value.first).toLocaleDateString('en-ZA', { month: 'short', year: 'numeric' }))

// Spend per visit, oldest → newest (last 12 visits) for the little trend line.
const trend = computed(() => c.value.history.slice(0, 12).reverse().map((v) => v.amount))

function book() {
  const lastVisit = c.value.history[0]
  closeModal()
  openAppointment(null, { client: c.value.name, employeeId: c.value.staffId, service: lastVisit?.service || '', amount: lastVisit?.amount || '' })
}
</script>

<template>
  <BaseModal :title="c.name" @close="closeModal">
    <p style="margin: -10px 0 14px; color: var(--muted); font-size: 13.5px">
      Client since {{ since }}<template v-if="c.usualGap"> · usually every {{ c.usualGap }} days</template>
      <span v-if="c.due" class="badge due" style="margin-left: 6px">Due for a refill</span>
    </p>
    <div class="client-figs">
      <div><div class="l">Visits</div><div class="v">{{ c.visits }}</div></div>
      <div><div class="l">Spent</div><div class="v">{{ fmt0(c.spend) }}</div></div>
      <div><div class="l">Avg visit</div><div class="v">{{ fmt0(avg) }}</div></div>
    </div>
    <div v-if="trend.length > 2" style="margin-bottom: 14px">
      <div style="font-size: 12px; color: var(--muted); font-weight: 600; margin-bottom: 4px">Spend per visit (last {{ trend.length }})</div>
      <Sparkline :values="trend" :width="300" :height="40" :color="employeeColor(c.staffId)" label="Spend per visit" />
    </div>
    <div v-if="c.unpaid" class="delta down" style="margin-bottom: 12px">Owes {{ fmt(c.unpaid) }}</div>

    <div style="font-size: 12px; color: var(--muted); font-weight: 700; text-transform: uppercase; letter-spacing: .06em; margin-bottom: 4px">History</div>
    <div class="list">
      <button v-for="v in c.history.slice(0, 40)" :key="v.id" class="list-row" @click="closeModal(); openAppointment(v)">
        <i class="swatch-dot" :style="{ background: employeeColor(v.employeeId) }" />
        <div class="grow">
          <div class="title" style="font-weight: 600">{{ dayLabel(v.date) }} {{ v.date.slice(0, 4) }}</div>
          <div class="meta">{{ employeeById(v.employeeId)?.name || v.employeeName }}<template v-if="v.service"> · {{ v.service }}</template> · {{ v.method }}</div>
        </div>
        <div class="right">
          <div class="big">{{ fmt(v.amount) }}</div>
          <div class="meta" :class="v.status === 'Paid' ? 'green' : 'orange'">{{ v.status }}</div>
        </div>
      </button>
    </div>
    <p v-if="c.history.length > 40" style="text-align: center; color: var(--muted); font-size: 12.5px">+ {{ c.history.length - 40 }} older visits</p>

    <div class="modal-actions">
      <button class="btn ghost" @click="closeModal">Close</button>
      <button class="btn" @click="book">Add appointment</button>
    </div>
  </BaseModal>
</template>
