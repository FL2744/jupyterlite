/* Installed in lab/index.html by install.py. No arbitrary code from messages. */
(() => {
  const CHANNEL = 'notebook-bridge-v1';
  // Add the exact origin of your HTML page here if hosted elsewhere.
  const ALLOWED_ORIGINS = new Set([location.origin, 'http://localhost:8000']);
  const NOTEBOOK = 'pyodide/simple-api-call.ipynb';
  let busy = false;
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
      send('connected');
      return;
    }
    if (message.type !== 'run') return;
    if (busy) { send('error', {error: 'A notebook execution is already running.'}); return; }
    if (!message.inputs || typeof message.inputs !== 'object' || Array.isArray(message.inputs)) {
      send('error', {error: 'Inputs must be a JSON object.'}); return;
    }
    busy = true;
    send('status', {text: 'Starting Python…'});
    try {
      const app = await getApp();
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
