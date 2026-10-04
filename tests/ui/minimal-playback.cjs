const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
const Vue = require('vue')
const root = path.resolve(__dirname, '../..')
const evaluateTs = (file, boundaries = {}) => {
  const output = ts.transpileModule(fs.readFileSync(path.join(root, file), 'utf8'), {compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText
  const module = {exports:{}}
  new Function('require','module','exports',output)(id => Object.hasOwn(boundaries,id) ? boundaries[id] : require(id),module,module.exports)
  return module.exports
}
const defaults = evaluateTs('src/common/defaultSetting.ts',{'./constants':{TRAY_AUTO_ID:'auto',DEFAULT_THEME_ID:'mono',THEME_LIGHT_ID:'mono',THEME_DARK_ID:'mono_dark'}}).default
const {getStandardPlaybackPatch} = evaluateTs('src/renderer/utils/standardPlayback.ts',{'@common/defaultSetting':{__esModule:true,default:defaults}})
const results = []
const check = (test,pass) => {results.push({test,pass});console.log(`${pass?'PASS':'FAIL'} ${test}`)}
const original = {...defaults,'player.volume':.32,'theme.id':'mono_dark','common.apiSource':'custom','player.togglePlayMethod':'none','player.soundEffect.biquadFilter.hz125':6,'player.soundEffect.convolution.fileName':'custom.wav','player.soundEffect.panner.enable':true,'player.soundEffect.pitchShifter.playbackRate':1.2,'player.playbackRate':1.4,'player.audioVisualization':true}
const patch = getStandardPlaybackPatch(original)
check('standard playback neutralizes EQ, convolution and panning',patch['player.soundEffect.biquadFilter.hz125']===0&&patch['player.soundEffect.convolution.fileName']===''&&patch['player.soundEffect.panner.enable']===false)
check('standard playback restores normal pitch and speed',patch['player.soundEffect.pitchShifter.playbackRate']===1&&patch['player.playbackRate']===1)
check('removed visualization and disabled switching restore useful defaults',patch['player.audioVisualization']===false&&patch['player.togglePlayMethod']==='listLoop')
check('neutral playback preserves volume, theme and user API preferences',!Object.hasOwn(patch,'player.volume')&&!Object.hasOwn(patch,'theme.id')&&!Object.hasOwn(patch,'common.apiSource')&&original['player.soundEffect.biquadFilter.hz125']===6)
check('standard playback settings need no rewrite',Object.keys(getStandardPlaybackPatch({...defaults})).length===0)
const appSetting=Vue.reactive({'player.togglePlayMethod':'list'}),saved=[]
const useNext = evaluateTs('src/renderer/utils/compositions/useNextTogglePlay.ts',{'@renderer/store/setting':{appSetting,setTogglePlayMode:mode=>saved.push(mode)},'@common/utils/vueTools':Vue,'@renderer/plugins/i18n':{useI18n:()=>key=>key}}).default
const controller=useNext()
for(let i=0;i<4;i++)controller.toggleNextPlayMode()
check('successive mode clicks cycle without waiting for IPC',saved.join(',')==='listLoop,singleLoop,random,list'&&appSetting['player.togglePlayMethod']==='list')
check('no mode cycle includes disabled song switching',!saved.includes('none'))
appSetting['player.togglePlayMethod']='none'
check('legacy disabled mode is not advertised to the user',controller.nextTogglePlayName.value==='player__play_toggle_mode_list_loop')
controller.toggleNextPlayMode()
check('a legacy disabled mode recovers to a playable mode',appSetting['player.togglePlayMethod']==='list')
fs.writeFileSync(path.join(root,'.design/minimal-playback-results.json'),JSON.stringify(results,null,2))
process.exit(results.every(item=>item.pass)?0:1)
