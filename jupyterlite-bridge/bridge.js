/* Installed in lab/index.html by install.py. Pasted code is accepted only from the allowed parent origins. */
(() => {
  const CHANNEL = 'notebook-bridge-v1';
  // Add the exact origin of your HTML page here if hosted elsewhere.
  const ALLOWED_ORIGINS = new Set([location.origin, 'http://localhost:8000', 'https://l1001.vt.domains']);
  const NOTEBOOK = 'pyodide/simple-api-call.ipynb';
  let busy = false, codeRun = null;
  function bounded(promise, ms, text) {
    let timer;
    return Promise.race([promise, new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(text)), ms);
    })]).finally(() => clearTimeout(timer));
  }
  async function runCode(app, message, send, origin) {
    let abort;
    const cancelled = new Promise((_, reject) => { abort = reject; });
    // Register a rejection handler before awaiting any startup work.
    cancelled.catch(() => {});
    const run = {id:message.id, origin, session:null, input:null, aborted:false,
      cancel() { this.aborted = true; abort(new Error('Stopped. You can run your code again.')); }};
    codeRun = run;
    const wait = (promise, ms=90000) => bounded(Promise.race([promise, cancelled]), ms,
      'Python took too long to respond. This run was stopped; you can try again.');
    let content, path, future;
    try {
      await wait(app.serviceManager.ready);
      const specs = app.serviceManager.kernelspecs.specs;
      const entries = Object.entries(specs?.kernelspecs || {});
      const selected = entries.find(([name, spec]) => spec.language === 'python' && /pyodide/i.test(spec.display_name || name)) || entries.find(([, spec]) => spec.language === 'python');
      if (!selected) throw new Error('The site has no Python kernel available.');
      const [name, spec] = selected;
      const created = await wait(app.serviceManager.contents.newUntitled({type:'notebook'}));
      path = created.path;
      content = {nbformat:4, nbformat_minor:5,
        metadata:{kernelspec:{name, display_name:spec.display_name, language:'python'}},
        cells:[{id:'pasted-code',cell_type:'code',source:message.code,metadata:{},execution_count:null,outputs:[]}]};
      await wait(app.serviceManager.contents.save(path,{type:'notebook',format:'json',content}));
      send('status',{text:'Starting Python for ' + path + '…'});
      // Start the session directly. Opening a notebook panel first can trigger a
      // competing kernel-selection dialog, especially with multiple kernels.
      const starting = app.serviceManager.sessions.startNew({path, name:'Launcher code',type:'notebook',kernel:{name}});
      starting.then(session => {
        if (run.aborted) session.shutdown().catch(() => {}).finally(() => session.dispose());
        else run.session = session;
      }, () => {});
      const session = await wait(starting);
      const kernel = session.kernel;
      if (!kernel) throw new Error('Unable to start Python.');
      await wait(kernel.requestKernelInfo());
      send('status',{text:'Running ' + path + '…'});
      const cell = content.cells[0];
      future = kernel.requestExecute({code:message.code,stop_on_error:true,store_history:true,allow_stdin:true});
      future.onStdin = msg => {
        if (run.aborted || msg.header.msg_type !== 'input_request') return;
        run.input = msg;
        send('input-request',{prompt:msg.content.prompt || 'Enter a value:',password:!!msg.content.password});
      };
      let clearNext = false;
      future.onIOPub = msg => {
        if (run.aborted) return;
        const type = msg.header.msg_type, c = msg.content;
        if (type === 'execute_input') cell.execution_count = c.execution_count;
        if (['stream','display_data','execute_result','error'].includes(type)) {
          if (clearNext) {cell.outputs=[];clearNext=false;send('clear');}
          const output = {output_type:type,...c}; delete output.transient;
          cell.outputs.push(output);
        }
        if (type === 'stream') send('stream',{text:c.text});
        if (['display_data','execute_result'].includes(type)) send('stream',{text:(c.data?.['text/plain'] || '[Rich output is saved in ' + path + '.]') + '\n'});
        if (type === 'error') send('stream',{text:(c.traceback || [c.ename + ': ' + c.evalue]).join('\n').replace(/\x1b\[[0-9;]*m/g,'') + '\n'});
        if (type === 'clear_output') {
          if (c.wait) clearNext=true;
          else {cell.outputs=[];send('clear');}
        }
      };
      const reply = await wait(future.done, 600000);
      if (reply.content.status !== 'ok') throw new Error(reply.content.evalue || 'Code execution stopped.');
    } finally {
      run.aborted = true;
      run.input = null;
      future?.dispose();
      // Retain the notebook and its output, but release this run's worker.
      // Never stop kernels belonging to notebooks opened by the user.
      const cleanup = [];
      if (content && path) cleanup.push(bounded(app.serviceManager.contents.save(path,{type:'notebook',format:'json',content}),10000,'Notebook save timed out.'));
      if (run.session) cleanup.push(bounded(run.session.shutdown(),10000,'Kernel shutdown timed out.').finally(() => run.session.dispose()));
      const outcomes = await Promise.allSettled(cleanup);
      if (outcomes.some(x=>x.status==='rejected')) send('stream',{text:'\nSome cleanup could not finish. Your pasted code remains in the launcher.\n'});
      if (codeRun === run) codeRun = null;
    }
  }
  const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
  async function getApp() {
    for (let i = 0; i < 240; i++) {
      if (window.jupyterapp) {
        await window.jupyterapp.restored;
        return window.jupyterapp;
      }
      await delay(500);
    }
    throw new Error('JupyterLite did not become ready. Check exposeAppInBrowser and reload.');
  }
  window.addEventListener('message', async event => {
    if (event.source !== window.parent || window.parent === window ||
        !ALLOWED_ORIGINS.has(event.origin)) return;
    const message = event.data;
    if (!message || message.channel !== CHANNEL || typeof message.id !== 'string') return;
    const send = (type, data = {}) => event.source.postMessage(
      { channel: CHANNEL, id: message.id, type, ...data }, event.origin);
    if (message.type === 'ping') {
      send('connected', {capabilities: ['run-code', 'stdin', 'stop-code', 'managed-kernel-v2']});
      return;
    }
    if (message.type === 'stop-code' || message.type === 'input-reply') {
      if (!codeRun || codeRun.id !== message.id || codeRun.origin !== event.origin) return;
      if (message.type === 'stop-code') codeRun.cancel();
      else if (codeRun.input && typeof message.value === 'string' && message.value.length <= 100000) {
        codeRun.session.kernel.sendInputReply({value:message.value},codeRun.input.header);
        codeRun.input = null;
      }
      return;
    }
    if (!['run', 'run-code'].includes(message.type)) return;
    if (busy) { send('error', {error: 'A notebook execution is already running.'}); return; }
    if (message.type === 'run-code' && (typeof message.code !== 'string' || !message.code.trim() || message.code.length > 200000)) { send('error', {error: 'Enter Python code (maximum 200,000 characters).'}); return; }
    if (message.type === 'run' && (!message.inputs || typeof message.inputs !== 'object' || Array.isArray(message.inputs))) {
      send('error', {error: 'Inputs must be a JSON object.'}); return;
    }
    busy = true;
    send('status', {text: 'Starting Python…'});
    try {
      const app = await getApp();
      if (message.type === 'run-code') {
        await runCode(app, message, send, event.origin);
        send('done');
        return;
      }

      const panel = await app.commands.execute('docmanager:open', {path: NOTEBOOK, factory: 'Notebook'});
      if (!panel?.sessionContext) throw new Error(`Notebook not found: ${NOTEBOOK}`);
      await panel.context.ready;
      await panel.sessionContext.ready;
      const kernel = panel.sessionContext.session?.kernel;
      if (!kernel) throw new Error('Select a Python kernel in the notebook, then try again.');
      const execute = async code => {
        const future = kernel.requestExecute({code, stop_on_error: true, store_history: false, allow_stdin: false});
        future.onIOPub = msg => {
          const c = msg.content;
          if (msg.header.msg_type === 'stream') send('stream', {text: c.text});
          if (['display_data', 'execute_result'].includes(msg.header.msg_type)) {
            if ('application/vnd.notebook-bridge+json' in c.data) {
              send('result', {outputs: c.data['application/vnd.notebook-bridge+json']});
            } else if (c.data['text/plain']) send('stream', {text: c.data['text/plain'] + '\n'});
          }
          if (msg.header.msg_type === 'clear_output') send('clear');
        };
        const reply = await future.done;
        if (reply.content.status !== 'ok') throw new Error(
          reply.content.evalue || 'Notebook execution stopped.');
      };
      const bytes = new TextEncoder().encode(JSON.stringify(message.inputs));
      let binary = '';
      for (const byte of bytes) binary += String.fromCharCode(byte);
      const encoded = btoa(binary);
      await execute(`import base64 as _bridge_b64, json as _bridge_json\ninputs = _bridge_json.loads(_bridge_b64.b64decode('${encoded}'))\noutputs = {}`);
      // Execute the published notebook, avoiding stale browser-saved copies.
      const response = await fetch(new URL('../files/' + NOTEBOOK, location.href), {cache: 'no-store'});
      if (!response.ok) throw new Error('Cannot load published notebook (HTTP ' + response.status + ').');
      const notebook = await response.json();
      const cells = notebook.cells;
      if (!Array.isArray(cells)) throw new Error('Published file is not a notebook.');
      for (let i = 0; i < cells.length; i++) {
        if (cells[i].cell_type !== 'code') continue;
        const code = Array.isArray(cells[i].source) ? cells[i].source.join('') : cells[i].source;
        if (!code.trim()) continue;
        send('status', {text: `Running cell ${i + 1} of ${cells.length}…`});
        await execute(code);
      }
      await execute("import json as _bridge_json\nfrom IPython.display import display as _bridge_display\n_bridge_display({'application/vnd.notebook-bridge+json': _bridge_json.loads(_bridge_json.dumps(outputs, allow_nan=False))}, raw=True)");
      send('done');
    } catch (error) {
      send('error', {error: error.message || 'Notebook execution failed.'});
    } finally { busy = false; }
  });
})();
