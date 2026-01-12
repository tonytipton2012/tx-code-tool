
const APP_VERSION = "v1.0.99-debug";
const BUILD_TIME = "2026-01-11 21:30:00";

function setVersionBadges(offenseCount){
  const vb = document.getElementById("verBadge");
  const db = document.getElementById("dataBadge");
  if(vb) vb.textContent = `Traffic Tool ${APP_VERSION} (${BUILD_TIME})`;
  if(db) db.textContent = `Records loaded: ${offenseCount}`;
}

async function forceReloadData(){
  const url = "offenses.json?v=" + Date.now();
  const res = await fetch(url, { cache: "no-store" });
  if(!res.ok) throw new Error("Failed to reload offenses.json (" + res.status + ")");
  return await res.json();
}

// TX Traffic Code QuickSearch (PWA)
// Primary match + related (≤10). Offline-ready after first load.

const $ = (id) => document.getElementById(id);
const BUILD_ID = "v9";

const state = {
  offenses: [],
  byId: new Map(),
  aliases: {},
  statutesBySection: new Map(),
  statutesRegistryBySection: new Map(),
  relatedOpen: false
};

function cleanDisplayText(s){
  s = s.replace(/\bLe\b/gi,'Left');
  if(!s) return s
    .replace(/\bignion\b/gi,"ignition")
    .replace(/\binstrucon\b/gi,"instruction")
    .replace(/\bacvate\b/gi,"activate")
    .replace(/\bexcepons\b/gi,"exceptions")
    .replace(/\brecreaonal\b/gi,"recreational")
    .replace(/Arcles/gi,"Articles");
  // Last-line defense against OCR typos that may sneak into source text.
  return s
    .replace(/\bLel\b/gi, "Left")
    .replace(/\bAer\b/gi, "After")
    .replace(/O\.?cer/gi, "Officer")
    .replace(/\bficous\b/gi, "fictitious")
    .replace(/\bdefecve\b/gi, "defective")
    .replace(/\bmulple\b/gi, "multiple")
    .replace(/\blighng\b/gi, "lighting")
    .replace(/\bregistraon\b/gi, "registration")
    .replace(/\bRegistraon\b/g, "Registration")
    .replace(/cer\W*cate/gi, "certificate")
    .replace(/Cer\W*cate/g, "Certificate")
    .replace(/\bcericate\b/gi, "certificate")
    .replace(/Cer\.cate/gi, "Certificate")
    .replace(/\bcericate\b/gi, "certificate");
}


function normalize(s){
  return (s || "").toString().trim().toLowerCasee();
}

function tokens(s){
  // keep it simple and fast
  return normalize(s).split(/[^a-z0-9]+/).filter(Boolean);
}

function scoreOffense(qTokens, o){
  // Very fast scoring:
  // - title hits weighted higher than keyword hits
  // - citation hits weighted
  const hayTitle = normalize(o.title);
  const hayKw = normalize(o.kw || "");
  const hayCit = normalize(o.citation || "");

  let score = 0;
  for (const t of qTokens){
    if (t.length < 2) continue;
    if (hayTitle.includes(t)) score += 4;
    if (hayKw.includes(t)) score += 2;
    if (hayCit.includes(t)) score += 3;
  }
  // bonus if all tokens appear somewhere
  const allHit = qTokens.every(t => hayTitle.includes(t) || hayKw.includes(t) || hayCit.includes(t));
  if (allHit) score += 3;
  return score;
}

function itemHtml(o, onDetails){
  const level = o.level_code ? o.level_code : "";
  const code = o.code || "TTC";
  const cite = `${code} § ${o.citation}`;
  return `
    <div class="item">
      <div class="itemTop">
        <div class="itemTitle">${escapeHtml(o.title)}</div>
        <button data-id="${o.id}" class="detailsBtn">Details</button>
      </div>
      <div class="itemMeta">${escapeHtml(cite)}${level ? " • " + escapeHtml(level) : ""}</div>
    </div>
  `;
}

function escapeHtml(str){
  return (str||"").replace(/[&<>"']/g, (m) => ({
    "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"
  }[m]));
}

function showStatus(msg){
  $("status").textContent = msg;
}

function setHidden(id, hidden){
  const el = $(id);
  if (!el) return;
  el.classList.toggle("hidden", hidden);
}

