export class Store{
  constructor(initial={}){this.state=structuredClone(initial);this.listeners=new Set();this.dirty=false}
  get(){return this.state}
  set(patch,{dirty=true}={}){this.state=typeof patch==='function'?patch(this.state):{...this.state,...patch};if(dirty)this.dirty=true;this.emit();return this.state}
  replace(next,{dirty=false}={}){this.state=structuredClone(next);this.dirty=dirty;this.emit()}
  subscribe(fn){this.listeners.add(fn);return()=>this.listeners.delete(fn)}
  emit(){for(const fn of this.listeners)fn(this.state,this.dirty)}
  markClean(){this.dirty=false;this.emit()}
}