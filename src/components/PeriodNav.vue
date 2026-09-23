<script setup>
import Icon from './Icon.vue'
import { openPicker } from '../store.js'

defineProps({ label: String, mode: { type: String, default: 'month' } })
defineEmits(['prev', 'next'])
</script>

<template>
  <div class="period">
    <button class="round" aria-label="Previous" @click="$emit('prev')"><Icon name="left" /></button>
    <div class="period-label">
      <button class="period-pick" :aria-label="`Choose ${mode}`" @click="openPicker(mode)">
        <h2>{{ label }}</h2><Icon name="down" :size="18" :stroke="2.2" />
      </button>
      <slot />
    </div>
    <button class="round" aria-label="Next" @click="$emit('next')"><Icon name="right" /></button>
  </div>
</template>
