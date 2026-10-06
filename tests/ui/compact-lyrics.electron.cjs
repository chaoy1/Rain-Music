const { app, BrowserWindow } = require('electron')
const fs = require('node:fs')
const path = require('node:path')
const { parse, compileScript } = require('@vue/compiler-sfc')
const root = path.resolve(__dirname, '../..')
app.whenReady().then(async() => {
  const { descriptor } = parse(fs.readFileSync(path.join(root, 'src/renderer-lyric/components/layout/CompactLyrics.vue'), 'utf8'))
  let code = compileScript(descriptor, { id: 'compact-regression', inlineTemplate: true }).content
  code = code.replace(/import\s+\{([\s\S]*?)\}\s+from\s+['"]([^'"]+)['"]/g, (_, names, source) => {
    const target = source === 'vue' || source.includes('vueTools') ? 'Vue' : source.includes('/ipc') ? 'ipc' : 'store'
    return `const {${names.replace(/\bas\b/g, ':')}} = ${target}`
  }).replace('export default', 'const component =')
  const win = new BrowserWindow({ show: false, webPreferences: { nodeIntegration: true, contextIsolation: false } })
  await win.loadURL('data:text/html,<div id="app"></div>')
  const results = await win.webContents.executeJavaScript(`(async() => {
    const Vue = require(${JSON.stringify(path.join(root, 'node_modules/vue/dist/vue.cjs.js'))});
    const makeLine = text => {
      const node = document.createElement('div'); node.className = 'font-mode';
      const line = document.createElement('span'); line.className = 'line'; line.textContent = text; node.append(line);
      return {text, dom_line: Vue.markRaw(node)};
    };
    const store = { lyric: Vue.reactive({lines: [makeLine('雨声'), makeLine('晨光')], line: 0}), setting: Vue.reactive({'desktopLyric.style.fontSize':20,'desktopLyric.style.opacity':100}), musicInfo: {} };
    const ipc = {setWindowBounds() {}};
    ${code}
    component.__cssModules = {$style: new Proxy({}, {get: (_, name) => name})};
    const instance = Vue.createApp(component); instance.config.globalProperties.$t = key => key; instance.mount('#app');
    await Vue.nextTick();
    const displayed = () => document.querySelector('[data-current-lyric]').textContent;
    const results = [{test:'first karaoke line appears', pass:displayed()==='雨声'}];
    store.lyric.line = 1; await Vue.nextTick();
    results.push({test:'advancing displays the next line', pass:displayed()==='晨光'});
    store.lyric.line = 0; await Vue.nextTick();
    results.push({test:'seeking backwards restores the original line', pass:displayed()==='雨声'});
    results.push({test:'original karaoke node is retained for animation updates',pass:store.lyric.lines[0].dom_line.contains(document.querySelector('[data-current-lyric] .line'))});
    return results;
  })()`)
  console.log(JSON.stringify(results, null, 2))
  app.exit(results.every(result => result.pass) ? 0 : 1)
}).catch(error => { console.error(error); app.exit(1) })
