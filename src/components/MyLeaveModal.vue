<script setup>
import { computed, reactive, ref, watch } from 'vue'
import BaseModal from './BaseModal.vue'
import SegmentedControl from './SegmentedControl.vue'
import { state, closeModal, requestLeave, cancelLeave, toast, fail } from '../store.js'
import { todayStr } from '../lib/format.js'
import { MATERNITY_MONTHS, addMonths, leaveBalance, sickBalance, familyBalance, leaveSettings, leaveText, payDefaults, weekDays, workDays } from '../lib/payroll.js'
import { LEAVE_TYPES } from '../lib/schema.js'

/** Staff: ask for leave (or change / withdraw a request that's still waiting). */
const props = defineProps({ leave: Object })
const editing = !!props.leave
const form = reactive(editing ? { ...props.leave } : { type: 'Annual', from: todayStr(), to: todayStr(), hours: '', notes: '' })
const saving = ref(false)
const me = computed(() => state.employees[0])
const withPay = computed(() => me.value && { ...me.value, pay: payDefaults(me.value.pay) })
const settings = computed(() => leaveSettings(withPay.value?.pay || {}))
const days = computed(() => workDays(form.from, form.to, weekDays(settings.value.perWeek)))
const half = ref(false)
const autoHours = ref(!editing)
function fillHours() {
  if (autoHours.value) form.hours = Math.round(days.value * settings.value.perDay * (half.value ? 0.5 : 1) * 100) / 100 || ''
}
watch([() => form.from, () => form.to, half], () => {
  if (form.to < form.from) form.to = form.from
  fillHours()
}, { immediate: !editing })
watch(() => form.type, (t) => {
  if (t === 'Maternity' && form.from) {
    const end = new Date(addMonths(form.from, MATERNITY_MONTHS) + 'T12:00:00')
    end.setDate(end.getDate() - 1)
    form.to = end.toISOString().slice(0, 10)
  }
})
const others = computed(() => state.leave.filter((l) => l.id !== form.id))
const hrs = computed(() => Number(form.hours) || 0)
const annual = computed(() => withPay.value && leaveBalance(withPay.value, others.value, form.from))
const sick = computed(() => withPay.value && sickBalance(withPay.value, others.value, form.from))
const family = computed(() => withPay.value && familyBalance(withPay.value, others.value, form.from))
const r2 = (n) => Math.round(n * 100) / 100

async function submit() {
  saving.value = true
  try {
    await requestLeave({ id: props.leave?.id, type: form.type, from: form.from, to: form.to, hours: form.hours, notes: form.notes })
    toast(editing ? 'Request updated' : 'Request sent — you\'ll see here when it\'s approved')
    closeModal()
  } catch (err) {
    fail(err)
  } finally {
    saving.value = false
  }
}
async function withdraw() {
  if (!confirm('Withdraw this leave request?')) return
  try {
    await cancelLeave(props.leave.id)
    toast('Request withdrawn')
    closeModal()
  } catch (err) {
    fail(err)
  }
}
</script>

<template>
  <BaseModal :title="editing ? 'Your leave request' : 'Ask for leave'" @close="closeModal">
    <form autocomplete="off" @submit.prevent="submit">
      <div class="field">
        <label>Type</label>
        <SegmentedControl v-model="form.type" :options="LEAVE_TYPES" variant="wrap" />
      </div>
      <div class="row2">
        <div class="field"><label for="m-from">From</label><input id="m-from" v-model="form.from" type="date" required></div>
        <div class="field"><label for="m-to">To</label><input id="m-to" v-model="form.to" type="date" :min="form.from" required></div>
      </div>
      <div class="row2">
        <div class="field">
          <label for="m-hours">Hours</label>
          <input id="m-hours" v-model="form.hours" type="number" inputmode="decimal" step="0.25" min="0.25" required @input="autoHours = false">
          <div class="field-hint">{{ days }} work day{{ days === 1 ? '' : 's' }} × {{ settings.perDay }} h</div>
        </div>
        <div class="field" style="align-self: center">
          <label class="calc-check"><input v-model="half" type="checkbox" @change="autoHours = true; fillHours()"> Half day{{ days > 1 ? 's' : '' }}</label>
        </div>
      </div>
      <div class="field">
        <label for="m-notes">Note (optional)</label>
        <input id="m-notes" v-model="form.notes" maxlength="500">
      </div>
      <p v-if="form.type === 'Annual' && annual?.start" class="muted-note" :class="{ orange: annual.days - hrs / settings.perDay < 0 }">
        🌴 You'll have {{ leaveText(annual.days, settings.perDay) }} on {{ form.from }}; after this: {{ leaveText(annual.days - hrs / settings.perDay, settings.perDay) }}.
      </p>
      <p v-else-if="form.type === 'Sick' && sick && !sick.owner" class="muted-note" :class="{ orange: sick.hours - hrs < 0 }">
        🤒 {{ sick.hours }} h sick leave left; after this: {{ r2(sick.hours - hrs) }} h. More than 2 days in a row needs a doctor's note.
      </p>
      <p v-else-if="form.type === 'Family' && family && !family.owner" class="muted-note">
        👨‍👩‍👧 {{ family.eligible ? `${family.hours} h family responsibility leave left.` : 'Family responsibility leave starts after 4 months.' }}
      </p>
      <p v-else-if="form.type === 'Maternity'" class="muted-note">🤱 4 months in a row. It's paid by UIF, not the salon.</p>
      <div class="modal-actions">
        <button v-if="editing" type="button" class="btn danger" @click="withdraw">Withdraw</button>
        <button type="button" class="btn ghost" @click="closeModal">Cancel</button>
        <button type="submit" class="btn" :disabled="saving">{{ editing ? 'Save' : 'Send request' }}</button>
      </div>
    </form>
  </BaseModal>
</template>
