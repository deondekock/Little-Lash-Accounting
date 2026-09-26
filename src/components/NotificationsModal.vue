<script setup>
import { computed, onMounted, ref } from 'vue'
import BaseModal from './BaseModal.vue'
import { state, closeModal, toast, fail } from '../store.js'
import { cloudflare as api } from '../api.js'
import { pushSupported, isIos, isInstalled, currentSubscription, subscribePush, unsubscribePush } from '../lib/push.js'

/** Her notification settings: push on this phone, email, and (owner) the Gmail sender. */
const info = ref(null) // { emailOn, emailReady, vapidKey }
const pushOn = ref(false)
const busy = ref('')
const relay = ref(null) // owner: { url, script }
const relayUrl = ref('')
const showScript = ref(false)
const owner = computed(() => state.role !== 'staff')

const pushNote = computed(() => {
  if (pushSupported()) return ''
  if (isIos() && !isInstalled()) return 'On iPhone, add the app to your Home Screen first (Share → Add to Home Screen), then open it from there.'
  return 'This browser can\'t show notifications. Try Chrome on Android, or the app from the Home Screen on iPhone.'
})

onMounted(async () => {
  try {
    info.value = await api.getNotify()
    pushOn.value = !!(await currentSubscription().catch(() => null))
    if (owner.value) {
      relay.value = await api.getEmailRelay()
      relayUrl.value = relay.value.url
    }
  } catch (err) {
    fail(err)
  }
})

async function togglePush() {
  busy.value = 'push'
  try {
    if (pushOn.value) {
      const endpoint = await unsubscribePush()
      if (endpoint) await api.removePushSubscription(endpoint)
      pushOn.value = false
      toast('Notifications off on this phone')
    } else {
      await api.addPushSubscription(await subscribePush(info.value.vapidKey))
      pushOn.value = true
      toast('Notifications on for this phone')
    }
  } catch (err) {
    fail(err)
  } finally {
    busy.value = ''
  }
}

async function toggleEmail() {
  busy.value = 'email'
  try {
    const on = !info.value.emailOn
    await api.setEmailNotify(on)
    info.value.emailOn = on
    toast(on ? 'Emails on' : 'Emails off')
  } catch (err) {
    fail(err)
  } finally {
    busy.value = ''
  }
}

async function test() {
  busy.value = 'test'
  try {
    const { results } = await api.testNotify()
    const sent = results.filter((r) => r.result === 'sent').map((r) => (r.via === 'push' ? 'this phone' : 'email'))
    const failed = results.filter((r) => r.result === 'failed')
    if (failed.length) toast(`Couldn't send by ${failed.map((r) => r.via).join(' and ')}: ${failed[0].error}`, true)
    else toast(sent.length ? `Test sent (${[...new Set(sent)].join(' and ')}) ✨` : 'Nothing to send to: turn on a notification first.')
  } catch (err) {
    fail(err)
  } finally {
    busy.value = ''
  }
}

async function copyScript() {
  try {
    await navigator.clipboard.writeText(relay.value.script)
    toast('Script copied')
  } catch {
    showScript.value = true
  }
}

async function saveRelay() {
  busy.value = 'relay'
  try {
    await api.setEmailRelay(relayUrl.value)
    relay.value.url = relayUrl.value.trim()
    info.value.emailReady = !!relayUrl.value.trim()
    toast(relayUrl.value.trim() ? 'Email sender saved — tap "Send a test"' : 'Email sender removed')
  } catch (err) {
    fail(err)
  } finally {
    busy.value = ''
  }
}
</script>

<template>
  <BaseModal title="Notifications" @close="closeModal">
    <div v-if="!info" class="muted-note" style="margin-top: -6px">Loading…</div>
    <template v-else>
      <p class="muted-note" style="margin-top: -6px">
        <template v-if="owner">You'll hear when someone asks for, changes or withdraws leave, or changes her details.</template>
        <template v-else>You'll hear when your leave is approved or declined, and when a new payslip is ready.</template>
      </p>

      <div class="toggle-row">
        <div class="grow">
          <div class="title">Notifications on this phone</div>
          <div class="meta">{{ pushNote || 'Pop-up notifications, like WhatsApp. Turn on for each phone.' }}</div>
        </div>
        <button type="button" class="switch" role="switch" :aria-checked="pushOn" :disabled="!!pushNote || busy === 'push'" @click="togglePush"><span /></button>
      </div>

      <div class="toggle-row">
        <div class="grow">
          <div class="title">Email me</div>
          <div class="meta">{{ info.emailReady ? `To ${state.email}` : owner ? 'Set up the email sender below first.' : 'The salon hasn\'t set up email yet.' }}</div>
        </div>
        <button type="button" class="switch" role="switch" :aria-checked="info.emailOn && info.emailReady" :disabled="!info.emailReady || busy === 'email'" @click="toggleEmail"><span /></button>
      </div>

      <button type="button" class="btn soft wide" style="margin-top: 12px" :disabled="busy === 'test'" @click="test">{{ busy === 'test' ? 'Sending…' : 'Send a test' }}</button>

      <template v-if="owner && relay">
        <h4 class="section-label">Email sender (your Gmail)</h4>
        <p class="muted-note" style="margin-top: 0">Emails are sent from your Google account by a tiny script, free (up to 100 a day). One-time setup:</p>
        <ol class="setup-steps">
          <li><button type="button" class="link-btn" @click="copyScript">Copy the script</button><template v-if="showScript"> (select it below and copy)</template></li>
          <li>Open <a href="https://script.google.com/create" target="_blank" rel="noopener">script.google.com/create</a> (signed in to your Gmail), delete what's there, paste, and tap 💾 Save.</li>
          <li><b>Deploy → New deployment</b> → ⚙️ <b>Web app</b>. Execute as: <b>Me</b>. Who has access: <b>Anyone</b>. Tap <b>Deploy</b> and allow access (Advanced → Go to… if Google warns — it's your own script).</li>
          <li>Copy the <b>Web app URL</b> (ends in <code>/exec</code>), paste it here and Save:</li>
        </ol>
        <textarea v-if="showScript" class="script-box" readonly rows="8" :value="relay.script" @focus="$event.target.select()" />
        <div class="field" style="margin-top: 8px">
          <input v-model="relayUrl" placeholder="https://script.google.com/macros/s/…/exec" aria-label="Web app URL">
        </div>
        <button type="button" class="btn wide" :disabled="busy === 'relay' || relayUrl.trim() === relay.url" @click="saveRelay">Save email sender</button>
      </template>
    </template>
  </BaseModal>
</template>
