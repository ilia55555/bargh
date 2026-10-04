import{trapezoidalSamples,simpsonUniformSamples}from'../ee/math.js';
import{solveAC}from'../ee/circuits.js';
import{faultCurrent}from'../ee/faults.js';
import{thd}from'../ee/signals.js';
import{bodeTransfer}from'../ee/control.js';
import{inductionMotor}from'../ee/machines.js';
import{buck,boost,threePhaseInverterFundamental}from'../ee/powerElectronics.js';
import{economicDispatch,dcStateEstimation}from'../ee/powerSystems.js';
import{skinDepth,transmissionLine}from'../ee/electromagnetics.js';
import{weightedMean,linearRegression}from'../ee/measurements.js';

const num=(root,id,d=0)=>{const v=Number(root.querySelector('#'+id)?.value);return Number.isFinite(v)?v:d};
const list=s=>String(s||'').split(/[\s,;]+/).filter(Boolean).map(Number);
const cpx=(r,x)=>[Number(r),Number(x)];
const fmt=v=>typeof v==='number'&&Number.isFinite(v)?Number(v).toPrecision(8):String(v);
function out(el,obj){el.textContent=JSON.stringify(obj,(k,v)=>typeof v==='number'&&Number.isFinite(v)?Number(v.toPrecision(10)):v,2)}
function card(title,id,body){return'<article class="card ee-tool"><h2>'+title+'</h2>'+body+'<div id="'+id+'-out" class="status">Ready.</div></article>'}

