// Loaded before both PDF.js realms. Preserve native implementations when present.
// PDF.js's official legacy build supplies collection and typed-array polyfills;
// these Promise helpers also cover engines older than its current baseline.
if(typeof Promise.withResolvers!=='function')Object.defineProperty(Promise,'withResolvers',{
 configurable:true,writable:true,value:function withResolvers(){
  let resolve,reject;const promise=new this((yes,no)=>{resolve=yes;reject=no;});
  return {promise,resolve,reject};
 }
});
if(typeof Promise.try!=='function')Object.defineProperty(Promise,'try',{
 configurable:true,writable:true,value:function tryPromise(callback,...args){
  return new this((resolve,reject)=>{try{resolve(callback(...args));}catch(error){reject(error);}});
 }
});
