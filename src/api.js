/**
 * Calls a server function in apps-script/Code.gs.
 * Inside Google Apps Script this uses google.script.run; during local
 * development it posts to the preview server (dev/preview-server.cjs).
 */
export function call(fn, ...args) {
  const run = window.google?.script?.run
  if (run) {
    return new Promise((resolve, reject) => {
      run.withSuccessHandler(resolve).withFailureHandler(reject)[fn](...args)
    })
  }
  return fetch('/api/' + fn, { method: 'POST', body: JSON.stringify(args) })
    .then((r) => r.json())
    .then((r) => {
      if (r.error) throw new Error(r.error)
      return r.result
    })
}
