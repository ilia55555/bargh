import{loadMatpowerUrl}from'../io/matpower.js';
let cache=null;
export async function loadIEEE39(){if(!cache)cache=await loadMatpowerUrl(new URL('../../public/cases/case39.m',import.meta.url));return structuredClone(cache)}
export const IEEE39_META={name:'New England 39-bus / MATPOWER case39',source:'MATPOWER case39.m',reference:'Bills et al.; Pai; Athay-Podmore-Virmani',licenseNote:'Bundled from MATPOWER with source attribution'};