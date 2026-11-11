<script setup>
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import BaseModal from './BaseModal.vue'
import SegmentedControl from './SegmentedControl.vue'
import ClientInput from './ClientInput.vue'
import { state, sellVoucher, voidVoucher, deleteVoucher, extendVoucher, updateVoucherNotes, closeModal, toast, toastUndo, fail, senderName, phoneOf } from '../store.js'
import { voucherImage } from '../lib/voucherImage.js'
import { MESSAGES, openWhatsApp } from '../lib/whatsapp.js'
import { clientKey } from '../lib/stats.js'
import { METHODS, fmt, fmt0, shortDate, todayStr } from '../lib/format.js'
import { defaultExpiry, voucherExpired } from '../lib/vouchers.js'
import { looseKey } from '../lib/stats.js'
import Icon from './Icon.vue'

/** Sell gift vouchers (cash in now), see which still have money on them, and extend an expiry. */
const today = todayStr()
const form = reactive({ amount: '', buyer: '', method: 'Card', soldOn: today, note: '', voucherNote: '', expiresOn: defaultExpiry(today) })
const expiryTouched = ref(false)
// The expiry follows "Sold on" (one year later) until she picks her own date.
watch(() => form.soldOn, (d) => { if (!expiryTouched.value && d) form.expiresOn = defaultExpiry(d) })
const saving = ref(false)
const adding = ref(false) // the New form is open
const extending = ref(null) // { id, expiresOn } while a date is being picked
const STATUS = { active: 'Active', redeemed: 'Used up', void: 'Void' }
const query = ref('')
// Search by code, who bought it, or the note (loose: ignores case, spaces and punctuation).
const list = computed(() => {
  const q = looseKey(query.value)
  return [...state.vouchers]
    .filter((v) => !q || looseKey(`${v.code} ${v.buyer} ${v.note} ${v.voucherNote}`).includes(q))
    .sort((a, b) => (a.soldOn < b.soldOn ? 1 : -1))
})
const remaining = computed(() => list.value.filter((v) => v.status === 'active').reduce((t, v) => t + v.balance, 0))
const ok = computed(() => Number(form.amount) > 0)
const expired = (v) => v.status === 'active' && voucherExpired(v, today)
const label = (v) => (expired(v) ? 'Expired' : STATUS[v.status] || v.status)
const long = (d) => (d ? new Date(d + 'T12:00:00').toLocaleDateString('en-ZA', { day: 'numeric', month: 'short', year: 'numeric' }) : '')

async function sell() {
  if (!ok.value) return
  saving.value = true
  try {
    await sellVoucher({ ...form })
    toast('Voucher sold 🎁')
    form.amount = ''; form.buyer = ''; form.note = ''; form.voucherNote = ''
    adding.value = false
  } catch (err) {
    fail(err)
  } finally {
    saving.value = false
  }
}
async function remove(v) {
  if (!confirm(`Void voucher ${v.code}? It can't be used after this.`)) return
  try {
    await voidVoucher(v.id)
  } catch (err) {
    fail(err)
  }
}
const admin = computed(() => state.role === 'admin')

/* Hold a voucher to get its actions as a row of round icon buttons (keeps the list itself uncluttered). */
const menuFor = ref(null) // voucher id with the menu open
let press = null
function pressStart(v) {
  pressEnd()
  press = setTimeout(() => { menuFor.value = menuFor.value === v.id ? null : v.id; longPressed = true; navigator.vibrate?.(10); press = null }, 450)
}
function pressEnd() { if (press) { clearTimeout(press); press = null } }
const held = computed(() => list.value.find((v) => v.id === menuFor.value) || null)

