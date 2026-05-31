/* ===== Tartalék bank ===== */
const FALLBACK_BANK = [
  { topic: "Komplex számok", multi: false, prompt: "Mennyi (2+5i)·(1−i)?", options: [{ t: "7+3i", c: true }, { t: "2−5i", c: false }, { t: "7−3i", c: false }, { t: "−3+7i", c: false }], e: "(2+5i)(1−i)=2+3i+5 = <strong>7+3i</strong>." },
  { topic: "Sajátérték", multi: true, prompt: "Melyik igaz a sajátértékekről?", options: [{ t: "Különböző sajátértékek sajátvektorai függetlenek.", c: true }, { t: "geom. multiplicitás ≤ alg. multiplicitás.", c: true }, { t: "Különböző sajátértékek sajátvektorai mindig merőlegesek.", c: false }, { t: "A 0 minden transzformációnak sajátértéke.", c: false }], e: "Függetlenek (nem feltétlenül merőlegesek); geom ≤ alg; a 0 csak nem invertálható esetben sajátérték." }
];

/* ===== Állapot ===== */
let bank = [];
let quiz = [], quizState = [], i = 0, score = 0;
const results = [];
let ghToken = '';
const app = document.getElementById('app');
const foot = document.getElementById('foot');

function typeset(el) { if (window.MathJax && MathJax.typesetPromise) MathJax.typesetPromise([el]).catch(() => { }); }
function shuffle(a) { a = a.slice(); for (let k = a.length - 1; k > 0; k--) { const j = Math.floor(Math.random() * (k + 1));[a[k], a[j]] = [a[j], a[k]]; } return a; }
function toast(m) { const t = document.getElementById('toast'); t.textContent = m; t.classList.add('show'); clearTimeout(t._t); t._t = setTimeout(() => t.classList.remove('show'), 2600); }
function esc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
function norm(arr) { return arr.filter(q => q && q.prompt && Array.isArray(q.options)).map(q => ({ topic: q.topic || "Egyéb", multi: !!q.multi, prompt: q.prompt, options: q.options.map(o => ({ t: o.t || o.text || '', c: !!o.c || !!o.correct })), e: q.e || q.explanation || '' })); }

/* ===== Indítás: questions.json letöltése ===== */
async function init() {
  try {
    const res = await fetch('questions.json?t=' + Date.now(), { cache: 'no-store' });
    if (!res.ok) throw new Error(res.status);
    const data = await res.json();
    const arr = Array.isArray(data) ? data : data.questions;
    const clean = norm(arr || []);
    bank = clean.length ? clean : FALLBACK_BANK.map(q => ({ ...q }));
    if (!clean.length) toast('questions.json üres — tartalék bank betöltve');
  } catch (e) {
    bank = FALLBACK_BANK.map(q => ({ ...q }));
    toast('questions.json nem elérhető — tartalék bank (' + bank.length + ' kérdés)');
  }
  renderSetup();
}

