/**
 * Android 移植 · 阶段 3 / 线 A 的传输层回归测试。
 *
 * 目的：证明"引入可替换的 HTTP 传输层 + `statusCode`→`status` 机械改名"之后，
 * **桌面路径的行为没有变化**。做法是起一个本地 `node:http` 服务，把真实的
 * `src/renderer/utils/request.js`（通过它默认的桌面 needle 适配器）打上去，逐条钉住：
 *
 * - 返回值形状：`status` / `statusText` / `headers` / `raw` / `body`（JSON 自动解析）；
 * - `form` 请求体 → `application/x-www-form-urlencoded`；`body` 对象 → JSON；
 * - needle 默认 `follow_max = 0`：**不跟随**重定向，3xx 的 `location` 原样返回
 *   （`kg`/`wy`/`tx` 三个歌单分享链接解析点依赖这条语义）；
 * - `cancelHttp()` 仍然能让 promise 以 "取消http请求" 拒绝。
 *
 * 这些断言与改动前的旧实现（直接 `needle.request`）是同一组期望值，所以它同时是
 * "阶段 3 没有回归桌面行为"的证据。
 */
const assert = require('node:assert/strict')
const { test, before, after } = require('node:test')
const http = require('node:http')
const load = require('./load-ts.cjs')

// 默认路径 = 桌面的 needle 适配器（`platform/http/index.js` 就是转出它）。
// 这里按 load-ts 的约定显式注入依赖：`request.js` 的 `./env` / `./message` 都是 ESM，
// 原生 `require` 解析不了（`./message` 是 .ts，`./env` 是 ESM 的 .js）。
const desktopTransport = load('src/renderer/platform/http/desktop.js').transport
const { httpFetch } = load('src/renderer/utils/request.js', {
  '../platform/http/index.js': { transport: desktopTransport },
  './env': { debugRequest: false },
  './message': {
    requestMsg: {
      unachievable: '哦No😱...接口无法访问了！',
      timeout: '请求超时',
      notConnectNetwork: '无法连接到服务器',
      cancelRequest: '取消http请求',
    },
  },
})

let server
let baseUrl

before(async() => {
  server = http.createServer((req, res) => {
    const chunks = []
    req.on('data', chunk => chunks.push(chunk))
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString()
      switch (req.url) {
        case '/json':
          res.writeHead(200, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ code: 200, echo: raw }))
          break
        case '/redirect':
          res.writeHead(302, { Location: '/json' })
          res.end()
          break
        case '/notfound':
          res.writeHead(404, { 'Content-Type': 'text/plain' })
          res.end('nope')
          break
        case '/slow':
          setTimeout(() => {
            res.writeHead(200, { 'Content-Type': 'application/json' })
            res.end('{"code":200}')
          }, 3000)
          break
        default:
          res.writeHead(200, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({
            code: 200,
            method: req.method,
            contentType: req.headers['content-type'],
            accept: req.headers.accept,
            body: raw,
          }))
      }
    })
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  baseUrl = `http://127.0.0.1:${server.address().port}`
})

after(() => new Promise(resolve => server.close(resolve)))

test('GET + JSON 响应：status / headers / raw / body 形状不变', async() => {
  const resp = await httpFetch(`${baseUrl}/json`).promise
  assert.equal(resp.status, 200)
  assert.equal(resp.statusText, 'OK')
  assert.equal(resp.headers['content-type'], 'application/json')
  assert.ok(Buffer.isBuffer(resp.raw))
  // body 由 request.js 从 raw.toString() 再 JSON.parse 得到（与改动前同一段代码）。
  // 注意：JSON.parse 发生在 vm 内部，跨 realm 的 deepStrictEqual 会因为原型不同而失败，
  // 所以这里比较序列化结果。
  assert.equal(JSON.stringify(resp.body), JSON.stringify({ code: 200, echo: '' }))
})

test('form 请求体：x-www-form-urlencoded（`json` 被 request.js 置为 false）', async() => {
  const resp = await httpFetch(`${baseUrl}/echo`, {
    method: 'post',
    form: { params: 'a+b/c=', encSecKey: '0f' },
  }).promise
  assert.equal(resp.body.contentType, 'application/x-www-form-urlencoded')
  assert.equal(resp.body.body, 'params=a%2Bb%2Fc%3D&encSecKey=0f')
  // 非 json 请求不额外带 Accept: application/json
  assert.notEqual(resp.body.accept, 'application/json')
})

test('body 对象：JSON.stringify + application/json + Accept', async() => {
  const resp = await httpFetch(`${baseUrl}/echo`, {
    method: 'post',
    body: { appid: 1001, data: [1, 2] },
  }).promise
  assert.equal(resp.body.contentType, 'application/json; charset=utf-8')
  assert.equal(resp.body.accept, 'application/json')
  assert.deepEqual(JSON.parse(resp.body.body), { appid: 1001, data: [1, 2] })
})

test('默认不跟随重定向：3xx 的 status 与 location 原样返回', async() => {
  const resp = await httpFetch(`${baseUrl}/redirect`).promise
  assert.equal(resp.status, 302)
  assert.equal(resp.headers.location, '/json')
})

test('非 200 也照常 resolve（错误判定留给调用方）', async() => {
  const resp = await httpFetch(`${baseUrl}/notfound`).promise
  assert.equal(resp.status, 404)
  assert.equal(resp.body, 'nope')
})

test('cancelHttp 让 promise 以"取消http请求"拒绝', async() => {
  const requestObj = httpFetch(`${baseUrl}/slow`)
  requestObj.cancelHttp()
  await assert.rejects(requestObj.promise, { message: '取消http请求' })
})
