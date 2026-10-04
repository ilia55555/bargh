import{modelLibrary}from'./modelLibrary.js';
const BASE=[
 {bus:39,Sn:10000,H:500.0,xdp:.0060},{bus:31,Sn:700,H:30.3,xdp:.0697},{bus:32,Sn:800,H:35.8,xdp:.0531},{bus:33,Sn:800,H:28.6,xdp:.0436},{bus:34,Sn:300,H:26.0,xdp:.1320},
 {bus:35,Sn:800,H:34.8,xdp:.0500},{bus:36,Sn:700,H:26.4,xdp:.0490},{bus:37,Sn:700,H:24.3,xdp:.0570},{bus:38,Sn:1000,H:34.5,xdp:.0570},{bus:30,Sn:1000,H:42.0,xdp:.0310}
];
export const IEEE39_EVBUS=[4,8,15,16,20,21,23,24,25,27];
export function ieee39Generators(mpc,{fullOrder=false}={}){return BASE.map((b,k)=>{const g=mpc.gen.find(x=>x[0]===b.bus),model=fullOrder?(b.bus===30?'GENSAL':'GENROU'):'Classical',lib=structuredClone(modelLibrary.machines[model].params);return{id:'G'+(k+1),name:'Generator '+(k+1),bus:b.bus,Sn:b.Sn,H:b.H,D:0,model,enabled:true,params:{...lib,H:b.H*(b.Sn/100),D:0,xdp:b.xdp,xdpp:lib.xdpp??Math.min(b.xdp,.25),xqpp:lib.xqpp??Math.min(b.xdp,.25),wb:2*Math.PI*60},P0:g?.[1]??0,Q0:g?.[2]??0,controller:{governor:'TGOV1',exciter:'EXST1',pss:'PSS1A'}}})}
export function ieee39Loads(mpc){return mpc.bus.filter(b=>Math.abs(b[2])+Math.abs(b[3])>1e-9).map((b,i)=>({id:'L'+(i+1),name:'Load '+b[0],bus:b[0],P0:b[2]/mpc.baseMVA,Q0:b[3]/mpc.baseMVA,model:'ZIP',zip:{zP:.2,iP:.3,pP:.5,zQ:.2,iQ:.3,pQ:.5},Kpf:1,Kqf:0,motorFraction:0}))}
export function ieee39Fleet(){return IEEE39_EVBUS.map((bus,i)=>({id:'EV'+(i+1),name:'EV/BESS '+bus,bus,type:'BatteryInverter',model:'GridFollowing',pmax:45,rampMWs:250,energyMWh:90,soc0:.7,socMin:.2,socMax:.9,eta:.95,enabled:true,participation:.1}))}