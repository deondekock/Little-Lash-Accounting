<script setup>
import BaseModal from './BaseModal.vue'
import PayslipDocument from './PayslipDocument.vue'
import { closeModal, printPayslips } from '../store.js'
import { monthLabel } from '../lib/format.js'
import { downloadPayslipPdf } from '../lib/payslipPdf.js'
import { fail } from '../store.js'

/** Shows a saved payslip on screen, with buttons to download it as a PDF or print it. */
const props = defineProps({ slip: { type: Object, required: true } })
</script>

<template>
  <BaseModal :title="`Payslip · ${monthLabel(props.slip.month)}`" @close="closeModal">
    <div class="payslip-screen"><PayslipDocument :slip="props.slip" /></div>
    <div class="modal-actions">
      <button type="button" class="btn ghost" @click="closeModal">Close</button>
      <button type="button" class="btn ghost" @click="printPayslips([props.slip])">Print</button>
      <button type="button" class="btn" @click="downloadPayslipPdf([props.slip]).catch(fail)">Download PDF</button>
    </div>
  </BaseModal>
</template>
