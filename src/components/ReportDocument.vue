<script setup>
import { fmt } from '../lib/format.js'

/** A report (see lib/reports.js) as a clean document: on screen, and when printing / saving as PDF. */
defineProps({ report: { type: Object, required: true } })
const logo = import.meta.env.BASE_URL + 'brand/logo.png'
const cell = (v, col) => (col?.num && typeof v === 'number' ? fmt(v) : v ?? '')
</script>

<template>
  <article class="report">
    <header>
      <img class="ps-logo" :src="logo" alt="" width="170" height="49">
      <h1>{{ report.title }}</h1>
      <div class="rp-sub">{{ report.subtitle }}</div>
    </header>
    <section v-for="s in report.sections" :key="s.heading">
      <h2>{{ s.heading }}</h2>
      <p v-if="s.note" class="rp-note">{{ s.note }}</p>
      <div v-if="s.rows.length" class="rp-scroll">
        <table>
          <thead><tr><th v-for="(c, i) in s.columns" :key="i" :class="{ n: c.num || i > 0 && typeof s.rows[0]?.[i] === 'number' }">{{ c.label }}</th></tr></thead>
          <tbody><tr v-for="(r, j) in s.rows" :key="j"><td v-for="(v, i) in r" :key="i" :class="{ n: typeof v === 'number' }">{{ cell(v, s.columns[i]) }}</td></tr></tbody>
          <tfoot v-if="s.foot"><tr><td v-for="(v, i) in s.foot" :key="i" :class="{ n: typeof v === 'number' }">{{ cell(v, s.columns[i]) }}</td></tr></tfoot>
        </table>
      </div>
      <p v-else class="rp-note">{{ s.empty || 'Nothing to show.' }}</p>
    </section>
    <footer><p v-for="n in report.notes" :key="n">{{ n }}</p></footer>
  </article>
</template>
