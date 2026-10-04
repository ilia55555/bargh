import{sha256}from'./hash.js';
export const APP_VERSION='12.0.0';
export const MODEL_LIBRARY_VERSION='2026.10';
export function newProject(name='Untitled Power-System Study'){
 return{schema:12,appVersion:APP_VERSION,name,created:new Date().toISOString(),modified:new Date().toISOString(),seed:20261005,
 network:{baseMVA:100,frequencyHz:60,buses:[],branches:[],transformers:[]},
 devices:{generators:[],loads:[],inverters:[],fleet:[],relays:[]},
 controls:{mpc:{enabled:true,mode:'coordinated',horizon:10,sampleTime:0.1,tolerance:5e-4,maxIterations:500,warmStart:true,adaptive:true},agc:{enabled:true},governors:true,exciters:true,pss:true},
 simulation:{dt:0.01,endTime:20,integrator:'RK4',algebraicTolerance:1e-9},
 experiments:[],runs:[],validation:{references:[],thresholds:{}},calibration:{},publication:{theme:'ieee'},notes:''
 }}
export async function fingerprintProject(p){const copy=structuredClone(p);delete copy.runs;delete copy.modified;return sha256(copy)}
export function downloadProject(p){const blob=new Blob([JSON.stringify({...p,modified:new Date().toISOString()},null,2)],{type:'application/json'});const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=(p.name||'gridmpc-project').replace(/[^a-z0-9_-]+/gi,'_')+'.gridmpc.json';a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000)}
export async function loadProjectFile(file){const j=JSON.parse(await file.text());if(!j||typeof j!=='object')throw new Error('Invalid project');return j}