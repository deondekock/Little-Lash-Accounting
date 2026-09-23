<script setup>
/** Floating readout: value leads, label follows; series keyed with a short line in its colour. */
defineProps({ x: Number, y: Number, title: String, rows: { type: Array, default: () => [] }, width: Number })
</script>

<template>
  <div class="tooltip" :style="{ left: Math.min(Math.max(x, 72), (width || 9999) - 72) + 'px', top: y + 'px' }" role="status">
    <div v-if="title" class="t-title">{{ title }}</div>
    <div v-for="r in rows" :key="r.label" class="t-row">
      <i v-if="r.color" class="t-key" :style="{ background: r.color }" />
      <b>{{ r.value }}</b><span>{{ r.label }}</span>
    </div>
  </div>
</template>
