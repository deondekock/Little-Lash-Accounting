<script setup>
import { computed } from 'vue'
import { phoneOf, senderName, openInvoice } from '../store.js'
import { MESSAGES, openWhatsApp } from '../lib/whatsapp.js'

/** A round WhatsApp button that opens a ready-written message to this client. */
const props = defineProps({ client: { type: Object, required: true }, kind: { type: String, default: 'hello' }, label: { type: String, default: '' } })
const title = computed(() => props.label || { refill: 'Send a refill reminder', quiet: 'Send a "we miss you"', owed: 'Send a statement', hello: 'Message on WhatsApp' }[props.kind])
// Money owed: a statement image goes with the message.
const send = () => (props.kind === 'owed' ? openInvoice(props.client) : openWhatsApp(phoneOf(props.client), MESSAGES[props.kind](props.client, senderName.value)))
</script>

<template>
  <button type="button" class="wa-btn" :aria-label="`${title}: ${client.name}`" :title="title" @click.stop="send">
    <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M12 2a10 10 0 0 0-8.6 15.1L2 22l5-1.3A10 10 0 1 0 12 2zm0 18.2a8.2 8.2 0 0 1-4.2-1.2l-.3-.2-3 .8.8-2.9-.2-.3A8.2 8.2 0 1 1 12 20.2zm4.5-6.1c-.2-.1-1.5-.7-1.7-.8s-.4-.1-.6.1-.7.8-.8 1-.3.2-.5.1a6.7 6.7 0 0 1-3.3-2.9c-.2-.4.2-.4.7-1.3.1-.2 0-.3 0-.4l-.8-1.8c-.2-.5-.4-.4-.6-.4h-.5a1 1 0 0 0-.7.3 3 3 0 0 0-.9 2.2 5.2 5.2 0 0 0 1.1 2.7 11.8 11.8 0 0 0 4.5 4c1.7.7 2.3.8 3.2.6a2.7 2.7 0 0 0 1.8-1.2 2.2 2.2 0 0 0 .1-1.2c0-.1-.2-.2-.4-.3z"/></svg>
  </button>
</template>
