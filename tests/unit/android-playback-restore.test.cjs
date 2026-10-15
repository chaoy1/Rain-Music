const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')
const {spawnSync} = require('node:child_process')
const {test} = require('node:test')
const ts = require('typescript')
const vm = require('node:vm')
const load = require('./load-ts.cjs')
const root = path.resolve(__dirname,'../..')
const java = process.env.RAIN_RESTORE_JAVA_ROOT || path.join(root,'android/app/src/main/java/com/rainmusic/mobile/ipc')
const fixture = path.join(__dirname,'fixtures/android-playback-restore')
const shared = path.join(__dirname,'fixtures/android-music-add')
const work = fs.mkdtempSync(path.join(os.tmpdir(),'rain-playback-restore-'))
const jsonJar = process.env.RAIN_RESTORE_JSON_JAR
const song = (id,name=id,singer='Singer')=>({id,name,singer})
const original = [song('a','Ｓｏｎｇ'),song('b','song'),song('c','Other')]
const merged = [song('a','Ｓｏｎｇ'),song('c','Other')]
const play = (extra={})=>({listId:'default',index:1,time:42,volume:0.7,...extra})
const store = value=>JSON.stringify({untouched:{nested:['中文',1]},playInfo:value})
const get = (name,value,extra={})=>({name,seed:merged,snapshot:JSON.stringify(original),store:store(value),payload:'playInfo',...extra})
const save = (name,value,extra={})=>get(name,play(),{save:true,payload:{path:'playInfo',data:value},...extra})
const cases = [
 get('snapshot-index',play(),{dirtyAfter:true}),
 get('stable-id',play({index:0,musicId:'c'})),
 get('identity-fallback',play({index:0,musicId:'removed',musicName:' song ',musicSinger:'Ｓｉｎｇｅｒ'})),
 get('no-snapshot',play({index:2}),{seed:original,snapshot:undefined}),
 get('unresolved',play({index:8})),get('removed',play({musicId:'removed'})),
 get('empty',play(),{seed:[]}),
 get('bad-store',play(),{store:'{"playInfo":{}} trailing'}),
 get('bad-snapshot',play(),{snapshot:'[] trailing'}),
 get('bad-record',play(),{snapshot:'[{"id":1,"name":"Song","singer":"Singer"}]'}),
 get('bad-index',play({index:1.5})),
 get('commit-false',play(),{failCommit:true,retry:true}),
 get('delete-failure',play(),{failDelete:true,retry:true}),
 get('missing-table',play(),{drop:'db_info'}),
 save('save-pending',play()),save('save-id',play({musicId:'a'})),save('save-other',play({listId:'user'})),save('save-null',null),
 save('save-failure',play({musicId:'a'}),{failCommit:true}),
 get('get-other',play({listId:'user'})),get('get-negative',play({index:-1})),get('get-null',null),get('get-empty-store',null,{store:null}),
 get('other-path',play(),{payload:'untouched',drop:'db_info'}),
 save('other-save',['a'],{payload:{path:'searchHistoryList',data:['a']},drop:'db_info'}),
]
let results
function probe(){
 if(results)return results
 fs.mkdirSync(path.join(work,'src'),{recursive:true})
 const files={
 'android/content/Context.java':fs.readFileSync(path.join(fixture,'Context.java'),'utf8'),
 'android/content/SharedPreferences.java':fs.readFileSync(path.join(fixture,'SharedPreferences.java'),'utf8'),
 'com/rainmusic/mobile/ipc/TestPreferences.java':fs.readFileSync(path.join(fixture,'TestPreferences.java'),'utf8'),
 'com/rainmusic/mobile/ipc/RestoreProbe.java':fs.readFileSync(path.join(fixture,'RestoreProbe.java'),'utf8'),
 'com/rainmusic/mobile/ipc/RainMusicIpcPlugin.java':'package com.rainmusic.mobile.ipc; public class RainMusicIpcPlugin {private final android.content.Context context;public RainMusicIpcPlugin(android.content.Context context){this.context=context;}public android.content.Context getContext(){return context;}}',
 'com/getcapacitor/Logger.java':'package com.getcapacitor;public class Logger{public static void info(String t,String m){}public static void warn(String t,String m){}public static void debug(String t,String m){}public static void error(String t,String m){}}',
 'org/json/ProbeJson.java':'package org.json;public class ProbeJson{public static JSONObject parse(String text)throws JSONException{return new JSONObject(text);}}',
 }
 if (!jsonJar) {
   const text = fs.readFileSync(path.join(__dirname, 'android-playback-queue-merge.test.cjs'), 'utf8')
   const ast = ts.createSourceFile('stubs.cjs', text, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS)
   let initializer
   for (const statement of ast.statements) if (ts.isVariableStatement(statement)) {
     for (const declaration of statement.declarationList.declarations) if (declaration.name.getText(ast) === 'STUBS') initializer = declaration.initializer.getText(ast)
   }
   assert.ok(initializer)
   Object.assign(files, Object.fromEntries(Object.entries(vm.runInNewContext(`(${initializer})`)).filter(([file]) => file.startsWith('org/json/'))))
   files['org/json/ProbeJson.java'] = fs.readFileSync(path.join(shared,'ProbeJson.java'),'utf8').replace('private static Object wrap','static Object wrap')
   files['org/json/JSONObject.java'] = files['org/json/JSONObject.java']
     .replace('values.put(String.valueOf(entry.getKey()), entry.getValue());', 'values.put(String.valueOf(entry.getKey()), ProbeJson.wrap(entry.getValue()));')
     .replace('    public JSONObject() {}', `    public JSONObject() {}
       public JSONObject(java.util.Map values) { this.values.putAll(values); }
       public boolean isNull(String name) { Object value=opt(name); return value==null || value==NULL; }
       public JSONArray names() { JSONArray names=new JSONArray(); for(String key:values.keySet()) names.put(key); return names; }
       static Object parseForProbe(String text) throws JSONException {return new Parser(text).parseValue();}`)
   files['org/json/JSONArray.java'] = files['org/json/JSONArray.java'].replace('    public JSONArray() {}', `    public JSONArray() {}
       public JSONArray(String text) throws JSONException {
         Object value=JSONObject.parseForProbe(text);
         if(!(value instanceof java.util.List)) throw new JSONException("Expected array");
         for(Object item:(java.util.List<?>)value) values.add(ProbeJson.wrap(item));
       }`)
 }
 for(const [name,dir] of [['Cursor','android/database'],['SQLiteDatabase','android/database/sqlite'],['RainMusicDatabase','com/rainmusic/mobile/ipc']])files[`${dir}/${name}.java`]=fs.readFileSync(path.join(shared,`${name}.java`),'utf8')
 for(const [name,source]of Object.entries(files)){const file=path.join(work,'src',name);fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,source)}
 const run=(command,args)=>{const result=spawnSync(command,args,{encoding:'utf8',timeout:60000});assert.equal(result.status,0,result.stdout+result.stderr)}
 const sources=['RainMusicDataChannels','RainMusicPlaybackQueueRestore','RainMusicListMusicGetChannels','RainMusicPlaybackQueueKey','RainMusicIpcHandlers','RainMusicListWriteLock','RainMusicStoreLock','RainMusicLogThrottle'].map(name=>path.join(java,`${name}.java`))
 run('javac',['-encoding','UTF-8',...(jsonJar?['-cp',jsonJar]:[]),'-sourcepath',path.join(work,'src'),'-d',path.join(work,'out'),path.join(work,'src/com/rainmusic/mobile/ipc/RestoreProbe.java'),...sources])
 fs.writeFileSync(path.join(work,'schema.json'),JSON.stringify([...load('src/main/worker/dbService/tables.ts').default.values()]))
 fs.writeFileSync(path.join(work,'cases.json'),JSON.stringify({cases}))
 run('java',['-cp',jsonJar?`${path.join(work,'out')}${path.delimiter}${jsonJar}`:path.join(work,'out'),'com.rainmusic.mobile.ipc.RestoreProbe',process.execPath,path.join(shared,'sql-bridge.cjs'),path.join(work,'schema.json'),path.join(work,'cases.json'),path.join(work,'results.json')])
 results=Object.fromEntries(JSON.parse(fs.readFileSync(path.join(work,'results.json'),'utf8')).map(result=>[result.name,result]))
 return results
}
const preserved=(result)=>assert.deepEqual(JSON.parse(result.durable).untouched,{nested:['中文',1]})
test('Android restore remaps snapshot position by JS identity and durably acknowledges before disabling new snapshots',()=>{
 const r=probe()['snapshot-index'];assert.equal(r.error,undefined);assert.equal(r.result.index,0);assert.equal(r.result.musicId,'a');assert.equal(r.result.time,42);assert.equal(r.snapshots.length,0);assert.equal(r.writes,1);assert.equal(r.listLocked,true);assert.equal(r.storeLocked,true);preserved(r);assert.equal(r.againRows.length,2);assert.equal(r.againSnapshots.length,0)
})
test('Android restore prefers saved musicId then normalized identity and can repair without an existing snapshot',()=>{
 const r=probe();for(const name of ['stable-id','identity-fallback','no-snapshot']) assert.ok(r[name].result,name);assert.equal(r['stable-id'].result.index,1);assert.equal(r['stable-id'].result.musicId,'c');assert.equal(r['identity-fallback'].result.musicId,'a');assert.equal(r['no-snapshot'].result.index,1);assert.equal(r['no-snapshot'].result.musicId,'c');assert.equal(r['no-snapshot'].snapshots.length,0)
})
test('Android restore unresolved identities return null without acknowledging the snapshot or overwriting playInfo',()=>{
 for(const name of ['unresolved','removed','empty']){const r=probe()[name];assert.equal(r.result,null);assert.equal(r.writes,0);assert.equal(r.snapshots.length,1);assert.equal(r.durable,r.memory)}
})
test('Android restore rejects malformed full JSON, snapshot records, fractional index and database failures',()=>{
 for(const name of ['bad-store','bad-snapshot','bad-record','bad-index','missing-table']){const r=probe()[name];assert.ok(r.error,name);assert.equal(r.writes,0,name);if(r.snapshots)assert.equal(r.snapshots.length,1,name)}
})
test('Android restore failed Preferences commit retains the snapshot and stable identity makes retry safe',()=>{
 const r=probe()['commit-false'];assert.match(r.error,/commit/);assert.equal(r.snapshots.length,1);assert.equal(JSON.parse(r.durable).playInfo.index,1);assert.equal(r.retryError,undefined);assert.equal(r.retryResult.musicId,'a');assert.equal(r.retrySnapshots.length,0)
})
test('Android restore failed snapshot DELETE propagates after a durable save and succeeds safely on retry',()=>{
 const r=probe()['delete-failure'];assert.match(r.error,/Injected SQL/);assert.equal(JSON.parse(r.durable).playInfo.musicId,'a');assert.equal(r.snapshots.length,1);assert.equal(r.retryResult.musicId,'a');assert.equal(r.retrySnapshots.length,0)
})
test('Android save playInfo only finishes for stable identity or another list after successful persistence',()=>{
 const r=probe();assert.equal(r['save-pending'].snapshots.length,1);for(const name of ['save-id','save-other','save-null']){assert.equal(r[name].snapshots.length,0,name);assert.equal(r[name].writes,1,name);preserved(r[name]);assert.equal(r[name].listLocked,true,name)}assert.ok(r['save-failure'].error);assert.equal(r['save-failure'].snapshots.length,1)
})
test('Android get inactive or absent playInfo commits its acknowledgement and other data paths never open SQLite',()=>{
 const r=probe();for(const name of ['get-other','get-negative','get-null','get-empty-store']){assert.equal(r[name].snapshots.length,0,name);assert.equal(r[name].writes,1,name)}assert.deepEqual(r['other-path'].result,{nested:['中文',1]});assert.equal(r['other-path'].writes,0);assert.equal(r['other-save'].error,undefined);assert.deepEqual(JSON.parse(r['other-save'].durable).searchHistoryList,['a']);assert.equal(r['other-save'].listLocked,false)
})
module.exports={work,probe}
