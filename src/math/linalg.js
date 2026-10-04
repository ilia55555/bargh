export const EPS=1e-12;
export const clamp=(x,a,b)=>Math.max(a,Math.min(b,x));
export function zeros(n,m=null){return m===null?Array(n).fill(0):Array.from({length:n},()=>Array(m).fill(0))}
export function dot(a,b){let s=0;for(let i=0;i<a.length;i++)s+=a[i]*b[i];return s}
export function norm2(a){return Math.sqrt(dot(a,a))}
export function maxAbs(a){let m=0;for(const x of a)m=Math.max(m,Math.abs(x));return m}
export function add(a,b){return a.map((x,i)=>x+b[i])}
export function sub(a,b){return a.map((x,i)=>x-b[i])}
export function scale(a,s){return a.map(x=>x*s)}
export function matVec(A,x){return A.map(r=>dot(r,x))}
export function transpose(A){return A[0].map((_,j)=>A.map(r=>r[j]))}
export function matMul(A,B){const BT=transpose(B);return A.map(r=>BT.map(c=>dot(r,c)))}
export function eye(n){const A=zeros(n,n);for(let i=0;i<n;i++)A[i][i]=1;return A}
export function solveLinear(A,b){const n=A.length,M=A.map((r,i)=>[...r,b[i]]);for(let k=0;k<n;k++){let p=k;for(let i=k+1;i<n;i++)if(Math.abs(M[i][k])>Math.abs(M[p][k]))p=i;if(Math.abs(M[p][k])<1e-14)throw new Error('Singular linear system');[M[k],M[p]]=[M[p],M[k]];const q=M[k][k];for(let j=k;j<=n;j++)M[k][j]/=q;for(let i=0;i<n;i++)if(i!==k){const f=M[i][k];if(!f)continue;for(let j=k;j<=n;j++)M[i][j]-=f*M[k][j]}}return M.map(r=>r[n])}
export function complex(re=0,im=0){return[re,im]}
export const cadd=(a,b)=>[a[0]+b[0],a[1]+b[1]];
export const csub=(a,b)=>[a[0]-b[0],a[1]-b[1]];
export const cmul=(a,b)=>[a[0]*b[0]-a[1]*b[1],a[0]*b[1]+a[1]*b[0]];
export const cconj=a=>[a[0],-a[1]];
export const cabs=a=>Math.hypot(a[0],a[1]);
export const cscale=(a,s)=>[a[0]*s,a[1]*s];
export function cdiv(a,b){const d=b[0]*b[0]+b[1]*b[1];if(d<EPS)throw new Error('Complex divide by zero');return[(a[0]*b[0]+a[1]*b[1])/d,(a[1]*b[0]-a[0]*b[1])/d]}
export const cexp=a=>[Math.cos(a),Math.sin(a)];
export function solveComplex(A,b){const n=A.length,R=zeros(2*n,2*n),y=zeros(2*n);for(let i=0;i<n;i++){y[2*i]=b[i][0];y[2*i+1]=b[i][1];for(let j=0;j<n;j++){const [re,im]=A[i][j];R[2*i][2*j]=re;R[2*i][2*j+1]=-im;R[2*i+1][2*j]=im;R[2*i+1][2*j+1]=re}}const x=solveLinear(R,y);return Array.from({length:n},(_,i)=>[x[2*i],x[2*i+1]])}