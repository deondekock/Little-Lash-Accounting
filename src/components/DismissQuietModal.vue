<script setup>
import { ref } from 'vue'
import BaseModal from './BaseModal.vue'
import { dismissQuiet, closeModal, toast, fail } from '../store.js'

/** Take a client off the "gone quiet" win-back list (with a reason), or put them back. */
const props = defineProps({ client: { type: Object, required: true } })
const note = ref(props.client.quietNote || '')
const saving = ref(false)
const REASONS = ['Moved away', 'Passed away', 'Went elsewhere', 'One-off visitor']

async function apply(value) {
  saving.value = true
  try {
    await dismissQuiet(props.client, value)
    toast(value == null ? `${props.client.name} back on the win-back list` : `${props.client.name} removed from win-back`)
    closeModal()
  } catch (err) {
    fail(err)
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <BaseModal :title="`Dismiss ${client.name}?`" @close="closeModal">
    <p class="muted-note" style="margin-top: -6px !important">
      Take this client off the “gone quiet” list — for the ones who left for a known reason, so the list
      keeps just the clients worth a win-back message.
    </p>
    <div class="chips inline" style="margin-bottom: 12px">
      <button v-for="r in REASONS" :key="r" type="button" class="chip small" :class="{ active: note === r }" @click="note = r">{{ r }}</button>
    </div>
    <div class="field">
      <label for="dq-note">Reason (optional)</label>
      <input id="dq-note" v-model="note" maxlength="200" placeholder="e.g. moved to Cape Town">
    </div>
    <div class="modal-actions">
      <button v-if="client.dismissedQuiet" type="button" class="btn ghost" :disabled="saving" @click="apply(null)">Put back on list</button>
      <button type="button" class="btn ghost" @click="closeModal">Cancel</button>
      <button type="button" class="btn" :disabled="saving" @click="apply((note || '').trim())">Dismiss</button>
    </div>
  </BaseModal>
</template>
