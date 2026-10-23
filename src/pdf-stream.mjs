// Workers' native pipe avoids a JavaScript callback for every chunk of a large
// PDF. FixedLengthStream enforces the source + trailer length end to end.
export function appendPdfTail(source,size,tail){
 if(typeof FixedLengthStream!=='undefined'){
   const output=new FixedLengthStream(size+tail.length);
   source.pipeTo(output.writable,{preventClose:true}).then(async()=>{
     const writer=output.writable.getWriter();
     try{await writer.write(tail);await writer.close();}catch(e){await writer.abort(e);}finally{writer.releaseLock();}
   }).catch(async e=>{try{await output.writable.abort(e);}catch{}});
   return output.readable;
 }
 const reader=source.getReader();let count=0;
 return new ReadableStream({async pull(controller){try{const {done,value}=await reader.read();if(done){if(count!==size)throw Error('Incomplete Drive stream');controller.enqueue(tail);controller.close();}else{count+=value.length;if(count>size)throw Error('Oversized Drive stream');controller.enqueue(value);}}catch(e){await reader.cancel();controller.error(e);}},cancel(reason){return reader.cancel(reason);}});
}
