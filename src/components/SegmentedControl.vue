<script setup>
const model = defineModel({ type: String })
defineProps({ options: { type: Array, required: true }, variant: String })
</script>

<template>
  <div class="seg" :class="variant">
    <button
      v-for="o in options"
      :key="o"
      type="button"
      :data-v="o"
      :class="{ active: model === o }"
      @click="model = o"
    >
      {{ o }}
    </button>
  </div>
</template>
