<script setup>
import Icon from './Icon.vue'

defineProps({ label: String })
defineEmits(['prev', 'next'])
</script>

<template>
  <div class="period">
    <button class="round" aria-label="Previous" @click="$emit('prev')"><Icon name="left" /></button>
    <div class="period-label">
      <h2>{{ label }}</h2>
      <slot />
    </div>
    <button class="round" aria-label="Next" @click="$emit('next')"><Icon name="right" /></button>
  </div>
</template>
