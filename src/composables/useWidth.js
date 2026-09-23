import { onBeforeUnmount, onMounted, ref } from 'vue'

/** Live pixel width of an element, so charts draw crisp at their real size. */
export function useWidth(el, fallback = 320) {
  const width = ref(fallback)
  let ro
  onMounted(() => {
    width.value = el.value?.clientWidth || fallback
    ro = new ResizeObserver(([entry]) => (width.value = Math.max(200, Math.round(entry.contentRect.width))))
    if (el.value) ro.observe(el.value)
  })
  onBeforeUnmount(() => ro?.disconnect())
  return width
}
