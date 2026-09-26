<script setup>
import { computed, reactive, ref, watch } from 'vue'
import { state, updateMyDetails, toast, fail } from '../../store.js'

/** Staff: her details. She can change her phone number and address; the rest is shown for checking. */
const me = computed(() => state.employees[0])
const pay = computed(() => me.value?.pay || {})
const form = reactive({ phone: '', address: '' })
watch(me, (e) => Object.assign(form, { phone: e?.phone || '', address: e?.pay?.address || '' }), { immediate: true })
const changed = computed(() => form.phone.trim() !== (me.value?.phone || '') || form.address.trim() !== (pay.value.address || ''))
const saving = ref(false)
const masked = (v) => (v ? '•••• ' + String(v).slice(-4) : '—')
const date = (d) => (d ? new Date(d + 'T12:00').toLocaleDateString('en-ZA', { day: 'numeric', month: 'long', year: 'numeric' }) : '—')

async function save() {
  saving.value = true
  try {
    await updateMyDetails({ phone: form.phone, address: form.address })
    toast('Saved')
  } catch (err) {
    fail(err)
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <div class="page">
    <div class="greeting"><div class="hello">Your <em>details</em></div><div class="sub">{{ state.email }}</div></div>
    <form class="card" autocomplete="off" @submit.prevent="save">
      <div class="field">
        <label for="d-phone">Phone number</label>
        <input id="d-phone" v-model="form.phone" type="tel" maxlength="40">
      </div>
      <div class="field">
        <label for="d-addr">Address</label>
        <textarea id="d-addr" v-model="form.address" rows="4" maxlength="300" placeholder="Street&#10;Suburb&#10;City&#10;Postal code" />
      </div>
      <button type="submit" class="btn wide" :disabled="saving || !changed">{{ saving ? 'Saving…' : 'Save' }}</button>
    </form>

    <section class="card" style="margin-top: 14px">
      <div class="card-title"><h3>On your payslip</h3></div>
      <dl class="details-list">
        <dt>Name</dt><dd>{{ pay.fullName || me?.name }}</dd>
        <dt>Employee number</dt><dd>{{ pay.code || '—' }}</dd>
        <dt>ID number</dt><dd>{{ masked(pay.idNumber) }}</dd>
        <dt>Tax number</dt><dd>{{ pay.taxNumber || '—' }}</dd>
        <dt>Started</dt><dd>{{ date(pay.engaged) }}</dd>
        <dt>Bank</dt><dd>{{ [pay.bankName, pay.accountType].filter(Boolean).join(' · ') || '—' }}</dd>
        <dt>Account</dt><dd>{{ masked(pay.accountNumber) }}</dd>
      </dl>
      <p class="muted-note">Something wrong here, or new bank details? Please ask the salon owner to change it.</p>
    </section>
  </div>
</template>