/* Tap a voucher: the same form as New, filled in — only the expiry and the notes can be changed. */
const viewing = ref(null) // the voucher open in the form
const edit = reactive({ expiresOn: '', note: '', voucherNote: '' })
let longPressed = false
function openVoucher(v) {
  if (longPressed) { longPressed = false; return } // the hold already opened the menu
  viewing.value = v
  edit.expiresOn = v.expiresOn || ''
  edit.note = v.note || ''
  edit.voucherNote = v.voucherNote || ''
}
const current = computed(() => (viewing.value ? state.vouchers.find((x) => x.id === viewing.value.id) || null : null))
watch(current, (v) => { if (!v) viewing.value = null }) // deleted underneath us
const dirty = computed(() => current.value && (edit.expiresOn !== (current.value.expiresOn || '') || edit.note !== (current.value.note || '') || edit.voucherNote !== (current.value.voucherNote || '')))
async function saveView() {
  const v = current.value
  saving.value = true
  try {
    if (edit.note !== (v.note || '') || edit.voucherNote !== (v.voucherNote || '')) await updateVoucherNotes(v.id, edit.note, edit.voucherNote)
    if (edit.expiresOn && edit.expiresOn !== (v.expiresOn || '')) await extendVoucher(v.id, edit.expiresOn)
    toast('Voucher updated')
    viewing.value = null
  } catch (err) {
    fail(err)
  } finally {
    saving.value = false
  }
}
async function voidFromView() { await remove(current.value); if (current.value?.status !== 'active') viewing.value = null }
async function deleteFromView() { const before = state.vouchers.length; await destroy(current.value); if (state.vouchers.length !== before) viewing.value = null }
function act(fn, v) { menuFor.value = null; fn(v) }
// A tap anywhere outside the held row and the floating menu closes it.
const onDocDown = (e) => { if (menuFor.value && !e.target.closest?.('.voucher-row.open, .voucher-pill')) menuFor.value = null }
onMounted(() => document.addEventListener('pointerdown', onDocDown, true))
onBeforeUnmount(() => document.removeEventListener('pointerdown', onDocDown, true))
const uses = (v) => state.voucherUses?.[v.id] || []

/* Share: the voucher as an image, sent on WhatsApp (phones: the share sheet; computers: saved + WhatsApp opens). */
const sharing = ref(null) // the voucher being shared
const shareUrl = ref('')
let shareBlob = null
const canShare = ref(false)
const busy = ref(false)
const shareMessage = computed(() => (sharing.value ? MESSAGES.voucher(sharing.value, senderName.value) : ''))
const shareFile = () => new File([shareBlob], `${sharing.value.code}.png`, { type: 'image/png' })
async function startShare(v) {
  sharing.value = v
  shareUrl.value = ''
  try {
    shareBlob = await voucherImage(v, state.company)
    shareUrl.value = URL.createObjectURL(shareBlob)
    canShare.value = !!navigator.canShare?.({ files: [shareFile()] })
  } catch (err) {
    fail(err)
    sharing.value = null
  }
}
function stopShare() { if (shareUrl.value) URL.revokeObjectURL(shareUrl.value); shareUrl.value = ''; sharing.value = null }
onBeforeUnmount(() => shareUrl.value && URL.revokeObjectURL(shareUrl.value))
function saveImage() {
  const a = Object.assign(document.createElement('a'), { href: shareUrl.value, download: `${sharing.value.code}.png` })
  document.body.append(a); a.click(); a.remove()
}
async function send() {
  busy.value = true
  navigator.clipboard?.writeText(shareMessage.value).catch(() => {})
  try {
    if (canShare.value) {
      await navigator.share({ files: [shareFile()], text: shareMessage.value })
    } else {
      saveImage()
      openWhatsApp(sharing.value.buyer ? phoneOf({ key: clientKey(sharing.value.buyer) }) : '', shareMessage.value)
      toast('Voucher saved — attach it in WhatsApp (📎)')
    }
  } catch (err) {
    if (err?.name !== 'AbortError') fail(err)
  } finally {
    busy.value = false
  }
}
async function destroy(v) {
  if (!confirm(`Delete voucher ${v.code} (${fmt0(v.amount)}) completely? It disappears from the list and the books — void it instead if it was sold and refunded.`)) return
  try {
    await deleteVoucher(v.id)
    toastUndo('Voucher deleted')
  } catch (err) {
    fail(err)
  }
}
function startExtend(v) {
  const base = v.expiresOn && v.expiresOn > today ? v.expiresOn : today
  extending.value = { id: v.id, code: v.code, expiresOn: defaultExpiry(base) }
}
async function confirmExtend() {
  const { id, expiresOn } = extending.value
  try {
    await extendVoucher(id, expiresOn)
    toast('Expiry changed')
    extending.value = null
  } catch (err) {
    fail(err)
  }
}
</script>

