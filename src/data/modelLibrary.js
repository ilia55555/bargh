export const MODEL_LIBRARY_VERSION='2026.10';
export const modelLibrary={
 machines:{
  Classical:{status:'implemented',fidelity:'2nd-order transient stability',source:'standard swing-equation model',params:{H:5,D:0,xdp:0.3}},
  GENROU:{status:'implemented-experimental',fidelity:'6th-order round-rotor subtransient',source:'PSS/E-style equations cross-checked against CURENT/ANDES GENROU implementation',params:{ra:0,xd:1.9,xq:1.7,xdp:0.3,xqp:0.55,xdpp:0.25,xqpp:0.25,xl:0.15,Td0p:8,Tq0p:0.8,Td0pp:0.04,Tq0pp:0.02,S10:0,S12:1}},
  GENSAL:{status:'implemented-experimental',fidelity:'salient-pole subtransient model',source:'standard salient-pole synchronous-machine formulation; user parameters required for publication studies',params:{ra:0,xd:1.2,xq:0.7,xdp:0.3,xdpp:0.22,xqpp:0.22,xl:0.15,Td0p:5,Td0pp:0.05,Tq0pp:0.08}}
 },
 governors:{
  TGOV1:{status:'implemented',source:'CURENT/ANDES TGOV1 semantics',params:{R:0.05,VMAX:1.2,VMIN:0,T1:0.1,T2:0.2,T3:10,Dt:0}}
 },
 exciters:{
  EXST1:{status:'implemented',source:'CURENT/ANDES EXST1 semantics',params:{TR:0.01,VIMAX:0.2,VIMIN:-0.2,TC:1,TB:1,KA:80,TA:0.05,VRMAX:8,VRMIN:-3,KC:0.2,KF:0.1,TF:1}}
 },
 pss:{
  PSS1A:{status:'implemented',source:'IEEE-style washout + two lead-lag stabilizer',params:{K:10,Tw:10,T1:0.1,T2:0.02,T3:0.1,T4:0.02,Vmax:0.1,Vmin:-0.1}}
 },
 loads:{
  ZIP:{status:'implemented',params:{zP:0.2,iP:0.3,pP:0.5,zQ:0.2,iQ:0.3,pQ:0.5}},
  FrequencyDependent:{status:'implemented',params:{Kpf:1,Kqf:0}},
  CompositeMotor:{status:'implemented-experimental',fidelity:'aggregate 3rd-order induction-motor torque/slip surrogate'}
 },
 inverters:{
  GridFollowing:{status:'implemented-reduced',fidelity:'RMS current/power-control surrogate'},
  DroopGFM:{status:'implemented',fidelity:'RMS P-f / Q-V droop'},
  VSG:{status:'implemented',fidelity:'virtual swing equation RMS'},
  BatteryInverter:{status:'implemented',fidelity:'RMS converter + SOC/energy constraints'}
 },
 protection:{
  UFLS:{status:'implemented'},UVLS:{status:'implemented'},OverVoltage:{status:'implemented'},GeneratorTrip:{status:'implemented'},Breaker:{status:'implemented'}
 }
};
export const scientificBoundaries=[
 ['AC power flow','implemented','Full nonlinear balanced positive-sequence AC Newton-Raphson'],
 ['Electromechanical dynamics','implemented','RMS/positive-sequence DAE; not EMT'],
 ['Classical machine','implemented','Validated for transient-stability workflow'],
 ['GENROU','experimental','Full state equations implemented; requires case-specific parameter validation before publication claims'],
 ['GENSAL','experimental','Implemented salient-pole model; publication use requires external cross-tool validation'],
 ['EMT / switching transients','not','Not implemented'],
 ['Vendor-certified protection','not','Not implemented'],
 ['Full nonlinear NMPC','not','MPC is reduced-order/prediction-model based with full-network security checks']
];