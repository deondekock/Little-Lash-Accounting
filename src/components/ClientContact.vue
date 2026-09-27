<script setup>
import { computed, nextTick, ref } from 'vue'
import { phoneOf, saveClientPhone, senderName, toast, fail } from '../store.js'
import { MESSAGES, openWhatsApp } from '../lib/whatsapp.js'
import { fmt0 } from '../lib/format.js'
import { ordinal } from '../lib/stats.js'

/**
 * A client's cell number (tap to add or change) and WhatsApp buttons with ready-written messages:
 * payment reminder (owner only — `owed`), refill reminder, "we miss you", or just a hello.
 */
const props = defineProps({ client: { type: Object, required: true }, owed: { type: Boolean, default: false } })
const c = computed(() => props.client)
const phone = computed(() => phoneOf(c.value))
const editing = ref(false)
const draft = ref('')
const input = ref(null)
const saving = ref(false)

async function edit() {
  draft.value = phone.value
  editing.value = true
  await nextTick()
  input.value?.focus()
}
async function save() {
  saving.value = true
  try {
    await saveClientPhone(c.value.name, draft.value)
    editing.value = false
    toast(draft.value.trim() ? 'Cell number saved' : 'Cell number removed')
  } catch (err) {
    fail(err)
  } finally {
    saving.value = false
  }
}

const buttons = computed(() => [
  props.owed && c.value.unpaid > 0 && { kind: 'owed', label: `Remind about ${fmt0(c.value.unpaid)}` },
  c.value.due && { kind: 'refill', label: 'Refill reminder' },
  c.value.quiet && { kind: 'quiet', label: 'We miss you' },
  { kind: 'hello', label: 'WhatsApp' },
].filter(Boolean))
const send = (kind) => openWhatsApp(phone.value, MESSAGES[kind](c.value, senderName.value))
</script>

<template>
  <div class="contact">
    <p v-if="c.milestone" class="milestone-note">🎉 Her next visit will be her <b>{{ ordinal(c.milestone) }}</b> — maybe plan a little treat.</p>
    <div v-if="!editing" class="contact-phone">
      <span aria-hidden="true">📱</span>
      <a v-if="phone" :href="`tel:${phone.replace(/\s/g, '')}`">{{ phone }}</a>
      <span v-else class="muted">No cell number yet</span>
      <button type="button" class="link-btn" @click="edit">{{ phone ? 'Change' : 'Add cell number' }}</button>
    </div>
    <form v-else class="contact-edit" @submit.prevent="save">
      <input ref="input" v-model="draft" type="tel" inputmode="tel" autocomplete="off" placeholder="082 123 4567" aria-label="Cell number">
      <button class="btn small" :disabled="saving">Save</button>
      <button type="button" class="btn small ghost" @click="editing = false">Cancel</button>
    </form>
    <div class="wa-row">
      <button v-for="b in buttons" :key="b.kind" type="button" class="btn small wa" @click="send(b.kind)">
        <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M12 2a10 10 0 0 0-8.6 15.1L2 22l5-1.3A10 10 0 1 0 12 2zm0 18.2a8.2 8.2 0 0 1-4.2-1.2l-.3-.2-3 .8.8-2.9-.2-.3A8.2 8.2 0 1 1 12 20.2z"/></svg>
        {{ b.label }}
      </button>
    </div>
    <p v-if="!phone" class="muted-note" style="margin: 6px 0 0 !important">Without a number, WhatsApp asks who to send it to.</p>
  </div>
</template>
