<script setup>
import { computed, reactive, ref } from 'vue'
import BaseModal from './BaseModal.vue'
import SegmentedControl from './SegmentedControl.vue'
import { recordPayment, liveVouchers, closeModal, toastUndo, fail } from '../store.js'
import { METHODS, fmt, fmt0, shortDate, todayStr } from '../lib/format.js'

/** Record money a client paid — one or more tenders (a split, incl. a voucher), on their unpaid visits. */
const props = defineProps({ client: { type: Object, required: true } })

const owingOf = (v) => (v.outstanding != null ? v.outstanding : (v.status === 'Unpaid' ? v.amount : 0))
const visits = computed(() => (props.client.history || []).filter((v) => owingOf(v) > 0.005).sort((a, b) => (a.date < b.date ? -1 : 1)))
const owed = computed(() => Math.round(visits.value.reduce((s, v) => s + owingOf(v), 0) * 100) / 100)

// Voucher can be a tender too, but only if there are vouchers with money left.
const vouchers = liveVouchers
const methodOptions = computed(() => (vouchers.value.length ? [...METHODS, 'Voucher'] : METHODS))

const date = ref(todayStr())
const lines = reactive([{ amount: '', method: 'Card', voucherId: '' }])
const total = computed(() => Math.round(lines.reduce((s, l) => s + (Number(l.amount) || 0), 0) * 100) / 100)
const over = computed(() => total.value > owed.value + 0.005)
const saving = ref(false)

const voucherById = (id) => vouchers.value.find((v) => v.id === id)
const addLine = () => lines.push({ amount: '', method: lines.some((l) => l.method === 'EFT') ? 'Card' : 'EFT', voucherId: '' })
const removeLine = (i) => { lines.splice(i, 1); if (!lines.length) lines.push({ amount: '', method: 'Card', voucherId: '' }) }
function fillFirst() { lines[0].amount = owed.value }

// Picking Voucher: default to the first voucher and fill in up to its balance or what's still owed.
function onMethod(l) {
  if (l.method === 'Voucher') {
    if (!l.voucherId) l.voucherId = vouchers.value[0]?.id || ''
    const v = voucherById(l.voucherId)
    const room = owed.value - (total.value - (Number(l.amount) || 0))
    if (v && !Number(l.amount)) l.amount = Math.max(0, Math.round(Math.min(v.balance, room) * 100) / 100)
  } else {
    l.voucherId = ''
  }
}

async function submit() {
  if (!total.value || over.value) return
  // A voucher tender can't draw more than the voucher's balance.
  for (const l of lines) {
    if (l.method === 'Voucher') {
      const v = voucherById(l.voucherId)
      if (!v) return fail(new Error('Pick a voucher.'))
      if ((Number(l.amount) || 0) > v.balance + 0.005) return fail(new Error(`That voucher only has ${fmt0(v.balance)} left.`))
    }
  }
  saving.value = true
  try {
    await recordPayment(props.client.key, { date: date.value, lines: lines.map((l) => ({ amount: l.amount, method: l.method, voucherId: l.voucherId })) })
    toastUndo(`Payment recorded · ${fmt0(total.value)}`)
    closeModal()
  } catch (err) {
    fail(err)
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <BaseModal :title="`Payment · ${client.name}`" @close="closeModal">
    <div class="delta down" style="margin: -6px 0 14px">Owes {{ fmt(owed) }} across {{ visits.length }} visit{{ visits.length === 1 ? '' : 's' }}</div>

    <div v-if="visits.length" class="list" style="margin-bottom: 16px">
      <div v-for="v in visits.slice(0, 8)" :key="v.id" class="list-row" style="cursor: default">
        <div class="grow">
          <div class="title" style="font-weight: 600">{{ shortDate(v.date) }} {{ v.date.slice(0, 4) }}</div>
          <div class="meta">{{ v.service || 'Appointment' }}<template v-if="v.paid"> · {{ fmt(v.paid) }} paid</template></div>
        </div>
        <div class="right"><div class="big orange">{{ fmt(owingOf(v)) }}</div><div class="meta">owing</div></div>
      </div>
      <p v-if="visits.length > 8" class="meta" style="text-align: center">+ {{ visits.length - 8 }} more</p>
    </div>

    <form autocomplete="off" @submit.prevent="submit">
      <div class="field">
        <label>How they paid <button type="button" class="link-btn" style="margin-left: 6px" @click="fillFirst">pay it all</button></label>
        <template v-for="(l, i) in lines" :key="i">
          <div class="pay-line">
            <input v-model="l.amount" type="number" inputmode="decimal" step="0.01" min="0" placeholder="0.00" aria-label="Amount">
            <SegmentedControl :model-value="l.method" :options="methodOptions" @update:model-value="(m) => { l.method = m; onMethod(l) }" />
            <button v-if="lines.length > 1" type="button" class="icon-btn" aria-label="Remove" @click="removeLine(i)">✕</button>
          </div>
          <select v-if="l.method === 'Voucher'" v-model="l.voucherId" class="voucher-pick" @change="onMethod(l)">
            <option v-for="v in vouchers" :key="v.id" :value="v.id">{{ v.code }} · {{ fmt(v.balance) }} left{{ v.buyer ? ` · ${v.buyer}` : '' }}</option>
          </select>
        </template>
        <button type="button" class="btn small ghost" style="margin-top: 8px" @click="addLine">+ Split into another method</button>
      </div>
      <div class="row2">
        <div class="field">
          <label for="pay-date">Date paid</label>
          <input id="pay-date" v-model="date" type="date" required>
        </div>
        <div class="field">
          <label>Total</label>
          <div class="pay-total" :class="{ orange: over }">{{ fmt(total) }}</div>
        </div>
      </div>
      <p v-if="over" class="field-hint orange">That's more than the {{ fmt0(owed) }} owing.</p>

      <div class="modal-actions">
        <button type="button" class="btn ghost" @click="closeModal">Cancel</button>
        <button type="submit" class="btn" :disabled="saving || !total || over">Record {{ total ? fmt0(total) : '' }}</button>
      </div>
    </form>
  </BaseModal>
</template>