export function renderEngineeringToolbox(container){
 container.innerHTML=
 '<div class="page-head"><div><h2>Electrical Engineering Toolbox</h2><p class="muted">Numerical tools run locally. Advanced modules stay separate from the main research workflow.</p></div></div>'+
 '<div class="grid cards-2">'+
 card('Calculus / sampled integration','ee-int','<label>x samples<input id="ee-int-x" value="0,0.5,1,1.5,2"></label><label>y samples<input id="ee-int-y" value="0,0.25,1,2.25,4"></label><button class="btn" data-ee="int">Integrate</button>')+
 card('AC circuit / MNA','ee-circuit','<div class="row"><label>Frequency Hz<input id="ee-c-f" value="60"></label><label>Source Vrms<input id="ee-c-v" value="230"></label></div><div class="row"><label>R Ω<input id="ee-c-r" value="10"></label><label>L H<input id="ee-c-l" value="0.05"></label><label>C F<input id="ee-c-cap" value="0.0001"></label></div><button class="btn" data-ee="circuit">Solve RLC series</button>')+
 card('Short-circuit / sequence networks','ee-fault','<label>Fault<select id="ee-f-type"><option>3PH</option><option>SLG</option><option>LL</option><option>DLG</option></select></label><div class="row"><label>X1 pu<input id="ee-f-x1" value="0.2"></label><label>X2 pu<input id="ee-f-x2" value="0.2"></label><label>X0 pu<input id="ee-f-x0" value="0.6"></label></div><button class="btn" data-ee="fault">Calculate</button>')+
 card('Power quality / FFT / THD','ee-thd','<div class="row"><label>fs Hz<input id="ee-thd-fs" value="6400"></label><label>f1 Hz<input id="ee-thd-f1" value="50"></label></div><label>Harmonics % (2..7)<input id="ee-thd-h" value="0,3,0,2,0,1"></label><button class="btn" data-ee="thd">Analyze</button>')+
 card('Control / Bode','ee-bode','<label>Numerator coefficients<input id="ee-b-num" value="1"></label><label>Denominator coefficients<input id="ee-b-den" value="1,1"></label><label>Frequencies Hz<input id="ee-b-freq" value="0.1,1,10,100"></label><button class="btn" data-ee="bode">Evaluate</button>')+
 card('Induction motor','ee-motor','<div class="row"><label>Vline<input id="ee-m-v" value="400"></label><label>Hz<input id="ee-m-f" value="50"></label><label>Slip<input id="ee-m-s" value="0.03"></label></div><div class="row"><label>R1<input id="ee-m-r1" value="0.4"></label><label>X1<input id="ee-m-x1" value="0.8"></label><label>R2<input id="ee-m-r2" value="0.3"></label><label>X2<input id="ee-m-x2" value="0.8"></label></div><button class="btn" data-ee="motor">Solve</button>')+
 card('Power electronics','ee-pe','<label>Topology<select id="ee-pe-top"><option value="buck">Buck</option><option value="boost">Boost</option><option value="inverter">3-phase inverter</option></select></label><div class="row"><label>Vin/Vdc<input id="ee-pe-vin" value="400"></label><label>Vout<input id="ee-pe-vout" value="230"></label><label>Iout<input id="ee-pe-i" value="10"></label></div><div class="row"><label>fs Hz<input id="ee-pe-fs" value="20000"></label><label>L H<input id="ee-pe-l" value="0.002"></label><label>C F<input id="ee-pe-c" value="0.001"></label></div><button class="btn" data-ee="pe">Calculate</button>')+
 card('Economic dispatch','ee-ed','<label>Demand MW<input id="ee-ed-demand" value="500"></label><label>Units: a,b,c,pmin,pmax | one per line<textarea id="ee-ed-units">0.002,10,100,50,300\n0.003,8,120,40,250\n0.0015,12,80,30,220</textarea></label><button class="btn" data-ee="ed">Dispatch</button>')+
 card('DC state estimation','ee-se','<p class="muted">3-bus example using angle/flow measurements.</p><button class="btn" data-ee="se">Run WLS example</button>')+
 card('Electromagnetics / transmission line','ee-em','<div class="row"><label>f Hz<input id="ee-em-f" value="1000000"></label><label>σ S/m<input id="ee-em-sigma" value="58000000"></label></div><button class="btn" data-ee="em">Skin depth + line example</button>')+
 card('Measurements / statistics','ee-meas','<label>Values<input id="ee-meas-v" value="10.01,9.99,10.03,10.00"></label><label>σ<input id="ee-meas-s" value="0.02,0.02,0.03,0.01"></label><button class="btn" data-ee="meas">Estimate</button>')+
 '</div>';
 container.querySelectorAll('[data-ee]').forEach(b=>b.onclick=()=>run(container,b.dataset.ee));
}

