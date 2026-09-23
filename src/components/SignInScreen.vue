<script setup>
import { signIn } from '../store.js'
</script>

<template>
  <div class="card welcome-card">
    <div class="logo"><svg width="40" height="40" viewBox="0 0 512 512" aria-hidden="true"><path d="M112 300c40-56 92-84 144-84s104 28 144 84" fill="none" stroke="#fff" stroke-width="30" stroke-linecap="round"/><g stroke="#fff" stroke-width="22" stroke-linecap="round"><path d="M150 262l-26-40"/><path d="M196 236l-14-46"/><path d="M256 226v-48"/><path d="M316 236l14-46"/><path d="M362 262l26-40"/></g></svg></div>
    <h2>Little Lash <em style="color: var(--brand)">Lounge</em></h2>
    <p>Your salon's takings, team and clients — all in one place.</p>
    <button class="btn google" @click="signIn">
      <svg viewBox="0 0 48 48" width="20" height="20" aria-hidden="true">
        <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z" />
        <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
        <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-7.9l-6.5 5C9.5 39.6 16.2 44 24 44z" />
        <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z" />
      </svg>
      Sign in with Google
    </button>
  </div>
</template>
