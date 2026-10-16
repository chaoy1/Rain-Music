// 在真实 Chromium 里渲染 `src/renderer/platform/WindowControls.vue` 的**两条分支**。
//
// 验收项是「Android（Capacitor）上不出现 macOS 交通灯」。判定发生在
// `src/renderer/platform/index.ts`（判定表由 `tests/unit/android-shell-detection.test.cjs`
// 逐条钉住），**落地点**就是本文件要渲染的这个组件。两个方向都必须成立：
//   · 移动端 → 交通灯组件一次都不许被挂载（连实例都不该创建）；
//   · 桌面端 → 必须照旧挂载（主窗口 `frame: false`，它是关闭 / 最小化 / 全屏的唯一入口）。
// 只测移动端不够：把 `v-if` 写死成 false 也能让 Android 通过，却让桌面用户关不掉窗口。
//
// 交通灯在这里用**带挂载计数的替身组件**，而不是真的 `TrafficLights.vue`：本文件要证明的命题
// 是「移动端根本不会挂载交通灯」，计数比数按钮更直接。真实组件的三颗按钮与桌面 DOM 形状
// 由既有套件覆盖（`tests/ui/responsive-layout.electron.cjs`、`tests/ui/song-detail.electron.cjs`、
// `tests/ui/traffic-lights.electron.cjs`）。替身渲染 3 颗按钮是为了让桌面侧的断言有可比性。
const { app, BrowserWindow } = require('electron')
const fs = require('node:fs')
const path = require('node:path')
const { parse, compileScript } = require('@vue/compiler-sfc')
const root = path.resolve(__dirname, '../..')
const outDir = path.join(root, '.design/window-controls-shell')
const componentPath = path.join(root, 'src/renderer/platform/WindowControls.vue')

app.whenReady().then(async() => {
  const { descriptor } = parse(fs.readFileSync(componentPath, 'utf8'))
  const code = compileScript(descriptor, { id: 'window-controls-test', inlineTemplate: true }).content
    // 默认导入（交通灯组件）→ 交给 `store`，这样才能换成替身并数挂载次数。
    .replace(/import\s+([A-Za-z_$][\w$]*)\s+from\s+['"]@renderer\/components\/layout\/Toolbar\/TrafficLights\.vue['"]/,
      (_, name) => `const ${name} = store.${name}`)
    // 具名导入：`vue` 的编译期 helper 走 Vue，其余（`@renderer/platform` 的 `isDesktopShell`）走 store。
    .replace(/import\s+\{([\s\S]*?)\}\s+from\s+['"]([^'"]+)['"]/g, (_, names, source) => {
      const target = source === 'vue' ? 'Vue' : 'store'
      return `const {${names.replace(/\bas\b/g, ':')}} = ${target}`
    })
    .replace('export default', 'const component =')
  // 该组件没有 `<style>` 块，所以这里不需要 less（有的话 `descriptor.styles[0]` 会拿到样式）。
  if (descriptor.styles.length > 0) throw new Error('WindowControls.vue 新增了样式块，渲染替身需要同步处理')

  const win = new BrowserWindow({ show: false, webPreferences: { nodeIntegration: true, contextIsolation: false } })
  await win.loadURL('data:text/html,' + encodeURIComponent('<div id="desktop"></div><div id="mobile"></div>'))
  await win.webContents.executeJavaScript(`
    window.Vue = require(${JSON.stringify(path.join(root, 'node_modules/vue/dist/vue.cjs.js'))});
    window.trafficMounts = 0;
    window.windowControlsCode = ${JSON.stringify(code)};
    // 直接 eval 才能让编译产物里的 \`store\` / \`Vue\` 解析到调用方作用域；
    // 尾部的表达式把 \`component\` 作为 eval 的完成值返回（const 声明不会泄漏出 eval）。
    window.buildWindowControls = store => eval(window.windowControlsCode + '\\n;component');
    window.renderControls = (selector, isDesktopShell) => {
      const store = {
        isDesktopShell,
        TrafficLights: {
          name: 'TrafficLightsStub',
          mounted() { window.trafficMounts++ },
          template: '<button data-native-window-control></button>'.repeat(3)
        }
      };
      const instance = Vue.createApp(window.buildWindowControls(store));
      instance.config.globalProperties.$t = key => key;
      instance.mount(selector);
    };
    window.renderControls('#desktop', true);
    window.renderControls('#mobile', false);
    void 0;
  `)
  const result = await win.webContents.executeJavaScript(`(() => {
    const desktop = document.querySelector('#desktop');
    const mobile = document.querySelector('#mobile');
    const lights = scope => scope.querySelectorAll('[data-native-window-control]').length;
    return [
      {
        test: 'desktop shell still mounts the window controls (3 buttons reach the DOM)',
        pass: lights(desktop) === 3,
        detail: 'desktop buttons = ' + lights(desktop)
      },
      {
        test: 'desktop shell does not render the mobile placeholder',
        pass: desktop.querySelectorAll('[data-mobile-title-bar]').length === 0
      },
      {
        test: 'mobile shell never mounts the traffic-light component',
        pass: window.trafficMounts === 1,
        detail: 'traffic-light mounts = ' + window.trafficMounts + ' (expected 1: desktop only)'
      },
      {
        test: 'mobile shell renders zero window-control buttons',
        pass: lights(mobile) === 0,
        detail: 'mobile buttons = ' + lights(mobile)
      },
      {
        test: 'mobile shell renders zero focusable elements',
        pass: mobile.querySelectorAll('button, a[href], input, [tabindex]').length === 0
      },
      {
        test: 'mobile shell keeps the layout placeholder for the Aside / PlayDetail slots',
        pass: mobile.querySelectorAll('[data-mobile-title-bar]').length === 1 &&
          mobile.firstElementChild?.getAttribute('aria-hidden') === 'true'
      }
    ];
  })()`)
  console.log(JSON.stringify(result, null, 2))
  fs.mkdirSync(outDir, { recursive: true })
  fs.writeFileSync(path.join(outDir, 'results.json'), JSON.stringify(result, null, 2))
  app.exit(result.every(r => r.pass) ? 0 : 1)
}).catch(error => { console.error(error); app.exit(1) })
