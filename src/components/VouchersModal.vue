<script setup>
import { computed, reactive, ref } from 'vue'
import BaseModal from './BaseModal.vue'
import SegmentedControl from './SegmentedControl.vue'
import { state, sellVoucher, voidVoucher, closeModal, toast, fail } from '../store.js'
import { METHODS, fmt, fmt0, shortDate, todayStr } from '../lib/format.js'

/** Sell gift vouchers (cash in now) and see which still have money on them. */
const form = reactive({ amount: '', buyer: '', method: 'Card', soldOn: todayStr(), note: '' })
const saving = ref(false)
const STATUS = { active: 'Active', redeemed: 'Used up', void: 'Void' }
const list = computed(() => [...state.vouchers].sort((a, b) => (a.soldOn < b.soldOn ? 1 : -1)))
const ok = computed(() => Number(form.amount) > 0)

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
</script>

<template>
  <BaseModal title="Gift vouchers" @close="closeModal">
    <form class="voucher-sell" autocomplete="off" @submit.prevent="sell">
      <div class="row2">
        <div class="field"><label for="v-amt">Amount (R)</label><input id="v-amt" v-model="form.amount" type="number" inputmode="decimal" step="0.01" min="0" placeholder="0.00"></div>
        <div class="field"><label for="v-date">Sold on</label><input id="v-date" v-model="form.soldOn" type="date"></div>
      </div>
      <div class="field"><label for="v-buyer">Bought by (optional)</label><input id="v-buyer" v-model="form.buyer" placeholder="Who paid for it"></div>
      <div class="field"><label>Paid with</label><SegmentedControl v-model="form.method" :options="METHODS" /></div>
      <div class="field"><label for="v-note">Note (optional)</label><input id="v-note" v-model="form.note" placeholder="e.g. birthday gift for Sarah"></div>
      <button class="btn wide" type="submit" :disabled="saving || !ok">Sell voucher {{ ok ? fmt0(Number(form.amount)) : '' }}</button>
    </form>

    <h4 class="section-label" style="margin-top: 18px">Vouchers</h4>
    <div v-if="list.length" class="list">
      <div v-for="v in list" :key="v.id" class="list-row" :class="{ faded: v.status !== 'active' }" style="cursor: default">
        <div class="grow">
          <div class="title" style="font-weight: 600">{{ v.code }} <span class="meta" style="font-weight: 400">· {{ STATUS[v.status] || v.status }}</span></div>
          <div class="meta">{{ shortDate(v.soldOn) }}<template v-if="v.buyer"> · {{ v.buyer }}</template><template v-if="v.note"> · {{ v.note }}</template></div>
        </div>
        <div class="right">
          <div class="big">{{ fmt(v.balance) }}<template v-if="v.balance !== v.amount"> <span class="meta">/ {{ fmt0(v.amount) }}</span></template></div>
          <button v-if="v.status === 'active'" class="link-btn" @click="remove(v)">Void</button>
        </div>
      </div>
    </div>
    <div v-else class="empty" style="padding: 16px">No vouchers yet. Sell one above 🎁</div>

    <div class="modal-actions"><button class="btn ghost" @click="closeModal">Close</button></div>
  </BaseModal>
</template>
