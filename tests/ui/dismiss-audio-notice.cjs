const wait = ms => new Promise(resolve => setTimeout(resolve, ms))

// Hosted Windows runners may have no audio output. Dismiss only that startup
// notice; leave every unrelated dialog visible so UI regressions still fail.
module.exports = async evaluate => {
  const hasOutput = await evaluate(`(async()=> (await navigator.mediaDevices.enumerateDevices()).some(d=>d.kind==='audiooutput'))()`)
  if (hasOutput) return false
  for (let i = 0; i < 50; i++) {
    const dismissed = await evaluate(`(()=>{const message=window.i18n.t('media_device__empty_device_tip');const main=[...document.querySelectorAll('#root > div main')].find(e=>e.textContent.trim()===message.trim());if(!main)return false;const button=main.parentElement.querySelector('footer button');if(!button)return false;button.click();return true})()`)
    if (dismissed) {
      console.log('Dismissed startup notice: no audio output device')
      await wait(300)
      return true
    }
    await wait(50)
  }
  throw new Error('No audio output device, but its startup notice was not found')
}
