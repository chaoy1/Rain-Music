const { app, BrowserWindow } = require('electron')
const fs = require('node:fs')
const path = require('node:path')
const { parse } = require('@vue/compiler-sfc')
const less = require('less')
const root = path.resolve(__dirname, '../..')
app.whenReady().then(async() => {
  const { descriptor } = parse(fs.readFileSync(path.join(root,'src/renderer/components/material/Pagination.vue'),'utf8'))
  const code = descriptor.script.content.replace(/import[^\n]+/, 'const { computed } = Vue').replace('export default','const component =')
  const css = (await less.render(descriptor.styles[0].content.replace(/@import[^;]+;/,''),{globalVars:{'radius-border':'10px'}})).css
  const win = new BrowserWindow({show:false,width:600,height:180,webPreferences:{nodeIntegration:true,contextIsolation:false}})
  await win.loadURL('data:text/html,<div id="app"></div>')
  await win.webContents.executeJavaScript(`
    window.Vue=require(${JSON.stringify(path.join(root,'node_modules/vue/dist/vue.cjs.js'))});
    window.calls=[]; window.props=Vue.reactive({count:300,limit:10,page:2});
    ${code}
    component.template=${JSON.stringify(descriptor.template.content)};
    component.__cssModules={$style:Object.fromEntries(${JSON.stringify([...descriptor.styles[0].content.matchAll(/\.([a-zA-Z][\w-]*)/g)].map(m=>m[1]))}.map(n=>[n,n]))};
    const style=document.createElement('style');style.textContent=${JSON.stringify(css)};document.head.append(style);
    const instance=Vue.createApp({render:()=>Vue.h(component,{...props,'onBtn-click':page=>calls.push(page)})});
    instance.config.globalProperties.$t=(key,values)=>key==='pagination__page'?'Page '+values.num:key;
    instance.mount('#app');void 0;
  `)
  const results = await win.webContents.executeJavaScript(`(async()=>{
    const results=[];const check=(test,pass)=>results.push({test,pass});
    const button=label=>document.querySelector('button[aria-label="'+label+'"]');
    check('current page is announced and keyboard focusable',button('Page 2')?.getAttribute('aria-current')==='page');
    button('Page 2')?.click();check('current page does not reload data',calls.length===0);
    button('pagination__next')?.click();button('pagination__prev')?.click();
    check('next and previous request adjacent pages',calls.join(',')==='3,1');calls.length=0;
    props.page=1;await Vue.nextTick();button('pagination__prev')?.click();
    check('previous is disabled on the first page',button('pagination__prev')?.disabled===true&&calls.length===0);
    props.page=30;await Vue.nextTick();button('pagination__next')?.click();
    check('next is disabled on the last page',button('pagination__next')?.disabled===true&&calls.length===0);
    props.page=15;await Vue.nextTick();button('Page 1')?.click();button('Page 30')?.click();
    check('distant first and last pages remain explicit jump targets',calls.join(',')==='1,30');
    props.count=1;await Vue.nextTick();check('single page hides pagination',document.querySelectorAll('button').length===0);
    return results;
  })()`)
  console.log(JSON.stringify(results,null,2))
  fs.writeFileSync(path.join(root,'.design/pagination-results.json'),JSON.stringify(results,null,2))
  app.exit(results.every(r=>r.pass)?0:1)
}).catch(error=>{console.error(error);app.exit(1)})
