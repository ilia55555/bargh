function n(v,d=0){const x=Number(v);return Number.isFinite(x)?x:d}
export function projectToMatpower(project){
 const buses=project.network.buses||[];if(!buses.length)throw new Error('Project has no buses');
 const idToNum=new Map();buses.forEach((b,i)=>idToNum.set(String(b.id),i+1));const busNum=b=>idToNum.get(String(b))??n(b,NaN);
 const generators=(project.devices.generators||[]).filter(g=>g.enabled!==false);let slack=buses.find(b=>String(b.type).toLowerCase()==='slack');if(!slack&&generators.length)slack=buses.find(b=>String(b.id)===String(generators[0].bus)||n(b.number,-1)===n(generators[0].bus,-2));if(!slack)slack=buses[0];
 const genBusSet=new Set(generators.map(g=>busNum(g.bus)));
 const bus=buses.map((b,i)=>{const no=i+1,isSlack=b===slack,type=isSlack?3:(String(b.type).toUpperCase()==='PV'||genBusSet.has(no)?2:1);return[no,type,n(b.Pd),n(b.Qd),n(b.Gs),n(b.Bs),n(b.area,1),n(b.Vm,1),n(b.Va),n(b.baseKV,345),n(b.zone,1),n(b.Vmax,1.06),n(b.Vmin,.94)]});
 const original=project.network.case?.gen||[];
 const gen=generators.map((g,i)=>{const no=busNum(g.bus);if(!Number.isFinite(no))throw new Error('Generator '+(g.name||g.id)+' references missing bus');const o=original.find(x=>x[0]===n(g.bus))||original[i]||[];return[no,n(g.P0,o[1]??0),n(g.Q0,o[2]??0),n(g.Qmax,o[3]??9999),n(g.Qmin,o[4]??-9999),n(g.Vg,o[5]??1),n(g.mBase,o[6]??g.Sn??project.network.baseMVA),1,n(g.Pmax,o[8]??g.Sn??9999),n(g.Pmin,o[9]??0),0,0,0,0,0,0,0,0,0,0,0]});
 if(!gen.length)throw new Error('Project needs at least one in-service generator');
 const makeBranch=(e,isTransformer=false)=>{const f=busNum(e.from),t=busNum(e.to);if(!Number.isFinite(f)||!Number.isFinite(t))throw new Error('Branch references missing bus');return[f,t,n(e.r,.001),n(e.x,.01),n(e.b),n(e.rateA),n(e.rateB,e.rateA),n(e.rateC,e.rateA),isTransformer?n(e.tap,1):n(e.tap,0),n(e.shift),e.status===0?0:1,n(e.angmin,-360),n(e.angmax,360)]};
 const branch=[...(project.network.branches||[]).map(e=>makeBranch(e,false)),...(project.network.transformers||[]).map(e=>makeBranch(e,true))];
 return{version:'2',baseMVA:n(project.network.baseMVA,100),bus,gen,branch,gencost:project.network.case?.gencost||[],source:'GridMPC Project Adapter',gridmpc:{busMap:Object.fromEntries(idToNum),reverseBusMap:Object.fromEntries([...idToNum].map(([k,v])=>[v,k]))}}
}
export function matpowerToProjectNetwork(mpc){
 return{
  baseMVA:mpc.baseMVA,frequencyHz:60,case:mpc,
  buses:mpc.bus.map((b,i)=>({id:String(b[0]),number:b[0],name:'Bus '+b[0],type:b[1]===3?'Slack':b[1]===2?'PV':'PQ',Pd:b[2],Qd:b[3],Gs:b[4],Bs:b[5],area:b[6],Vm:b[7],Va:b[8],baseKV:b[9],zone:b[10],Vmax:b[11],Vmin:b[12],ui:{x:40+(i%8)*110,y:40+Math.floor(i/8)*92}})),
  branches:mpc.branch.filter(b=>!(b[8]&&Math.abs(b[8]-1)>1e-12)||b[8]===0).map((b,i)=>({id:'BR'+(i+1),from:String(b[0]),to:String(b[1]),r:b[2],x:b[3],b:b[4],rateA:b[5],rateB:b[6],rateC:b[7],tap:b[8],shift:b[9],status:b[10],angmin:b[11],angmax:b[12]})),
  transformers:mpc.branch.filter(b=>b[8]&&Math.abs(b[8]-1)>1e-12).map((b,i)=>({id:'TR'+(i+1),from:String(b[0]),to:String(b[1]),r:b[2],x:b[3],b:b[4],rateA:b[5],rateB:b[6],rateC:b[7],tap:b[8],shift:b[9],status:b[10],angmin:b[11],angmax:b[12]}))
 }
}