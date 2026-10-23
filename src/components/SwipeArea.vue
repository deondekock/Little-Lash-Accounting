<script setup>
import { computed, ref } from 'vue'

/**
 * Wraps a list so a sideways swipe moves to the next/previous thing (day, month, filter…). The content
 * follows the finger, slides out on release, and the new content slides in from the other side. Emits
 * `swipe` with +1 (swiped left → forward) or -1; `canGo(dir)` says whether there is anywhere to go.
 */
const props = defineProps({ canGo: { type: Function, default: () => true } })
const emit = defineEmits(['swipe'])
let swipe = null
const dragX = ref(0) // how far the content is pulled, in px
const anim = ref('') // '' | 'out-left' | 'out-right' | 'in-left' | 'in-right'
const style = computed(() => (anim.value || !dragX.value ? {} : { transform: `translateX(${dragX.value}px)`, opacity: 1 - Math.min(0.5, Math.abs(dragX.value) / 300) }))

function start(e) {
  if (anim.value) return
  const t = e.touches[0]
  // Not when the finger is on something that scrolls sideways itself (chip rows).
  for (let el = e.target; el && el !== e.currentTarget; el = el.parentElement) {
    const o = getComputedStyle(el).overflowX
    if ((o === 'auto' || o === 'scroll') && el.scrollWidth > el.clientWidth) return
  }
  swipe = { x: t.clientX, y: t.clientY, horizontal: null }
}
function move(e) {
  if (!swipe) return
  const t = e.touches[0]
  const dx = t.clientX - swipe.x
  const dy = t.clientY - swipe.y
  // Decide once whether this is a sideways swipe or a normal scroll.
  if (swipe.horizontal === null && (Math.abs(dx) > 10 || Math.abs(dy) > 10)) swipe.horizontal = Math.abs(dx) > Math.abs(dy) * 1.5
  if (!swipe.horizontal) return
  const dir = dx < 0 ? 1 : -1
  dragX.value = dx * (props.canGo(dir) ? 0.6 : 0.15) // follows the finger, barely when there's nowhere to go
}
function end(e) {
  if (!swipe) return
  const t = e.changedTouches[0]
  const dx = t.clientX - swipe.x
  const dir = dx < 0 ? 1 : -1 // swipe left → forward
  const went = swipe.horizontal && Math.abs(dx) >= 60 && props.canGo(dir)
  swipe = null
  if (!went) { dragX.value = 0; return } // springs back
  anim.value = dir > 0 ? 'out-left' : 'out-right'
  setTimeout(() => {
    emit('swipe', dir)
    dragX.value = 0
    anim.value = dir > 0 ? 'in-right' : 'in-left'
    setTimeout(() => { anim.value = '' }, 220)
  }, 160)
}
function cancel() { swipe = null; dragX.value = 0 }
</script>

<template>
  <div class="swipe-page" :class="anim && 'swipe-' + anim" :style="style" @touchstart.passive="start" @touchmove.passive="move" @touchend.passive="end" @touchcancel.passive="cancel">
    <slot />
  </div>
</template>
