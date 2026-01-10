// TX Traffic Code QuickSearch (PWA)
// Primary match + related (≤10). Offline-ready after first load.

const $ = (id) => document.getElementById(id);

const state = {
  offenses: [],
  byId: new Map(),
  aliases: {},
  relatedOpen: false
};

function normalize(s){
  return (s || "").toString().trim().toLowerCase();
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

function renderPrimary(o){
  if (!o){
    setHidden("primarySec", true);
    return;
  }
  $("primaryTitle").textContent = o.title;
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
    state.relatedOpen = !state.relatedOpen;
    btn.textContent = `${state.relatedOpen ? "Hide" : "Show"} related (${list.length})`;
    setHidden("relatedList", !state.relatedOpen);
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
  $("dlgTitle").textContent = o.title;
  const code = o.code || "TTC";
  const cite = `${code} § ${o.citation}`;
  $("dlgBody").innerHTML = `
    <div class="kv"><b>Citation:</b> ${escapeHtml(cite)}</div>
    <div class="kv"><b>Offense level:</b> ${escapeHtml(o.level_code || "Not specified in dataset")}</div>
    <div class="kv"><b>Search keywords:</b> ${escapeHtml((o.kw || "").split(/\s+/).slice(0,35).join(" "))}${(o.kw||"").split(/\s+/).length>35 ? " …" : ""}</div>
    <div class="kv" style="margin-top:10px;"><b>Note:</b> Verbatim statute text is a separate layer we can add next (cached for offline).</div>
  `;
  dlg.showModal();
}

function closeDetails(){
  $("detailDlg").close();
}

async function loadJson(path){
  const res = await fetch(path, {cache:"no-store"});
  if (!res.ok) throw new Error(`Failed to load ${path}`);
  return await res.json();
}

async function init(){
  try{
    const [offenses, aliases] = await Promise.all([
      loadJson("offenses.json"),
      loadJson("primary_aliases.json")
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
    showStatus("Error loading data. (If first time offline, connect once to cache.)");
  }
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
  const primaryId = state.aliases[q];
  const primary = primaryId ? state.byId.get(primaryId) : null;
  renderPrimary(primary || null);

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
