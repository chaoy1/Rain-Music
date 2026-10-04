// Exercise the real Vue component in Chromium, with only the IPC boundary substituted.
const { app, BrowserWindow } = require('electron')
const fs = require('node:fs')
const path = require('node:path')
const { parse, compileScript } = require('@vue/compiler-sfc')
const less = require('less')
const root = path.resolve(__dirname, '../..')
const componentPath = path.join(root, 'src/renderer/components/layout/Toolbar/TrafficLights.vue')

app.whenReady().then(async() => {
  const { descriptor } = parse(fs.readFileSync(componentPath, 'utf8'))
  let code = compileScript(descriptor, { id: 'traffic-test', inlineTemplate: true }).content
  code = code.replace(/import\s+\{([\s\S]*?)\}\s+from\s+['"]([^'"]+)['"]/g, (_, names, source) => {
    const target = source === 'vue' || source.includes('vueTools') ? 'Vue' : source.includes('/ipc') ? 'ipc' : 'store'
    return `const {${names.replace(/\bas\b/g, ':')}} = ${target}`
  }).replace('export default', 'const component =')
  const css = (await less.render(descriptor.styles[0].content.replace(/@import[^;]+;/, ''), {
    globalVars: { 'transition-fast': '.16s ease' },
  })).css.replace(/:global\(([^)]+)\)/g, '$1')
  const win = new BrowserWindow({ show: false, webPreferences: { nodeIntegration: true, contextIsolation: false } })
  await win.loadURL('data:text/html,<div id="app"></div>')
  await win.webContents.executeJavaScript(`
    window.Vue = require(${JSON.stringify(path.join(root, 'node_modules/vue/dist/vue.cjs.js'))});
    window.calls = [];
    window.ipc = {
      closeWindow: () => calls.push('close'), quitApp: () => calls.push('quit'),
      minWindow: () => calls.push('min'), setFullScreen: async value => { calls.push(value); return value; }
    };
    window.store = { isFullscreen: Vue.ref(false) };
    window.app_event = new (require('node:events').EventEmitter)();
    ${code}
    component.__cssModules = { $style: Object.fromEntries(${JSON.stringify([...descriptor.styles[0].content.matchAll(/\.([a-zA-Z][\w-]*)/g)].map(m => m[1]))}.map(name => [name, name])) };
    const style = document.createElement('style'); style.textContent = ${JSON.stringify(css)}; document.head.append(style);
    const instance = Vue.createApp(component); instance.config.globalProperties.$t = key => key; instance.mount('#app'); void 0;
  `)
  const result = await win.webContents.executeJavaScript(`(async() => {
    const results = [];
    const buttons = () => [...document.querySelectorAll('button')];
    buttons()[0].click(); results.push({ test: 'red closes the window instead of quitting the app', pass: calls.pop() === 'close' });
    buttons()[1].click(); results.push({ test: 'yellow minimizes', pass: calls.pop() === 'min' });
    buttons()[2].click(); buttons()[2].click();
    results.push({ test: 'rapid green clicks cannot issue conflicting fullscreen requests', pass: calls.filter(value => typeof value === 'boolean').length === 1 });
    await Vue.nextTick(); await new Promise(r => setTimeout(r, 0));
    results.push({ test: 'green synchronizes fullscreen state from IPC response', pass: store.isFullscreen.value === true });
    store.isFullscreen.value = true; await Vue.nextTick();
    const green = buttons()[2];
    results.push({ test: 'fullscreen retains a visible exit control with correct label', pass: green.getBoundingClientRect().width > 0 && green.getAttribute('aria-label') === 'fullscreen_exit' });
    window.dispatchEvent(new Event('focus')); await Vue.nextTick();
    window.dispatchEvent(new Event('blur')); await Vue.nextTick();
    const pseudo = getComputedStyle(buttons()[0], '::before');
    const gray = pseudo.content !== 'none' ? pseudo.backgroundColor : getComputedStyle(buttons()[0]).backgroundColor;
    results.push({ test: 'native window blur makes the controls inactive', pass: gray !== 'rgb(255, 95, 87)' && gray !== 'rgba(0, 0, 0, 0)' });
    return results;
  })()`)
  console.log(JSON.stringify(result, null, 2))
  fs.writeFileSync(path.join(root, '.design/traffic-test-results.json'), JSON.stringify(result, null, 2))
  app.exit(result.every(r => r.pass) ? 0 : 1)
}).catch(error => { console.error(error); app.exit(1) })
