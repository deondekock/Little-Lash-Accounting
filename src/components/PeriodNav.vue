<script setup>
defineProps({ label: String })
defineEmits(['prev', 'next'])
</script>

<template>
  <div class="period">
    <button class="round" aria-label="Previous" @click="$emit('prev')">‹</button>
    <div class="period-label">
      <h2>{{ label }}</h2>
      <slot />
    </div>
    <button class="round" aria-label="Next" @click="$emit('next')">›</button>
  </div>
</template>
