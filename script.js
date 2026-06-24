/* ============================================================
   DM & LA gyakorló  —  logika
   Két mód:
   • KVÍZ (questions.json): feleletválasztós kérdések.
   • SZÁMOLÓS FELADATOK (feladatok.json): előzmény + több
     részfeladat (szövegbeviteli / egy- vagy többválasztós).
   Kvíz-pontozás: feladatonként 4 pont, a 4 pont elosztva a
   helyes állítások számával; minden téves jelölés −40% (5+
   válasznál −25%); feladatonként min. 0 pont.
   Számolós pontozás: részfeladatonként saját pontszám; a
   többválasztós részeknél ugyanaz az arányos/büntetéses logika.
   ============================================================ */

const QUESTION_MAX = 4;

/* ===== Tartalék bankok ===== */
const FALLBACK_BANK = [
  { topic: "Komplex számok", multi: false, prompt: "Mennyi (2+5i)·(1−i)?", options: [{ t: "7+3i", c: true }, { t: "2−5i", c: false }, { t: "7−3i", c: false }, { t: "−3+7i", c: false }], e: "(2+5i)(1−i)=2+3i+5 = <strong>7+3i</strong>." },
  { topic: "Sajátérték", multi: true, prompt: "Melyik igaz a sajátértékekről?", options: [{ t: "Különböző sajátértékek sajátvektorai függetlenek.", c: true }, { t: "geom. multiplicitás ≤ alg. multiplicitás.", c: true }, { t: "Különböző sajátértékek sajátvektorai mindig merőlegesek.", c: false }, { t: "A 0 minden transzformációnak sajátértéke.", c: false }], e: "Függetlenek (nem feltétlenül merőlegesek); geom ≤ alg; a 0 csak nem invertálható esetben sajátérték." }
];
const FALLBACK_PROBLEMS = [
  {
    topic: "Komplex számok", title: "Komplex számok – alapműveletek",
    preamble: "Legyen z₁ = 4 − 3i és z₂ = 1 + i.",
    parts: [
      { id: "a", type: "text", prompt: "z₁·z₂ valós része:", answer: "7", points: 1, e: "(4−3i)(1+i)=4+i+3 = 7+i." },
      { id: "b", type: "text", prompt: "z₁·z₂ képzetes része (az i együtthatója):", answer: "1", points: 1, e: "A képzetes rész 1." },
      { id: "c", type: "text", prompt: "|z₁| =", answer: "5", points: 1, e: "√(4²+3²)=√25=5." }
    ]
  }
];

/* ===== Állapot ===== */
let lastTopic = '__all';                     // Megjegyzi a legutóbbi témát
let lastCount = 10;                          // Megjegyzi a legutóbbi darabszámot
let mode = 'kviz';                 // 'kviz' | 'szamolos'
/* Forrás szerint külön bankok: 'vizsga' = korábbi vizsgakérdések,
   'gen' = (AI által) generált gyakorló kérdések. A FÁJL a forrás:
   questions.json / feladatok.json   → generált
   questions-vizsga.json / feladatok-vizsga.json → korábbi vizsga */
let bankVizsga = [], bankGen = [];          // kvíz, forrás szerint
let probVizsga = [], probGen = [];          // számolós, forrás szerint
let examOnly = false;                       // toggle: csak korábbi vizsgakérdések
let quiz = [], quizState = [], i = 0;       // kvíz futás
let run = [], pstate = [], pi = 0;          // számolós futás
let ghToken = '';
let exportSrc = 'gen';                       // melyik fájllal dolgozzon az export/GitHub
let pickMode = 'random';                     // 'random' = sorsolás | 'manual' = kézi kiválasztás
let pickedKviz = new Set();                  // kézzel kiválasztott kérdés-objektumok
let pickedSzam = new Set();                  // kézzel kiválasztott feladat-objektumok
let pickerItems = [];                        // az épp listázott (szűrt) elemek
const app = document.getElementById('app');
const foot = document.getElementById('foot');

try { examOnly = localStorage.getItem('examOnly') === '1'; } catch (e) { }

/* ===== Segédfüggvények ===== */
function typeset(el) { if (window.MathJax && MathJax.typesetPromise) MathJax.typesetPromise([el]).catch(() => { }); }
function shuffle(a) { a = a.slice(); for (let k = a.length - 1; k > 0; k--) { const j = Math.floor(Math.random() * (k + 1));[a[k], a[j]] = [a[j], a[k]]; } return a; }
function toast(m) { const t = document.getElementById('toast'); t.textContent = m; t.classList.add('show'); clearTimeout(t._t); t._t = setTimeout(() => t.classList.remove('show'), 2600); }
function esc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
function fmtPts(n) { const r = Math.round(n * 100) / 100; return r.toFixed(2).replace(/\.?0+$/, '').replace('.', ','); }

function norm(arr, src) { return arr.filter(q => q && q.prompt && Array.isArray(q.options)).map(q => ({ topic: q.topic || "Egyéb", multi: !!q.multi, prompt: q.prompt, options: q.options.map(o => ({ t: o.t || o.text || '', c: !!o.c || !!o.correct })), e: q.e || q.explanation || '', src: src || q.src || 'gen' })); }

function normProblems(arr, src) {
  return (arr || []).filter(p => p && Array.isArray(p.parts) && p.parts.length).map(p => ({
    topic: p.topic || "Egyéb",
    title: p.title || '',
    preamble: p.preamble || '',
    src: src || p.src || 'gen',
    parts: p.parts.map((pt, k) => {
      const type = (pt.type === 'single' || pt.type === 'multi') ? pt.type : 'text';
      const base = { id: pt.id || String(k + 1), type, prompt: pt.prompt || '', points: pt.points != null ? +pt.points : 1, e: pt.e || pt.explanation || '' };
      if (type === 'text') { base.answer = pt.answer != null ? String(pt.answer) : ''; base.accept = (pt.accept || []).map(String); base.tol = pt.tol != null ? +pt.tol : null; base.suffix = pt.suffix || ''; }
      else { base.options = (pt.options || []).map(o => ({ t: o.t || o.text || '', c: !!o.c || !!o.correct })); }
      return base;
    })
  }));
}

/* ===== Pontszámítás ===== */
function scoreQuestion(q, selectedSet) {
  const correctCount = q.options.filter(o => o.c).length || 1;
  const perCorrect = QUESTION_MAX / correctCount;
  const penalty = (q.options.length >= 5 ? 0.25 : 0.40) * QUESTION_MAX;
  let pts = 0;
  selectedSet.forEach(idx => { pts += (q.options[idx] && q.options[idx].c) ? perCorrect : -penalty; });
  return Math.max(0, Math.min(QUESTION_MAX, pts));
}
function classify(pts, max) { max = max == null ? QUESTION_MAX : max; if (pts >= max - 1e-9) return 'ok'; if (pts <= 1e-9) return 'no'; return 'part'; }
function totalPoints() { return quizState.reduce((sum, s) => sum + (s.answered ? s.points : 0), 0); }
function totalProblemPoints() { return pstate.reduce((s, st) => s + (st.answered ? st.earned : 0), 0); }
function runMaxPoints() { return pstate.reduce((s, st) => s + st.max, 0); }

