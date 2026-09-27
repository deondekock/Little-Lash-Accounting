<script setup>
import { nextTick, onMounted, ref } from 'vue'
import { state, signInWithPin, unlock, signOut } from '../store.js'

/**
 * The owner's passcode: to sign in on a new phone (mode "signin"), or to open the app again after
 * she's been away (mode "lock", covering everything).
 */
const props = defineProps({ mode: { type: String, default: 'lock' } })
const pin = ref('')
const error = ref('')
const busy = ref(false)
const input = ref(null)
const logo = import.meta.env.BASE_URL + 'brand/logo.png'
onMounted(() => nextTick(() => input.value?.focus()))

async function submit() {
  if (!/^\d{4,8}$/.test(pin.value)) {
    error.value = 'Your passcode is 4 to 8 digits.'
    return
  }
  busy.value = true
  error.value = ''
  try {
    if (props.mode === 'signin') await signInWithPin(pin.value)
    else await unlock(pin.value)
  } catch (err) {
    error.value = String(err?.message || err)
    pin.value = ''
    input.value?.focus()
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <div class="pin-screen" :class="mode" role="dialog" aria-modal="true" aria-label="Enter your passcode">
    <form class="pin-card" @submit.prevent="submit">
      <img :src="logo" alt="Little Lash Lounge" width="240" height="69">
      <h2>{{ mode === 'signin' ? 'One more step' : 'Welcome back' }}</h2>
      <p>{{ mode === 'signin' ? 'Enter your passcode to use the app on this phone.' : 'Enter your passcode to open the app.' }}</p>
      <input
        ref="input" v-model="pin" class="pin-input" type="password" inputmode="numeric" pattern="[0-9]*" autocomplete="current-password"
        maxlength="8" placeholder="••••" aria-label="Passcode" @input="pin = pin.replace(/\D/g, ''); error = ''"
      >
      <p v-if="error" class="pin-error" role="alert">{{ error }}</p>
      <button class="btn wide" :disabled="busy || pin.length < 4">{{ busy ? 'Checking…' : 'Open' }}</button>
      <button type="button" class="link-btn pin-out" @click="signOut">Not you? Sign out</button>
      <p class="pin-help">Forgot it? Deon can reset it for you.</p>
    </form>
  </div>
</template>
