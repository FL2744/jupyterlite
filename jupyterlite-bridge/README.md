# HTML ↔ JupyterLite notebook

The HTML sends a JSON object to the embedded JupyterLite app using `postMessage`.
The bridge opens `pyodide/simple-api-call.ipynb`, sets Python `inputs`, executes its code
cells in order, and returns the JSON-serializable Python variable `outputs`.
Printed text and Python errors also appear in the HTML page. Execution occurs
in the notebook's kernel; these bridge executions do not populate saved cell outputs.
Each click reruns the notebook, so API calls and other side effects repeat.
The kernel retains other variables between runs. The bridge executes the published notebook cells, avoiding stale browser-saved notebook code.

## Install in your GitHub JupyterLite repository

1. Put your actual notebook at `content/pyodide/simple-api-call.ipynb`.
2. Copy this folder into the repository as `jupyterlite-bridge/`.
3. Adapt the notebook to read the `inputs` dictionary and assign `outputs`.
   Replace interactive `input()` and `getpass()` calls with dictionary lookups.
   For example:

   ```python
   question = inputs.get("question", "")
   # Call your existing Python function here, for example:
   # answer = await ask_llm(question)
   # outputs = {"answer": answer}
   outputs = {"received_question": question}  # Round-trip smoke test only
   ```

4. After the workflow's `jupyter lite build` step and before uploading the Pages
   artifact, run:

   ```sh
   python jupyterlite-bridge/install.py dist
   cp notebook-launcher.html dist/notebook-launcher.html
   ```

   Copy `notebook-launcher.html` into the repository root first. Replace `dist`
   if your build uses a different destination. The installer enables
   `exposeAppInBrowser` in the generated Lab page and adds the bridge script.
   Run it after every build; editing generated files manually will not persist.

5. Deploy through your existing GitHub Pages workflow. Your HTML will be at
   `https://fl2744.github.io/jupyterlite/notebook-launcher.html`.

The page and bridge point to `pyodide/simple-api-call.ipynb`, as shown in
JupyterLite. Change the path in both `bridge.js` and the HTML if it moves.
The API notebook reads the question and API key from the HTML form and returns an answer.

## Hosting the HTML elsewhere

Add its exact origin (scheme, hostname, optional port; no path) to
`ALLOWED_ORIGINS` in `bridge.js` before installing. The bridge checks both origin
and parent window; it accepts only JSON inputs for the fixed notebook, never
arbitrary Python from the HTML. Do not use a wildcard origin.

For local testing, serve the workspace with `python3 -m http.server 8000` and
open `http://localhost:8000/notebook-launcher.html`. Double-clicking the file
produces a `null` origin and is intentionally unsupported.

Inputs are passed in memory, not in URLs or notebook cell source. Nothing here
stores credentials, but any key supplied is accessible to the participating
pages and notebook code. The Python API request is still subject to the remote
API's browser CORS policy. No actual API request was made during development.

Only JSON results and plain text are rendered. Charts, HTML display output, and
interactive notebook stdin prompts are not part of this bridge contract.

References:
- https://jupyterlite.readthedocs.io/en/stable/reference/schema-v0.html
- https://jupyterlab.readthedocs.io/en/stable/api/classes/services.KernelConnection.html

## VT Domains interface

Upload `notebook-launcher.html` to `public_html/notebook-launcher.html` for
https://l1001.vt.domains/notebook-launcher.html. Both the form and bridge permit
that exact HTTPS origin. JupyterLite and the notebook remain on GitHub Pages.
Do not upload the source notebook or installer to cPanel.