function run(root,id){
 try{
  if(id==='int'){const x=list(root.querySelector('#ee-int-x').value),y=list(root.querySelector('#ee-int-y').value),trap=trapezoidalSamples(x,y),uniform=x.length>2&&x.every((v,i)=>i===0||Math.abs((v-x[i-1])-(x[1]-x[0]))<1e-10),simp=uniform&&y.length%2===1?simpsonUniformSamples(y,x[1]-x[0]):null;out(root.querySelector('#ee-int-out'),{trapezoidal:trap,simpson:simp})}
  else if(id==='circuit'){const f=num(root,'ee-c-f',60),V=num(root,'ee-c-v',230),R=num(root,'ee-c-r',10),L=num(root,'ee-c-l',.05),C=num(root,'ee-c-cap',1e-4),r=solveAC([{type:'V',name:'Vs',n1:1,n2:0,value:[V,0]},{type:'R',n1:1,n2:2,value:R},{type:'L',n1:2,n2:3,value:L},{type:'C',n1:3,n2:0,value:C}],{frequency:f});out(root.querySelector('#ee-circuit-out'),r)}
  else if(id==='fault'){const type=root.querySelector('#ee-f-type').value,r=faultCurrent({type,V:[1,0],Z1:[0,num(root,'ee-f-x1',.2)],Z2:[0,num(root,'ee-f-x2',.2)],Z0:[0,num(root,'ee-f-x0',.6)]});out(root.querySelector('#ee-fault-out'),r)}
  else if(id==='thd'){const fs=num(root,'ee-thd-fs',6400),f1=num(root,'ee-thd-f1',50),h=list(root.querySelector('#ee-thd-h').value),N=2048,s=Array.from({length:N},(_,i)=>{const t=i/fs;let y=Math.sin(2*Math.PI*f1*t);for(let k=0;k<h.length;k++)y+=(h[k]/100)*Math.sin(2*Math.PI*f1*(k+2)*t);return y}),r=thd(s,fs,f1,{maxHarmonic:20});out(root.querySelector('#ee-thd-out'),r)}
  else if(id==='bode'){const nume=list(root.querySelector('#ee-b-num').value),den=list(root.querySelector('#ee-b-den').value),freq=list(root.querySelector('#ee-b-freq').value);out(root.querySelector('#ee-bode-out'),bodeTransfer(nume,den,freq))}
  else if(id==='motor'){out(root.querySelector('#ee-motor-out'),inductionMotor({Vline:num(root,'ee-m-v',400),frequency:num(root,'ee-m-f',50),slip:num(root,'ee-m-s',.03),R1:num(root,'ee-m-r1',.4),X1:num(root,'ee-m-x1',.8),R2:num(root,'ee-m-r2',.3),X2:num(root,'ee-m-x2',.8),Xm:20}))}
  else if(id==='pe'){const top=root.querySelector('#ee-pe-top').value,Vin=num(root,'ee-pe-vin',400),Vout=num(root,'ee-pe-vout',230),Iout=num(root,'ee-pe-i',10),fs=num(root,'ee-pe-fs',2e4),L=num(root,'ee-pe-l',.002),C=num(root,'ee-pe-c',.001),r=top==='buck'?buck({Vin,Vout,Iout,fs,L,C}):top==='boost'?boost({Vin,Vout,Iout,fs,L,C}):threePhaseInverterFundamental({Vdc:Vin,modulationIndex:.9,method:'SPWM'});out(root.querySelector('#ee-pe-out'),r)}
  else if(id==='ed'){const demand=num(root,'ee-ed-demand',500),units=root.querySelector('#ee-ed-units').value.trim().split(/\n+/).map(line=>{const[a,b,c,pmin,pmax]=list(line);return{a,b,c,pmin,pmax}});out(root.querySelector('#ee-ed-out'),economicDispatch(units,demand))}
  else if(id==='se'){const r=dcStateEstimation({nBus:3,slack:0,branches:[{id:'12',from:0,to:1,x:.1},{id:'23',from:1,to:2,x:.125},{id:'13',from:0,to:2,x:.2}],measurements:[{type:'flow',branch:'12',value:.5,sigma:.01},{type:'flow',branch:'23',value:.15,sigma:.01},{type:'angle',bus:1,value:-.05,sigma:.005},{type:'angle',bus:2,value:-.07,sigma:.005}]});out(root.querySelector('#ee-se-out'),r)}
  else if(id==='em'){const frequency=num(root,'ee-em-f',1e6),conductivity=num(root,'ee-em-sigma',5.8e7),sd=skinDepth({frequency,conductivity}),tl=transmissionLine({R:.05,L:250e-9,C:100e-12,G:1e-9,frequency,length:1});out(root.querySelector('#ee-em-out'),{skinDepthM:sd,transmissionLine:tl})}
  else if(id==='meas'){const v=list(root.querySelector('#ee-meas-v').value),s=list(root.querySelector('#ee-meas-s').value),w=weightedMean(v,s),x=v.map((_,i)=>i),lr=linearRegression(x,v);out(root.querySelector('#ee-meas-out'),{weightedMean:w,linearTrend:lr})}
 }catch(e){const el=root.querySelector('#ee-'+id+'-out')||root.querySelector('#ee-circuit-out');if(el)el.textContent='Error: '+e.message}
}