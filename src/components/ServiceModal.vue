<script setup>
/** Add a service to her list, or edit one (name, price, show/hide). Past names can be adopted into the list. */
import { computed, reactive, ref, watch } from 'vue'
import BaseModal from './BaseModal.vue'
import SegmentedControl from './SegmentedControl.vue'
import { state, closeModal, saveService, openServiceMerge, toastUndo, fail, employeeColor, serviceCatalog } from '../store.js'
import { fmt0 } from '../lib/format.js'
import { lengthLabel } from '../lib/booking.js'

const props = defineProps({ service: Object })
const s = props.service
const inList = !!s?.inList
const adopting = !!s && !inList
const form = reactive({
  name: s?.name || '',
  price: s?.price ?? (adopting && s.typical != null ? s.typical : ''),
  status: s && !s.active ? 'Hidden' : 'Shown',
  prices: { ...(s?.prices || {}) },
  // Booking
  minutes: s?.minutes ?? '',
  durations: { ...(s?.durations || {}) },
  category: s?.category || '',
  description: s?.description || '',
  online: !!s?.online,
})
// Who does it: saved list; else whoever did it before; else (new service) everyone active.
const doesIt = reactive(Object.fromEntries(state.employees.map((e) => [e.id,
  s?.staff?.length ? s.staff.includes(e.id) : s?.countBy ? !!s.countBy[e.id] && e.active : e.active])))
const categories = computed(() => [...new Set(serviceCatalog.value.map((x) => x.category).filter(Boolean))].sort())
const LENGTHS = [15, 30, 45, 60, 75, 90, 105, 120, 150, 180, 210, 240]
const lengthOptions = computed(() => [...new Set([...LENGTHS, Number(form.minutes) || 0])].filter(Boolean).sort((a, b) => a - b))
// Everyone active, plus anyone who has a price for this service or has done it before.
const team = computed(() => state.employees.filter((e) => e.active || form.prices[e.id] != null || s?.countBy?.[e.id]))
const isSet = (v) => v !== '' && v != null
const same = (a, b) => isSet(a) && isSet(b) && Number(a) === Number(b)

// Show everyone's price filled in: her own price, else the price for anyone, else what she usually
// charged for it (so past services come linked to whoever did them).
for (const e of team.value) {
  if (isSet(form.prices[e.id])) continue
  if (isSet(form.price)) form.prices[e.id] = form.price
  else if (s?.typicalBy?.[e.id] != null) form.prices[e.id] = s.typicalBy[e.id]
}

// Changing the price for anyone updates everyone who was on that price (or had none);
// people with their own different price keep it.
watch(() => form.price, (now, before) => {
  for (const e of team.value) {
    const v = form.prices[e.id]
    if (!isSet(v) || same(v, before)) form.prices[e.id] = isSet(now) ? now : ''
  }
})
const differs = (e) => isSet(form.prices[e.id]) && !same(form.prices[e.id], form.price)
const hint = (e) => {
  const usual = s?.typicalBy?.[e.id]
  return usual != null ? `usually ${fmt0(usual)}` : 'No price'
}
const saving = ref(false)
const title = computed(() => (inList ? 'Edit service' : adopting ? 'Add to your list' : 'New service'))
const renames = computed(() => s && form.name.trim() && form.name.trim() !== s.name && s.count)