/* ===== SETUP ===== */
function renderSetup() {
  document.getElementById('sidebar').classList.remove('open');
  const topics = [...new Set(bank.map(q => q.topic))].sort();
  const maxN = bank.length, def = Math.min(10, maxN);
  const gh = detectRepo();
  app.innerHTML = `
   <div class="card setup">
     <h2>Kvíz beállítása</h2>
     <div class="lead">Válaszd ki, hány kérdés legyen — a program véletlenszerűen sorsol a bankból.</div>
     <div class="bankinfo">
       <div class="stat"><div class="n">${bank.length}</div><div class="l">Kérdés a bankban</div></div>
       <div class="stat"><div class="n">${topics.length}</div><div class="l">Téma</div></div>
       <div class="stat"><div class="n" id="willdo">${def}</div><div class="l">Most kérdezem</div></div>
     </div>
     <div class="field"><label for="topic">Téma szűrő</label>
       <select id="topic"><option value="__all">Összes téma (${bank.length})</option>
       ${topics.map(t => `<option value="${esc(t)}">${esc(t)} (${bank.filter(q => q.topic === t).length})</option>`).join("")}</select></div>
     <div class="field"><label for="count">Kérdések száma</label>
       <div class="countrow"><input type="range" id="count" min="1" max="${maxN}" value="${def}"><span class="countbadge" id="countval">${def}</span></div></div>
     <div class="controls">
       <button class="btn primary" id="start">Kvíz indítása →</button>
       <button class="btn ghost small" id="add">＋ Új kérdés</button>
       <button class="btn ghost small" id="export">⬇ Teljes bank letöltése</button>
       <button class="btn ghost small" id="loadbtn">📂 JSON felülírása</button>
       <button class="btn ghost small" id="mergebtn" style="color:var(--accent-deep); border-color:var(--accent-deep)">➕ Új JSON hozzáfűzése</button>
       <button class="btn blue small" id="ghbtn">⚙ GitHub feltöltés</button>
     </div>

     <div class="gh-panel" id="ghpanel">
       <div class="flbl">Kérdésbank feltöltése GitHubra (tulajdonosi mód)</div>
       <div class="gh-grid">
         <div><label class="flbl">Felhasználó / org</label><input type="text" id="gh-owner" value="${esc(gh.owner)}" placeholder="pl. kovacsanna"></div>
         <div><label class="flbl">Repó</label><input type="text" id="gh-repo" value="${esc(gh.repo)}" placeholder="pl. dm-la-kviz"></div>
         <div><label class="flbl">Fájl útvonal</label><input type="text" id="gh-path" value="questions.json"></div>
         <div><label class="flbl">Branch</label><input type="text" id="gh-branch" value="main"></div>
         <div class="full"><label class="flbl">Personal Access Token (Contents: write)</label><input type="password" id="gh-token" placeholder="github_pat_… (csak ebben a fülben tárolódik)"></div>
       </div>
       <button class="btn blue small" id="ghpush">Feltöltés GitHubra</button>
       <div class="help">A token csak a memóriában marad. Visitoroknak nincs rá szükségük.</div>
     </div>
   </div>`;

  const range = document.getElementById('count'), countval = document.getElementById('countval'),
    willdo = document.getElementById('willdo'), topicSel = document.getElementById('topic');
  function refreshMax() { const t = topicSel.value; const n = t === '__all' ? bank.length : bank.filter(q => q.topic === t).length; range.max = n; if (+range.value > n) range.value = n; countval.textContent = range.value; willdo.textContent = range.value; }
  topicSel.addEventListener('change', refreshMax);
  range.addEventListener('input', () => { countval.textContent = range.value; willdo.textContent = range.value; });

  document.getElementById('start').addEventListener('click', () => {
    const t = topicSel.value, pool = t === '__all' ? bank : bank.filter(q => q.topic === t);
    const n = Math.min(+range.value, pool.length);
    quiz = shuffle(pool).slice(0, n);
    quizState = quiz.map(() => ({ answered: false, selected: new Set(), result: null }));
    i = 0; score = 0; results.length = 0;
    document.getElementById('sidebar').classList.add('open');
    renderSidebar();
    renderQuestion();
    scrollTop();
  });

  document.getElementById('add').addEventListener('click', renderAddForm);
  document.getElementById('export').addEventListener('click', exportJSON);
  document.getElementById('loadbtn').addEventListener('click', loadFile);
  document.getElementById('mergebtn').addEventListener('click', mergeFile);

  const panel = document.getElementById('ghpanel');
  document.getElementById('ghbtn').addEventListener('click', () => { panel.classList.toggle('open'); });
  document.getElementById('ghpush').addEventListener('click', pushToGitHub);
  if (ghToken) document.getElementById('gh-token').value = ghToken;
  foot.textContent = "Kérdésbank: " + bank.length + " kérdés · " + topics.length + " téma";
}

function scrollTop() { window.scrollTo({ top: 0, behavior: 'smooth' }); }
window.goTo = function (idx) { i = idx; renderQuestion(); renderSidebar(); scrollTop(); };

/* ===== SIDEBAR (Oldalsáv) ===== */
function renderSidebar() {
  const grid = document.getElementById('q-grid');
  grid.innerHTML = quizState.map((s, idx) => {
    let cls = 'q-nav-btn';
    if (idx === i) cls += ' active';
    if (s.answered && s.result) cls += ' ' + s.result;
    return `<button class="${cls}" onclick="goTo(${idx})">${idx + 1}</button>`;
  }).join('');
  document.getElementById('sidebar-finishbtn').onclick = finish;
}

