<script setup>
import { reactive, ref } from 'vue'
import BaseModal from './BaseModal.vue'
import { state, closeModal, saveCompany, toast, fail } from '../store.js'

const form = reactive({ name: '', type: '', registration: '', address: '', payeRef: '', uifRef: '', ...state.company })
const saving = ref(false)

async function submit() {
  saving.value = true
  try {
    await saveCompany({ ...form })
    toast('Company details saved')
    closeModal()
  } catch (err) {
    fail(err)
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <BaseModal title="Company details" @close="closeModal">
    <form autocomplete="off" @submit.prevent="submit">
      <p class="muted-note" style="margin-top: -6px">Shown on every payslip. Kept in the sheet's Settings tab.</p>
      <div class="field">
        <label for="c-name">Company name</label>
        <input id="c-name" v-model="form.name" placeholder="Little Lash Lounge (PTY) LTD">
      </div>
      <div class="row2">
        <div class="field">
          <label for="c-type">Company type</label>
          <input id="c-type" v-model="form.type" list="co-types" placeholder="PTY Limited">
          <datalist id="co-types"><option>PTY Limited</option><option>Sole proprietor</option><option>CC</option></datalist>
        </div>
        <div class="field">
          <label for="c-reg">Registration number</label>
          <input id="c-reg" v-model="form.registration" placeholder="2020/000000/07">
        </div>
      </div>
      <div class="field">
        <label for="c-addr">Address</label>
        <textarea id="c-addr" v-model="form.address" rows="4" placeholder="Street&#10;Suburb&#10;City&#10;Postal code" />
      </div>
      <div class="row2">
        <div class="field">
          <label for="c-paye">PAYE reference (optional)</label>
          <input id="c-paye" v-model="form.payeRef" placeholder="7…">
        </div>
        <div class="field">
          <label for="c-uif">UIF reference (optional)</label>
          <input id="c-uif" v-model="form.uifRef" placeholder="U…">
        </div>
      </div>
      <div class="modal-actions">
        <button type="button" class="btn ghost" @click="closeModal">Cancel</button>
        <button type="submit" class="btn" :disabled="saving">Save</button>
      </div>
    </form>
  </BaseModal>
</template>