/* szövegbeviteli rész ellenőrzése (normalizálva, opcionális tűréssel) */
function gradeText(part, raw) {
  const nz = s => String(s).trim().toLowerCase().replace(/\s+/g, '').replace(/,/g, '.');
  const u = nz(raw); if (u === '') return false;
  const accepts = [part.answer, ...(part.accept || [])].filter(x => x != null && x !== '').map(nz);
  if (part.tol != null) {
    const un = parseFloat(u);
    if (!isNaN(un)) for (const a of accepts) { const an = parseFloat(a); if (!isNaN(an) && Math.abs(un - an) <= part.tol + 1e-9) return true; }
  }
  return accepts.includes(u);
}
/* egy részfeladat pontszáma */
function gradePart(part, st) {
  const max = part.points || 1;
  if (part.type === 'text') return gradeText(part, st.value) ? max : 0;
  // single / multi
  const correct = part.options.map((o, k) => o.c ? k : -1).filter(k => k >= 0);
  if (part.type === 'single') return (st.sel.size === 1 && st.sel.has(correct[0])) ? max : 0;
  const perCorrect = max / (correct.length || 1);
  const penalty = (part.options.length >= 5 ? 0.25 : 0.40) * max;
  let pts = 0; st.sel.forEach(idx => { pts += part.options[idx] && part.options[idx].c ? perCorrect : -penalty; });
  return Math.max(0, Math.min(max, pts));
}

/* ===== Indítás: forrásonként külön JSON betöltése ===== */
async function fetchJSON(name) {
  const res = await fetch(name + '?t=' + Date.now(), { cache: 'no-store' });
  if (!res.ok) throw 0;
  return res.json();
}
async function init() {
  // kvíz – generált
  try { const d = await fetchJSON('questions.json'); bankGen = norm(Array.isArray(d) ? d : d.questions || [], 'gen'); }
  catch (e) { bankGen = []; }
  if (!bankGen.length) bankGen = norm(FALLBACK_BANK, 'gen');
  // kvíz – korábbi vizsga
  try { const d = await fetchJSON('questions-vizsga.json'); bankVizsga = norm(Array.isArray(d) ? d : d.questions || [], 'vizsga'); }
  catch (e) { bankVizsga = []; }

  // számolós – generált
  try { const d = await fetchJSON('feladatok.json'); probGen = normProblems(Array.isArray(d) ? d : d.problems || [], 'gen'); }
  catch (e) { probGen = []; }
  if (!probGen.length) probGen = normProblems(FALLBACK_PROBLEMS, 'gen');
  // számolós – korábbi vizsga
  try { const d = await fetchJSON('feladatok-vizsga.json'); probVizsga = normProblems(Array.isArray(d) ? d : d.problems || [], 'vizsga'); }
  catch (e) { probVizsga = []; }

  // ha nincs egyetlen vizsgakérdés sem, kapcsoljuk ki a kizárólagos vizsga-szűrőt
  if (examOnly && !bankVizsga.length && !probVizsga.length) examOnly = false;
  renderSetup();
}

/* ===== Bankok forrás szerint ===== */
function bankFor(src) { return src === 'vizsga' ? bankVizsga : bankGen; }
function probFor(src) { return src === 'vizsga' ? probVizsga : probGen; }
function allBank() { return examOnly ? bankVizsga.slice() : bankVizsga.concat(bankGen); }
function allProblems() { return examOnly ? probVizsga.slice() : probVizsga.concat(probGen); }
function vizsgaCount() { return mode === 'kviz' ? bankVizsga.length : probVizsga.length; }
function genCount() { return mode === 'kviz' ? bankGen.length : probGen.length; }

/* ===== Aktív adathalmaz a mód + toggle szerint ===== */
function activeArr() { return mode === 'kviz' ? allBank() : allProblems(); }
function activeName() { return mode === 'kviz' ? 'questions.json' : 'feladatok.json'; }
function activeLabel() { return mode === 'kviz' ? 'kérdés' : 'feladat'; }
/* a kiválasztott (mód × forrás) fájl neve */
function fileNameFor(src) {
  if (mode === 'kviz') return src === 'vizsga' ? 'questions-vizsga.json' : 'questions.json';
  return src === 'vizsga' ? 'feladatok-vizsga.json' : 'feladatok.json';
}

