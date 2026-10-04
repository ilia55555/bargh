import{nsga2}from'./nsga2.js';
function seeded(seed=1){let x=seed>>>0;return()=>((x=(1664525*x+1013904223)>>>0)/4294967296)}
function normal(R){let u=0,v=0;while(!u)u=R();while(!v)v=R();return Math.sqrt(-2*Math.log(u))*Math.cos(2*Math.PI*v)}
export function defaultMicrogrid(){return{
 methodNote:'Method-aligned with Torkan, Ilinca & Ghorbanzadeh, Renewable Energy 2022; not an exact numerical reproduction without the authors complete input dataset.',
 hours:24,powerFactor:.95,
 load:[58,55,53,52,53,58,67,75,82,88,92,96,98,96,93,91,95,104,110,103,90,78,68,61],
 pv:[0,0,0,0,0,0,2,10,25,42,55,64,68,64,52,36,18,5,0,0,0,0,0,0],
 wind:[32,30,28,26,25,24,25,27,30,35,38,40,42,44,45,43,41,38,36,34,33,32,31,30],
 price:[55,50,46,44,45,52,65,78,92,108,120,128,132,126,118,112,125,148,165,150,122,95,75,62],
 gridCO2:.38,grid:{importMax:90,exportMax:50,qMax:45,reserveCost:4},
 generators:[
  {pmax:65,pmin:8,qmax:30,a:.006,b:26,c:80,co2:.55,reserveCost:3},
  {pmax:45,pmin:5,qmax:25,a:.009,b:31,c:55,co2:.42,reserveCost:3.5}
 ],
 battery:{power:35,energy:90,soc0:.6,socMin:.15,socMax:.95,eta:.94,degradation:12,sMVA:40},
 pvInverterMVA:75,windInverterMVA:55,
 dr:{maxFrac:.15,cost:20},
 reserve:{fraction:.10,minMW:8},
 uncertainty:{scenarios:12,loadSigma:.04,windSigma:.12,pvSigma:.10,alpha:.9,riskWeight:.08,seed:202207055},
 curtailmentCost:3,unservedCost:10000
}}
function qNeed(P,pf){return Math.abs(P)*Math.tan(Math.acos(Math.max(.1,Math.min(1,pf))))}
function qCapability(s,p){return Math.sqrt(Math.max(0,s*s-p*p))}
function dispatchHour(mg,h,batt,dr,scale){const load=mg.load[h]*(1+dr)*scale.load,wind=mg.wind[h]*scale.wind,pv=mg.pv[h]*scale.pv,ren=wind+pv,net=load-ren-batt;let rem=net,cost=0,co2=0,g=[];for(const u of mg.generators){let p=Math.max(0,Math.min(u.pmax,rem));if(p>0)p=Math.max(u.pmin,p);g.push(p);rem-=p;cost+=u.a*p*p+u.b*p+u.c;co2+=u.co2*p*1000}const grid=Math.max(-mg.grid.exportMax,Math.min(mg.grid.importMax,rem));rem-=grid;cost+=grid*mg.price[h];co2+=Math.max(0,grid)*mg.gridCO2*1000;
 const unserved=Math.max(0,rem),curtail=Math.max(0,-rem),reserveReq=Math.max(mg.reserve.minMW,mg.reserve.fraction*load),genReserve=mg.generators.reduce((s,u,i)=>s+Math.max(0,u.pmax-g[i]),0),battReserve=Math.max(0,mg.battery.power-Math.max(0,batt)),gridReserve=Math.max(0,mg.grid.importMax-Math.max(0,grid)),reserveAvail=genReserve+battReserve+gridReserve,reserveShort=Math.max(0,reserveReq-reserveAvail),reserveCost=reserveReq*(mg.generators.reduce((s,u)=>s+u.reserveCost,0)/mg.generators.length);
 const qLoad=qNeed(load,mg.powerFactor),qCap=mg.generators.reduce((s,u)=>s+u.qmax,0)+mg.grid.qMax+qCapability(mg.battery.sMVA,Math.abs(batt))+qCapability(mg.pvInverterMVA,Math.min(pv,mg.pvInverterMVA))+qCapability(mg.windInverterMVA,Math.min(wind,mg.windInverterMVA)),qShort=Math.max(0,qLoad-qCap);
 cost+=reserveCost+curtail*mg.curtailmentCost+unserved*mg.unservedCost;return{load,wind,pv,ren,batt,g,grid,unserved,curtail,cost,co2,reserveReq,reserveAvail,reserveShort,qLoad,qCap,qShort}}
function scenarios(mg){const R=seeded(mg.uncertainty.seed),out=[];for(let i=0;i<mg.uncertainty.scenarios;i++)out.push({load:Math.max(.6,1+mg.uncertainty.loadSigma*normal(R)),wind:Math.max(0,1+mg.uncertainty.windSigma*normal(R)),pv:Math.max(0,1+mg.uncertainty.pvSigma*normal(R))});return out}
function cvar(values,alpha=.9){const v=[...values].sort((a,b)=>a-b),k=Math.max(0,Math.floor(alpha*v.length)),tail=v.slice(k);return tail.reduce((s,x)=>s+x,0)/Math.max(1,tail.length)}
export async function optimizeMicrogrid(mg=defaultMicrogrid(),opts={}){const H=mg.hours,bounds=Array.from({length:2*H},(_,i)=>i<H?[-mg.battery.power,mg.battery.power]:[-mg.dr.maxFrac,mg.dr.maxFrac]),sc=scenarios(mg);
 const evaluate=async x=>{const scenarioResults=[];let expectedRows=null,maxViolation=0;for(let si=0;si<sc.length;si++){let soc=mg.battery.soc0,cost=0,co2=0,violation=0,rows=[],drEnergy=0;for(let h=0;h<H;h++){let p=x[h],dr=x[H+h];if(p>0&&soc<=mg.battery.socMin)p=0;if(p<0&&soc>=mg.battery.socMax)p=0;soc-=((p>=0?p/mg.battery.eta:p*mg.battery.eta)/mg.battery.energy);const r=dispatchHour(mg,h,p,dr,sc[si]);cost+=r.cost+Math.abs(p)*mg.battery.degradation+Math.abs(dr*mg.load[h])*mg.dr.cost;co2+=r.co2;violation+=r.unserved*1000+r.reserveShort*200+r.qShort*200+Math.max(0,mg.battery.socMin-soc)*1e4+Math.max(0,soc-mg.battery.socMax)*1e4;drEnergy+=dr*mg.load[h];rows.push({...r,h,soc,dr})}violation+=Math.abs(drEnergy)*100;scenarioResults.push({cost,co2,violation,rows,finalSoc:soc});maxViolation=Math.max(maxViolation,violation);if(si===0)expectedRows=rows}
 const avgCost=scenarioResults.reduce((s,r)=>s+r.cost,0)/sc.length,avgCO2=scenarioResults.reduce((s,r)=>s+r.co2,0)/sc.length,risk=cvar(scenarioResults.map(r=>r.cost),mg.uncertainty.alpha),riskAdjusted=avgCost+mg.uncertainty.riskWeight*Math.max(0,risk-avgCost);return{obj:[riskAdjusted,avgCO2],violation:maxViolation,rows:expectedRows,expectedCost:avgCost,cvarCost:risk,expectedCO2:avgCO2,scenarioResults}}
 return nsga2({dimension:2*H,bounds,evaluate,population:opts.population||60,generations:opts.generations||60,seed:opts.seed||mg.uncertainty.seed,onGeneration:opts.onGeneration})}