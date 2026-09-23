<script setup>
import { onMounted, onBeforeUnmount } from 'vue'

const emit = defineEmits(['close'])
defineProps({ title: String })

const onKey = (e) => e.key === 'Escape' && emit('close')
onMounted(() => document.addEventListener('keydown', onKey))
onBeforeUnmount(() => document.removeEventListener('keydown', onKey))
</script>

<template>
  <div class="backdrop" @click.self="emit('close')">
    <div class="modal" role="dialog" :aria-label="title">
      <div class="grabber" />
      <h3 v-if="title">{{ title }}</h3>
      <slot />
    </div>
  </div>
</template>