/* ===== SETUP ===== */
function renderSetup() {
  document.getElementById('sidebar').classList.remove('open');
  const data = activeArr();
  const topics = [...new Set(data.map(q => q.topic))].filter(Boolean).sort();
  const maxN = data.length, def = Math.min(10, maxN) || 1;
  const gh = detectRepo();
  const isK = mode === 'kviz';
  const nV = vizsgaCount(), nG = genCount();
  const noVizsga = nV === 0;
  const pset = mode === 'kviz' ? pickedKviz : pickedSzam;
  const apc = [...pset].filter(x => data.includes(x)).length;   // aktív (látható) kijelöltek száma

  app.innerHTML = `
   <div class="card setup">
     <div class="modebar">
       <button class="${isK ? 'on' : ''}" id="m-kviz">📝 Kvíz</button>
       <button class="${isK ? '' : 'on'}" id="m-szam">🧮 Számolós feladatok</button>
     </div>

     <div class="srctoggle ${examOnly ? 'on' : ''}" id="srctoggle">
       <button class="srcswitch" id="examtoggle" role="switch" aria-checked="${examOnly}" ${noVizsga ? 'disabled' : ''}>
         <span class="knob"></span>
       </button>
       <div class="srctoggle-txt">
         <div class="srctoggle-title">Csak korábbi vizsgakérdések</div>
         <div class="srctoggle-sub">${examOnly
      ? `Most <b>kizárólag</b> a korábbi vizsgákból származó ${activeLabel()}ek jönnek (AI-generált nélkül).`
      : `Most a korábbi vizsga <b>és</b> a generált ${activeLabel()}ek is bekerülnek a sorsolásba.`}</div>
       </div>
       <span class="srcbadge ${examOnly ? 'vizsga' : ''}">${examOnly ? '🎓 vizsga' : '🎓+🤖 mind'}</span>
     </div>
     ${noVizsga ? `<div class="help" style="margin:-8px 0 14px">Ehhez a módhoz még nincs korábbi vizsga ${activeLabel()} betöltve, ezért a kapcsoló inaktív.</div>` : ''}

     <h2>${isK ? 'Kvíz' : 'Számolós feladatok'} beállítása</h2>
     <div class="lead">${isK ? 'Válaszd ki, hány kérdés legyen — a program véletlenszerűen sorsol a bankból.' : 'Több részből álló számolós feladatok (komplex számok, sajátérték, relációk…). A program véletlenszerűen sorsol.'}</div>
     <div class="bankinfo">
       <div class="stat"><div class="n">${data.length}</div><div class="l">${isK ? 'Kérdés' : 'Feladat'} most</div></div>
       <div class="stat" title="Korábbi vizsgákból"><div class="n" style="color:var(--green)">${nV}</div><div class="l">🎓 vizsga</div></div>
       <div class="stat" title="Generált gyakorló"><div class="n" style="color:var(--blue)">${nG}</div><div class="l">🤖 generált</div></div>
       <div class="stat"><div class="n" id="willdo">${def}</div><div class="l">Most kapok</div></div>
     </div>
     ${maxN === 0 ? `<div class="lead" style="color:var(--red)">Nincs betöltve ${activeLabel()}. Tölts be egy JSON-t lent.</div>` : `
     <div class="seg pickseg" id="pickseg">
       <button data-pm="random" class="${pickMode === 'random' ? 'on' : ''}">🎲 Véletlen sorsolás</button>
       <button data-pm="manual" class="${pickMode === 'manual' ? 'on' : ''}">✋ Kézi kiválasztás</button>
     </div>
     <div class="field"><label for="topic">Téma szűrő</label>
       <select id="topic"><option value="__all">Összes téma (${data.length})</option>
       ${topics.map(t => `<option value="${esc(t)}">${esc(t)} (${data.filter(q => q.topic === t).length})</option>`).join("")}</select></div>
     ${pickMode === 'random' ? `
     <div class="field"><label for="count">${isK ? 'Kérdések' : 'Feladatok'} száma (csúszka vagy beírás)</label>
       <div class="countrow">
         <input type="range" id="count" min="1" max="${maxN}" value="${def}">
         <input type="number" id="countnum" class="countbadge-input" min="1" max="${maxN}" value="${def}" inputmode="numeric">
       </div></div>` : `
     <div class="pickerhead">
       <span id="pickcount">0 kiválasztva</span>
       <span class="pickerhead-btns">
         <button class="btn ghost small" id="pickall">Mind (lista)</button>
         <button class="btn ghost small" id="picknone">Egyik sem</button>
       </span>
     </div>
     <div class="picker" id="picker"></div>
     <div class="help" style="margin-top:6px">Pipáld ki, melyik ${activeLabel()}ek legyenek a ${isK ? 'kvízben' : 'feladatsorban'}. A téma szűrő csak a listát szűkíti, a kijelölés megmarad.</div>`}`}
     <div class="controls">
       ${maxN ? `<button class="btn primary" id="start" ${pickMode === 'manual' && apc === 0 ? 'disabled' : ''}>${pickMode === 'manual' ? `Kiválasztottakkal indítás (${apc}) →` : `${isK ? 'Kvíz' : 'Feladatok'} indítása →`}</button>` : ''}
       ${isK ? `<button class="btn ghost small" id="add">＋ Új kérdés</button>` : ''}
       <button class="btn blue small" id="managebtn">⚙ Bank kezelése / feltöltés</button>
     </div>

     <div class="gh-panel" id="ghpanel">
       <div class="flbl">Melyik fájllal dolgozol?</div>
       <div class="seg srcseg" id="srcseg">
         <button data-src="vizsga" class="${exportSrc === 'vizsga' ? 'on' : ''}">🎓 Korábbi vizsga</button>
         <button data-src="gen" class="${exportSrc === 'gen' ? 'on' : ''}">🤖 Generált</button>
       </div>
       <div class="help" id="srcfile" style="margin:6px 0 14px">Aktív fájl: <b>${fileNameFor(exportSrc)}</b> — <span id="srccount">${(exportSrc === 'vizsga' ? nV : nG)}</span> ${activeLabel()}.</div>

       <div class="controls" style="margin-bottom:18px">
         <button class="btn ghost small" id="export">⬇ Letöltés</button>
         <button class="btn ghost small" id="loadbtn">📂 JSON felülírása</button>
         <button class="btn ghost small" id="mergebtn" style="color:var(--accent-deep); border-color:var(--accent-deep)">➕ JSON hozzáfűzése</button>
       </div>

       <div class="flbl">Kiválasztott fájl feltöltése GitHubra (tulajdonosi mód)</div>
       <div class="gh-grid">
         <div><label class="flbl">Felhasználó / org</label><input type="text" id="gh-owner" value="${esc(gh.owner)}" placeholder="pl. kovacsanna"></div>
         <div><label class="flbl">Repó</label><input type="text" id="gh-repo" value="${esc(gh.repo)}" placeholder="pl. dm-la-kviz"></div>
         <div><label class="flbl">Fájl útvonal</label><input type="text" id="gh-path" value="${fileNameFor(exportSrc)}"></div>
         <div><label class="flbl">Branch</label><input type="text" id="gh-branch" value="main"></div>
         <div class="full"><label class="flbl">Personal Access Token (Contents: write)</label><input type="password" id="gh-token" placeholder="github_pat_… (csak ebben a fülben tárolódik)"></div>
       </div>
       <button class="btn blue small" id="ghpush">Feltöltés GitHubra</button>
       <div class="help">A token csak a memóriában marad. Látogatóknak nincs rá szükségük. A két fájlt külön töltsd fel (forrásváltás fent).</div>
     </div>
   </div>`;

  // korábbi-vizsga toggle
  const exBtn = document.getElementById('examtoggle');
  if (exBtn && !noVizsga) exBtn.addEventListener('click', () => {
    examOnly = !examOnly;
    try { localStorage.setItem('examOnly', examOnly ? '1' : '0'); } catch (e) { }
    if (examOnly) exportSrc = 'vizsga';
    renderSetup();
  });

  // forrás-választó (mely fájl: vizsga / generált)
  const srcseg = document.getElementById('srcseg');
  if (srcseg) srcseg.querySelectorAll('button').forEach(b => b.addEventListener('click', () => {
    exportSrc = b.dataset.src; renderSetup();
    document.getElementById('ghpanel').classList.add('open');
  }));

  // mód váltás
  document.getElementById('m-kviz').addEventListener('click', () => { if (mode !== 'kviz') { mode = 'kviz'; renderSetup(); } });
  document.getElementById('m-szam').addEventListener('click', () => { if (mode !== 'szamolos') { mode = 'szamolos'; renderSetup(); } });

  // kiválasztási mód váltó (sorsolás / kézi)
  const pickseg = document.getElementById('pickseg');
  if (pickseg) pickseg.querySelectorAll('button').forEach(b => b.addEventListener('click', () => {
    if (pickMode !== b.dataset.pm) { pickMode = b.dataset.pm; renderSetup(); }
  }));

  if (maxN) {
    const topicSel = document.getElementById('topic');

    if (pickMode === 'random') {
      const range = document.getElementById('count'), num = document.getElementById('countnum'),
        willdo = document.getElementById('willdo');
      function setCount(v) { const mx = +range.max; v = Math.round(+v) || 1; v = Math.max(1, Math.min(mx, v)); range.value = v; num.value = v; willdo.textContent = v; }
      function refreshMax() { const t = topicSel.value; const n = t === '__all' ? data.length : data.filter(q => q.topic === t).length; range.max = n; num.max = n; setCount(Math.min(+num.value || 1, n)); }
      topicSel.addEventListener('change', refreshMax);
      range.addEventListener('input', () => setCount(range.value));
      num.addEventListener('input', () => { if (num.value === '') { willdo.textContent = '…'; return; } setCount(num.value); });
      num.addEventListener('blur', () => setCount(num.value || 1));
    } else {
      // KÉZI KIVÁLASZTÁS
      buildPicker(topicSel.value);
      topicSel.addEventListener('change', () => buildPicker(topicSel.value));
      document.getElementById('pickall').addEventListener('click', () => { pickerItems.forEach(it => pset.add(it)); buildPicker(topicSel.value); });
      document.getElementById('picknone').addEventListener('click', () => { pset.clear(); buildPicker(topicSel.value); });
    }

    document.getElementById('start').addEventListener('click', () => {
      let chosen;
      if (pickMode === 'manual') {
        chosen = data.filter(x => pset.has(x));
        if (!chosen.length) { toast('Pipálj ki legalább egy ' + activeLabel() + 't'); return; }
        
        // Ha kézzel válogatott össze pl. 5 kérdést, az "Új random" gomb 5 db véletlen kérdést fog adni az összesből:
        lastTopic = '__all';
        lastCount = chosen.length;
      } else {
        const t = topicSel.value, pool = t === '__all' ? data : data.filter(q => q.topic === t);
        const n = Math.min(Math.max(1, +document.getElementById('countnum').value || 1), pool.length);
        chosen = shuffle(pool).slice(0, n);
        
        // Mentsük el a sorsolási beállításokat a következő körre:
        lastTopic = t;
        lastCount = n;
      }
      if (mode === 'kviz') {
        quiz = chosen;
        quizState = quiz.map(() => ({ answered: false, selected: new Set(), result: null, points: 0 }));
        i = 0; document.getElementById('sidebar').classList.add('open'); renderSidebar(); renderQuestion();
      } else {
        run = chosen;
        pstate = run.map(pr => ({ answered: false, earned: 0, result: null, max: pr.parts.reduce((s, p) => s + (p.points || 1), 0), parts: pr.parts.map(() => ({ value: '', sel: new Set(), pts: 0, ok: false })) }));
        pi = 0; document.getElementById('sidebar').classList.add('open'); renderSidebar(); renderProblem();
      }
      scrollTop();
    });
  }

  if (isK) document.getElementById('add').addEventListener('click', renderAddForm);
  document.getElementById('export').addEventListener('click', exportJSON);
  document.getElementById('loadbtn').addEventListener('click', loadFile);
  document.getElementById('mergebtn').addEventListener('click', mergeFile);
  const panel = document.getElementById('ghpanel');
  document.getElementById('managebtn').addEventListener('click', () => panel.classList.toggle('open'));
  document.getElementById('ghpush').addEventListener('click', pushToGitHub);
  if (ghToken) document.getElementById('gh-token').value = ghToken;
  foot.textContent = `${isK ? 'Kérdésbank' : 'Feladatbank'}: 🎓 ${nV} vizsga + 🤖 ${nG} generált · ${topics.length} téma${examOnly ? ' · csak vizsga mód' : ''}`;
  if (pickMode === 'manual') updatePickCount();
}

