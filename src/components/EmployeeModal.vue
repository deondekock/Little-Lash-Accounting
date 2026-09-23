<script setup>
import { onMounted, reactive, ref } from 'vue'
import BaseModal from './BaseModal.vue'
import SegmentedControl from './SegmentedControl.vue'
import { saveEmployee, deleteEmployee, closeModal, toast, fail } from '../store.js'

const props = defineProps({ employee: Object })
const editing = !!props.employee

const form = reactive({
  name: props.employee?.name || '',
  phone: props.employee?.phone || '',
  status: props.employee?.active === false ? 'Inactive' : 'Active',
})
const saving = ref(false)
const nameInput = ref(null)

onMounted(() => !editing && nameInput.value?.focus())

async function submit() {
  saving.value = true
  try {
    await saveEmployee({
      id: props.employee?.id,
      name: form.name,
      phone: form.phone,
      active: form.status === 'Active',
    })
    closeModal()
    toast(editing ? 'Saved' : 'Employee added')
  } catch (err) {
    fail(err)
  } finally {
    saving.value = false
  }
}

async function remove() {
  if (!confirm('Delete ' + props.employee.name + '?')) return
  try {
    await deleteEmployee(props.employee.id)
    closeModal()
    toast('Deleted')
  } catch (err) {
    fail(err)
  }
}
</script>

<template>
  <BaseModal :title="editing ? 'Edit employee' : 'New employee'" @close="closeModal">
    <form autocomplete="off" @submit.prevent="submit">
      <div class="field">
        <label for="f-name">Name</label>
        <input id="f-name" ref="nameInput" v-model="form.name" required placeholder="e.g. Chrisilda">
      </div>
      <div class="field">
        <label for="f-phone">Phone (optional)</label>
        <input id="f-phone" v-model="form.phone" type="tel">
      </div>
      <div v-if="editing" class="field">
        <label>Status</label>
        <SegmentedControl v-model="form.status" :options="['Active', 'Inactive']" />
      </div>
      <div class="modal-actions">
        <button v-if="editing" type="button" class="btn danger" @click="remove">Delete</button>
        <button type="button" class="btn ghost" @click="closeModal">Cancel</button>
        <button type="submit" class="btn" :disabled="saving">{{ editing ? 'Save' : 'Add' }}</button>
      </div>
    </form>
  </BaseModal>
</template>
