<script setup>
import { computed, onMounted, reactive, ref } from 'vue'
import BaseModal from './BaseModal.vue'
import { state, closeModal, saveBookingSettings, setView, toast, fail } from '../store.js'
import { cloudflare } from '../api.js'

/** Owner: online booking on/off, the link for clients, and the booking rules. */
const form = reactive({ online: false, daysAhead: 60, noticeHours: 2, step: 15, cancelHours: 24, phone: '', message: '', ...state.booking })
const saving = ref(false)
const emailReady = ref(null)
const link = `${location.origin}${import.meta.env.BASE_URL}book/`
onMounted(async () => {
  try {
    emailReady.value = (await cloudflare.getNotify()).emailReady
  } catch {
    emailReady.value = null
  }
})
const onlineServices = computed(() => state.services.filter((s) => s.active && s.online))
const noLength = computed(() => onlineServices.value.filter((s) => !s.minutes).map((s) => s.name))
const noStaff = computed(() => onlineServices.value.filter((s) => !s.staff?.length).map((s) => s.name))
const checks = computed(() => [
  { ok: onlineServices.value.length > 0, text: onlineServices.value.length ? `${onlineServices.value.length} services can be booked online` : 'No services can be booked online yet', fix: () => { closeModal(); setView('services') } },
  { ok: !noLength.value.length, text: noLength.value.length ? `No usual length: ${noLength.value.slice(0, 3).join(', ')}${noLength.value.length > 3 ? '…' : ''}` : 'Every online service has a length', fix: () => { closeModal(); setView('services') } },
  { ok: !noStaff.value.length, text: noStaff.value.length ? `Nobody does: ${noStaff.value.slice(0, 3).join(', ')}${noStaff.value.length > 3 ? '…' : ''}` : 'Every online service has someone who does it', fix: () => { closeModal(); setView('services') } },
  { ok: state.employees.filter((e) => e.active).every((e) => e.schedule), text: 'Working hours set for everyone (Team → Edit → Working hours)', fix: () => { closeModal(); setView('team') } },
  { ok: emailReady.value !== false, text: emailReady.value === false ? 'Email sender not set up — clients sign in with an emailed code' : 'Email sender set up (for sign-in codes)', fix: null },
])

async function copy() {
  try {
    await navigator.clipboard.writeText(link)
    toast('Link copied')
  } catch {
    toast(link)
  }
}
async function share() {
  try {
    await navigator.share({ title: 'Book at Little Lash Lounge', text: 'Book your next appointment here:', url: link })
  } catch {
    copy()
  }
}
async function save() {
  saving.value = true
  try {
    await saveBookingSettings({ ...form })
    toast(form.online ? 'Online booking is on ✨' : 'Saved')
    closeModal()
  } catch (err) {
    fail(err)
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <BaseModal title="Online booking" @close="closeModal">
    <div class="toggle-row" style="padding-top: 0">
      <div class="grow"><div class="title">Clients can book online</div><div class="meta">{{ form.online ? 'The booking page is open' : 'The booking page says bookings are closed' }}</div></div>
      <button type="button" class="switch" role="switch" :aria-checked="form.online" @click="form.online = !form.online"><span /></button>
    </div>

    <div class="field" style="margin-top: 12px">
      <label>Booking page for clients</label>
      <div class="link-box"><span>{{ link }}</span></div>
      <div style="display: flex; gap: 8px; margin-top: 8px">
        <button type="button" class="btn small soft" @click="copy">Copy link</button>
        <button type="button" class="btn small soft" @click="share">Share…</button>
        <a class="btn small ghost" :href="link" target="_blank" rel="noopener">Open</a>
      </div>
      <div class="field-hint">Put it in your Instagram bio, WhatsApp status and Google profile.</div>
    </div>

    <h4 class="section-label">Before you switch it on</h4>
    <ul class="checklist">
      <li v-for="c in checks" :key="c.text" :class="{ ok: c.ok }">
        <span>{{ c.ok ? '✅' : '⚠️' }}</span><span class="grow">{{ c.text }}</span>
        <button v-if="!c.ok && c.fix" type="button" class="link-btn" @click="c.fix()">Fix</button>
      </li>
    </ul>

    <h4 class="section-label">Rules</h4>
    <div class="row2">
      <div class="field">
        <label for="bk-ahead">Book up to</label>
        <select id="bk-ahead" v-model.number="form.daysAhead">
          <option v-for="d in [14, 30, 60, 90, 180]" :key="d" :value="d">{{ d }} days ahead</option>
        </select>
      </div>
      <div class="field">
        <label for="bk-notice">At least</label>
        <select id="bk-notice" v-model.number="form.noticeHours">
          <option v-for="h in [0, 1, 2, 4, 12, 24, 48]" :key="h" :value="h">{{ h ? `${h} h before` : 'Any time' }}</option>
        </select>
      </div>
    </div>
    <div class="row2">
      <div class="field">
        <label for="bk-cancel">Clients can cancel</label>
        <select id="bk-cancel" v-model.number="form.cancelHours">
          <option v-for="h in [2, 6, 12, 24, 48]" :key="h" :value="h">up to {{ h }} h before</option>
        </select>
      </div>
      <div class="field">
        <label for="bk-step">Times every</label>
        <select id="bk-step" v-model.number="form.step">
          <option v-for="m in [15, 30, 60]" :key="m" :value="m">{{ m }} minutes</option>
        </select>
      </div>
    </div>
    <div class="field">
      <label for="bk-phone">Salon phone / WhatsApp (shown to clients)</label>
      <input id="bk-phone" v-model="form.phone" type="tel" placeholder="e.g. 082 123 4567">
    </div>
    <div class="field">
      <label for="bk-msg">Message on the booking page (optional)</label>
      <input id="bk-msg" v-model="form.message" maxlength="200" placeholder="e.g. Please arrive 5 minutes early 💕">
    </div>
    <div class="modal-actions">
      <button type="button" class="btn ghost" @click="closeModal">Cancel</button>
      <button type="button" class="btn" :disabled="saving" @click="save">Save</button>
    </div>
  </BaseModal>
</template>