/* ===== KÉRDÉS NÉZET ===== */
function renderQuestion() {
  const q = quiz[i], s = quizState[i];
  const opts = q.options.map((o, idx) => {
    let cls = q.multi ? '' : 'single';
    let badge = '';
    const isSel = s.selected.has(idx);
    if (isSel) cls += ' sel';
    if (s.answered) {
      cls += ' locked';
      const isC = o.c;
      if (isSel && isC) { cls += ' correct'; badge = '<span class="badge">helyes</span>'; }
      else if (isSel && !isC) { cls += ' wrongpick'; badge = '<span class="badge">rossz</span>'; }
      else if (!isSel && isC) { cls += ' missed'; badge = '<span class="badge">kimaradt</span>'; }
    }
    return `<li class="opt ${cls}" data-idx="${idx}"><span class="mark"></span><span class="txt">${o.t}</span>${badge}</li>`;
  }).join("");

  let fbHtml = '';
  if (s.answered) {
    let head, dot;
    if (s.result === 'ok') { head = "Helyes!"; dot = "✓"; }
    else if (s.result === 'part') { head = "Részben helyes"; dot = "◐"; }
    else { head = "Nem talált"; dot = "✕"; }
    fbHtml = `<div class="feedback ${s.result}"><div class="fb-head"><span>${dot}</span>${head}</div><div class="expl">${q.e || ''}</div></div>`;
  }

  app.innerHTML = `
   <div class="progress-row"><span class="pmeta">${i + 1} / ${quiz.length}</span><div class="ptrack"><div class="pfill" id="pfill"></div></div><span class="score-chip" id="scorechip">${score} pont</span></div>
   <div class="card bar">
     <div class="qtag">${i + 1}. kérdés</div><span class="qtopic">${esc(q.topic || '')}</span>
     <div class="prompt">${q.prompt}</div>
     <div class="hint">${q.multi ? "Több helyes válasz is lehet — jelöld be mindet." : "Egy helyes válasz van."}</div>
     <ul class="options">${opts}</ul><div id="fbslot">${fbHtml}</div>
     <div class="controls">
       <button class="btn ghost" id="prevbtn" ${i === 0 ? 'disabled' : ''}>← Előző</button>
       ${!s.answered ? `<button class="btn primary" id="checkbtn" ${s.selected.size === 0 ? 'disabled' : ''}>Ellenőrzés</button>` : ''}
       <button class="btn primary" id="nextbtn">${i + 1 < quiz.length ? 'Következő →' : 'Befejezés'}</button>
     </div>
   </div>`;

  document.getElementById('pfill').style.width = (quizState.filter(x => x.answered).length / quiz.length * 100) + "%";

  if (!s.answered) {
    app.querySelectorAll('.opt').forEach(el => el.addEventListener('click', () => {
      const idx = +el.dataset.idx;
      if (q.multi) {
        if (s.selected.has(idx)) { s.selected.delete(idx); el.classList.remove('sel'); }
        else { s.selected.add(idx); el.classList.add('sel'); }
      } else {
        s.selected.clear();
        app.querySelectorAll('.opt').forEach(o => o.classList.remove('sel'));
        s.selected.add(idx); el.classList.add('sel');
      }
      document.getElementById('checkbtn').disabled = s.selected.size === 0;
    }));

    document.getElementById('checkbtn').addEventListener('click', () => {
      const correct = new Set(q.options.map((o, k) => o.c ? k : -1).filter(k => k >= 0));
      let right = 0, wrong = 0;
      app.querySelectorAll('.opt').forEach(el => {
        const idx = +el.dataset.idx;
        if (s.selected.has(idx) && correct.has(idx)) right++;
        else if (s.selected.has(idx) && !correct.has(idx)) wrong++;
      });
      const all = (wrong === 0 && right === correct.size);
      const part = (!all && right > 0 && wrong === 0);

      s.answered = true;
      if (all) { s.result = 'ok'; score++; }
      else if (part) { s.result = 'part'; }
      else { s.result = 'no'; }

      renderQuestion();
      renderSidebar();
    });
  }

  document.getElementById('prevbtn').addEventListener('click', () => goTo(i - 1));
  document.getElementById('nextbtn').addEventListener('click', () => {
    if (i + 1 < quiz.length) goTo(i + 1); else finish();
  });
  typeset(app);
}

