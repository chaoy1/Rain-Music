const assert = require('node:assert/strict')
const { test } = require('node:test')
const path = require('node:path')
const http = require('node:http')
const load = require('./fixtures/android-user-api/load.cjs')
const web = () => load(path.join(process.env.RAIN_USER_API_TEST_ROOT || path.resolve(__dirname, '../..'), 'src/renderer/platform/userApi/web.js'))

test('real localStorage adapter round-trips one snapshot and rejects quota, malformed JSON and access errors', async() => {
  const {createUserApiStorage} = web()
  const map = new Map()
  const storage = createUserApiStorage({getItem:key=>map.get(key)??null,setItem:(key,value)=>map.set(key,value)})
  assert.equal(await storage.read(), null)
  const value = {version:1,apis:[],selectedId:''}
  await storage.write(value)
  assert.deepEqual(await storage.read(), value)
  assert.equal(map.size,1)
  const key = [...map.keys()][0]
  map.set(key,'bad json')
  await assert.rejects(storage.read(), /JSON/)
  await assert.rejects(createUserApiStorage({setItem(){throw Error('quota')}}).write(value), /quota/)
  await assert.rejects(createUserApiStorage({getItem(){throw Error('security')}}).read(), /security/)
})

test('WebView HTTP adapter uses real transport and preserves JSON body/raw bytes/status and form encoding', async t => {
  let observed
  const server = http.createServer((request,response) => {
    let body = ''
    request.on('data',data=>{body+=data})
    request.on('end',()=> {
      observed={method:request.method,body,headers:request.headers}
      response.writeHead(201,{'Content-Type':'application/json','X-Test':'response'})
      response.end(JSON.stringify({ok:true,text:'中文'}))
    })
  })
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve))
  t.after(()=>server.close())
  const {userApiHttpRequest} = web()
  const result = await new Promise((resolve,reject)=> userApiHttpRequest(`http://127.0.0.1:${server.address().port}/test`, {method:'post',form:{query:'hello world'},headers:{'X-Request':'request'},timeout:1000}, (error,response,body)=> error?reject(error):resolve({response,body})))
  assert.equal(observed.method,'POST')
  assert.equal(observed.body,'query=hello+world')
  assert.equal(observed.headers['x-request'],'request')
  assert.equal(result.response.statusCode,201)
  assert.equal(result.response.headers['x-test'],'response')
  assert.deepEqual(result.body,{ok:true,text:'中文'})
  assert.deepEqual(result.response.body,result.body)
  assert.deepEqual(JSON.parse(Buffer.from(result.response.raw).toString()),result.body)
})

test('WebView HTTP adapter sends an object body as JSON when the script sets a JSON content type', async t => {
  // 这条钉的是"社区脚本的典型形状"：**对象 body + 自己写 Content-Type: application/json**，且
  // **不传 json**。适配器以前把 `json: false` 写死，于是这种请求被表单序列化、头却还是 json，
  // 服务端按 JSON 解析直接失败 —— 一整类社区音源脚本因此不可用。
  let observed
  const server = http.createServer((request,response) => {
    let body = ''
    request.on('data',data=>{body+=data})
    request.on('end',()=> {
      observed={method:request.method,body,headers:request.headers}
      response.writeHead(200,{'Content-Type':'application/json'})
      response.end('{"ok":true}')
    })
  })
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve))
  t.after(()=>server.close())
  const {userApiHttpRequest} = web()
  await new Promise((resolve,reject)=> userApiHttpRequest(`http://127.0.0.1:${server.address().port}/test`, {method:'post',body:{a:1,b:'x y'},headers:{'Content-Type':'application/json'},timeout:1000}, (error,response,body)=> error?reject(error):resolve(body)))
  assert.equal(observed.headers['content-type'],'application/json','调用方给的头必须原样保留')
  assert.equal(observed.body,JSON.stringify({a:1,b:'x y'}),'JSON 内容类型必须产生 JSON body，而不是表单字节')
  // 派生出来的 json **不**补 Accept（needle 用的是 options.json 本身）；真实 fetch 自己可能补别的值，
  // 所以只断言"不是 application/json"。
  assert.notEqual(observed.headers.accept,'application/json')
})
