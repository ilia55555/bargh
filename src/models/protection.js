export class ProtectionEngine{
 constructor(devices=[]){this.devices=structuredClone(devices);this.state=new Map()}
 reset(){this.state.clear()}
 step(t,dt,signals){const actions=[];for(const d of this.devices){if(d.enabled===false)continue;const key=d.id||d.name||JSON.stringify(d),s=this.state.get(key)||{timer:0,latched:false};let picked=false,value=null;
  if(d.type==='UFLS'){value=signals.frequency;picked=value<d.threshold}
  else if(d.type==='UVLS'){value=signals.voltage?.[d.bus-1]??1;picked=value<d.threshold}
  else if(d.type==='OverVoltage'){value=signals.voltage?.[d.bus-1]??1;picked=value>d.threshold}
  else if(d.type==='GeneratorTrip'){value=signals.frequency;picked=(d.trigger==='frequency'&&value<d.threshold)||(d.trigger==='time'&&t>=d.time)}
  else if(d.type==='Breaker'){picked=d.triggerTime!=null&&t>=d.triggerTime}
  s.timer=picked?s.timer+dt:0;if(!s.latched&&picked&&s.timer>=(d.delay||0)){s.latched=true;actions.push({time:t,device:d,action:d.action||defaultAction(d),measured:value})}this.state.set(key,s)}
 return actions}}
function defaultAction(d){if(d.type==='UFLS'||d.type==='UVLS')return{kind:'shed-load',fraction:d.fraction||.1,bus:d.bus};if(d.type==='GeneratorTrip')return{kind:'trip-generator',id:d.generatorId,bus:d.bus};if(d.type==='Breaker')return{kind:'open-branch',branch:d.branch};return{kind:'alarm'}}
export const protectionPresets={
 'UFLS-3stage':[{id:'ufls1',type:'UFLS',threshold:59.3,delay:.15,fraction:.1},{id:'ufls2',type:'UFLS',threshold:59.0,delay:.15,fraction:.1},{id:'ufls3',type:'UFLS',threshold:58.7,delay:.1,fraction:.15}]
};