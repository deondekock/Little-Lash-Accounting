<script setup>
import { onMounted, onBeforeUnmount, ref } from 'vue'

const emit = defineEmits(['close'])
defineProps({ title: String })

const onKey = (e) => e.key === 'Escape' && emit('close')
onMounted(() => document.addEventListener('keydown', onKey))
onBeforeUnmount(() => document.removeEventListener('keydown', onKey))

/*
 * Swipe down to close (phones): drag the sheet down from its top edge, or from anywhere once it's
 * scrolled to the top. Let go far enough (or flick) and it slides away; otherwise it springs back.
 */
const sheet = ref(null)
const backdrop = ref(null)
let drag = null

function start(e) {
  if (e.touches.length !== 1) return
  const t = e.touches[0]
  const fromTop = !!e.target.closest('.modal-head')
  drag = { y: t.clientY, x: t.clientX, t: Date.now(), dy: 0, active: false, fromTop, scrolled: sheet.value.scrollTop > 0 }
}
function move(e) {
  if (!drag) return
  const t = e.touches[0]
  const dy = t.clientY - drag.y
  const dx = t.clientX - drag.x
  if (!drag.active) {
    // Only a clear downward pull, starting from the top edge or with the sheet scrolled to the top.
    if (Math.abs(dy) < 8 && Math.abs(dx) < 8) return
    if (dy <= 0 || Math.abs(dx) > Math.abs(dy) || (!drag.fromTop && (drag.scrolled || sheet.value.scrollTop > 0))) { drag = null; return }
    drag.active = true
    drag.y = t.clientY // start from here, so it doesn't jump
    sheet.value.style.transition = 'none'
  }
  e.preventDefault()
  drag.dy = Math.max(0, t.clientY - drag.y)
  sheet.value.style.transform = `translateY(${drag.dy}px)`
  backdrop.value.style.opacity = String(Math.max(0.3, 1 - drag.dy / 600))
}
function end() {
  if (!drag) return
  const d = drag
  drag = null
  if (!d.active) return
  const speed = d.dy / Math.max(1, Date.now() - d.t) // px per ms
  const el = sheet.value
  el.style.transition = 'transform .2s ease-out'
  if (d.dy > 110 || (d.dy > 40 && speed > 0.5)) {
    el.style.transform = 'translateY(110%)'
    backdrop.value.style.transition = 'opacity .2s ease-out'
    backdrop.value.style.opacity = '0'
    setTimeout(() => emit('close'), 180)
  } else {
    el.style.transform = ''
    backdrop.value.style.opacity = ''
  }
}
</script>

<template>
  <div ref="backdrop" class="backdrop" @click.self="emit('close')">
    <div
      ref="sheet" class="modal" role="dialog" :aria-label="title"
      @touchstart.passive="start" @touchmove="move" @touchend="end" @touchcancel="end"
    >
      <div class="modal-head">
        <div class="grabber" />
        <div class="modal-x-wrap">
          <button type="button" class="modal-x" aria-label="Close" title="Close" @click="emit('close')">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>
          </button>
        </div>
        <h3 v-if="title">{{ title }}</h3>
      </div>
      <slot />
    </div>
  </div>
</template>
