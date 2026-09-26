import * as sheets from './backend.js'
import * as cloudflare from './backend-cf.js'
import { BACKEND } from './config.js'

/** The data layer in use (the Google Sheet, or Cloudflare), plus both for moving data across. */
export const backend = BACKEND === 'cloudflare' ? cloudflare : sheets
export { sheets, cloudflare }

/** Calls a data-layer function; always returns a Promise. */
export async function call(fn, ...args) {
  if (typeof backend[fn] !== 'function') throw new Error('Unknown function ' + fn)
  return backend[fn](...args)
}
