<script setup>
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import BaseModal from './BaseModal.vue'
import { state, clients, closeModal, phoneOf, senderName, toast, fail } from '../store.js'
import { fmt0 } from '../lib/format.js'
import { invoiceImage, invoiceNumber } from '../lib/invoice.js'
import { MESSAGES, openWhatsApp } from '../lib/whatsapp.js'

/**
 * A statement of a client's unpaid visits as an image, to send on WhatsApp with a friendly message.
 * Phones: the share sheet (pick WhatsApp, then her chat) sends the image and the message together.
 * Computers: the image is saved and WhatsApp opens with the message, to attach it there.
 */
const props = defineProps({ clientKey: { type: String, required: true } })
const c = computed(() => clients.value.find((x) => x.key === props.clientKey))
const blob = ref(null)
const url = ref('')
const busy = ref(false)
const fileName = computed(() => `${invoiceNumber(c.value)}.png`)
const message = computed(() => MESSAGES.statement(c.value, senderName.value, !!state.company.bankAccount))
const nameOf = (id) => state.employees.find((e) => e.id === id)?.name || ''
const canShare = ref(false)

onMounted(async () => {
  try {
    blob.value = await invoiceImage(c.value, state.company, nameOf)
    url.value = URL.createObjectURL(blob.value)
    const file = new File([blob.value], fileName.value, { type: 'image/png' })
    canShare.value = !!navigator.canShare?.({ files: [file] })
  } catch (err) {
    fail(err)
  }
})
onBeforeUnmount(() => url.value && URL.revokeObjectURL(url.value))

function save() {
  const a = Object.assign(document.createElement('a'), { href: url.value, download: fileName.value })
  document.body.append(a)
  a.click()
  a.remove()
}

async function send() {
  busy.value = true
  // Copy the message too: some apps drop the text when an image is shared.
  navigator.clipboard?.writeText(message.value).catch(() => {})
  try {
    if (canShare.value) {
      await navigator.share({ files: [new File([blob.value], fileName.value, { type: 'image/png' })], text: message.value })
    } else {
      save()
      openWhatsApp(phoneOf(c.value), message.value)
      toast('Statement saved — attach it in WhatsApp (📎)')
    }
  } catch (err) {
    if (err?.name !== 'AbortError') fail(err)
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <BaseModal :title="`Statement · ${c?.name || ''}`" @close="closeModal">
    <template v-if="c">
      <p class="muted-note" style="margin-top: -6px !important">
        {{ c.history.filter((v) => v.status === 'Unpaid').length }} unpaid visit{{ c.history.filter((v) => v.status === 'Unpaid').length === 1 ? '' : 's' }} · {{ fmt0(c.unpaid) }}.
        <template v-if="!state.company.bankAccount">Add your banking details in Settings → Company details so clients can pay by EFT.</template>
      </p>
      <div class="invoice-preview">
        <img v-if="url" :src="url" alt="Statement preview">
        <div v-else class="empty">Making the statement…</div>
      </div>
      <div class="modal-actions">
        <button class="btn ghost" :disabled="!url" @click="save">Save image</button>
        <button class="btn wa-send" :disabled="!url || busy" @click="send">
          <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M12 2a10 10 0 0 0-8.6 15.1L2 22l5-1.3A10 10 0 1 0 12 2zm0 18.2a8.2 8.2 0 0 1-4.2-1.2l-.3-.2-3 .8.8-2.9-.2-.3A8.2 8.2 0 1 1 12 20.2z"/></svg>
          Send on WhatsApp
        </button>
      </div>
      <p class="muted-note" style="text-align: center">
        {{ canShare ? 'Choose WhatsApp, then her chat. The message is copied too, in case it needs pasting.' : 'The statement is saved, and WhatsApp opens with the message — attach the image with 📎.' }}
      </p>
    </template>
    <div v-else class="empty">Nothing unpaid for this client.</div>
  </BaseModal>
</template>