function renderPrimaries(list){
  const sec = $('primarySec');
  const containerId = 'primaryContainer';
  let cont = document.getElementById(containerId);
  if(!cont){
    cont = document.createElement('div');
    cont.id = containerId;
    sec.appendChild(cont);
  }
  cont.innerHTML = '';

  if (!list || list.length === 0){
    setHidden('primarySec', true);
    return;
  }

  // show section
  setHidden('primarySec', false);
  // For multiple primaries, hide the single-title elements and render cards instead
  const singleTitle = $('primaryTitle');
  const singleMeta  = $('primaryMeta');
  const singleActions = sec.querySelector('.actions');
  if(singleTitle) singleTitle.classList.add('hidden');
  if(singleMeta) singleMeta.classList.add('hidden');
  if(singleActions) singleActions.classList.add('hidden');

  for(const o of list){
    const card = document.createElement('div');
    card.className = 'item';
    const code = o.code || 'TTC';
    const cite = `${code} § ${o.citation}`;
    card.innerHTML = `
      <div class='itemTop'>
        <div class='itemTitle'>${escapeHtml(o.title)}</div>
        <button data-id='${o.id}' class='detailsBtn'>Details</button>
      </div>
      <div class='itemMeta'>${escapeHtml(cite)}${o.level_code ? ' • ' + escapeHtml(o.level_code) : ''}</div>
    `;
    cont.appendChild(card);
  }
  wireDetailButtons(cont);
}

function renderPrimary(o){
  if (!o){
    setHidden("primarySec", true);
    return;
  }
  $("primaryTitle").textContent = cleanDisplayText(o.title);
  const code = o.code || "TTC";
  const cite = `${code} § ${o.citation}`;
  $("primaryMeta").textContent = `${cite}${o.level_code ? " • " + o.level_code : ""}`;
  setHidden("primarySec", false);

  $("copyPrimary").onclick = async () => {
    try{
      await navigator.clipboard.writeText(cite);
      showStatus("Copied citation.");
      setTimeout(()=>showStatus(""), 900);
    }catch(e){
      showStatus("Copy failed (clipboard permission).");
      setTimeout(()=>showStatus(""), 1200);
    }
  };
  $("openPrimary").onclick = () => openDetails(o);
}

function renderRelated(list){
  const btn = $("toggleRelated");
  btn.textContent = `Show related (${list.length})`;
  state.relatedOpen = false;
  setHidden("relatedWrap", list.length === 0);
  setHidden("relatedList", true);

  $("relatedList").innerHTML = list.map(o => itemHtml(o)).join("");
  wireDetailButtons($("relatedList"));

  btn.onclick = () => {
      // Online-only: open official Texas Legislature Online text.
      const raw = (o.citation_base || o.citation || "").toString();
      const m = raw.match(/(\d{3}\.\d+)/);
      const sec = m ? m[1] : "";
      if (!sec){
        box.innerHTML = "<b>Statute:</b> Not available for this citation in current dataset.";
        return;
      }
      const reg = state.statutesRegistryBySection.get(sec);
      const url = (reg && reg.url) ? reg.url : `https://statutes.capitol.texas.gov/Docs/TN/htm/TN.${sec.split('.')[0]}.htm#${sec}`;
      try{
        window.open(url, "_blank", "noopener,noreferrer");
        box.innerHTML = `Opened official text for <b>TTC § ${sec}</b>. (Requires internet.)`;
      }catch(e){
        box.innerHTML = `Internet required to open <b>TTC § ${sec}</b>. <a href="${url}" target="_blank" rel="noopener noreferrer">Open official statute online</a>.`;
      }
    };
}

function renderTop(list){
  setHidden("topWrap", list.length === 0);
  $("topList").innerHTML = list.map(o => itemHtml(o)).join("");
  wireDetailButtons($("topList"));
}

function wireDetailButtons(container){
  container.querySelectorAll(".detailsBtn").forEach(btn => {
    btn.addEventListener("click", () => {
      const id = parseInt(btn.getAttribute("data-id"), 10);
      const o = state.byId.get(id);
      if (o) openDetails(o);
    });
  });
}

function openDetails(o){
  const dlg = $("detailDlg");
  $("dlgTitle").textContent = cleanDisplayText(o.title);
  const code = o.code || "TTC";
  const cite = `${code} § ${o.citation}`;
  $("dlgBody").innerHTML = `
    <div class="kv"><b>Citation:</b> ${escapeHtml(cite)}</div>
    <div class="kv"><b>Offense level:</b> ${escapeHtml(o.level_code || "Not specified in dataset")}</div>
    <div class="kv"><b>Search keywords:</b> ${escapeHtml((o.kw || "").split(/\s+/).slice(0,35).join(" "))}${(o.kw||"").split(/\s+/).length>35 ? " …" : ""}</div>
    <div class="kv" style="margin-top:10px;"><b>Full statute:</b> <button id="showStatuteBtn" style="margin-left:8px;">Show full statute</button></div>
    <div id="statuteBox" class="kv" style="margin-top:10px;"></div>
    <div class="kv" style="margin-top:10px;"><b>Source:</b> Texas Legislature Online (official). Online only (requires internet).</div>
  `;
  dlg.showModal();

  // Wire statute button each time dialog opens
  const btn = document.getElementById("showStatuteBtn");
  const box = document.getElementById("statuteBox");
  if (btn && box){
    box.textContent = "";
    btn.onclick = () => {
      // Prefer citation_base (e.g., 545.060). Fall back to parsing citation.
      const raw = (o.citation_base || o.citation || "").toString();
      const m = raw.match(/(\d{3}\.\d+)/);
      const sec = m ? m[1] : "";
      if (!sec){
        box.innerHTML = "<b>Statute:</b> Not available for this citation in current dataset.";
        return;
      }
      const cached = state.statutesBySection.get(sec);
      if (cached && cached.text){
        box.innerHTML = `<b>TTC § ${sec}</b><div style="white-space:pre-wrap;margin-top:6px;color:var(--text);">${escapeHtml(cached.text)}</div>`;
        return;
      }
      const reg = state.statutesRegistryBySection.get(sec);
      const url = (reg && reg.url) ? reg.url : `https://statutes.capitol.texas.gov/Docs/TN/htm/TN.${sec.split('.')[0]}.htm#${sec}`;
      box.innerHTML = `Not cached yet for offline. <a href="${url}" target="_blank" rel="noopener noreferrer">Open official statute online</a>.`;
    };
  }
}