function finish() {
  document.getElementById('sidebar').classList.remove('open');
  let finalScore = 0;
  results.length = 0;
  quizState.forEach((s, idx) => {
    if (s.result === 'ok') finalScore++;
    results.push({ topic: quiz[idx].topic, state: s.result || 'no' });
  });
  score = finalScore;

  const pct = Math.round(score / quiz.length * 100);
  let verdict = pct >= 90 ? "Kiváló — ez vizsgaérett tudás." : pct >= 70 ? "Erős teljesítmény, pár fogalmat csiszolj." : pct >= 50 ? "Jó alap — nézd át a hibás témákat." : "Még gyakorolj — a magyarázatok segítenek.";
  const rows = results.map((r, k) => { const ico = r.state === "ok" ? '<span class="ico ok-i">✓</span>' : r.state === "part" ? '<span class="ico pt-i">◐</span>' : '<span class="ico no-i">✕</span>'; return `<div class="brow">${ico}<span>${k + 1}. kérdés</span><span class="topic">${esc(r.topic || '')}</span></div>`; }).join("");
  app.innerHTML = `<div class="card result"><div class="ring" id="ring"><div class="inner"><div class="big">${score}<span style="font-size:1.1rem;color:var(--ink-soft)">/${quiz.length}</span></div><div class="small">${pct}%</div></div></div>
   <h2>Kvíz kész</h2><div class="verdict">${verdict}</div><div class="breakdown">${rows}</div>
   <div class="controls" style="justify-content:center"><button class="btn primary" id="again">Új kvíz beállítása</button></div></div>`;
  requestAnimationFrame(() => { const r = document.getElementById('ring'); if (r) r.style.background = `conic-gradient(var(--accent) ${pct}%, var(--rule) 0)`; });
  document.getElementById('again').addEventListener('click', renderSetup); typeset(app);
}

/* ===== ÚJ KÉRDÉS (Szerkesztő) ===== */
let draftType = 'multi';
function renderAddForm() {
  draftType = 'multi';

  // Kiszedjük és sorbarendezzük a már meglévő (egyedi) témákat a bankból
  const topics = [...new Set(bank.map(q => q.topic))].filter(Boolean).sort();
  const datalistOpts = topics.map(t => `<option value="${esc(t)}"></option>`).join('');

  app.innerHTML = `<div class="card addform"><h2>Új kérdés</h2>
   <div class="lead">A bekapcsolt jelölő = helyes válasz. LaTeX-hez: \\( ... \\).</div>
   
   <div class="frow">
     <label class="flbl">Téma</label>
     <input type="text" id="f-topic" list="topic-list" placeholder="Kattints ide a meglévőkhöz vagy gépelj újat..." autocomplete="off">
     <datalist id="topic-list">${datalistOpts}</datalist>
   </div>
   
   <div class="frow"><label class="flbl">Típus</label><div class="seg"><button id="t-multi" class="on">Több válasz</button><button id="t-single">Egy válasz</button></div></div>
   <div class="frow"><label class="flbl">Kérdés szövege</label><textarea id="f-prompt" rows="2" placeholder="A kérdés..."></textarea></div>
   <div class="frow"><label class="flbl">Válaszlehetőségek (pipáld be a helyeseket)</label><div id="opts"></div><button class="btn ghost small" id="addopt" style="margin-top:4px;">＋ Válasz</button></div>
   <div class="frow"><label class="flbl">Magyarázat</label><textarea id="f-expl" rows="3" placeholder="Miért ez a helyes válasz..."></textarea></div>
   <div class="controls"><button class="btn primary" id="saveq">Hozzáadás a bankhoz</button><button class="btn ghost small" id="back">← Vissza</button></div></div>`;

   // Szövegdobozok automatikus függőleges méretezése
  app.querySelectorAll('textarea').forEach(ta => {
    ta.addEventListener('input', function() {
      this.style.height = 'auto';
      this.style.height = this.scrollHeight + 'px';
    });
    // Kezdeti magasság beállítása
    requestAnimationFrame(() => {
      ta.style.height = 'auto';
      ta.style.height = ta.scrollHeight + 'px';
    });
  });

  const box = document.getElementById('opts');
  function addOpt(t = '', c = false) {
    const r = document.createElement('div'); r.className = 'optedit';
    r.innerHTML = `<input type="text" class="o-text" placeholder="Válasz szövege" value="${esc(t)}"><label class="cbx"><input type="checkbox" class="o-correct" ${c ? 'checked' : ''}>helyes</label><button class="del">✕</button>`;
    r.querySelector('.del').addEventListener('click', () => { if (box.children.length > 2) r.remove(); else toast('Legalább 2 válasz kell'); }); box.appendChild(r);
  }
  addOpt('', true); addOpt(''); addOpt(''); addOpt('');
  document.getElementById('addopt').addEventListener('click', () => { if (box.children.length < 8) addOpt(); else toast('Max 8 válasz'); });
  const tm = document.getElementById('t-multi'), ts = document.getElementById('t-single');
  tm.addEventListener('click', () => { draftType = 'multi'; tm.classList.add('on'); ts.classList.remove('on'); });
  ts.addEventListener('click', () => { draftType = 'single'; ts.classList.add('on'); tm.classList.remove('on'); });

  document.getElementById('saveq').addEventListener('click', () => {
    const topic = document.getElementById('f-topic').value.trim() || "Egyéb";
    const prompt = document.getElementById('f-prompt').value.trim();
    const expl = document.getElementById('f-expl').value.trim();
    const rows = [...box.querySelectorAll('.optedit')];
    const options = rows.map(r => ({ t: r.querySelector('.o-text').value.trim(), c: r.querySelector('.o-correct').checked })).filter(o => o.t);
    if (!prompt) { toast('Írd be a kérdést'); return; }
    if (options.length < 2) { toast('Legalább 2 válasz kell'); return; }
    const nC = options.filter(o => o.c).length;
    if (nC < 1) { toast('Jelölj meg helyes választ'); return; }
    if (draftType === 'single' && nC > 1) { toast('Egyválaszos: csak 1 helyes'); return; }
    bank.push({ topic, multi: draftType === 'multi', prompt, options, e: expl });
    toast('Hozzáadva (' + bank.length + ' kérdés)'); renderSetup();
  });
  document.getElementById('back').addEventListener('click', renderSetup); typeset(app);
}