async function save() {
  saving.value = true
  try {
    await saveService({
      id: inList ? s.id : undefined,
      name: form.name,
      price: form.price,
      // Only keep prices that differ from the price for anyone, so they follow it later.
      prices: Object.fromEntries(Object.entries(form.prices).filter(([, v]) => isSet(v) && !same(v, form.price))),
      active: form.status === 'Shown',
      minutes: form.minutes,
      // Only lengths that differ from the usual one.
      durations: Object.fromEntries(Object.entries(form.durations).filter(([, v]) => isSet(v) && Number(v) !== Number(form.minutes))),
      staff: Object.keys(doesIt).filter((id) => doesIt[id]),
      online: form.online,
      category: form.category,
      description: form.description,
      fromNames: adopting ? s.spellings : undefined,
    })
    toastUndo(inList ? 'Service saved' : 'Service added')
    closeModal()
  } catch (err) {
    fail(err)
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <BaseModal :title="title" @close="closeModal">
    <p v-if="s" style="margin: -8px 0 14px; color: var(--muted); font-size: 13.5px">
      Done {{ s.count }} time{{ s.count === 1 ? '' : 's' }}<template v-if="s.typical != null"> · usually {{ fmt0(s.typical) }}</template><template v-if="s.revenue"> · {{ fmt0(s.revenue) }} in total</template>
    </p>
    <form @submit.prevent="save">
      <div class="field">
        <label for="svc-name">Name</label>
        <input id="svc-name" v-model="form.name" required autocapitalize="sentences" placeholder="e.g. Volume lash fill">
        <div v-if="renames" class="field-hint">This also renames it on {{ s.count }} past appointment{{ s.count === 1 ? '' : 's' }}.</div>
      </div>
      <div class="field">
        <label for="svc-price">Price for anyone (R)</label>
        <input id="svc-price" v-model="form.price" type="number" inputmode="decimal" step="0.01" min="0" placeholder="Optional">
      </div>
      <div v-if="team.length" class="field">
        <label>Who does it, her price and how long it takes her</label>
        <div class="team-prices">
          <div v-for="e in team" :key="e.id" class="team-price team-row" :class="{ off: !doesIt[e.id] }">
            <label class="who"><input v-model="doesIt[e.id]" type="checkbox" :aria-label="`${e.name} does this`"><i class="swatch-dot" :style="{ background: employeeColor(e.id) }" /><span>{{ e.name }}<small v-if="s?.countBy?.[e.id]">{{ s.countBy[e.id] }}× done</small></span></label>
            <input v-model="form.prices[e.id]" type="number" inputmode="decimal" step="0.01" min="0" :placeholder="hint(e)" :aria-label="`Price for ${e.name}`" :class="{ differs: differs(e) }" :disabled="!doesIt[e.id]">
            <input v-model="form.durations[e.id]" class="mins" type="number" inputmode="numeric" step="5" min="5" max="720" :placeholder="form.minutes ? `${form.minutes}` : 'min'" :aria-label="`Minutes for ${e.name}`" :disabled="!doesIt[e.id]">
            <span v-if="differs(e)" class="own-price">own price</span>
          </div>
        </div>
        <div class="field-hint">Price in rand, time in minutes. Leave them empty to use the price for anyone and the usual length.</div>
      </div>

      <h4 class="section-label">Booking</h4>
      <div class="row2">
        <div class="field">
          <label for="svc-min">Usual length</label>
          <select id="svc-min" v-model.number="form.minutes">
            <option value="">Not set</option>
            <option v-for="m in lengthOptions" :key="m" :value="m">{{ lengthLabel(m) }}</option>
          </select>
        </div>
        <div class="field">
          <label for="svc-cat">Category</label>
          <input id="svc-cat" v-model="form.category" list="svc-cats" placeholder="e.g. Lashes">
          <datalist id="svc-cats"><option v-for="c in categories" :key="c">{{ c }}</option><option>Lashes</option><option>Brows</option><option>Waxing</option><option>Nails</option><option>Facials</option></datalist>
        </div>
      </div>
      <div class="field">
        <label for="svc-desc">Short description for clients (optional)</label>
        <input id="svc-desc" v-model="form.description" maxlength="300" placeholder="e.g. Refill every 2–3 weeks">
      </div>
      <div class="toggle-row" style="border: 0; padding-top: 0">
        <div class="grow"><div class="title">Clients can book this online</div><div class="meta">{{ form.online ? 'Shown on the booking page' : 'Only you and the team can book it' }}</div></div>
        <button type="button" class="switch" role="switch" :aria-checked="form.online" @click="form.online = !form.online"><span /></button>
      </div>
      <p v-if="form.online && !form.minutes" class="field-hint orange">Set the usual length so clients get the right times.</p>
      <div v-if="inList" class="field">
        <label>In the appointment form</label>
        <SegmentedControl v-model="form.status" :options="['Shown', 'Hidden']" />
      </div>
      <div class="modal-actions">
        <button v-if="s" type="button" class="btn ghost" @click="openServiceMerge(s)">Merge…</button>
        <button type="button" class="btn ghost" @click="closeModal">Cancel</button>
        <button type="submit" class="btn" :disabled="saving">{{ inList ? 'Save' : 'Add' }}</button>
      </div>
    </form>
  </BaseModal>
</template>
