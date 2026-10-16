// 在真实 Chromium 里渲染 `SettingDownload.vue` 的两个分支（桌面 / 移动），并验证两半修复：
//   1) 移动端**不渲染**"保存路径"那一行（既不是真的落盘目录、按钮又点不动）；
//   2) 桌面端"更改保存路径"**失败时会说出来**，不再是一次静默无反应的点击。
//
// 组件是 Options API + `<template lang="pug">`，所以这里走 `descriptor.script.content` +
// `compileTemplate({ preprocessLang: 'pug' })`（两种写法都与 `window-controls-shell.electron.cjs` 同源：
// 只替换边界依赖，组件本体是仓库里的真实 SFC）。
const { app, BrowserWindow } = require('electron')
const fs = require('node:fs')
const path = require('node:path')
const { parse, compileTemplate } = require('@vue/compiler-sfc')
const root = path.resolve(__dirname, '../..')
const outDir = path.join(root, '.design/setting-download-shell')
const componentPath = path.join(root, 'src/renderer/views/Setting/components/SettingDownload.vue')

// 一个不可能真实存在的哨兵路径：只在"路径被显示出来"时才会出现在 DOM 里。
const SENTINEL_PATH = '/home/rain-user/Desktop'

app.whenReady().then(async() => {
  const { descriptor } = parse(fs.readFileSync(componentPath, 'utf8'))
  if (!descriptor.script) throw new Error('SettingDownload.vue 不再是 Options API 的 <script>，渲染替身需要同步处理')
  const scriptCode = descriptor.script.content
    .replace(/import\s+\{([\s\S]*?)\}\s+from\s+['"]([^'"]+)['"]/g, (_, names) => `const {${names.replace(/\bas\b/g, ':')}} = store`)
    .replace('export default', 'const component =')
  const template = compileTemplate({ source: descriptor.template.content, filename: componentPath, id: 'setting-download', preprocessLang: 'pug' })
  if (template.errors.length > 0) throw new Error(`模板编译失败: ${template.errors.join('; ')}`)
  const templateCode = template.code
    .replace(/import\s+\{([\s\S]*?)\}\s+from\s+["']vue["']/, (_, names) => `const {${names.replace(/\bas\b/g, ':')}} = Vue`)
    .replace('export function render', 'function render')
  const code = `${scriptCode}\n${templateCode}\ncomponent.render = render\ncomponent`

  const win = new BrowserWindow({ show: false, webPreferences: { nodeIntegration: true, contextIsolation: false } })
  await win.loadURL('data:text/html,' + encodeURIComponent('<div id="desktop"></div><div id="mobile"></div>'))
  const setupResult = await win.webContents.executeJavaScript(`(() => { try {
    window.Vue = require(${JSON.stringify(path.join(root, 'node_modules/vue/dist/vue.cjs.js'))});
    window.settingDownloadCode = ${JSON.stringify(code)};
    window.buildSettingDownload = store => eval(window.settingDownloadCode);
    window.records = {};
    window.mountSettings = (selector, key, isDesktopShell, { pickerRejects } = {}) => {
      const record = { dialog: [], updateSetting: [], openDirInExplorer: [], selectDialog: 0 };
      window.records[key] = record;
      const store = {
        isDesktopShell,
        // 真实设置里的默认值形态（web 构建下 os.homedir() 是 polyfill，形如 /home/user/Desktop）。
        appSetting: { 'download.savePath': ${JSON.stringify(SENTINEL_PATH)}, 'download.enable': true },
        updateSetting: value => record.updateSetting.push(value),
        openDirInExplorer: value => record.openDirInExplorer.push(value),
        dialog: options => { record.dialog.push(options && options.message); return Promise.resolve() },
        useI18n: () => key => key,
        showSelectDialog: () => { record.selectDialog++; return pickerRejects ? Promise.reject(new Error('Directory selection requires Android document-tree support')) : Promise.resolve({ canceled: true, filePaths: [] }) },
        getSystemFonts: undefined
      };
      const instance = Vue.createApp(window.buildSettingDownload(store));
      instance.config.globalProperties.$t = key => key;
      // 模板里 :class="$style.savePath" 要解析到 CSS-modules 映射；而这个类的样式块在本文件里
      // **是注释掉的**，所以真实运行时 $style.savePath 就是 undefined —— 空对象才是忠实替身
      // （第一版没给 $style，于是渲染直接抛 "Cannot read properties of undefined (reading 'savePath')"）。
      instance.config.globalProperties.$style = {};
      // 两个真实组件用替身：base-btn 必须把点击转成组件的 click 事件，否则测不到那个调用点。
      instance.component('base-checkbox', { name: 'base-checkbox', props: ['modelValue', 'label', 'id'], template: '<div data-stub-checkbox><slot /></div>' });
      instance.component('base-btn', { name: 'base-btn', emits: ['click'], template: '<button data-change-save-path type="button" @click="$emit(\\'click\\')"><slot /></button>' });
      instance.mount(selector);
    };
    window.mountSettings('#desktop', 'desktop', true, { pickerRejects: true });
    window.mountSettings('#mobile', 'mobile', false);
    return 'SETUP OK';
  } catch (error) { return 'SETUP ERROR: ' + String(error && error.stack || error) } })()`)
  if (setupResult !== 'SETUP OK') {
    console.error(setupResult)
    app.exit(1)
    return
  }
  const result = await win.webContents.executeJavaScript(`(async () => {
    const desktop = document.querySelector('#desktop');
    const mobile = document.querySelector('#mobile');
    const flush = () => new Promise(resolve => setTimeout(resolve, 0));
    const results = [];
    const push = (test, pass, detail) => results.push(detail === undefined ? { test, pass } : { test, pass, detail });

    // 桌面：这一行必须还在（写死 v-if=false 能让移动端"过"，却会砍掉桌面端仍然可用的功能）。
    push('desktop keeps the save-path row', desktop.querySelector('#download_path') !== null);
    push('desktop still renders the change button', desktop.querySelector('[data-change-save-path]') !== null);
    push('desktop shows the configured path', desktop.textContent.includes(${JSON.stringify(SENTINEL_PATH)}));
    push('desktop keeps the download enable switch', desktop.querySelector('[data-stub-checkbox]') !== null);

    // 桌面：选目录失败时必须**说出来**（原来是未处理 rejection ⇒ 静默无反应）。
    // 按钮不在时**不许**在这里崩：那会让"桌面端这一行被写没了"变成一次崩溃而不是一条具名失败
    // （第一版就是这么写的，变异 M2 只给出 exit 1、给不出是哪条断言红的）。
    const changeButton = desktop.querySelector('[data-change-save-path]');
    if (changeButton) changeButton.click();
    await flush(); await flush();
    const record = window.records.desktop;
    push('a rejected directory picker is reported, not swallowed', record.dialog.length === 1, JSON.stringify(record.dialog));
    push('a rejected directory picker does not write a path', record.updateSetting.length === 0, JSON.stringify(record.updateSetting));

    // 移动端：整行不该渲染（显示的是不存在的路径，按钮点不动）。
    push('mobile hides the save-path row', mobile.querySelector('#download_path') === null);
    push('mobile renders no change button', mobile.querySelector('[data-change-save-path]') === null);
    push('mobile never shows the desktop-only path', !mobile.textContent.includes(${JSON.stringify(SENTINEL_PATH)}));
    push('mobile keeps the download enable switch', mobile.querySelector('[data-stub-checkbox]') !== null);
    return results;
  })()`)
  console.log(JSON.stringify(result, null, 2))
  fs.mkdirSync(outDir, { recursive: true })
  fs.writeFileSync(path.join(outDir, 'results.json'), JSON.stringify(result, null, 2))
  app.exit(result.every(r => r.pass) ? 0 : 1)
}).catch(error => { console.error(error); app.exit(1) })