/* ===== Export / import / GitHub ===== */
function bankJSON() { return JSON.stringify({ version: 1, questions: bank }, null, 2); }
function exportJSON() {
  const blob = new Blob([bankJSON()], { type: 'application/json' });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'questions.json';
  document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(a.href); toast('Letöltve: questions.json');
}
function loadFile() {
  const inp = document.createElement('input'); inp.type = 'file'; inp.accept = '.json,application/json';
  inp.onchange = async () => { const f = inp.files[0]; if (!f) return; try { const data = JSON.parse(await f.text()); const arr = Array.isArray(data) ? data : data.questions; const clean = norm(arr || []); if (!clean.length) throw new Error('üres'); bank = clean; toast('Betöltve: ' + bank.length + ' kérdés (Felülírva)'); renderSetup(); } catch (e) { toast('Hiba: ' + e.message); } };
  inp.click();
}

/* === JSON hozzáfűzése === */
function mergeFile() {
  const inp = document.createElement('input'); inp.type = 'file'; inp.accept = '.json,application/json';
  inp.onchange = async () => {
    const f = inp.files[0]; if (!f) return;
    try {
      const data = JSON.parse(await f.text());
      const arr = Array.isArray(data) ? data : data.questions;
      const clean = norm(arr || []);
      if (!clean.length) throw new Error('Nem található érvényes kérdés a fájlban');
      bank.push(...clean);
      toast('Sikeresen hozzáfűzve ' + clean.length + ' kérdés! (Összesen: ' + bank.length + ')');
      renderSetup();
    } catch (e) { toast('Hiba a fájl feldolgozásakor: ' + e.message); }
  };
  inp.click();
}

function detectRepo() {
  try {
    const h = location.hostname, parts = location.pathname.split('/').filter(Boolean);
    if (h.endsWith('.github.io')) {
      const owner = h.split('.')[0];
      const repo = parts.length ? parts[0] : owner + '.github.io';
      return { owner, repo };
    }
  } catch (e) { }
  return { owner: '', repo: '' };
}
function b64utf8(str) { return btoa(unescape(encodeURIComponent(str))); }
async function pushToGitHub() {
  const owner = document.getElementById('gh-owner').value.trim();
  const repo = document.getElementById('gh-repo').value.trim();
  const path = document.getElementById('gh-path').value.trim() || 'questions.json';
  const branch = document.getElementById('gh-branch').value.trim() || 'main';
  ghToken = document.getElementById('gh-token').value.trim();
  if (!owner || !repo || !ghToken) { toast('Töltsd ki: owner, repó, token'); return; }
  const api = `https://api.github.com/repos/${owner}/${repo}/contents/${path.split('/').map(encodeURIComponent).join('/')}`;
  const headers = { Authorization: `Bearer ${ghToken}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' };
  toast('Feltöltés…');
  let sha = null;
  try { const g = await fetch(`${api}?ref=${encodeURIComponent(branch)}`, { headers }); if (g.ok) { const j = await g.json(); sha = j.sha; } } catch (e) { }
  const body = { message: `Kérdésbank frissítése (${bank.length} kérdés)`, content: b64utf8(bankJSON()), branch };
  if (sha) body.sha = sha;
  try {
    const r = await fetch(api, { method: 'PUT', headers, body: JSON.stringify(body) });
    if (r.ok) { toast('Feltöltve ✓ A Pages 1–2 perc múlva frissül.'); }
    else { const e = await r.json().catch(() => ({})); toast('GitHub hiba: ' + (e.message || r.status)); }
  } catch (err) { toast('Hálózati hiba: ' + err.message); }
}

init();