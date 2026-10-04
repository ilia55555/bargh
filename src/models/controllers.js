import{clamp}from'../math/linalg.js';
export function initTGOV1(p,pref=1){return{valve:clamp(pref,p.VMIN,p.VMAX),ll:pref,pref}}
export function derivTGOV1(s,{omega,paux=0},p){const wd=omega-1,pd=s.pref+paux-wd/p.R,target=clamp(pd,p.VMIN,p.VMAX),dvalve=(target-s.valve)/Math.max(p.T1,1e-4),dll=(s.valve-s.ll)/Math.max(p.T3,1e-4),out=s.ll+(p.T2/Math.max(p.T3,1e-4))*(s.valve-s.ll)-p.Dt*wd;return{d:{valve:dvalve,ll:dll},out}}
export function initEXST1(v=1,vf=1,p){return{vmeas:v,ll:0,vr:clamp(vf,p.VRMIN,p.VRMAX),fb:vf}}
export function derivEXST1(s,{v,vref,pss=0,ifd=0},p){const dvmeas=(v-s.vmeas)/Math.max(p.TR,1e-4),wf=p.KF/Math.max(p.TF,1e-4)*(s.vr-s.fb),vi=clamp(vref-s.vmeas-wf+pss,p.VIMIN,p.VIMAX),dll=(vi-s.ll)/Math.max(p.TB,1e-4),llOut=s.ll+(p.TC/Math.max(p.TB,1e-4))*(vi-s.ll),vrTarget=clamp(p.KA*llOut,p.VRMIN-p.KC*ifd,p.VRMAX-p.KC*ifd),dvr=(vrTarget-s.vr)/Math.max(p.TA,1e-4),dfb=(s.vr-s.fb)/Math.max(p.TF,1e-4);return{d:{vmeas:dvmeas,ll:dll,vr:dvr,fb:dfb},out:clamp(s.vr,p.VRMIN-p.KC*ifd,p.VRMAX-p.KC*ifd)}}
export function initPSS1A(){return{xw:0,x1:0,x2:0}}
function leadLag(u,x,Tn,Td){const dx=(u-x)/Math.max(Td,1e-4),y=x+(Tn/Math.max(Td,1e-4))*(u-x);return{dx,y}}
export function derivPSS1A(s,{omega},p){const u=omega-1,dxw=(u-s.xw)/Math.max(p.Tw,1e-4),wash=p.K*(u-s.xw),a=leadLag(wash,s.x1,p.T1,p.T2),b=leadLag(a.y,s.x2,p.T3,p.T4);return{d:{xw:dxw,x1:a.dx,x2:b.dx},out:clamp(b.y,p.Vmin,p.Vmax)}}
export function initAGC(){return{integral:0}}
export function derivAGC(s,{frequency,f0=60},p){const err=(f0-frequency)/f0,active=Math.abs(frequency-f0)>(p.deadbandHz||0)?err:0,d=active,out=clamp((p.Ki||0)*s.integral,-Math.abs(p.maxPu||1),Math.abs(p.maxPu||1));return{d:{integral:d},out}}
export function eulerController(s,d,h){const n={...s};for(const[k,v]of Object.entries(d))n[k]=(n[k]??0)+h*v;return n}