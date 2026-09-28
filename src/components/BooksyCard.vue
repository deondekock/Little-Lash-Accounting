<script setup>
import { computed } from 'vue'
import { state, booksyToDo, recordFromBooksy, dismissBooksy, employeeColor, employeeById, openGmail, toastUndo } from '../store.js'
import { fmt0, shortDate, todayStr } from '../lib/format.js'

/** Home: bookings that came in from Booksy and still need their payment recorded. */
const today = todayStr()
const list = computed(() => booksyToDo.value)
const when = (x) => [x.data.date && x.data.date !== today ? shortDate(x.data.date) : x.data.date ? 'Today' : '', x.data.time].filter(Boolean).join(' · ')
function dismiss(x) {
  dismissBooksy(x.id)
  toastUndo(`Removed ${x.data.client || 'booking'} from the Booksy list`)
}
</script>

<template>
  <section v-if="state.booksy && list.length" class="card booksy-card">
    <div class="card-title">
      <h3>From Booksy</h3>
      <button class="link-btn" @click="openGmail">{{ list.length }} to record</button>
    </div>
    <p class="muted-note" style="margin: -4px 0 6px !important">Tap one after the visit: the payment form opens filled in.</p>
    <div class="list">
      <div v-for="x in list.slice(0, 8)" :key="x.id" class="list-row with-action">
        <button class="row-main" @click="recordFromBooksy(x)">
          <i class="swatch-dot" :style="{ background: x.employeeId ? employeeColor(x.employeeId) : 'var(--series-other)' }" />
          <div class="grow">
            <div class="title">{{ x.data.client || x.subject }}</div>
            <div class="meta">{{ [when(x), x.data.service, employeeById(x.employeeId)?.name || x.data.staff, x.data.price ? fmt0(x.data.price) : ''].filter(Boolean).join(' · ') }}</div>
          </div>
          <span class="btn small soft">Record</span>
        </button>
        <button class="icon-btn" aria-label="Not needed — remove from this list" title="Not needed" @click="dismiss(x)">×</button>
      </div>
    </div>
  </section>
</template>