/* ===== Kézi kiválasztás segédfüggvényei ===== */
function pickLabel(it) {
  if (mode === 'kviz') return it.prompt || '';
  return it.title || (it.preamble || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 90);
}
function buildPicker(topicVal) {
  const box = document.getElementById('picker'); if (!box) return;
  const data = activeArr();
  const pset = mode === 'kviz' ? pickedKviz : pickedSzam;
  pickerItems = (topicVal && topicVal !== '__all') ? data.filter(q => q.topic === topicVal) : data;
  box.innerHTML = pickerItems.map((it, idx) =>
    `<label class="picker-row${pset.has(it) ? ' on' : ''}">
       <input type="checkbox" class="pchk" data-i="${idx}" ${pset.has(it) ? 'checked' : ''}>
       <span class="picker-badge ${it.src === 'vizsga' ? 'v' : 'g'}" title="${it.src === 'vizsga' ? 'korábbi vizsga' : 'generált'}">${it.src === 'vizsga' ? '🎓' : '🤖'}</span>
       <span class="picker-topic">${esc(it.topic || '')}</span>
       <span class="picker-text">${pickLabel(it)}</span>
     </label>`).join('') || `<div class="help" style="padding:10px">Nincs ${activeLabel()} ebben a szűrőben.</div>`;
  box.querySelectorAll('.pchk').forEach(chk => chk.addEventListener('change', () => {
    const it = pickerItems[+chk.dataset.i];
    if (chk.checked) pset.add(it); else pset.delete(it);
    chk.closest('.picker-row').classList.toggle('on', chk.checked);
    updatePickCount();
  }));
  typeset(box);
  updatePickCount();
}
function updatePickCount() {
  const data = activeArr();
  const pset = mode === 'kviz' ? pickedKviz : pickedSzam;
  const n = [...pset].filter(x => data.includes(x)).length;
  const pc = document.getElementById('pickcount'); if (pc) pc.textContent = n + ' kiválasztva';
  const wd = document.getElementById('willdo'); if (wd) wd.textContent = n;
  const sb = document.getElementById('start'); if (sb) { sb.disabled = n === 0; sb.textContent = `Kiválasztottakkal indítás (${n}) →`; }
}

function scrollTop() { window.scrollTo({ top: 0, behavior: 'smooth' }); }
window.goTo = function (idx) {
  if (mode === 'kviz') { i = idx; renderQuestion(); }
  else { pi = idx; renderProblem(); }
  renderSidebar(); scrollTop();
};

/* ===== OLDALSÁV (mindkét módban) ===== */
function renderSidebar() {
  const states = mode === 'kviz' ? quizState : pstate;
  const cur = mode === 'kviz' ? i : pi;
  const h3 = document.querySelector('#sidebar h3'); if (h3) h3.textContent = mode === 'kviz' ? 'Kérdések állapota' : 'Feladatok állapota';
  const grid = document.getElementById('q-grid');
  grid.innerHTML = states.map((s, idx) => {
    let cls = 'q-nav-btn';
    if (idx === cur) cls += ' active';
    if (s.answered && s.result) cls += ' ' + s.result;
    else if (!s.answered) {
      const started = mode === 'kviz'
        ? (s.selected && s.selected.size > 0)
        : (s.parts && s.parts.some(p => (p.value && p.value.trim() !== '') || (p.sel && p.sel.size > 0)));
      if (started) cls += ' started';
    }
    return `<button class="${cls}" onclick="goTo(${idx})">${idx + 1}</button>`;
  }).join('');
  document.getElementById('sidebar-finishbtn').textContent = mode === 'kviz' ? 'Kvíz befejezése' : 'Feladatok befejezése';
  document.getElementById('sidebar-finishbtn').onclick = mode === 'kviz' ? finish : finishProblems;
}