<template>
  <BaseModal title="Gift vouchers" @close="closeModal">
    <form v-if="adding" class="voucher-sell" autocomplete="off" @submit.prevent="sell">
      <div class="field"><label for="v-buyer">Bought by</label><ClientInput id="v-buyer" v-model="form.buyer" plain /></div>
      <div class="field"><label for="v-amt">Amount (R)</label><input id="v-amt" v-model="form.amount" type="number" inputmode="decimal" step="0.01" min="0" placeholder="0.00"></div>
      <div class="row2">
        <div class="field"><label for="v-date">Sold on</label><input id="v-date" v-model="form.soldOn" type="date" :max="today"></div>
        <div class="field"><label for="v-exp">Expires on</label><input id="v-exp" v-model="form.expiresOn" type="date" :min="form.soldOn" @input="expiryTouched = true"></div>
      </div>
      <p class="field-hint" style="margin-top: -6px">Vouchers are good for a year unless you choose another date.</p>
      <div class="field"><label>Paid with</label><SegmentedControl v-model="form.method" :options="METHODS" /></div>
      <div class="field">
        <label for="v-vnote">On the voucher (optional)</label>
        <input id="v-vnote" v-model="form.voucherNote" maxlength="80" placeholder="e.g. Any full set of lash extensions">
        <div class="field-hint">Printed on the voucher image, under the amount.</div>
      </div>
      <div class="field"><label for="v-note">Private note (optional)</label><input id="v-note" v-model="form.note" placeholder="e.g. birthday gift for Sarah — not shown on the voucher"></div>
      <div class="modal-actions" style="margin-top: 4px">
        <button class="btn ghost" type="button" @click="adding = false">Cancel</button>
        <button class="btn" type="submit" :disabled="saving || !ok">Sell voucher {{ ok ? fmt0(Number(form.amount)) : '' }}</button>
      </div>
    </form>

    <form v-else-if="current && !sharing" class="voucher-sell" autocomplete="off" @submit.prevent="saveView">
      <p class="muted-note" style="margin-top: -6px !important">
        <b>{{ current.code }}</b> · {{ label(current) }} · {{ fmt(current.balance) }} left<template v-if="current.balance !== current.amount"> of {{ fmt0(current.amount) }}</template>
      </p>
      <div class="field"><label>Bought by</label><input :value="current.buyer || '—'" readonly></div>
      <div class="field"><label>Amount (R)</label><input :value="current.amount.toFixed(2)" readonly></div>
      <div class="row2">
        <div class="field"><label>Sold on</label><input type="date" :value="current.soldOn" readonly></div>
        <div class="field"><label for="v-view-exp">Expires on</label><input id="v-view-exp" v-model="edit.expiresOn" type="date" :min="current.soldOn"></div>
      </div>
      <p v-if="edit.expiresOn !== (current.expiresOn || '')" class="field-hint" style="margin-top: -6px">The change is recorded on the voucher with your name and today's date.</p>
      <div v-for="(n, i) in (current.expiryNote || '').split('\n').filter(Boolean)" :key="i" class="field-hint orange" style="margin-top: -6px">✎ {{ n }}</div>
      <div class="field"><label>Paid with</label><input :value="current.method" readonly></div>
      <div class="field">
        <label for="v-view-vnote">On the voucher (optional)</label>
        <input id="v-view-vnote" v-model="edit.voucherNote" maxlength="80" placeholder="e.g. Any full set of lash extensions">
      </div>
      <div class="field"><label for="v-view-note">Private note (optional)</label><input id="v-view-note" v-model="edit.note" maxlength="200" placeholder="Not shown on the voucher"></div>
      <div v-if="uses(current).length" class="field">
        <label>Used on</label>
        <div v-for="(u, i) in uses(current)" :key="i" class="meta">↳ {{ fmt(u.amount) }} · {{ shortDate(u.date) }} {{ u.date.slice(0, 4) }}<template v-if="u.client"> · {{ u.client }}</template><template v-if="u.service"> · {{ u.service }}</template><template v-if="u.who"> · with {{ u.who }}</template></div>
      </div>
      <div class="voucher-view-actions">
        <button v-if="current.status === 'active'" type="button" class="btn wa-send small" @click="startShare(current)">
          <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M12 2a10 10 0 0 0-8.6 15.1L2 22l5-1.3A10 10 0 1 0 12 2zm0 18.2a8.2 8.2 0 0 1-4.2-1.2l-.3-.2-3 .8.8-2.9-.2-.3A8.2 8.2 0 1 1 12 20.2z"/></svg> WhatsApp
        </button>
        <button v-if="current.status === 'active'" type="button" class="btn ghost small" @click="voidFromView"><Icon name="ban" :size="16" /> Void</button>
        <button v-if="admin" type="button" class="btn danger small" @click="deleteFromView"><Icon name="trash" :size="16" /> Delete</button>
      </div>
      <div class="modal-actions" style="margin-top: 4px">
        <button class="btn ghost" type="button" @click="viewing = null">{{ dirty ? 'Cancel' : 'Back' }}</button>
        <button class="btn" type="submit" :disabled="saving || !dirty">Save</button>
      </div>
    </form>

    <template v-else-if="sharing">
      <p class="muted-note" style="margin-top: -6px !important">Voucher {{ sharing.code }} · {{ fmt0(sharing.amount) }}<template v-if="sharing.buyer"> · for {{ sharing.buyer }}</template></p>
      <div class="invoice-preview">
        <img v-if="shareUrl" :src="shareUrl" alt="Voucher preview">
        <div v-else class="empty">Making the voucher…</div>
      </div>
      <div class="modal-actions">
        <button class="btn ghost" @click="stopShare">Back</button>
        <button class="btn ghost" :disabled="!shareUrl" @click="saveImage">Save image</button>
        <button class="btn wa-send" :disabled="!shareUrl || busy" @click="send">
          <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M12 2a10 10 0 0 0-8.6 15.1L2 22l5-1.3A10 10 0 1 0 12 2zm0 18.2a8.2 8.2 0 0 1-4.2-1.2l-.3-.2-3 .8.8-2.9-.2-.3A8.2 8.2 0 1 1 12 20.2z"/></svg>
          Send on WhatsApp
        </button>
      </div>
      <p class="muted-note" style="text-align: center">
        {{ canShare ? 'Choose WhatsApp, then the chat. The message is copied too, in case it needs pasting.' : 'The voucher is saved, and WhatsApp opens with the message — attach the image with 📎.' }}
      </p>
    </template>

    <template v-else>
    <div class="section-label" style="margin-top: 0">
      <span>Vouchers</span>
      <button class="btn small" type="button" @click="adding = true">+ New</button>
    </div>
    <label class="search" style="margin-bottom: 10px">
      <Icon name="search" />
      <input v-model="query" type="search" placeholder="Search code, who paid, or note…" aria-label="Search vouchers">
    </label>
    <p v-if="query" class="field-hint" style="margin: -4px 0 10px">
      {{ list.length }} voucher{{ list.length === 1 ? '' : 's' }} · {{ fmt(remaining) }} still on {{ list.length === 1 ? 'it' : 'them' }}
    </p>
    <p class="field-hint" style="margin: -2px 0 8px">Hold a voucher for its options.</p>
    <div v-if="list.length" class="list">
      <div v-for="v in list" :key="v.id" class="voucher-row" :class="{ faded: v.status !== 'active', open: menuFor === v.id }">
        <div
          class="list-row" style="padding-left: 0; padding-right: 0" :aria-expanded="menuFor === v.id"
          @pointerdown="pressStart(v)" @pointerup="pressEnd" @pointerleave="pressEnd" @pointercancel="pressEnd" @pointermove="pressEnd"
          @click="openVoucher(v)" @contextmenu.prevent="menuFor = menuFor === v.id ? null : v.id"
        >
          <div class="grow">
            <div class="title" style="font-weight: 600">
              {{ v.code }} <span class="meta" style="font-weight: 400">· {{ label(v) }}</span>
              <span v-if="v.expiryNote" class="badge quiet" title="The expiry date was changed">✎ expiry changed</span>
            </div>
            <div class="meta">
              {{ shortDate(v.soldOn) }}<template v-if="v.buyer"> · {{ v.buyer }}</template><template v-if="v.voucherNote"> · “{{ v.voucherNote }}”</template><template v-if="v.note"> · {{ v.note }}</template>
              <template v-if="v.expiresOn"> · <span :class="{ orange: expired(v) }">{{ expired(v) ? 'expired' : 'expires' }} {{ long(v.expiresOn) }}</span></template>
            </div>
            <div v-for="(n, i) in (v.expiryNote || '').split('\n').filter(Boolean)" :key="i" class="meta orange">✎ {{ n }}</div>
            <div v-for="(u, i) in uses(v)" :key="'u' + i" class="meta">
              ↳ {{ fmt(u.amount) }} used {{ shortDate(u.date) }} {{ u.date.slice(0, 4) }}<template v-if="u.client"> · {{ u.client }}</template><template v-if="u.service"> · {{ u.service }}</template><template v-if="u.who"> · with {{ u.who }}</template>
            </div>
          </div>
          <div class="right">
            <div class="big">{{ fmt(v.balance) }}<template v-if="v.balance !== v.amount"> <span class="meta">/ {{ fmt0(v.amount) }}</span></template></div>
          </div>
        </div>
        <div v-if="extending?.id === v.id" class="voucher-extend">
          <label :for="'v-ext-' + v.id">New expiry for {{ v.code }}</label>
          <input :id="'v-ext-' + v.id" v-model="extending.expiresOn" type="date" :min="today">
          <button class="btn small" type="button" @click="confirmExtend">Save</button>
          <button class="btn small ghost" type="button" @click="extending = null">Cancel</button>
        </div>
      </div>
    </div>
    <div v-else class="empty" style="padding: 16px">{{ query ? 'No vouchers match that.' : 'No vouchers yet. Sell one above 🎁' }}</div>

    <Teleport to="body">
      <div v-if="held" class="voucher-pill" role="menu" :aria-label="`Options for ${held.code}`">
        <template v-if="held.status === 'active'">
          <button type="button" role="menuitem" @click="act(startShare, held)">
            <svg width="26" height="26" viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M12 2a10 10 0 0 0-8.6 15.1L2 22l5-1.3A10 10 0 1 0 12 2zm0 18.2a8.2 8.2 0 0 1-4.2-1.2l-.3-.2-3 .8.8-2.9-.2-.3A8.2 8.2 0 1 1 12 20.2zm4.5-6.1c-.2-.1-1.5-.7-1.7-.8-.2-.1-.4-.1-.6.1l-.8 1c-.1.2-.3.2-.5.1a6.7 6.7 0 0 1-3.3-2.9c-.3-.4.2-.4.7-1.3.1-.2 0-.3 0-.4l-.8-1.8c-.2-.5-.4-.4-.6-.4h-.5a1 1 0 0 0-.7.3 3 3 0 0 0-.9 2.2c0 1.3.9 2.6 1.1 2.7.1.2 1.9 2.9 4.6 4 1.7.7 2.3.8 3.2.7.5-.1 1.5-.6 1.7-1.2.2-.6.2-1.1.1-1.2l-.5-.3z"/></svg>
            <span>Send</span>
          </button>
          <button type="button" role="menuitem" @click="act(startExtend, held)"><Icon name="calendar" :size="26" :stroke="1.7" /><span>{{ expired(held) ? 'Extend' : 'Expiry' }}</span></button>
          <button type="button" role="menuitem" @click="act(remove, held)"><Icon name="ban" :size="26" :stroke="1.7" /><span>Void</span></button>
        </template>
        <button v-if="admin" type="button" role="menuitem" class="danger" @click="act(destroy, held)"><Icon name="trash" :size="26" :stroke="1.7" /><span>Delete</span></button>
      </div>
    </Teleport>

    <div class="modal-actions"><button class="btn ghost" @click="closeModal">Close</button></div>
    </template>
  </BaseModal>
</template>
