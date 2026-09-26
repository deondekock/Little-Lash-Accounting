<script setup>
import { ref } from 'vue'
import SegmentedControl from '../../components/SegmentedControl.vue'
import MyStats from '../../components/staff/MyStats.vue'
import MyDetailsView from './MyDetailsView.vue'
import { state } from '../../store.js'

/** Staff "Me" tab: her stats, and her details. */
const tab = ref('My stats')
const first = (state.employees[0]?.name || '').split(' ')[0]
</script>

<template>
  <div>
    <div class="page" style="padding-bottom: 0">
      <div class="greeting"><div class="hello">Hi <em>{{ first }}</em> ✨</div></div>
      <SegmentedControl v-model="tab" :options="['My stats', 'My details']" />
    </div>
    <div v-if="tab === 'My stats'" class="page" style="padding-top: 14px"><MyStats /></div>
    <MyDetailsView v-else />
  </div>
</template>