/* ===== KÉRDÉS NÉZET (kvíz) ===== */
function renderQuestion() {
  const q = quiz[i], s = quizState[i];
  const opts = q.options.map((o, idx) => {
    let cls = q.multi ? '' : 'single'; let badge = ''; const isSel = s.selected.has(idx);
    if (isSel) cls += ' sel';
    if (s.answered) {
      cls += ' locked';
      if (isSel && o.c) { cls += ' correct'; badge = '<span class="badge">helyes</span>'; }
      else if (isSel && !o.c) { cls += ' wrongpick'; badge = '<span class="badge">rossz</span>'; }
      else if (!isSel && o.c) { cls += ' missed'; badge = '<span class="badge">kimaradt</span>'; }
    }
    return `<li class="opt ${cls}" data-idx="${idx}"><span class="mark"></span><span class="txt">${o.t}</span>${badge}</li>`;
  }).join("");

  let fbHtml = '';
  if (s.answered) {
    let head, dot;
    if (s.result === 'ok') { head = "Helyes!"; dot = "✓"; } else if (s.result === 'part') { head = "Részben helyes"; dot = "◐"; } else { head = "Nem talált"; dot = "✕"; }
    fbHtml = `<div class="feedback ${s.result}"><div class="fb-head"><span>${dot}</span>${head}</div><div class="expl">${q.e || ''}</div><div class="fb-points">Megszerzett pont: <b>${fmtPts(s.points)}</b> / ${QUESTION_MAX}</div></div>`;
  }

  const max = quiz.length * QUESTION_MAX;
  app.innerHTML = `
   <div class="progress-row"><span class="pmeta">${i + 1} / ${quiz.length}</span><div class="ptrack"><div class="pfill" id="pfill"></div></div><span class="score-chip">${fmtPts(totalPoints())} / ${max} pont</span></div>
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
      if (q.multi) { if (s.selected.has(idx)) { s.selected.delete(idx); el.classList.remove('sel'); } else { s.selected.add(idx); el.classList.add('sel'); } }
      else { s.selected.clear(); app.querySelectorAll('.opt').forEach(o => o.classList.remove('sel')); s.selected.add(idx); el.classList.add('sel'); }
      document.getElementById('checkbtn').disabled = s.selected.size === 0;
      renderSidebar();
    }));
    document.getElementById('checkbtn').addEventListener('click', () => { s.points = scoreQuestion(q, s.selected); s.result = classify(s.points); s.answered = true; renderQuestion(); renderSidebar(); });
  }
  document.getElementById('prevbtn').addEventListener('click', () => goTo(i - 1));
  document.getElementById('nextbtn').addEventListener('click', () => { if (i + 1 < quiz.length) goTo(i + 1); else finish(); });
  typeset(app);
}

/* ===== FELADAT NÉZET (számolós) ===== */
function renderProblem() {
  const pr = run[pi], st = pstate[pi];

  const partsHtml = pr.parts.map((part, j) => {
    const ps = st.parts[j];
    const pointsLbl = `<span class="ppoints">${fmtPts(part.points || 1)} pont</span>`;
    let body = '';
    if (part.type === 'text') {
      if (!st.answered) {
        body = `<div class="pin"><input type="text" class="pin-text" data-j="${j}" value="${esc(ps.value)}" placeholder="válasz" autocomplete="off">${part.suffix ? `<span class="psuffix">${esc(part.suffix)}</span>` : ''}</div>`;
      } else {
        const cls = ps.ok ? 'correct' : 'wrong';
        body = `<div class="pin ${cls}"><input type="text" class="pin-text" value="${esc(ps.value)}" disabled>${part.suffix ? `<span class="psuffix">${esc(part.suffix)}</span>` : ''}<span class="pmark">${ps.ok ? '✓' : '✕'}</span></div>
          ${!ps.ok ? `<div class="pans">Helyes: <b>${esc(part.answer)}${part.suffix ? ' ' + esc(part.suffix) : ''}</b></div>` : ''}`;
      }
    } else {
      const single = part.type === 'single';
      body = `<ul class="options compact">` + part.options.map((o, idx) => {
        let cls = single ? 'single' : ''; let badge = ''; const isSel = ps.sel.has(idx);
        if (isSel) cls += ' sel';
        if (st.answered) {
          cls += ' locked';
          if (isSel && o.c) { cls += ' correct'; badge = '<span class="badge">helyes</span>'; }
          else if (isSel && !o.c) { cls += ' wrongpick'; badge = '<span class="badge">rossz</span>'; }
          else if (!isSel && o.c) { cls += ' missed'; badge = '<span class="badge">kimaradt</span>'; }
        }
        return `<li class="opt ${cls}" data-j="${j}" data-idx="${idx}"><span class="mark"></span><span class="txt">${o.t}</span>${badge}</li>`;
      }).join('') + `</ul>`;
    }
    const fb = st.answered ? `<div class="part-pts ${ps.ok ? 'ok' : (ps.pts > 0 ? 'part' : 'no')}">${fmtPts(ps.pts)} / ${fmtPts(part.points || 1)} pont</div>${part.e ? `<div class="part-expl">${part.e}</div>` : ''}` : '';
    return `<div class="prob-part"><div class="pprompt">${part.prompt}${pointsLbl}</div>${body}${fb}</div>`;
  }).join('');

  const maxAll = runMaxPoints();
  app.innerHTML = `
   <div class="progress-row"><span class="pmeta">${pi + 1} / ${run.length}</span><div class="ptrack"><div class="pfill" id="pfill"></div></div><span class="score-chip">${fmtPts(totalProblemPoints())} / ${fmtPts(maxAll)} pont</span></div>
   <div class="card bar">
     <div class="qtag">${pi + 1}. feladat</div><span class="qtopic">${esc(pr.topic || '')}</span>
     ${pr.title ? `<div class="prompt" style="font-size:1.15rem">${pr.title}</div>` : ''}
     ${pr.preamble ? `<div class="preamble">${pr.preamble}</div>` : ''}
     ${partsHtml}
     <div class="controls">
       <button class="btn ghost" id="prevbtn" ${pi === 0 ? 'disabled' : ''}>← Előző</button>
       ${!st.answered ? `<button class="btn primary" id="checkbtn">Ellenőrzés</button>` : ''}
       <button class="btn primary" id="nextbtn">${pi + 1 < run.length ? 'Következő →' : 'Befejezés'}</button>
     </div>
   </div>`;
  document.getElementById('pfill').style.width = (pstate.filter(x => x.answered).length / run.length * 100) + "%";

  if (!st.answered) {
    app.querySelectorAll('.pin-text').forEach(inp => inp.addEventListener('input', () => { st.parts[+inp.dataset.j].value = inp.value; renderSidebar(); }));
    app.querySelectorAll('.opt').forEach(el => el.addEventListener('click', () => {
      const j = +el.dataset.j, idx = +el.dataset.idx, part = pr.parts[j], sel = st.parts[j].sel;
      if (part.type === 'single') { sel.clear(); app.querySelectorAll(`.opt[data-j="${j}"]`).forEach(o => o.classList.remove('sel')); sel.add(idx); el.classList.add('sel'); }
      else { if (sel.has(idx)) { sel.delete(idx); el.classList.remove('sel'); } else { sel.add(idx); el.classList.add('sel'); } }
      renderSidebar();
    }));
    document.getElementById('checkbtn').addEventListener('click', () => {
      let earned = 0;
      pr.parts.forEach((part, j) => { const ps = st.parts[j]; ps.pts = gradePart(part, ps); ps.ok = ps.pts >= (part.points || 1) - 1e-9; earned += ps.pts; });
      st.earned = earned; st.answered = true; st.result = classify(earned, st.max);
      renderProblem(); renderSidebar();
    });
  }
  document.getElementById('prevbtn').addEventListener('click', () => goTo(pi - 1));
  document.getElementById('nextbtn').addEventListener('click', () => { if (pi + 1 < run.length) goTo(pi + 1); else finishProblems(); });
  typeset(app);
}

/* ===== ÖSSZEFOGLALÓ (közös felépítés) ===== */
function summaryCard(opts) {
  // opts: {pct, earned, max, dist, distLabels, topicArr, rows, reviewLabel}
  const { pct, earned, max, dist, topicArr, rows } = opts;
  const verdict = pct >= 90 ? "Kiváló — ez vizsgaérett tudás." : pct >= 70 ? "Buzi vagy." : pct >= 50 ? "Buzi vagy" : "Extra buzi vagy.";
  const total = dist.ok + dist.part + dist.no + dist.skip;
  const chips = `<div class="stat-chips">
      <div class="stat-chip"><span class="d ok"></span><b>${dist.ok}</b> teljes</div>
      <div class="stat-chip"><span class="d part"></span><b>${dist.part}</b> részleges</div>
      <div class="stat-chip"><span class="d no"></span><b>${dist.no}</b> hibás</div>
      ${dist.skip ? `<div class="stat-chip"><span class="d skip"></span><b>${dist.skip}</b> kihagyott</div>` : ''}
    </div>`;
  const seg = (cls, c) => c ? `<span class="${cls}" data-w="${c / total * 100}%" style="width:0"></span>` : '';
  const distbar = `<div class="distbar">${seg('ok', dist.ok)}${seg('part', dist.part)}${seg('no', dist.no)}${seg('skip', dist.skip)}</div>`;
  const topicBars = topicArr.map(o => {
    const p = Math.round(o.pct * 100); const col = o.pct >= 0.75 ? 'var(--green)' : o.pct >= 0.4 ? 'var(--gold)' : 'var(--red)';
    return `<div class="topicbar"><div class="row"><span>${esc(o.t)}</span><span class="pts">${fmtPts(o.earned)} / ${fmtPts(o.max)} · ${p}%</span></div><div class="track"><div class="fill" data-w="${p}%" style="width:0;background:${col}"></div></div></div>`;
  }).join('');

  app.innerHTML = `
   <div class="card result">
     <div class="ring" id="ring"><div class="inner"><div class="big"><span id="ringnum">0</span><span style="font-size:1.1rem">%</span></div><div class="small">eredmény</div></div></div>
     <div class="summary-head"><h2>${mode === 'kviz' ? 'Kvíz' : 'Feladatok'} kész</h2>
       <div class="summary-pts"><span id="ptsnum">0</span> <span>/ ${fmtPts(max)} pont</span></div>
       <div class="verdict">${verdict}</div></div>
     ${chips}${distbar}
     <div class="section-title">Témánkénti teljesítmény</div>
     <div class="topicbars">${topicBars}</div>
     <div class="section-title">${mode === 'kviz' ? 'Kérdésenként' : 'Feladatonként'}</div>
     <div class="breakdown">${rows}</div>
     <div class="controls" style="justify-content:center">
       <button class="btn ghost" id="review">Vissza a ${mode === 'kviz' ? 'kérdésekhez' : 'feladatokhoz'}</button>
       <button class="btn ghost" id="retry">↻ Újra ugyanezekkel</button>
       <button class="btn primary" id="newrandom">🎲 Új random sorsolás</button>
       <button class="btn ghost" id="again">Új ${mode === 'kviz' ? 'kvíz' : 'feladatsor'} beállítása</button>
     </div>
   </div>`;

  const ring = document.getElementById('ring'), ringnum = document.getElementById('ringnum'), ptsnum = document.getElementById('ptsnum');
  animateValue(900, e => {
    const v = pct * e;
    if (ring) ring.style.background = `conic-gradient(var(--accent) ${v}%, var(--rule) 0)`;
    if (ringnum) ringnum.textContent = Math.round(v);
    if (ptsnum) ptsnum.textContent = fmtPts(earned * e);
  }, () => { if (ringnum) ringnum.textContent = pct; if (ptsnum) ptsnum.textContent = fmtPts(earned); });
  requestAnimationFrame(() => app.querySelectorAll('[data-w]').forEach(el => { el.style.width = el.dataset.w; }));

  document.getElementById('again').addEventListener('click', renderSetup);
  document.getElementById('retry').addEventListener('click', retrySame);
  document.getElementById('newrandom').addEventListener('click', startNewRandom); // <-- EZT ADD HOZZÁ
  document.getElementById('review').addEventListener('click', () => {
    document.getElementById('sidebar').classList.add('open'); renderSidebar();
    if (mode === 'kviz') renderQuestion(); else renderProblem();
    scrollTop();
  });
  typeset(app);
}

/* Új random sorsolás a legutóbbi beállítások alapján */
function startNewRandom() {
  const data = activeArr();
  const pool = lastTopic === '__all' ? data : data.filter(q => q.topic === lastTopic);
  const n = Math.min(Math.max(1, lastCount), pool.length);
  const chosen = shuffle(pool).slice(0, n);

  if (!chosen.length) { toast('Nincs elég kérdés a sorsoláshoz!'); return; }

  if (mode === 'kviz') {
    quiz = chosen;
    quizState = quiz.map(() => ({ answered: false, selected: new Set(), result: null, points: 0 }));
    i = 0; 
  } else {
    run = chosen;
    pstate = run.map(pr => ({ answered: false, earned: 0, result: null, max: pr.parts.reduce((s, p) => s + (p.points || 1), 0), parts: pr.parts.map(() => ({ value: '', sel: new Set(), pts: 0, ok: false })) }));
    pi = 0; 
  }
  document.getElementById('sidebar').classList.add('open'); 
  renderSidebar(); 
  if (mode === 'kviz') renderQuestion(); else renderProblem();
  scrollTop();
}

/* ===== Újra ugyanazokkal a kérdésekkel (friss állapot, nincs új sorsolás) ===== */
function retrySame() {
  document.getElementById('sidebar').classList.add('open');
  if (mode === 'kviz') {
    quizState = quiz.map(() => ({ answered: false, selected: new Set(), result: null, points: 0 }));
    i = 0; renderSidebar(); renderQuestion();
  } else {
    pstate = run.map(pr => ({ answered: false, earned: 0, result: null, max: pr.parts.reduce((s, p) => s + (p.points || 1), 0), parts: pr.parts.map(() => ({ value: '', sel: new Set(), pts: 0, ok: false })) }));
    pi = 0; renderSidebar(); renderProblem();
  }
  scrollTop();
}

function finish() {
  document.getElementById('sidebar').classList.remove('open');
  quizState.forEach((s, idx) => { if (!s.answered && s.selected.size > 0) { s.points = scoreQuestion(quiz[idx], s.selected); s.result = classify(s.points); s.answered = true; } });
  const max = quiz.length * QUESTION_MAX; let earned = 0; const dist = { ok: 0, part: 0, no: 0, skip: 0 }; const byTopic = {};
  quizState.forEach((s, idx) => {
    const pts = s.answered ? s.points : 0; earned += pts;
    if (!s.answered) dist.skip++; else dist[s.result]++;
    const t = quiz[idx].topic || 'Egyéb'; (byTopic[t] = byTopic[t] || { earned: 0, max: 0 }); byTopic[t].earned += pts; byTopic[t].max += QUESTION_MAX;
  });
  const pct = max ? Math.round(earned / max * 100) : 0;
  const topicArr = Object.entries(byTopic).map(([t, v]) => ({ t, ...v, pct: v.max ? v.earned / v.max : 0 })).sort((a, b) => a.pct - b.pct);
  const rows = quizState.map((s, k) => {
    const r = s.answered ? s.result : 'skip';
    const ico = r === 'ok' ? '<span class="ico ok-i">✓</span>' : r === 'part' ? '<span class="ico pt-i">◐</span>' : r === 'no' ? '<span class="ico no-i">✕</span>' : '<span class="ico skip-i">○</span>';
    const pts = s.answered ? `${fmtPts(s.points)} / ${QUESTION_MAX}` : '—';
    return `<div class="brow">${ico}<span>${k + 1}. kérdés</span><span class="topic">${esc(quiz[k].topic || '')}</span><span class="qpts">${pts}</span></div>`;
  }).join("");
  summaryCard({ pct, earned, max, dist, topicArr, rows });
}

function finishProblems() {
  document.getElementById('sidebar').classList.remove('open');
  // automatikus ellenőrzés azoknál, ahol már van bevitt/jelölt érték
  pstate.forEach((st, idx) => {
    const touched = st.parts.some(p => (p.value && p.value.trim() !== '') || p.sel.size > 0);
    if (!st.answered && touched) {
      let earned = 0; run[idx].parts.forEach((part, j) => { const ps = st.parts[j]; ps.pts = gradePart(part, ps); ps.ok = ps.pts >= (part.points || 1) - 1e-9; earned += ps.pts; });
      st.earned = earned; st.answered = true; st.result = classify(earned, st.max);
    }
  });
  const max = runMaxPoints(); let earned = 0; const dist = { ok: 0, part: 0, no: 0, skip: 0 }; const byTopic = {};
  pstate.forEach((st, idx) => {
    const pts = st.answered ? st.earned : 0; earned += pts;
    if (!st.answered) dist.skip++; else dist[st.result]++;
    const t = run[idx].topic || 'Egyéb'; (byTopic[t] = byTopic[t] || { earned: 0, max: 0 }); byTopic[t].earned += pts; byTopic[t].max += st.max;
  });
  const pct = max ? Math.round(earned / max * 100) : 0;
  const topicArr = Object.entries(byTopic).map(([t, v]) => ({ t, ...v, pct: v.max ? v.earned / v.max : 0 })).sort((a, b) => a.pct - b.pct);
  const rows = pstate.map((st, k) => {
    const r = st.answered ? st.result : 'skip';
    const ico = r === 'ok' ? '<span class="ico ok-i">✓</span>' : r === 'part' ? '<span class="ico pt-i">◐</span>' : r === 'no' ? '<span class="ico no-i">✕</span>' : '<span class="ico skip-i">○</span>';
    const pts = st.answered ? `${fmtPts(st.earned)} / ${fmtPts(st.max)}` : '—';
    return `<div class="brow">${ico}<span>${k + 1}. feladat</span><span class="topic">${esc(run[k].topic || '')}</span><span class="qpts">${pts}</span></div>`;
  }).join("");
  summaryCard({ pct, earned, max, dist, topicArr, rows });
}

/* easeOutCubic animáció */
function animateValue(duration, step, done) {
  const start = performance.now();
  function frame(now) { const t = Math.min(1, (now - start) / duration); const e = 1 - Math.pow(1 - t, 3); step(e); if (t < 1) requestAnimationFrame(frame); else if (done) done(); }
  requestAnimationFrame(frame);
}

/* ===== ÚJ KÉRDÉS (csak kvíz) ===== */
let draftType = 'multi';
let draftSrc = 'gen';
function renderAddForm() {
  draftType = 'multi';
  draftSrc = exportSrc;
  const topics = [...new Set(bankVizsga.concat(bankGen).map(q => q.topic))].filter(Boolean).sort();
  const datalistOpts = topics.map(t => `<option value="${esc(t)}"></option>`).join('');
  app.innerHTML = `<div class="card addform"><h2>Új kérdés</h2>
   <div class="lead">A bekapcsolt jelölő = helyes válasz. LaTeX-hez: \\( ... \\).</div>
   <div class="frow"><label class="flbl">Forrás (melyik bankba kerüljön)</label><div class="seg srcseg"><button id="s-vizsga" class="${draftSrc === 'vizsga' ? 'on' : ''}">🎓 Korábbi vizsga</button><button id="s-gen" class="${draftSrc === 'gen' ? 'on' : ''}">🤖 Generált</button></div></div>
   <div class="frow"><label class="flbl">Téma</label><input type="text" id="f-topic" list="topic-list" placeholder="Kattints ide a meglévőkhöz vagy gépelj újat..." autocomplete="off"><datalist id="topic-list">${datalistOpts}</datalist></div>
   <div class="frow"><label class="flbl">Típus</label><div class="seg"><button id="t-multi" class="on">Több válasz</button><button id="t-single">Egy válasz</button></div></div>
   <div class="frow"><label class="flbl">Kérdés szövege</label><textarea id="f-prompt" rows="2" placeholder="A kérdés..."></textarea></div>
   <div class="frow"><label class="flbl">Válaszlehetőségek (pipáld be a helyeseket)</label><div id="opts"></div><button class="btn ghost small" id="addopt" style="margin-top:4px;">＋ Válasz</button></div>
   <div class="frow"><label class="flbl">Magyarázat</label><textarea id="f-expl" rows="2" placeholder="Miért ez a helyes válasz..."></textarea></div>
   <div class="controls"><button class="btn primary" id="saveq">Hozzáadás a bankhoz</button><button class="btn ghost small" id="back">← Vissza</button></div></div>`;

  const sv = document.getElementById('s-vizsga'), sg = document.getElementById('s-gen');
  sv.addEventListener('click', () => { draftSrc = 'vizsga'; sv.classList.add('on'); sg.classList.remove('on'); });
  sg.addEventListener('click', () => { draftSrc = 'gen'; sg.classList.add('on'); sv.classList.remove('on'); });

  function autosize(ta) { ta.style.height = 'auto'; ta.style.height = ta.scrollHeight + 'px'; }
  app.querySelectorAll('textarea').forEach(ta => { ta.addEventListener('input', () => autosize(ta)); requestAnimationFrame(() => autosize(ta)); });

  const box = document.getElementById('opts');
  function addOpt(t = '', c = false) {
    const r = document.createElement('div'); r.className = 'optedit';
    r.innerHTML = `<input type="text" class="o-text" placeholder="Válasz szövege" value="${esc(t)}"><label class="cbx"><input type="checkbox" class="o-correct" ${c ? 'checked' : ''}>helyes</label><button class="del">✕</button>`;
    r.querySelector('.del').addEventListener('click', () => { if (box.children.length > 2) r.remove(); else toast('Legalább 2 válasz kell'); });
    box.appendChild(r);
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
    bankFor(draftSrc).push({ topic, multi: draftType === 'multi', prompt, options, e: expl, src: draftSrc });
    exportSrc = draftSrc;
    toast('Hozzáadva a(z) ' + (draftSrc === 'vizsga' ? 'vizsga' : 'generált') + ' bankba (' + bankFor(draftSrc).length + ' kérdés)'); renderSetup();
  });
  document.getElementById('back').addEventListener('click', renderSetup);
  typeset(app);
}

/* ===== Export / import / GitHub (a kiválasztott forrás-fájlon) ===== */
function stripSrc(o) { const c = { ...o }; delete c.src; return c; }
function bankJSON(src) {
  if (mode === 'kviz') return JSON.stringify({ version: 1, source: src, questions: bankFor(src).map(stripSrc) }, null, 2);
  return JSON.stringify({ version: 1, source: src, problems: probFor(src).map(stripSrc) }, null, 2);
}
function exportJSON() {
  const name = fileNameFor(exportSrc);
  const blob = new Blob([bankJSON(exportSrc)], { type: 'application/json' });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name;
  document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(a.href); toast('Letöltve: ' + name);
}
function parseActive(data) {
  if (mode === 'kviz') return norm(Array.isArray(data) ? data : data.questions || [], exportSrc);
  return normProblems(Array.isArray(data) ? data : data.problems || [], exportSrc);
}
function setBank(src, arr) {
  if (mode === 'kviz') { if (src === 'vizsga') bankVizsga = arr; else bankGen = arr; }
  else { if (src === 'vizsga') probVizsga = arr; else probGen = arr; }
}
function loadFile() {
  const inp = document.createElement('input'); inp.type = 'file'; inp.accept = '.json,application/json';
  inp.onchange = async () => {
    const f = inp.files[0]; if (!f) return;
    try { const clean = parseActive(JSON.parse(await f.text())); if (!clean.length) throw new Error('üres'); setBank(exportSrc, clean); toast('Betöltve a(z) ' + fileNameFor(exportSrc) + ' helyére: ' + clean.length + ' ' + activeLabel() + ' (felülírva)'); renderSetup(); document.getElementById('ghpanel').classList.add('open'); }
    catch (e) { toast('Hiba: ' + e.message); }
  };
  inp.click();
}
function mergeFile() {
  const inp = document.createElement('input'); inp.type = 'file'; inp.accept = '.json,application/json';
  inp.onchange = async () => {
    const f = inp.files[0]; if (!f) return;
    try { const clean = parseActive(JSON.parse(await f.text())); if (!clean.length) throw new Error('nincs érvényes ' + activeLabel() + ' a fájlban'); (mode === 'kviz' ? bankFor(exportSrc) : probFor(exportSrc)).push(...clean); toast('Hozzáfűzve ' + clean.length + ' ' + activeLabel() + ' a(z) ' + fileNameFor(exportSrc) + ' bankhoz'); renderSetup(); document.getElementById('ghpanel').classList.add('open'); }
    catch (e) { toast('Hiba: ' + e.message); }
  };
  inp.click();
}
function detectRepo() {
  try { const h = location.hostname, parts = location.pathname.split('/').filter(Boolean); if (h.endsWith('.github.io')) { const owner = h.split('.')[0]; const repo = parts.length ? parts[0] : owner + '.github.io'; return { owner, repo }; } } catch (e) { }
  return { owner: '', repo: '' };
}
function b64utf8(str) { return btoa(unescape(encodeURIComponent(str))); }
async function pushToGitHub() {
  const owner = document.getElementById('gh-owner').value.trim();
  const repo = document.getElementById('gh-repo').value.trim();
  const path = document.getElementById('gh-path').value.trim() || fileNameFor(exportSrc);
  const branch = document.getElementById('gh-branch').value.trim() || 'main';
  ghToken = document.getElementById('gh-token').value.trim();
  if (!owner || !repo || !ghToken) { toast('Töltsd ki: owner, repó, token'); return; }
  const count = (mode === 'kviz' ? bankFor(exportSrc) : probFor(exportSrc)).length;
  const api = `https://api.github.com/repos/${owner}/${repo}/contents/${path.split('/').map(encodeURIComponent).join('/')}`;
  const headers = { Authorization: `Bearer ${ghToken}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' };
  toast('Feltöltés: ' + path + ' …');
  let sha = null;
  try { const g = await fetch(`${api}?ref=${encodeURIComponent(branch)}`, { headers }); if (g.ok) { const j = await g.json(); sha = j.sha; } } catch (e) { }
  const body = { message: `${path} frissítése (${count} ${activeLabel()})`, content: b64utf8(bankJSON(exportSrc)), branch };
  if (sha) body.sha = sha;
  try {
    const r = await fetch(api, { method: 'PUT', headers, body: JSON.stringify(body) });
    if (r.ok) toast('Feltöltve ✓ (' + path + ') A Pages 1–2 perc múlva frissül.');
    else { const e = await r.json().catch(() => ({})); toast('GitHub hiba: ' + (e.message || r.status)); }
  } catch (err) { toast('Hálózati hiba: ' + err.message); }
}

/* ===== Témaváltó (világos / kékes sötét) ===== */
function setupThemeToggle() {
  const root = document.documentElement, btn = document.getElementById('themebtn');
  function icon() { if (btn) btn.textContent = root.getAttribute('data-theme') === 'dark' ? '☀️' : '🌙'; }
  icon();
  if (btn) btn.addEventListener('click', () => {
    const next = root.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
    root.setAttribute('data-theme', next);
    try { localStorage.setItem('theme', next); } catch (e) { }
    icon();
  });
}
setupThemeToggle();
init();
