<script setup>
import { reactive, ref } from 'vue'
import BaseModal from './BaseModal.vue'
import { state, closeModal, saveCompany, toast, fail } from '../store.js'

const form = reactive({ name: '', type: '', registration: '', address: '', payeRef: '', uifRef: '', phone: '', email: '', bank: '', bankHolder: '', bankAccount: '', bankBranch: '', ...state.company })
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
      <p class="muted-note" style="margin-top: -6px">Shown on payslips and on the statements clients get for unpaid visits.</p>
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
      <h4 class="section-label">On client statements</h4>
      <div class="row2">
        <div class="field">
          <label for="c-phone">Salon phone</label>
          <input id="c-phone" v-model="form.phone" type="tel" placeholder="061 998 9036">
        </div>
        <div class="field">
          <label for="c-email">Salon email</label>
          <input id="c-email" v-model="form.email" type="email" placeholder="info@…">
        </div>
      </div>
      <div class="row2">
        <div class="field">
          <label for="c-bank">Bank</label>
          <input id="c-bank" v-model="form.bank" placeholder="Capitec">
        </div>
        <div class="field">
          <label for="c-holder">Account name</label>
          <input id="c-holder" v-model="form.bankHolder" placeholder="Little Lash Lounge">
        </div>
      </div>
      <div class="row2">
        <div class="field">
          <label for="c-acc">Account number</label>
          <input id="c-acc" v-model="form.bankAccount" inputmode="numeric">
        </div>
        <div class="field">
          <label for="c-branch">Branch code</label>
          <input id="c-branch" v-model="form.bankBranch" inputmode="numeric">
        </div>
      </div>
      <div class="modal-actions">
        <button type="button" class="btn ghost" @click="closeModal">Cancel</button>
        <button type="submit" class="btn" :disabled="saving">Save</button>
      </div>
    </form>
  </BaseModal>
</template>