function closeDetails(){
  $("detailDlg").close();
}

async function loadJson(path){
  const res = await fetch(path, {cache:"no-store"});
  if (!res.ok) throw new Error(`Failed to load ${path} (HTTP ${res.status})`);
  return await res.json();
}

async function init(){
  try{
    const [offenses, aliases, statutes, statutesRegistry] = await Promise.all([
      loadJson("offenses.json"),
      loadJson("primary_aliases.json"),
      loadJson("statutes.json"),
      loadJson("statutes_registry.json")
    ]);

    state.offenses = offenses;
    state.aliases = aliases;
    state.byId = new Map(offenses.map(o => [o.id, o]));

    showStatus("");

    // wire UI
    $("closeDlg").onclick = closeDetails;
    $("clearBtn").onclick = () => { $("q").value=""; runSearch(""); $("q").focus(); };

    const input = $("q");
    input.addEventListener("input", () => runSearch(input.value));
    input.addEventListener("keydown", (e) => {
      if (e.key === "Escape"){ $("q").value=""; runSearch(""); }
    });

    // initial empty
    runSearch("");

  }catch(e){
    console.error(e);
    const msg = (e && e.message) ? e.message : String(e);
    showStatusHtml(
      `⚠️ <b>Error loading data</b> (build ${BUILD_ID}).<br><br>` +
      `<div style="font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace; font-size: 12px; opacity: .9;">${msg}</div>` +
      `<br><button id="resetBtn" style="padding:10px 12px;border-radius:10px;border:1px solid var(--border);background:var(--card);">Reset app cache</button>` +
      `<div style="margin-top:8px;opacity:.85;">If you just updated, the phone may still be using an old cached version. Tap reset once.</div>`
    );
    const b = document.getElementById('resetBtn');
    if (b) b.onclick = hardReset;
  }
}


async function hardReset(){
  try{
    // Unregister service workers
    if (navigator.serviceWorker){
      const regs = await navigator.serviceWorker.getRegistrations();
      await Promise.all(regs.map(r => r.unregister()));
    }
    // Clear caches
    if (window.caches){
      const keys = await caches.keys();
      await Promise.all(keys.map(k => caches.delete(k)));
    }
  }catch(e){
    console.warn(e);
  }
  // Hard reload
  location.reload();
}

function runSearch(query){
  const q = normalize(query);
  if (!q){
    renderPrimary(null);
    renderRelated([]);
    renderTop([]);
    showStatus("Type a keyword. Example: insurance, weaving, blinker, stop sign, tag.");
    return;
  }

  // Primary
  const primaryVal = state.aliases[q];
  const primaryIds = Array.isArray(primaryVal) ? primaryVal : (primaryVal ? [primaryVal] : []);
  const primaries = primaryIds.map(id => state.byId.get(id)).filter(Boolean);
  renderPrimaries(primaries);
  const primary = primaries.length ? primaries[0] : null;

  // Related/top: scored search over all offenses (fast enough for this dataset)
  const qTokens = tokens(q);
  const scored = [];
  for (const o of state.offenses){
    const s = scoreOffense(qTokens, o);
    if (s > 0) scored.push([s, o]);
  }
  scored.sort((a,b)=> b[0]-a[0]);

  // related: cap 10, exclude primary if present
  const related = [];
  for (const [s,o] of scored){
    if (primary && o.id === primary.id) continue;
    related.push(o);
    if (related.length >= 10) break;
  }
  renderRelated(related);

  // If no primary, show top matches (cap 10 as well for simplicity)
  if (!primary){
    renderTop(related);
  } else {
    renderTop([]);
  }
}

init();

// --- Debug: surface runtime errors in the status line (for iPhone Safari) ---
window.addEventListener("error", (e) => {
  try{
    const msg = (e && e.message) ? e.message : "Unknown JS error";
    showStatus("JS ERROR: " + msg);
  }catch(_){}
});
window.addEventListener("unhandledrejection", (e) => {
  try{
    const msg = (e && e.reason && e.reason.message) ? e.reason.message : (e && e.reason ? String(e.reason) : "Unhandled rejection");
    showStatus("LOAD ERROR: " + msg);
  }catch(_){}
});
