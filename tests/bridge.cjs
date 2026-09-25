const vm=require('node:vm'),fs=require('node:fs'),assert=require('node:assert/strict');
async function scenario(mode) {
 let listener, sent=[], saves=[], shuts=0, starts=0, request, resolveDone, f;
 const parent={postMessage:m=>sent.push(m)};
 const kernel={info:Promise.resolve({}),sendInputReply:({value},header)=>{assert.equal(value,'42');assert.equal(header.msg_id,'prompt');f.onIOPub({header:{msg_type:'stream'},content:{name:'stdout',text:'42\n'}});resolveDone({content:{status:'ok'}});},requestExecute:options=>{
  assert(options.allow_stdin);f={dispose(){},done:new Promise(r=>resolveDone=r)};
  setImmediate(()=>{
   if(mode==='input') f.onStdin({header:{msg_type:'input_request',msg_id:'prompt'},content:{prompt:'Enter a number: ',password:false}});
   else if(mode==='success') {f.onIOPub({header:{msg_type:'stream'},content:{name:'stdout',text:'hello\n'}});resolveDone({content:{status:'ok'}});}
   else if(mode==='error') resolveDone({content:{status:'error',evalue:'Example error'}});
  });return f;
 }};
 const app={restored:Promise.resolve(),serviceManager:{ready:Promise.resolve(),kernelspecs:{specs:{kernelspecs:{python:{language:'python',display_name:'Python (Pyodide)'}}}},contents:{newUntitled:async()=>({path:'Untitled.ipynb'}),save:async(p,data)=>saves.push(JSON.parse(JSON.stringify(data)))},sessions:{startNew:async()=>{starts++;return {kernel,shutdown:async()=>shuts++,dispose(){}};}}},commands:{execute:()=>{throw Error('Must not open a notebook/kernel-selection dialog');}}};
 vm.runInNewContext(fs.readFileSync('jupyterlite-bridge/bridge.js','utf8'),{window:{parent,jupyterapp:app,addEventListener:(n,fn)=>listener=fn},location:{origin:'https://fl2744.github.io'},setTimeout,clearTimeout,TextEncoder});
 const send=(data,origin='https://l1001.vt.domains')=>listener({origin,source:parent,data:{channel:'notebook-bridge-v1',id:'test',...data}});
 await send({type:'run-code',code:'print(1)'},'https://evil.example');assert.equal(starts,0);
 const running=send({type:'run-code',code:'print(1)'});
 await new Promise(r=>setImmediate(()=>setImmediate(r)));
 if(mode==='input'){assert(sent.some(x=>x.type==='input-request'));await send({type:'input-reply',value:'42'});}
 if(mode==='stop') await send({type:'stop-code'});
 await running; assert.equal(starts,1);assert.equal(shuts,1);assert.equal(saves.length,2);
 assert.equal(sent.at(-1).type,['stop','error'].includes(mode)?'error':'done');
 if(mode==='input') assert.equal(saves.at(-1).content.cells[0].outputs[0].text,'42\n');
 console.log('PASS',mode);
}
(async()=>{for(const mode of ['success','input','error','stop'])await scenario(mode);})().catch(e=>{console.error(e);process.exitCode=1;});
