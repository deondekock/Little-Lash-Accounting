<script setup>
import BaseModal from './BaseModal.vue'
import Icon from './Icon.vue'
import { state, closeModal, signOut, useDifferentSheet, refresh, openHistory } from '../store.js'

function run(fn) {
  closeModal()
  fn()
}
</script>

<template>
  <BaseModal title="Settings" @close="closeModal">
    <div class="list">
      <div class="list-row">
        <div class="avatar-btn" style="display:grid;place-items:center;flex:none">{{ (state.email || '?')[0].toUpperCase() }}</div>
        <div class="grow">
          <div class="title">{{ state.email || 'Google account' }}</div>
          <div class="meta">Signed in with Google</div>
        </div>
      </div>
      <a class="list-row" :href="state.spreadsheetUrl" target="_blank" rel="noopener" style="color: inherit; text-decoration: none">
        <Icon name="external" />
        <div class="grow"><div class="title">Open the Google Sheet</div><div class="meta">All data lives here</div></div>
      </a>
      <button class="list-row" @click="openHistory()">
        <Icon name="history" />
        <div class="grow"><div class="title">History &amp; undo</div><div class="meta">See every change and roll back mistakes</div></div>
      </button>
      <button class="list-row" @click="run(refresh)">
        <Icon name="refresh" />
        <div class="grow"><div class="title">Refresh</div><div class="meta">Load changes made on another phone</div></div>
      </button>
      <div class="list-row">
        <Icon name="calendar" />
        <div class="grow"><div class="title">Months start on day {{ state.monthStartDay }}</div><div class="meta">Change it in the sheet's Settings tab</div></div>
      </div>
      <button class="list-row" @click="run(useDifferentSheet)">
        <Icon name="swap" />
        <div class="grow"><div class="title">Use a different sheet</div></div>
      </button>
      <button class="list-row" @click="run(signOut)">
        <Icon name="logout" />
        <div class="grow"><div class="title">Sign out</div></div>
      </button>
    </div>
  </BaseModal>
</template>
