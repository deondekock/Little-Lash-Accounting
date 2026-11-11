<script setup>
import { computed, reactive, ref, watch } from 'vue'
import BaseModal from './BaseModal.vue'
import SegmentedControl from './SegmentedControl.vue'
import { state, sellVoucher, voidVoucher, deleteVoucher, extendVoucher, closeModal, toast, toastUndo, fail } from '../store.js'
import { METHODS, fmt, fmt0, shortDate, todayStr } from '../lib/format.js'
import { defaultExpiry, voucherExpired } from '../lib/vouchers.js'

/** Sell gift vouchers (cash in now), see which still have money on them, and extend an expiry. */
const today = todayStr()
const form = reactive({ amount: '', buyer: '', method: 'Card', soldOn: today, note: '', expiresOn: defaultExpiry(today) })
const expiryTouched = ref(false)
// The expiry follows "Sold on" (one year later) until she picks her own date.
watch(() => form.soldOn, (d) => { if (!expiryTouched.value && d) form.expiresOn = defaultExpiry(d) })
const saving = ref(false)
const extending = ref(null) // { id, expiresOn } while a date is being picked
const STATUS = { active: 'Active', redeemed: 'Used up', void: 'Void' }
const list = computed(() => [...state.vouchers].sort((a, b) => (a.soldOn < b.soldOn ? 1 : -1)))
const ok = computed(() => Number(form.amount) > 0)
const expired = (v) => v.status === 'active' && voucherExpired(v, today)
const label = (v) => (expired(v) ? 'Expired' : STATUS[v.status] || v.status)
const long = (d) => (d ? new Date(d + 'T12:00:00').toLocaleDateString('en-ZA', { day: 'numeric', month: 'short', year: 'numeric' }) : '')

async function sell() {
  if (!ok.value) return
  saving.value = true
  try {
    await sellVoucher({ ...form })
    toast('Voucher sold 🎁')
    form.amount = ''; form.buyer = ''; form.note = ''
  } catch (err) {
    fail(err)
  } finally {
    saving.value = false
  }
}
async function remove(v) {
  if (!confirm(`Void voucher ${v.code}? It can't be used after this.`)) return
  try {
    await voidVoucher(v.id)
  } catch (err) {
    fail(err)
  }
}
const admin = computed(() => state.role === 'admin')
async function destroy(v) {
  if (!confirm(`Delete voucher ${v.code} (${fmt0(v.amount)}) completely? It disappears from the list and the books — void it instead if it was sold and refunded.`)) return
  try {
    await deleteVoucher(v.id)
    toastUndo('Voucher deleted')
  } catch (err) {
    fail(err)
  }
}
function startExtend(v) {
  const base = v.expiresOn && v.expiresOn > today ? v.expiresOn : today
  extending.value = { id: v.id, code: v.code, expiresOn: defaultExpiry(base) }
}
async function confirmExtend() {
  const { id, expiresOn } = extending.value
  try {
    await extendVoucher(id, expiresOn)
    toast('Expiry changed')
    extending.value = null
  } catch (err) {
    fail(err)
  }
}
</script>

<template>
  <BaseModal title="Gift vouchers" @close="closeModal">
    <form class="voucher-sell" autocomplete="off" @submit.prevent="sell">
      <div class="row2">
        <div class="field"><label for="v-amt">Amount (R)</label><input id="v-amt" v-model="form.amount" type="number" inputmode="decimal" step="0.01" min="0" placeholder="0.00"></div>
        <div class="field"><label for="v-date">Sold on</label><input id="v-date" v-model="form.soldOn" type="date" :max="today"></div>
      </div>
      <div class="row2">
        <div class="field"><label for="v-exp">Expires on</label><input id="v-exp" v-model="form.expiresOn" type="date" :min="form.soldOn" @input="expiryTouched = true"></div>
        <div class="field"><label for="v-buyer">Bought by (optional)</label><input id="v-buyer" v-model="form.buyer" placeholder="Who paid for it"></div>
      </div>
      <p class="field-hint" style="margin-top: -6px">Vouchers are good for a year unless you choose another date.</p>
      <div class="field"><label>Paid with</label><SegmentedControl v-model="form.method" :options="METHODS" /></div>
      <div class="field"><label for="v-note">Note (optional)</label><input id="v-note" v-model="form.note" placeholder="e.g. birthday gift for Sarah"></div>
      <button class="btn wide" type="submit" :disabled="saving || !ok">Sell voucher {{ ok ? fmt0(Number(form.amount)) : '' }}</button>
    </form>

    <h4 class="section-label" style="margin-top: 18px">Vouchers</h4>
    <div v-if="list.length" class="list">
      <div v-for="v in list" :key="v.id" class="voucher-row" :class="{ faded: v.status !== 'active' }">
        <div class="list-row" style="cursor: default; padding-left: 0; padding-right: 0">
          <div class="grow">
            <div class="title" style="font-weight: 600">
              {{ v.code }} <span class="meta" style="font-weight: 400">· {{ label(v) }}</span>
              <span v-if="v.expiryNote" class="badge quiet" title="The expiry date was changed">✎ expiry changed</span>
            </div>
            <div class="meta">
              {{ shortDate(v.soldOn) }}<template v-if="v.buyer"> · {{ v.buyer }}</template><template v-if="v.note"> · {{ v.note }}</template>
              <template v-if="v.expiresOn"> · <span :class="{ orange: expired(v) }">{{ expired(v) ? 'expired' : 'expires' }} {{ long(v.expiresOn) }}</span></template>
            </div>
            <div v-for="(n, i) in (v.expiryNote || '').split('\n').filter(Boolean)" :key="i" class="meta orange">✎ {{ n }}</div>
          </div>
          <div class="right">
            <div class="big">{{ fmt(v.balance) }}<template v-if="v.balance !== v.amount"> <span class="meta">/ {{ fmt0(v.amount) }}</span></template></div>
            <div style="display: flex; gap: 10px; justify-content: flex-end">
              <template v-if="v.status === 'active'">
                <button class="link-btn" @click="startExtend(v)">{{ expired(v) ? 'Extend' : 'Change expiry' }}</button>
                <button class="link-btn" @click="remove(v)">Void</button>
              </template>
              <button v-if="admin" class="link-btn danger-link" @click="destroy(v)">Delete</button>
            </div>
          </div>
        </div>
        <div v-if="extending?.id === v.id" class="voucher-extend">
          <label :for="'v-ext-' + v.id">New expiry for {{ v.code }}</label>
          <input :id="'v-ext-' + v.id" v-model="extending.expiresOn" type="date" :min="today">
          <button class="btn small" type="button" @click="confirmExtend">Save</button>
          <button class="btn small ghost" type="button" @click="extending = null">Cancel</button>
        </div>
      </div>
    </div>
    <div v-else class="empty" style="padding: 16px">No vouchers yet. Sell one above 🎁</div>

    <div class="modal-actions"><button class="btn ghost" @click="closeModal">Close</button></div>
  </BaseModal>
</template>
