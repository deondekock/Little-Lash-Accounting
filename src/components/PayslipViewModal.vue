<script setup>
import BaseModal from './BaseModal.vue'
import PayslipDocument from './PayslipDocument.vue'
import { closeModal, printPayslips } from '../store.js'
import { monthLabel } from '../lib/format.js'

/** Shows a saved payslip on screen, with a button to save it as a PDF or print it. */
const props = defineProps({ slip: { type: Object, required: true } })
</script>

<template>
  <BaseModal :title="`Payslip · ${monthLabel(props.slip.month)}`" @close="closeModal">
    <div class="payslip-screen"><PayslipDocument :slip="props.slip" /></div>
    <div class="modal-actions">
      <button type="button" class="btn ghost" @click="closeModal">Close</button>
      <button type="button" class="btn" @click="printPayslips([props.slip])">Save as PDF / Print</button>
    </div>
  </BaseModal>
</template>
