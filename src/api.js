import * as backend from './backend.js'

/** Calls a data-layer function (see backend.js); always returns a Promise. */
export async function call(fn, ...args) {
  if (typeof backend[fn] !== 'function') throw new Error('Unknown function ' + fn)
  return backend[fn](...args)
}
