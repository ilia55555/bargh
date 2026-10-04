import fs from'node:fs/promises';import assert from'node:assert/strict';
import{parseMatpower}from'../src/io/matpower.js';import{solvePowerFlow,validateSolvedCase}from'../src/engines/powerflow.js';

import{simpsonUniformSamples,trapezoidalSamples}from'../src/ee/math.js';
import{solveAC}from'../src/ee/circuits.js';
import{faultCurrent}from'../src/ee/faults.js';
import{thd}from'../src/ee/signals.js';
import{economicDispatch}from'../src/ee/powerSystems.js';
import{inductionMotor}from'../src/ee/machines.js';
import{buck}from'../src/ee/powerElectronics.js';
import{skinDepth}from'../src/ee/electromagnetics.js';
import{newProject}from'../src/core/project.js';import{ieee39Generators,ieee39Loads,ieee39Fleet}from'../src/data/ieee39Dynamic.js';
import{CoordinatedMPC}from'../src/engines/mpc.js';import{compareSignal}from'../src/validation/metrics.js';import{nsga2}from'../src/engines/nsga2.js';import{simulateDynamics}from'../src/engines/dynamics.js';
const text=await fs.readFile(new URL('../public/cases/case39.m',import.meta.url),'utf8'),mpc=parseMatpower(text);
const pf=solvePowerFlow(mpc,{tolerance:1e-10,maxIterations:40,flatStart:true});assert.equal(pf.converged,true);assert.ok(pf.maxMismatch<1e-8);const v=validateSolvedCase(mpc,pf);assert.ok(v.vm<1e-5,'Vm '+v.vm);assert.ok(v.va<1e-3,'Va '+v.va);
const p=newProject('CI');p.network.baseMVA=mpc.baseMVA;p.network.frequencyHz=60;p.network.case=mpc;p.devices.generators=ieee39Generators(mpc);p.devices.loads=ieee39Loads(mpc);p.devices.fleet=ieee39Fleet();p.simulation.dt=.02;p.simulation.endTime=1.4;p.controls.mpc={...p.controls.mpc,mode:'coordinated',horizon:5,maxIterations:200,adaptiveMax:400,fleetCapMW:300,genCapMW:500,wFrequency:100,wRoCoF:30,wControl:.002,wDeltaU:.02};
const ctl=new CoordinatedMPC(p),q=ctl.solve({dfHz:-.1,genMW:0,fleetMW:0,disturbanceMW:300,soc0:.7,time:1});assert.ok(['CONVERGED','MAX_ITER'].includes(q.status));assert.ok(Number.isFinite(q.kkt));assert.ok(q.command.fleetMW<=300+1e-9);
const m=compareSignal('frequency',[0,1,2],[60,59.8,60],[60,59.81,60],{f0:60});assert.ok(m.rmse<.01);assert.ok(m.correlation>.999);
const z=await nsga2({dimension:4,bounds:Array(4).fill([0,1]),population:16,generations:8,seed:7,evaluate:async x=>({obj:[x[0],(1-x[0])**2+x.slice(1).reduce((s,v)=>s+v,0)],violation:0})});assert.ok(z.pareto.length>0);
const dyn=await simulateDynamics(p,mpc,{scenario:{type:'trip',bus:38,start:1},endTime:1.2,dt:.02});assert.ok(dyn.rows.length>10);assert.ok(Number.isFinite(dyn.metrics.nadir));

const sx=[0,.5,1,1.5,2],sy=sx.map(x=>x*x);assert.ok(Math.abs(simpsonUniformSamples(sy,.5)-8/3)<1e-12);assert.ok(Math.abs(trapezoidalSamples(sx,sy)-2.75)<1e-12);
const ac=solveAC([{type:'V',name:'Vs',n1:1,n2:0,value:[230,0]},{type:'R',n1:1,n2:2,value:10},{type:'L',n1:2,n2:0,value:.05}],{frequency:50});assert.ok(Number.isFinite(ac.voltages[2][0]));
const fc=faultCurrent({type:'3PH',V:[1,0],Z1:[0,.2],Z2:[0,.2],Z0:[0,.6]});assert.ok(Math.abs(Math.hypot(...fc.Ia)-5)<1e-10);
const fsig=6400,f1=50,Nsig=2048,sig=Array.from({length:Nsig},(_,i)=>Math.sin(2*Math.PI*f1*i/fsig)+.05*Math.sin(2*Math.PI*3*f1*i/fsig)),pq=thd(sig,fsig,f1,{maxHarmonic:10});assert.ok(Math.abs(pq.thdPercent-5)<.2,'THD '+pq.thdPercent);
const ed=economicDispatch([{a:.002,b:10,c:100,pmin:50,pmax:300},{a:.003,b:8,c:120,pmin:40,pmax:250},{a:.0015,b:12,c:80,pmin:30,pmax:220}],500);assert.ok(Math.abs(ed.dispatch.reduce((a,b)=>a+b,0)-500)<1e-6);
const im=inductionMotor({Vline:400,frequency:50,poles:4,R1:.4,X1:.8,R2:.3,X2:.8,Xm:20,slip:.03});assert.ok(im.torqueNm>0&&im.rotorRPM>0);
const bc=buck({Vin:400,Vout:200,Iout:10,fs:20000,L:.002,C:.001});assert.ok(Math.abs(bc.duty-.5)<1e-12&&bc.inductorRipple>0);
const sd=skinDepth({frequency:1e6,conductivity:5.8e7});assert.ok(sd>5e-5&&sd<8e-5);

console.log(JSON.stringify({powerFlow:{iterations:pf.iterations,mismatch:pf.maxMismatch,vmError:v.vm,vaError:v.va},mpc:{status:q.status,kkt:q.kkt,residual:q.residual},dynamics:dyn.metrics,pareto:z.pareto.length},null,2));