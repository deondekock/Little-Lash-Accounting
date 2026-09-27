<script setup>
import { reactive, ref } from 'vue'
import BaseModal from './BaseModal.vue'
import { state, closeModal, refreshPin, toast, fail } from '../store.js'
import { cloudflare as api } from '../api.js'
import { LOCK_CHOICES, lockAfter, setLockAfter, rememberPinSet, markSeen } from '../lib/lock.js'

/** Owner: her passcode (sign-in on new phones + app lock), and signing out other phones and computers. */
const form = reactive({ current: '', pin: '', again: '', signOutOthers: true })
const after = ref(lockAfter())
const busy = ref('')
const digits = (v) => String(v || '').replace(/\D/g, '')

async function save() {
  if (!/^\d{4,8}$/.test(form.pin)) return toast('Use 4 to 8 digits.', true)
  if (form.pin !== form.again) return toast("The two passcodes don't match.", true)
  busy.value = 'save'
  try {
    await api.setPin(form.pin, form.current, !state.pinSet && form.signOutOthers)
    const first = !state.pinSet
    rememberPinSet(true)
    markSeen()
    await refreshPin()
    Object.assign(form, { current: '', pin: '', again: '' })
    toast(first ? (form.signOutOthers ? 'Passcode set — other phones and computers are signed out' : 'Passcode set') : 'Passcode changed')
  } catch (err) {
    fail(err)
  } finally {
    busy.value = ''
  }
}
async function remove() {
  if (!form.current) return toast('Enter your current passcode first.', true)
  if (!confirm('Remove your passcode? The app will no longer lock or ask for it on new phones.')) return
  busy.value = 'remove'
  try {
    await api.removePin(form.current)
    rememberPinSet(false)
    await refreshPin()
    form.current = ''
    toast('Passcode removed')
  } catch (err) {
    fail(err)
  } finally {
    busy.value = ''
  }
}
async function signOutEverywhere() {
  if (!confirm('Sign out on every other phone and computer? You stay signed in here.')) return
  busy.value = 'others'
  try {
    await api.signOutOthers()
    toast('Signed out everywhere else')
  } catch (err) {
    fail(err)
  } finally {
    busy.value = ''
  }
}
function pickAfter(m) {
  after.value = m
  setLockAfter(m)
  markSeen()
}
</script>

<template>
  <BaseModal title="Passcode & security" @close="closeModal">
    <p class="muted-note" style="margin-top: -6px !important">
      Signing in needs your Google password, so knowing your email isn't enough. A passcode adds a second lock:
      it's needed on every new phone or computer, and the app asks for it again when you've been away.
    </p>

    <div class="sec-status" :class="{ on: state.pinSet }">{{ state.pinSet ? '🔒 Your passcode is on' : '🔓 No passcode yet' }}</div>

    <form autocomplete="off" @submit.prevent="save">
      <h4 class="section-label">{{ state.pinSet ? 'Change passcode' : 'Set a passcode' }}</h4>
      <div v-if="state.pinSet" class="field">
        <label for="s-cur">Current passcode</label>
        <input id="s-cur" v-model="form.current" type="password" inputmode="numeric" maxlength="8" autocomplete="current-password" @input="form.current = digits(form.current)">
      </div>
      <div class="row2">
        <div class="field">
          <label for="s-new">New passcode</label>
          <input id="s-new" v-model="form.pin" type="password" inputmode="numeric" maxlength="8" placeholder="4–8 digits" autocomplete="new-password" @input="form.pin = digits(form.pin)">
        </div>
        <div class="field">
          <label for="s-again">Again</label>
          <input id="s-again" v-model="form.again" type="password" inputmode="numeric" maxlength="8" autocomplete="new-password" @input="form.again = digits(form.again)">
        </div>
      </div>
      <label v-if="!state.pinSet" class="calc-check" style="margin: -4px 0 12px"><input v-model="form.signOutOthers" type="checkbox"> Also sign out every other phone and computer</label>
      <button class="btn wide" :disabled="busy === 'save' || form.pin.length < 4">{{ state.pinSet ? 'Change passcode' : 'Set passcode' }}</button>
    </form>

    <template v-if="state.pinSet">
      <h4 class="section-label">Lock the app on this phone</h4>
      <div class="radio-list">
        <label v-for="[m, label] in LOCK_CHOICES" :key="m"><input type="radio" name="lock-after" :checked="after === m" @change="pickAfter(m)"> {{ label }}</label>
      </div>
    </template>

    <h4 class="section-label">Other phones and computers</h4>
    <p class="muted-note" style="margin-top: 0 !important">Signed in somewhere you shouldn't be (e.g. the salon's tablet)? This signs you out everywhere except here.</p>
    <button class="btn ghost wide" :disabled="busy === 'others'" @click="signOutEverywhere">Sign out everywhere else</button>

    <template v-if="state.pinSet">
      <h4 class="section-label">Remove passcode</h4>
      <p class="muted-note" style="margin-top: 0 !important">Type your current passcode above, then:</p>
      <button class="btn danger" :disabled="busy === 'remove'" @click="remove">Remove passcode</button>
    </template>
  </BaseModal>
</template>
