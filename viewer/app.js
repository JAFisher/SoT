/* ── SoT Flow Visualizer — Client-Side App ── */

(async function () {
  "use strict";

  // ── State ──
  let flowsData = {};
  let activeFlow = null;

  // ── DOM refs ──
  const flowList         = document.getElementById("flowList");
  const globalStats      = document.getElementById("globalStats");
  const welcome          = document.getElementById("welcome");
  const flowView         = document.getElementById("flowView");
  const flowTitle        = document.getElementById("flowTitle");
  const flowBadge        = document.getElementById("flowBadge");
  const statNodes        = document.getElementById("statNodes");
  const statEdges        = document.getElementById("statEdges");
  const statMethods      = document.getElementById("statMethods");
  const diagramEl        = document.getElementById("diagram");
  const typesPanel       = document.getElementById("typesPanel");
  const typesContent     = document.getElementById("typesContent");
  const interfacesPanel  = document.getElementById("interfacesPanel");
  const interfacesContent= document.getElementById("interfacesContent");
  const methodsPanel     = document.getElementById("methodsPanel");
  const methodsContent   = document.getElementById("methodsContent");
  const externalsPanel   = document.getElementById("externalsPanel");
  const externalsContent = document.getElementById("externalsContent");
  const sourceCode       = document.getElementById("sourceCode");
  const tabBtns          = document.querySelectorAll(".tab-btn");
  const tabContents      = document.querySelectorAll(".tab-content");

  // ── Initialize Mermaid ──
  mermaid.initialize({
    startOnLoad: false,
    theme: "dark",
    themeVariables: {
      darkMode: true,
      background: "#111827",
      primaryColor: "#312e81",
      primaryTextColor: "#f1f5f9",
      primaryBorderColor: "#6366f1",
      lineColor: "#818cf8",
      secondaryColor: "#1e293b",
      tertiaryColor: "#1a2035",
      noteBkgColor: "#1e293b",
      noteTextColor: "#f1f5f9",
      fontFamily: "'Inter', system-ui, sans-serif",
      fontSize: "14px",
      nodeBorder: "#6366f1",
      clusterBkg: "#1e293b",
      clusterBorder: "#334155",
      edgeLabelBackground: "#111827",
    },
    flowchart: {
      curve: "basis",
      padding: 20,
      nodeSpacing: 50,
      rankSpacing: 60,
      htmlLabels: true,
      useMaxWidth: false,
    },
    securityLevel: "loose",
  });

  // ── Load Data ──
  try {
    const res = await fetch("flows.json");
    if (!res.ok) throw new Error("Failed to fetch flows.json");
    flowsData = await res.json();
  } catch (err) {
    welcome.innerHTML = `
      <div class="welcome-icon" style="filter:none;color:var(--danger)">⚠</div>
      <h1>Could not load flow data</h1>
      <p>Run <code>node flowToMermaid.js</code> first to generate <code>viewer/flows.json</code>.</p>
      <p style="margin-top:12px;font-size:0.8rem;color:var(--text-muted)">${err.message}</p>
    `;
    return;
  }

  // ── Populate Sidebar ──
  const flowNames = Object.keys(flowsData).sort();
  let totalNodes = 0;

  flowNames.forEach((name) => {
    const meta = flowsData[name].metadata;
    totalNodes += meta.nodeCount;

    const li = document.createElement("li");
    const a = document.createElement("a");
    a.href = "#";
    a.dataset.flow = name;

    const label = document.createElement("span");
    label.textContent = name;

    const count = document.createElement("span");
    count.className = "flow-node-count";
    count.textContent = meta.nodeCount;

    a.appendChild(label);
    a.appendChild(count);
    li.appendChild(a);
    flowList.appendChild(li);

    a.addEventListener("click", (e) => {
      e.preventDefault();
      selectFlow(name);
    });
  });

  // ── Tab Switching ──
  tabBtns.forEach(btn => {
    btn.addEventListener("click", () => {
      const tab = btn.dataset.tab;
      tabBtns.forEach(b => b.classList.toggle("active", b === btn));
      tabContents.forEach(c => {
        c.classList.toggle("hidden", c.id !== `tab-${tab}`);
      });
    });
  });

  globalStats.textContent = `${flowNames.length} flows · ${totalNodes} total nodes`;

  // ── Select a Flow ──
  async function selectFlow(name) {
    if (activeFlow === name) return;
    activeFlow = name;

    // Update sidebar active
    flowList.querySelectorAll("a").forEach((a) => {
      a.classList.toggle("active", a.dataset.flow === name);
    });

    // Show flow view
    welcome.classList.add("hidden");
    flowView.classList.remove("hidden");

    const data = flowsData[name];
    const meta = data.metadata;

    // Header
    flowTitle.textContent = name;
    flowBadge.textContent = ".flow";
    statNodes.querySelector(".stat-num").textContent = meta.nodeCount;
    statEdges.querySelector(".stat-num").textContent = meta.compositionEdgeCount + meta.inheritanceEdgeCount;
    statMethods.querySelector(".stat-num").textContent = meta.methods.length;

    // Render Mermaid Diagram
    await renderDiagram(data.diagram);

    // Render Source Code
    renderSource(data.rawSource || "");

    // Detail panels
    renderTypes(meta.types);
    renderInterfaces(meta.interfaces);
    renderMethods(meta.methods);
    renderExternals(meta.externals);
  }

  // ── Render Source ──
  function renderSource(code) {
    if (window.FlowHighlighter) {
      sourceCode.innerHTML = window.FlowHighlighter.highlight(code);
    } else {
      sourceCode.textContent = code;
    }
  }

  // ── Render Mermaid ──
  let diagramCounter = 0;

  async function renderDiagram(diagramDef) {
    diagramCounter++;
    const id = `sot-diagram-${diagramCounter}`;
    diagramEl.innerHTML = "";

    try {
      const { svg } = await mermaid.render(id, diagramDef);
      diagramEl.innerHTML = svg;
    } catch (err) {
      diagramEl.innerHTML = `
        <div style="padding:40px;text-align:center;color:var(--danger)">
          <p style="font-size:1.1rem;font-weight:600;margin-bottom:8px">Diagram render failed</p>
          <pre style="font-size:0.75rem;color:var(--text-muted);white-space:pre-wrap;max-width:600px;margin:0 auto">${escapeHtml(err.message || String(err))}</pre>
        </div>
      `;
    }
  }

  // ── Detail Panel Renderers ──

  function renderTypes(types) {
    const entries = Object.entries(types || {});
    if (entries.length === 0) {
      typesPanel.style.display = "none";
      return;
    }
    typesPanel.style.display = "";
    typesContent.innerHTML = entries.map(([name, fields]) => `
      <div class="detail-item">
        <div class="detail-item-name">${escapeHtml(name)}</div>
        <div class="detail-item-fields">${fields.map(f => escapeHtml(f)).join("<br>")}</div>
      </div>
    `).join("");
  }

  function renderInterfaces(interfaces) {
    const entries = Object.entries(interfaces || {});
    if (entries.length === 0) {
      interfacesPanel.style.display = "none";
      return;
    }
    interfacesPanel.style.display = "";
    interfacesContent.innerHTML = entries.map(([name, fields]) => `
      <div class="detail-item">
        <div class="detail-item-name">${escapeHtml(name)}</div>
        <div class="detail-item-fields">${fields.map(f => escapeHtml(f)).join("<br>")}</div>
      </div>
    `).join("");
  }

  function renderMethods(methods) {
    if (!methods || methods.length === 0) {
      methodsPanel.style.display = "none";
      return;
    }
    methodsPanel.style.display = "";

    // Group methods by class
    const grouped = {};
    methods.forEach((m) => {
      if (!grouped[m.class]) grouped[m.class] = [];
      grouped[m.class].push(m);
    });

    methodsContent.innerHTML = Object.entries(grouped).map(([cls, meths]) => `
      <div class="detail-item">
        <div class="detail-item-name">${escapeHtml(cls)}</div>
        ${meths.map(m => `
          <div class="detail-item-signature">
            ${escapeHtml(m.name)}(${(m.signature.match(/\(([^)]*)\)/)?.[1] || "")}): ${escapeHtml(m.signature.split(": ").pop())}
            ${m.hasCode ? '<span class="detail-item-badge badge-has-code">impl</span>' : ''}
          </div>
        `).join("")}
      </div>
    `).join("");
  }

  function renderExternals(externals) {
    if (!externals || Object.keys(externals).length === 0) {
      externalsPanel.style.display = "none";
      return;
    }
    externalsPanel.style.display = "";
    externalsContent.innerHTML = Object.entries(externals).map(([name, data]) => {
      const path = typeof data === 'string' ? data : data.path;
      const version = typeof data === 'object' && data.version && data.version !== 'latest' ? data.version : null;
      return `
        <div class="detail-item">
          <div class="detail-item-name">
            ${escapeHtml(name)}
            <span class="detail-item-badge badge-extern">ext</span>
            ${version ? `<span class="detail-item-badge" style="background:var(--primary);color:white;border:none">v${escapeHtml(version)}</span>` : ''}
          </div>
          <div class="detail-item-signature">from '${escapeHtml(path)}'</div>
        </div>
      `;
    }).join("");
  }

  // ── Helpers ──
  function escapeHtml(str) {
    if (!str) return "";
    return str
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  // ── Auto-select from hash or first flow ──
  const hash = window.location.hash.slice(1);
  if (hash && flowsData[hash]) {
    selectFlow(hash);
  }

})();
