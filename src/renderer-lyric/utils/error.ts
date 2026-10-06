window.addEventListener('error', event => {
  console.error('An uncaught lyric error occurred:', event.error ?? event.message)
})
window.addEventListener('unhandledrejection', event => {
  console.error('Unhandled lyric rejection:', event.reason)
})
