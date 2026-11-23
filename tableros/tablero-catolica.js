/* Tablero de pauta de Católica: lectura, homologación y render. La capa visual está en assets/ds. */
const SHEET_ID = '1uIBe2IadpAWIpVbqUp0RO8THfEw8Mjlrl_1VvORw_rs';
// CRM_ASPIRANTES pesa ~17 MB completa: se piden solo las columnas y filas de pauta.
const SRC = {
  rg:    { gid: 1551290449 },
  asp:   { gid: 40171782, tq: "select B,C,D,E,F,H,I where C='Trafico_Pago'" },
  adm:   { gid: 2049412307 },
  metas: { gid: 2109044138 },
  // metas mensuales por nivel (MENSUAL, la llena el script del forecast)
  mens:  { gid: 400336343 },
  // aspirantes de las demás fuentes, agrupados por día (la pestaña completa pesa ~17 MB)
  fu:    { gid: 40171782, tq: "select toDate(B), C, H, I, count(A) where C != 'Trafico_Pago' group by toDate(B), C, H, I" },
};
const FUENTE_PAUTA = 'Trafico_Pago';
const MESES = ['','ene','feb','mar','abr','may','jun','jul','ago','sep','oct','nov','dic'];
// Las metas y presupuestos salen solo de este periodo; las fechas del tablero no cambian con él.
const META_PER = '2027-1';
// Con el botón del periodo encendido la meta es la total del periodo; lo logrado se sigue contando por las fechas elegidas.
let META_TOTAL = true;
let MENS = [];
const NIVELES = ['Pregrado','Posgrado','General'];
const CANALES = ['Facebook','Google','TikTok','Programática','ChatGPT'];

let RAW = [], METAS = [], PERIODOS = {}, DISP = {}, BRAND = [], BRAND_METAS = [], EC = [], EC_METAS = [];
const CANAL_ORDER = CANALES, CANAL_LBL = {Facebook:'Meta Ads', Google:'Google Ads', TikTok:'TikTok', 'Programática':'Programática', ChatGPT:'ChatGPT Ads'};
let SORT = {col: 'inv', dir: -1}, OPEN = {}, CHART = null, CHART_INV = null, CHART_MAT = null, QUICK = '', EVO = 'mes';

// ── Parsers y formato ─────────────────────────────────────────────────────────
function num(v){ if(typeof v === 'number') return isFinite(v) ? v : 0;
  const s = String(v ?? '').replace(/[$\s%]/g,''); if(!s) return 0;
  return parseFloat(s.indexOf(',') >= 0 ? s.replace(/\./g,'').replace(',','.') : s.replace(/\./g,'')) || 0 }
function iso(v){ const m = String(v||'').match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if(m) return `${m[3]}-${m[2].padStart(2,'0')}-${m[1].padStart(2,'0')}`;
  const i = String(v||'').match(/(\d{4})-(\d{1,2})-(\d{1,2})/);
  return i ? `${i[1]}-${i[2].padStart(2,'0')}-${i[3].padStart(2,'0')}` : '' }
function norm(s){ return String(s||'').trim().toUpperCase().normalize('NFD').replace(/[̀-ͯ]/g,'') }
const esc = s => String(s).replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const fCOP = n => (n && isFinite(n)) ? '$' + Math.round(n).toLocaleString('es-CO') : '—';
const fN = n => (n && isFinite(n)) ? (Math.abs(n) < 10 && n % 1 ? n.toLocaleString('es-CO',{maximumFractionDigits:1}) : Math.round(n).toLocaleString('es-CO')) : '—';
const fP = n => (n === null || !isFinite(n)) ? '—' : (n*100).toLocaleString('es-CO',{maximumFractionDigits:1}) + '%';
const div = (a,b) => b ? a/b : null;
const fDate = s => { const p = s.split('-'); return `${+p[2]} ${MESES[+p[1]]}` };
function days(a,b){ return Math.round((Date.parse(b) - Date.parse(a)) / 864e5) + 1 }
function addDays(s,n){ const d = new Date(Date.parse(s) + n*864e5); return d.toISOString().slice(0,10) }
function weekStart(s){ const d = new Date(Date.parse(s)); const w = (d.getUTCDay() + 6) % 7; return addDays(s, -w) }
const todayISO = () => { const d = new Date(); return new Date(d.getTime() - d.getTimezoneOffset()*6e4).toISOString().slice(0,10) };
function cls(p){ return p === null ? 't-mute' : p >= .8 ? 't-pos' : p >= .5 ? 't-mid' : 't-neg' }
function bgc(p){ return p >= .8 ? 'bg-pos' : p >= .5 ? 'bg-mid' : 'bg-neg' }
function difCls(d){ return d === null ? 't-mute' : Math.abs(d) <= .1 ? 't-pos' : Math.abs(d) <= .25 ? 't-mid' : 't-neg' }

// ── Homologación ─────────────────────────────────────────────────────────────
// La llave ignora tildes, comas, mayúsculas y espacios; los alias cubren nombres que cambian entre fuentes.
const pkey = s => norm(s).replace(/[^A-Z0-9 ]/g,' ').replace(/\s+/g,' ').trim();
const PROG_CANON = [
  ['Especialización en Compliance y Derecho de los Negocios', ['Especializacion en Compliace y Derecho de los Negocios', 'Especialización Compliance y Derecho de los Negocios']],
  ['Especialización en Formulación, Evaluación Social y Económica de Proyectos', ['Especialización en Formulación y Evaluación Social y Económica de Proyectos']],
  ['Maestría en Derecho y Ciencias Políticas', ['Maestría en Derecho y Ciencia Política']],
  ['Administración de Empresas e Inteligencia de Negocios', ['Administración de Empresas']],
  ['Maestría en Gestión Económica y Evaluación de Impacto', []],
  ['Especialización en Psicología Clínica', []],
];
const ALIAS = {};
PROG_CANON.forEach(([c, al]) => [c, ...al].forEach(n => ALIAS[pkey(n)] = c));
function prog(s){ // llave del programa; guarda el nombre a mostrar (el que tenga más tildes)
  let t = String(s||'').trim();
  // las campañas generales llegan como "Campaña General" (pauta) o "Campaña general Pregrados" (metas)
  if(/^CAMPANA GENERAL( PREGRADOS| POSGRADOS)?$/.test(pkey(t))) t = 'Campaña general';
  const canon = ALIAS[pkey(t)], k = pkey(canon || t);
  const acc = x => (String(x).match(/[^\x00-\x7F]/g)||[]).length, up = x => /^[a-záéíóú]/.test(x) ? 0 : 1;
  if(canon) DISP[k] = canon; else if(!DISP[k] || up(t) > up(DISP[k]) || (up(t) === up(DISP[k]) && acc(t) > acc(DISP[k]))) DISP[k] = t;
  return k }
const D = k => DISP[k] || k;
// Campañas de leads sin programa: se quedan en su nivel, en su propio grupo.
const esGeneral = nm => /^CAMPANA|^ESPECIALIZACIONES /.test(pkey(nm));
const nivelDe = s => { const t = norm(s); return t.startsWith('PREGRADO') || t.startsWith('PROFESIONAL') ? 'Pregrado' : t.startsWith('POSGRADO') || /ESPECIALIZ|MAESTR|DOCTORADO/.test(t) ? 'Posgrado' : t.startsWith('GENERAL') ? 'General' : '' };
// Educación continua: modalidad Curso / Seminario (y similares); va en su propia sección
const esEC = s => /^(CURSO|SEMINARIO|DIPLOMADO|TALLER|EDUCON|EDUCACION CONTINUA)/.test(norm(s));
const grupoEC = s => { const t = norm(s); return t.startsWith('CURSO') ? 'Cursos' : t.startsWith('SEMINARIO') ? 'Seminarios' : t.startsWith('DIPLOMADO') ? 'Diplomados' : t.startsWith('TALLER') ? 'Talleres' : 'Otros' };
// jornada de la campaña de pauta: la nocturna lleva "Nocturna" en el nombre
const jornadaDe = s => /NOCTURN/.test(norm(s)) ? 'Nocturna' : 'Diurna';
const SIN_PROG = 'Sin programa definido';
function grupoDe(niv, nm, gen){
  if(gen) return 'Campañas generales';
  if(niv === 'Pregrado') return 'Pregrados';
  if(/^ESPECIALIZACI/.test(pkey(nm))) return 'Especializaciones';
  if(/^MAESTR/.test(pkey(nm))) return 'Maestrías';
  if(/^DOCTORADO/.test(pkey(nm))) return 'Doctorados';
  return 'Otros posgrados' }
const GEN_ORDER = ['Otros posgrados', 'Campañas generales'];
function canal(s){ const t = norm(s);
  if(t.startsWith('FACEBOOK') || t.startsWith('META') || t.startsWith('INSTAGRAM')) return 'Facebook';
  if(t.startsWith('GOOGLE')) return 'Google'; if(t.startsWith('TIKTOK')) return 'TikTok'; if(t.startsWith('PROGRAMATICA')) return 'Programática';
  if(/^CHAT-?GPT/.test(t)) return 'ChatGPT';
  return 'Otro' }

// ── Carga (JSONP de gviz: funciona también abriendo el archivo local) ─────────
let SEQ = 0;
function gvizRows(res){
  if(res?.status !== 'ok' || !res.table) throw new Error('Respuesta inválida de Google Sheets');
  const cols = res.table.cols || [];
  return (res.table.rows || []).map(row => cols.map((col, i) => { const c = row.c?.[i];
    if(!c || c.v === null || c.v === undefined) return '';
    if(col.type === 'date' || col.type === 'datetime'){ if(c.f) return c.f; const m = String(c.v).match(/^Date\((\d+),(\d+),(\d+)/); if(m) return `${m[3]}/${+m[2]+1}/${m[1]}` }
    return c.v }));
}
// En la web se lee CSV (trae todas las celdas). Abriendo el archivo local no hay CORS, así que se usa
// JSONP, que deja vacías las celdas de tipo distinto al resto de la columna.
function fetchTab(src){ return location.protocol.startsWith('http') ? fetchCSV(src) : fetchJSONP(src) }
function fetchCSV({gid, tq}){ return new Promise((ok, ko) => {
  const u = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:csv&gid=${gid}&headers=1${tq ? '&tq=' + encodeURIComponent(tq) : ''}&_=${Date.now()}`;
  Papa.parse(u, {download:true, header:false, skipEmptyLines:true, complete: r => ok(r.data.slice(1)), error: ko }) }) }
function fetchJSONP({gid, tq}){ return new Promise((ok, ko) => {
  const cb = `__cat_${Date.now()}_${++SEQ}`, s = document.createElement('script');
  const t = setTimeout(() => { cleanup(); ko(new Error('timeout')) }, 30000);
  const cleanup = () => { clearTimeout(t); s.remove(); delete window[cb] };
  window[cb] = r => { cleanup(); try{ ok(gvizRows(r)) } catch(e){ ko(e) } };
  const u = new URL(`https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq`);
  u.searchParams.set('tqx', `out:json;responseHandler:${cb}`); u.searchParams.set('gid', gid); u.searchParams.set('headers', '1'); u.searchParams.set('_', Date.now());
  if(tq) u.searchParams.set('tq', tq);
  s.src = u.toString(); s.async = true; s.onerror = () => { cleanup(); ko(new Error('red')) }; document.head.appendChild(s) }) }
function load(){
  document.getElementById('loading').style.display = 'flex';
  document.getElementById('ld-msg').textContent = 'Cargando datos...';
  Promise.all([fetchTab(SRC.rg), fetchTab(SRC.asp), fetchTab(SRC.adm), fetchTab(SRC.metas), fetchTab(SRC.fu), fetchTab(SRC.mens).catch(() => [])]).then(([rg, asp, adm, metas, fu, mens]) => {
    // MENSUAL: Periodo | Fecha (1.º del mes) | Mes | Nivel | % Mes | Presupuesto | Meta leads | CPL meta. Solo Pregrado y Posgrado (branding y educación continua van aparte)
    MENS = mens.map(x => ({ mes: iso(x[1]).slice(0,7), niv: String(x[3]||'').trim(), ppto: num(x[5]), lm: num(x[6]) })).filter(m => m.mes && (m.niv === 'Pregrado' || m.niv === 'Posgrado'));
    build(rg, asp, adm, metas, fu); prepare();
    const t = new Date().toLocaleString('es-CO', {day:'numeric', month:'short', hour:'2-digit', minute:'2-digit'});
    document.getElementById('last-upd').textContent = 'Datos cargados: ' + t;
    document.getElementById('last-upd-side').textContent = t;
    document.getElementById('loading').style.display = 'none';
  }).catch(() => { document.getElementById('ld-msg').textContent = 'No se pudo leer la hoja de Católica. Prueba actualizar en un momento.' });
}

function build(rg, asp, adm, metas, fu){
  RAW = []; METAS = []; PERIODOS = {}; DISP = {}; BRAND = []; BRAND_METAS = []; FUE = []; EC = []; EC_METAS = [];
  const fuenteDe = s => s === FUENTE_PAUTA ? 'Pauta' : s === 'Trafico_Organico' ? 'Orgánico' : 'Otras fuentes';
  const perDe = v => { const s = String(v||'').trim(), m = s.match(/^(\d{4})-(\d{1,2})-1$/); return m ? m[1] + '-' + m[2] : s };
  // demás fuentes (agrupado): fecha | fuente | nivel de formación | periodo | conteo
  fu.forEach(x => { const d = iso(x[0]), niv = nivelDe(x[2]); if(!d || !niv) return;
    FUE.push({ d, per: perDe(x[3]), niv, fu: fuenteDe(String(x[1]||'').trim()), lc: num(x[4]), mat: 0 }) });
  const row = o => { const r = { inv:0, lp:0, lc:0, pre:0, ins:0, adm:0, mat:0, per:'', ...o }; if(r.lc && r.medio) r[lcKey(r.medio)] = r.lc; RAW.push(r) };
  // RESUMEN GENERAL: Fecha | Campaña | Inversión | Leads plataforma | Medio | Modalidad | Tipo programa | Programa
  rg.forEach(x => {
    const d = iso(x[0]), mod = String(x[5]||'').trim(), tipo = String(x[6]||'').trim(), nm = String(x[7]||'').trim(), medio = canal(x[4]);
    if(!d || !nm) return;
    if(mod === 'Branding'){ BRAND.push({ d, niv: nivelDe(tipo), nm, tipo: tipo === 'Evento' ? 'Evento' : 'Branding', medio, inv: num(x[2]), lp: num(x[3]) }); return }
    if(esEC(mod)){ EC.push({ d, grp: grupoEC(mod), pk: prog(nm), medio, inv: num(x[2]), lp: num(x[3]) }); return }
    const niv = nivelDe(mod); if(!niv) return;
    const gen = esGeneral(nm), pk = prog(nm);
    row({ src:'rg', d, niv, pk, gen, grp: grupoDe(niv, nm, gen), medio, jor: jornadaDe(x[1]), inv: num(x[2]), lp: num(x[3]) });
  });
  // METAS: Periodo | Inicio | Fin | Modalidad | Tipo programa | Programa | Leads | Presupuesto | Matrículas
  metas.forEach(x => {
    const per = String(x[0]||'').trim(), ini = iso(x[1]), fin = iso(x[2]), mod = String(x[3]||'').trim(), nm = String(x[5]||'').trim();
    if(!per || !ini || !fin || !nm) return;
    PERIODOS[per] = PERIODOS[per] || [ini, fin]; if(ini < PERIODOS[per][0]) PERIODOS[per][0] = ini; if(fin > PERIODOS[per][1]) PERIODOS[per][1] = fin;
    if(mod === 'Branding'){ BRAND_METAS.push({ per, ini, fin, niv: nivelDe(x[4]), grupo: nivelDe(x[4]) || 'Branding', ppto: num(x[7]) }); return }
    if(esEC(mod)){ EC_METAS.push({ per, ini, fin, grp: grupoEC(mod), pk: prog(nm), ppto: num(x[7]), lm: num(x[6]), mm: num(x[8]) }); return }
    const niv = nivelDe(mod); if(!niv) return;
    const gen = esGeneral(nm), pk = prog(nm);
    METAS.push({ per, ini, fin, niv, pk, gen, grp: grupoDe(niv, nm, gen), ppto: num(x[7]), lm: num(x[6]), mm: num(x[8]) });
  });
  // CRM_ASPIRANTES (solo Trafico_Pago): Fecha | Fuente | Campaña | Código | Programa | Nivel de formación | Periodo
  asp.forEach(x => {
    const d = iso(x[0]), nm = String(x[4]||'').trim(), niv = nivelDe(x[5]);
    if(!d || !nm || !niv || String(x[1]).trim() !== FUENTE_PAUTA) return;
    const pk = prog(nm);
    FUE.push({ d, per: String(x[6]||'').trim(), niv, fu: 'Pauta', lc: 1, mat: 0 });
    row({ src:'crm', d, per: String(x[6]||'').trim(), niv, pk, gen:false, grp: grupoDe(niv, D(pk), false), medio: canal(x[2]), lc: 1 });
  });
  // CRM_ADMISIONES: ID adm | ID asp | Creación | Fase | Fuente | Campaña | Código | Programa | Nivel académico | Nivel de formación | Periodo |
  //                 Fecha pre-inscrito | Fecha inscrito | Fecha admitido | Fecha matriculado | Fecha cancelado
  adm.forEach(x => {
    // matriculados de todas las fuentes para la comparación (sin cancelados)
    const nf = nivelDe(x[8]) || nivelDe(x[9]), fm = iso(x[14]);
    if(nf && fm && norm(x[3]) !== 'CANCELADO') FUE.push({ d: fm, per: String(x[10]||'').trim(), niv: nf, fu: fuenteDe(String(x[4]||'').trim()), lc: 0, mat: 1 });
    if(String(x[4]).trim() !== FUENTE_PAUTA) return;
    const nm = String(x[7]||'').trim(), niv = nivelDe(x[8]) || nivelDe(x[9]); if(!nm || !niv) return;
    const pk = prog(nm), cancel = norm(x[3]) === 'CANCELADO';
    const b = { src:'adm', per: String(x[10]||'').trim(), niv, pk, gen:false, grp: grupoDe(niv, D(pk), false), medio: canal(x[5]) };
    // cada etapa en su fecha; una etapa no puede quedar antes de la anterior
    let prev = iso(x[2]);
    [[11,'pre'],[12,'ins'],[13,'adm'],[14,'mat']].forEach(([c, k]) => { let d = iso(x[c]); if(!d) return; if(prev && d < prev) d = prev; prev = d;
      if(k === 'mat' && cancel) return; row({ ...b, d, [k]: 1 }) });
  });
  RAW.forEach(r => { if(!r.gen) r.grp = grupoDe(r.niv, D(r.pk), false) });
  METAS.forEach(m => { if(!m.gen) m.grp = grupoDe(m.niv, D(m.pk), false) });
  fill('f-medio', CANALES.filter(c => RAW.some(r => r.medio === c)), document.getElementById('f-medio').value);
}

function prepare(){
  const q = [['sem','Esta semana'],['semAnt','Semana pasada'],['mes','Este mes']];
  document.getElementById('quick').innerHTML = q.map(([k,l]) => `<button class="qbtn" data-q="${k}" onclick="setQuick('${k}')">${l}</button>`).join('')
    + `<span class="f-sep"></span><button class="qbtn" data-mt onclick="toggleMetaTotal()" title="Meta total del periodo ${META_PER}; las fechas no cambian">Meta ${META_PER}</button>`;
  // con fechas libres (QUICK vacío) se respetan las que ya estén puestas
  if(!QUICK && document.getElementById('f-desde').value && document.getElementById('f-hasta').value){ cascade(); render() }
  else setQuick(QUICK || 'mes');
}

// ── Filtros ──────────────────────────────────────────────────────────────────
function fill(id, opts, sel, labelFn){ const el = document.getElementById(id), first = el.options[0].outerHTML;
  el.innerHTML = first + opts.map(o => `<option value="${esc(o)}"${o===sel?' selected':''}>${esc(labelFn ? labelFn(o) : o)}</option>`).join('');
  if(sel && !opts.includes(sel)) el.value = '' }
function setQuick(k){
  const hoy = todayISO(); let a, b = hoy;
  if(k === 'sem'){ a = weekStart(hoy) }
  else if(k === 'semAnt'){ a = addDays(weekStart(hoy), -7); b = addDays(a, 6) }
  else if(k === 'mes'){ a = hoy.slice(0,8) + '01' }
  else { const p = PERIODOS[k.slice(1)]; a = p[0]; b = p[1] < hoy ? p[1] : hoy }
  document.getElementById('f-desde').value = a; document.getElementById('f-hasta').value = b;
  QUICK = k; cascade(); render() }
function toggleMetaTotal(){ META_TOTAL = !META_TOTAL; render() }
function onDate(){ QUICK = ''; cascade(); render() }
function onSel(){ cascade(); render() }
// Parte de una meta que entra en el filtro: con un periodo elegido, la meta completa de ese periodo;
// con fechas libres, proporcional a los días del rango que caen dentro de la meta.
function share(m, f){
  if(META_TOTAL) return m.per === META_PER ? 1 : 0;
  const a = m.ini > f.desde ? m.ini : f.desde, b = m.fin < f.hasta ? m.fin : f.hasta;
  return a > b ? 0 : days(a, b) / days(m.ini, m.fin) }
function F(){ const g = id => document.getElementById(id).value;
  return { desde: g('f-desde'), hasta: g('f-hasta'), niv: g('f-nivel'), grp: g('f-grupo'), medio: g('f-medio'), prog: g('f-programa'),
    per: '' } }
// La pauta no trae periodo: siempre por fechas. El CRM, con periodo elegido, por su columna Periodo.
// el CRM siempre por fecha: con periodo elegido, las fechas son las del periodo
const enRango = (r, f) => r.d >= f.desde && r.d <= f.hasta;
const pasa = (r, f) => enRango(r, f) && (!f.niv || r.niv === f.niv) && (!f.medio || r.medio === f.medio);
function cascade(){
  const f = F(), base = RAW.filter(r => pasa(r, f));
  fill('f-grupo', [...new Set(base.map(r => r.grp))].sort((a, b) => (GEN_ORDER.indexOf(a) - GEN_ORDER.indexOf(b)) || a.localeCompare(b)), f.grp);
  const b2 = base.filter(r => !f.grp || r.grp === f.grp);
  fill('f-programa', [...new Set(b2.filter(r => !r.gen).map(r => r.pk))].sort((x, y) => D(x).localeCompare(D(y))), f.prog, D);
}
function resetFilters(){ ['f-nivel','f-grupo','f-medio','f-programa'].forEach(id => document.getElementById(id).value = '');
  document.getElementById('q').value = ''; QUICK = 'mes'; prepare() }

// ── Cálculo ──────────────────────────────────────────────────────────────────
const Z = () => ({inv:0, invG:0, lp:0, lc:0, pre:0, ins:0, adm:0, mat:0, ppto:0, lm:0, mm:0, pm:0, lmm:0, lcF:0, lcG:0, lcT:0, lcL:0, lcP:0, lcC:0, lcO:0});
// leads CRM por medio (columnas de la tabla de programas; no se reparten)
const LCM = [['lcF','Meta'],['lcG','Google'],['lcT','TikTok'],['lcL','LinkedIn'],['lcP','Programática'],['lcC','ChatGPT'],['lcO','Otros']];
const lcKey = m => { const t = norm(m); return /FACE|META|INSTA/.test(t) ? 'lcF' : /GOOGLE/.test(t) ? 'lcG' : /TIKTOK/.test(t) ? 'lcT' : /LINKEDIN/.test(t) ? 'lcL' : /PROGRAM/.test(t) ? 'lcP' : /CHAT-?GPT/.test(t) ? 'lcC' : 'lcO' };
const NUM = Object.keys(Z());
function add(a, b){ NUM.forEach(k => a[k] += b[k] || 0); return a }
function M(e){ return { ...e, dif: e.lp ? e.lc/e.lp - 1 : null, cplP: div(e.inv, e.lp), cplC: div(e.inv, e.lc), cpp: div(e.inv, e.pre), cpi: div(e.inv, e.ins), cpa: div(e.inv, e.adm), cpm: div(e.inv, e.mat),
  conv: div(e.mat, e.lc), cumL: div(e.lc, e.lm), cumM: div(e.mat, e.mm), cumI: div(e.inv, e.ppto),
  cumP: div(e.inv, e.pm), cumLm: div(e.lc, e.lmm), cplM: div(e.pm, e.lmm) } }

function entradas(f){
  const E = {}, get = (niv, pk, grp, gen) => { const k = niv + '|' + pk; return E[k] = E[k] || { ...Z(), niv, pk, grp, gen } };
  RAW.forEach(r => { if(pasa(r, f)) add(get(r.niv, r.pk, r.grp, r.gen), r) });
  if(!f.medio) METAS.forEach(m => {
    if(m.per !== META_PER) return; if(f.niv && m.niv !== f.niv) return;
    const s = share(m, f); if(!s) return;
    const e = get(m.niv, m.pk, m.grp, m.gen);
    e.ppto += m.ppto * s; e.lm += m.lm * s; e.mm += m.mm * s });
  const list = Object.values(E);
  return list.filter(e => (!f.grp || e.grp === f.grp) && (!f.prog || e.pk === f.prog));
}
// Meta mensual (MENSUAL) que cae entre a y b: cada mes aporta su meta × días del mes dentro del rango / días del mes
function metaMensual(a, b, niv){
  const out = {pm:0, lmm:0};
  MENS.forEach(m => { if(niv && m.niv !== niv) return;
    const ini = m.mes + '-01', fin = addDays(new Date(Date.UTC(+m.mes.slice(0,4), +m.mes.slice(5,7), 1)).toISOString().slice(0,10), -1);
    const x = a > ini ? a : ini, y = b < fin ? b : fin; if(x > y) return;
    const s = days(x, y) / days(ini, fin); out.pm += m.ppto * s; out.lmm += m.lm * s });
  return out }
function filasRango(f){ return RAW.filter(r => pasa(r, f) && (!f.grp || r.grp === f.grp) && (!f.prog || r.pk === f.prog)) }

// ── Render ───────────────────────────────────────────────────────────────────
let ENT = [];
function render(){
  const f = F(); if(!f.desde || !f.hasta) return;
  document.querySelectorAll('.qbtn[data-q]').forEach(b => b.classList.toggle('on', b.dataset.q === QUICK));
  document.querySelectorAll('.qbtn[data-mt]').forEach(b => b.classList.toggle('on', META_TOTAL));
  ENT = entradas(f);
  const T = M(ENT.reduce((a, e) => add(a, e), Z()));
  document.getElementById('rango-note').textContent = `${fDate(f.desde)} – ${fDate(f.hasta)} ${f.hasta.slice(0,4)} · ${days(f.desde, f.hasta)} días`;
  document.getElementById('embudo-note').textContent = 'cada etapa del CRM por su propia fecha';
  const gen = RAW.filter(r => r.gen && pasa(r, f)).reduce((a, r) => a + r.inv, 0);
  document.getElementById('gen-note').textContent = gen ? `Campañas generales: ${fCOP(gen)}, en su propio grupo` : '';
  const B = renderBrand(f, (r, f) => r.d >= f.desde && r.d <= f.hasta && (!f.niv || r.niv === f.niv) && (!f.medio || r.medio === f.medio), r => r.tipo === 'Evento' ? 'Eventos' : (r.niv || 'Branding'));
  renderKPIs(T, B); renderMedios(f); renderFunnel(T); renderFuentes(f, (r, f) => (r.d >= f.desde && r.d <= f.hasta) && (!f.niv || r.niv === f.niv)); renderNivel(); renderMedio(f); renderSemana(f); renderDetalle(); renderEC(f);
}

function bar(p, lbl){ if(p === null) return '';
  return `<div class="kpi-bwrap"><div class="kpi-brow"><span>${lbl}</span><span class="${cls(p)}">${fP(p)}</span></div><div class="kpi-bar"><div class="kpi-bfill ${bgc(p)}" style="width:${Math.min(p*100,100)}%"></div></div></div>` }
function renderKPIs(T, B){
  const cplMeta = div(T.ppto, T.lm), inv = T.inv + B.inv;
  const hero = (l, v, sub, extra) => `<div class="stat"><div class="stat-l">${l}</div><div class="stat-n">${v}</div>${sub ? `<div class="stat-s">${sub}</div>` : ''}${extra || ''}</div>`;
  const st = (l, v, sub) => `<div class="stat"><div class="stat-l">${l}</div><div class="stat-n">${v}</div>${sub ? `<div class="stat-s">${sub}</div>` : ''}</div>`;
  document.getElementById('kpi-grid').innerHTML =
    '<div class="stats-hero">' + [
      hero('Inversión total', fCOP(inv), `conversión ${fCOP(T.inv)} · branding y eventos ${fCOP(B.inv)}`, bar(div(inv, T.ppto + B.ppto), (META_TOTAL ? 'Ejecución vs presupuesto del periodo ' : 'Ejecución vs presupuesto proporcional al rango ') + fCOP(T.ppto + B.ppto))),
      hero('Leads CRM', fN(T.lc), `<span class="${difCls(T.dif)}">${T.dif === null ? '' : (T.dif > 0 ? '+' : '') + fP(T.dif) + ' vs plataforma'}</span>`, bar(T.cumL, 'Meta ' + fN(T.lm))),
      hero('Matriculados', '<span class="ad-fill">' + fN(T.mat) + '</span>', fP(T.conv) + ' de los leads CRM', bar(T.cumM, 'Meta ' + fN(T.mm))),
    ].join('') + '</div>' +
    '<div class="stats-row">' + [
      st('Leads plataforma', fN(T.lp), 'CPL plataforma ' + fCOP(T.cplP)),
      st('CPL CRM', fCOP(T.cplC), cplMeta ? 'CPL meta ' + fCOP(cplMeta) : ''),
      st('Pre-inscritos', fN(T.pre), fP(div(T.pre, T.lc)) + ' de los leads CRM'),
      st('Admitidos', fN(T.adm), fN(T.ins) + ' inscritos'),
      st('Costo por matrícula', fCOP(T.cpm), (T.mm ? 'meta ' + fCOP(div(T.ppto, T.mm)) + ' · ' : '') + 'con branding y eventos ' + fCOP(div(inv, T.mat))),
      st(META_TOTAL ? 'Meta de matrículas del periodo' : 'Meta de matrículas del rango', fN(T.mm), META_TOTAL ? 'meta completa del periodo' : 'proporcional a los días elegidos'),
    ].join('') + '</div>';
}
// Tarjetas por medio del resumen: mismas filas y reglas que la tabla "Por nivel y medio"
const MEDIO_CARD = [['Facebook','Meta',ADC.c.meta],['TikTok','TikTok',ADC.c.tiktok],['Google','Google',ADC.c.google],['Programática','Programática',ADC.c.prog],['ChatGPT','ChatGPT',ADC.c.chatgpt]];
function renderMedios(f){
  const g = groupRows(filasRango(f), r => r.medio);
  const cards = MEDIO_CARD.filter(([k]) => !f.medio || f.medio === k || (g[k] && NUM.some(x => g[k][x])));
  const row = (l, v, sub) => `<div class="med-row"><span>${l}</span><b>${v}${sub ? `<i>${sub}</i>` : ''}</b></div>`;
  document.getElementById('med-grid').innerHTML = cards.map(([k, lbl, col]) => {
    const e = M(g[k] || Z());
    return `<div class="card med-card"><div class="med-head"><span class="med-dot" style="background:${col}${col === ADC.c.google ? ";box-shadow:inset 0 0 0 1px " + ADC.c.googleB : ""}"></span>${lbl}</div>
      <div class="med-inv">${fCOP(e.inv)}</div><div class="kpi-sub">inversión${T_SHARE(e.inv, g)}</div>
      ${row('Leads plataforma', fN(e.lp), 'CPL ' + fCOP(e.cplP))}
      ${row('Leads CRM', fN(e.lc), 'CPL ' + fCOP(e.cplC))}
      ${row('Pre-inscritos', fN(e.pre), fP(div(e.pre, e.lc)) + ' de leads')}
      ${row('Admitidos', fN(e.adm), fN(e.ins) + ' inscritos')}
      ${row('Matriculados', fN(e.mat), fP(div(e.mat, e.adm)) + ' de admitidos')}
      ${row('Lead → mat.', fP(e.conv))}</div>` }).join('') }
const T_SHARE = (inv, g) => { const t = Object.values(g).reduce((a, x) => a + x.inv, 0); return t ? ' · ' + fP(inv / t) + ' del total' : '' };

function renderFunnel(T){
  // costo por etapa = inversión del rango / volumen de la etapa; se colorea contra el costo meta cuando existe
  const cplMeta = div(T.ppto, T.lm), cpmMeta = div(T.ppto, T.mm);
  const steps = [['Leads plataforma', T.lp, '', null], ['Leads CRM', T.lc, T.lp ? fP(div(T.lc, T.lp)) + ' de plataforma' : '', cplMeta],
    ['Pre-inscritos', T.pre, fP(div(T.pre, T.lc)) + ' de leads CRM', null], ['Inscritos', T.ins, fP(div(T.ins, T.pre)) + ' de pre-inscritos', null],
    ['Admitidos', T.adm, fP(div(T.adm, T.ins)) + ' de inscritos', null], ['Matriculados', T.mat, fP(div(T.mat, T.adm)) + ' de admitidos', cpmMeta]];
  const mx = Math.max(...steps.map(s => s[1]), 1);
  const costo = (v, meta) => { const c = div(T.inv, v); if(c === null) return '<span class="t-mute">—</span>';
    const k = meta ? (c <= meta ? 't-pos' : c <= meta * 1.25 ? 't-mid' : 't-neg') : '';
    return `<b class="${k}">${fCOP(c)}</b>${meta ? `<span class="t-mute">meta ${fCOP(meta)}</span>` : ''}` };
  document.getElementById('funnel').innerHTML =
    '<div class="f-row f-head"><div></div><div></div><div class="f-val"><span>Volumen</span><span>Tasa vs etapa anterior</span></div><div class="f-cost"><span>Costo por etapa</span></div></div>' +
    steps.map(([l, v, c, meta], i) => `<div class="f-row"><div class="f-lbl">${l}</div>
    <div class="f-track"><div class="f-fill${i === steps.length - 1 ? ' dark' : ''}" style="width:${Math.max(v/mx*100, .4)}%"></div></div>
    <div class="f-val"><b>${fN(v)}</b><span class="t-mute">${c}</span></div><div class="f-cost">${costo(v, meta)}</div></div>`).join('');
}
// Por nivel: una fila por nivel con lo principal; el chip abre una fila con el detalle del embudo y otras fuentes
const COLS_NIV = [['inv','Inversión','cop'],['cumI','Ejec. ppto','cum'],['lc','Leads CRM','n',1],['cplC','CPL CRM','cop'],['cumL','Cumpl. leads','cum'],
  ['pre','Pre-inscritos','n',1],['mat','Matriculados','n'],['cpm','Costo / mat.','cop'],['cumM','Cumpl. mat.','cum']];
let OPEN_NIV = {};
function togNiv(n){ OPEN_NIV[n] = !OPEN_NIV[n]; renderNivel() }
function renderNivel(){
  const tags = {'Pregrado':'tag-pre','Posgrado':'tag-pos'};
  const v = (l, x, c) => `<span>${l} <i class="${c||''}">${x}</i></span>`;
  const grp = (t, items) => `<div class="nv-det-grp"><b>${t}</b>${items.join('')}</div>`;
  const fila = (niv, e) => {
    const tag = tags[niv], open = !!OPEN_NIV[niv], n = FU_NIV[niv], cv = k => fP(div(n[k].mat, n[k].lc));
    let h = `<tr${tag ? '' : ' class="tr-total"'}><td>${tag ? `<span class="nv-chip${open ? ' open' : ''}" onclick="togNiv('${niv}')"><span class="car">▶</span><span class="nivel-tag ${tag}" style="margin:0">${niv}</span></span>` : 'Total'}</td>` +
      COLS_NIV.map(c => cell(e, c)).join('') + '</tr>';
    if(tag && open) h += `<tr class="nv-det"><td colspan="${COLS_NIV.length + 1}"><div class="nv-det-grid">` +
      grp('Plataforma', [v('Leads', fN(e.lp)), v('CPL', fCOP(e.cplP)), v('CRM vs plat.', e.dif === null ? '—' : (e.dif > 0 ? '+' : '') + fP(e.dif), difCls(e.dif))]) +
      grp('Embudo', [v('Costo / pre-insc.', fCOP(e.cpp)), v('Inscritos', fN(e.ins)), v('Admitidos', fN(e.adm)), v('Costo / adm.', fCOP(e.cpa)),
        v('Lead → pre-insc.', fP(div(e.pre, e.lc))), v('Pre-insc. → mat.', fP(div(e.mat, e.pre))), v('Lead → mat.', fP(e.conv))]) +
      grp('Metas', [v('Meta ppto', fCOP(e.ppto)), v('Meta leads', fN(e.lm)), v('Meta mat.', fN(e.mm))]) +
      (n ? grp('Orgánico', [v('Leads', fN(n['Orgánico'].lc)), v('Mat.', fN(n['Orgánico'].mat)), v('Conv.', cv('Orgánico'))]) +
           grp('Otras fuentes', [v('Leads', fN(n['Otras fuentes'].lc)), v('Mat.', fN(n['Otras fuentes'].mat)), v('Conv.', cv('Otras fuentes'))]) : '') +
      '</div></td></tr>';
    return h };
  const tot = niv => M(ENT.filter(x => x.niv === niv).reduce((a, x) => add(a, x), Z()));
  const pre = tot('Pregrado'), pos = tot('Posgrado'), T = M(add(add(Z(), pre), pos));
  document.getElementById('nivel-head').innerHTML = head('Nivel', COLS_NIV, false);
  document.getElementById('nivel-body').innerHTML = fila('Pregrado', pre) + fila('Posgrado', pos) + fila('Total', T);
}
const COLS_BASE = [['inv','Inversión','cop'],['lp','Leads plat.','n'],['lc','Leads CRM','n'],['dif','CRM vs plat.','dif'],['cplP','CPL plat.','cop'],['cplC','CPL CRM','cop'],
  ['pre','Pre-insc.','n'],['adm','Admitidos','n'],['mat','Matric.','n'],['cpm','Costo / mat.','cop'],['conv','Lead → mat.','pct']];
const COLS_MES = [['pm','Ppto meta','cop',1],['cumP','Ejec. ppto','cum'],['lmm','Meta leads','n'],['cumLm','Cumpl. leads','cum'],['cplM','CPL meta','cop']];
const COLS_META = [['lm','Meta leads','n',1],['cumL','Cumpl. leads','cum'],['mm','Meta mat.','n'],['cumM','Cumpl. mat.','cum'],['ppto','Presupuesto','cop',1],['cumI','Ejecución','cum']];
function cell(e, [k, , t, grp]){ const v = e[k], g = grp ? ' grp' : '';
  if(t === 'cop') return `<td class="r${g}">${fCOP(v)}</td>`;
  if(t === 'n') return `<td class="r${g}">${fN(v)}</td>`;
  if(t === 'pct') return `<td class="r${g}">${fP(v)}</td>`;
  if(t === 'dif') return `<td class="r${g} ${difCls(v)}">${v === null ? '—' : (v > 0 ? '+' : '') + fP(v)}</td>`;
  if(t === 'cum') return `<td class="r${g} ${cls(v)}">${fP(v)}</td>` }
function head(first, cols, sortable){ return '<tr><th>' + first + '</th>' + cols.map(c => {
  const act = SORT.col === c[0]; return `<th class="r${c[3] ? ' grp' : ''}${sortable ? ' sortable' : ''}${sortable && act ? ' sort-act' : ''}"${sortable ? ` onclick="sortBy('${c[0]}')"` : ''}>${c[1]}${sortable && act ? (SORT.dir > 0 ? ' ↑' : ' ↓') : ''}</th>` }).join('') + '</tr>' }
function groupRows(rows, keyFn){ const g = {}; rows.forEach(r => { const k = keyFn(r); g[k] = g[k] || Z(); add(g[k], r) }); return g }

let MEDIO_VISTA = 'niv';
function setMedioVista(k){ MEDIO_VISTA = k; document.querySelectorAll('[data-mv]').forEach(b => b.classList.toggle('on', b.dataset.mv === k)); renderMedio(F()) }
function renderMedio(f){
  const rows = filasRango(f);
  const lbl = {Facebook:'Meta (Facebook e Instagram)', Google:'Google Ads', TikTok:'TikTok', 'Programática':'Programática', ChatGPT:'ChatGPT Ads', Otro:'Otro (CRM)'};
  const orden = (a, b) => (CANALES.indexOf(a) + 1 || 9) - (CANALES.indexOf(b) + 1 || 9);
  const conDatos = g => k => g[k].inv || g[k].lp || g[k].lc || g[k].pre;
  const cols = COLS_BASE.slice(); cols.splice(cols.findIndex(c => c[0] === 'cpm'), 0, ['cpp','Costo / pre-insc.','cop']);
  const porNivel = MEDIO_VISTA === 'niv';
  document.getElementById('medio-head').innerHTML = head(porNivel ? 'Nivel / medio' : 'Medio', cols, false);
  const fila = (cl, lab, e) => `<tr${cl ? ` class="${cl}"` : ''}><td>${lab}</td>` + cols.map(c => cell(M(e), c)).join('') + '</tr>';
  const medios = (rs, cl) => { const g = groupRows(rs, r => r.medio); return Object.keys(g).filter(conDatos(g)).sort(orden).map(k => fila(cl, lbl[k] || esc(k), g[k])).join('') };
  let h = '';
  if(porNivel){
    // cada nivel con su subtotal y debajo sus medios
    const nv = groupRows(rows, r => r.niv);
    NIVELES.filter(n => nv[n]).forEach(n => { h += fila('lv1', esc(n), nv[n]) + medios(rows.filter(r => r.niv === n), 'lv3') });
  } else h = medios(rows, '');
  document.getElementById('medio-body').innerHTML = h + fila('tr-total', 'Total', rows.reduce((a, r) => add(a, r), Z()));
}
let OPEN_EVO = {};
function togEvo(k){ OPEN_EVO[k] = !OPEN_EVO[k]; renderSemana(F()) }
function abrirGeneral(){
  const p = new URLSearchParams(), n = document.getElementById('f-nivel').value, d = document.getElementById('f-desde').value, h = document.getElementById('f-hasta').value;
  if(n === 'Pregrado' || n === 'Posgrado') p.set('niv', n);
  if(d && h){ p.set('desde', d); p.set('hasta', h) }
  p.set('g', EVO === 'mes' ? 'm' : 's');
  location.href = '../tableros/tablero-catolica-general.html?' + p + '#evolucion';
}
function setEvo(k){ EVO = k; document.querySelectorAll('[data-ev]').forEach(b => b.classList.toggle('on', b.dataset.ev === k)); renderSemana(F()) }
function renderSemana(f){
  // con periodo elegido: pauta del rango y CRM del periodo, cada fila en su fecha
  const mes = EVO === 'mes', rows = filasRango(f), g = groupRows(rows, r => mes ? r.d.slice(0,7) : weekStart(r.d)), ks = Object.keys(g).sort();
  // metas mensuales: solo por nivel; con filtro de grupo, medio o programa no aplican
  const conMeta = !f.grp && !f.medio && !f.prog && f.niv !== 'General';
  if(conMeta) ks.forEach(k => {
    let a = mes ? k + '-01' : k, b = mes ? addDays(new Date(Date.UTC(+k.slice(0,4), +k.slice(5,7), 1)).toISOString().slice(0,10), -1) : addDays(k, 6);
    if(!(mes && META_TOTAL)) { if(f.desde > a) a = f.desde; if(f.hasta < b) b = f.hasta }
    Object.assign(g[k], metaMensual(a, b, f.niv)) });
  document.getElementById('semana-note').textContent = [f.prog ? 'con filtro de programa la inversión es solo la directa' : (mes ? 'por mes calendario · cada etapa del CRM por su propia fecha' : 'semanas de lunes a domingo · cada etapa del CRM por su propia fecha'),
    conMeta ? (mes && META_TOTAL ? 'meta del mes completo' : 'meta mensual proporcional a los días del rango') : 'metas mensuales solo sin filtro de grupo, medio ni programa'].join(' · ');
  const lab = k => mes ? MESES[+k.slice(5,7)].replace(/^./, c => c.toUpperCase()) + ' ' + k.slice(0,4) : `${fDate(k)} – ${fDate(addDays(k, 6))}`;
  const cols = COLS_BASE.concat(COLS_MES);
  document.getElementById('sem-head').innerHTML = head(mes ? 'Mes' : 'Semana', cols, false);
  const T = M(ks.reduce((a, k) => add(a, g[k]), Z()));
  const lblM = {Facebook:'Meta', Google:'Google', TikTok:'TikTok', 'Programática':'Programática', ChatGPT:'ChatGPT'};
  const ordM = (a, b) => (CANALES.indexOf(a) + 1 || 9) - (CANALES.indexOf(b) + 1 || 9);
  // el chip abre una fila por medio con las mismas columnas; las metas son del total, no del medio
  const subM = k => { const gm = groupRows(rows.filter(r => (mes ? r.d.slice(0,7) : weekStart(r.d)) === k), r => r.medio);
    return Object.keys(gm).filter(m => NUM.some(x => gm[m][x])).sort(ordM).map(m => '<tr class="lv3"><td>' + (lblM[m] || esc(m)) + '</td>' +
      cols.map(c => COLS_MES.includes(c) ? `<td class="r${c[3] ? ' grp' : ''} t-mute">—</td>` : cell(M(gm[m]), c)).join('') + '</tr>').join('') };
  document.getElementById('sem-body').innerHTML = ks.slice().reverse().map(k => { const open = !!OPEN_EVO[k];
    return `<tr><td><span class="nv-chip${open ? ' open' : ''}" onclick="togEvo('${k}')"><span class="car">▶</span>${lab(k)}</span></td>` + cols.map(c => cell(M(g[k]), c)).join('') + '</tr>' + (open ? subM(k) : '') }).join('') +
    '<tr class="tr-total"><td>Total</td>' + cols.map(c => cell(T, c)).join('') + '</tr>';
  const C = ADC.c, labels = ks.map(k => mes ? lab(k) : fDate(k));
  const base = { responsive:true, maintainAspectRatio:false, interaction:{mode:'index', intersect:false},
    scales:{ x:{grid:{display:false}, ticks:{maxRotation:0, autoSkip:true}}, y:{beginAtZero:true, border:{display:false}, ticks:{maxTicksLimit:5}} } };
  const pr = ks.length < 4 ? 4 : 0;
  if(CHART_INV) CHART_INV.destroy(); if(CHART) CHART.destroy(); if(CHART_MAT) CHART_MAT.destroy();
  CHART_INV = new Chart(document.getElementById('chart-inv'), { type:'bar', data:{ labels, datasets:[ { label:'Inversión', data: ks.map(k => Math.round(g[k].inv)), backgroundColor:C.sec, maxBarThickness:28 } ] },
    options:{ ...base, plugins:{ legend:{display:false}, tooltip:{callbacks:{label: c => 'Inversión: ' + fCOP(c.raw)}} },
      scales:{ ...base.scales, y:{...base.scales.y, ticks:{maxTicksLimit:5, callback: v => '$' + (v/1e6).toLocaleString('es-CO') + 'M'}} } } });
  CHART = new Chart(document.getElementById('chart-sem'), { type:'line', data:{ labels, datasets:[
    { label:'Leads plataforma', data: ks.map(k => g[k].lp), borderColor:C.otro, backgroundColor:C.otro, tension:.25, pointRadius:pr },
    { label:'Leads CRM', data: ks.map(k => g[k].lc), borderColor:C.sumi, backgroundColor:C.sumi, tension:.25, pointRadius:pr } ] },
    options:{ ...base, plugins:{ legend:{position:'bottom'}, tooltip:{callbacks:{label: c => c.dataset.label + ': ' + fN(c.raw)}} } } });
  CHART_MAT = new Chart(document.getElementById('chart-mat'), { type:'line', data:{ labels, datasets:[
    { label:'Pre-inscritos', data: ks.map(k => g[k].pre), borderColor:C.meta, backgroundColor:C.meta, tension:.25, pointRadius:pr },
    { label:'Matriculados', data: ks.map(k => g[k].mat), borderColor:C.tiktok, backgroundColor:C.tiktok, borderDash:[5,3], tension:.25, pointRadius:pr } ] },
    options:{ ...base, plugins:{ legend:{position:'bottom'}, tooltip:{callbacks:{label: c => c.dataset.label + ': ' + fN(c.raw)}} } } });
}

function sortBy(col){ SORT.dir = SORT.col === col ? -SORT.dir : -1; SORT.col = col; renderDetalle() }
function sorter(a, b){ const x = a.m[SORT.col], y = b.m[SORT.col];
  if(x === null && y === null) return 0; if(x === null) return 1; if(y === null) return -1; return SORT.dir * (x - y) }
function renderDetalle(){
  const cols = COLS_BASE.filter(c => c[0] !== 'dif' && c[0] !== 'cplP');
  cols.splice(cols.findIndex(c => c[0] === 'cpm'), 0, ['cpp','Costo / pre-insc.','cop'], ['cpa','Costo / adm.','cop']);
  cols.push(...COLS_META);
  const lcCols = LCM.filter(([k]) => ENT.some(e => e[k])).map(([k, l]) => [k, 'CRM ' + l, 'n']);
  cols.splice(cols.findIndex(c => c[0] === 'lc') + 1, 0, ...lcCols);
  const q = norm(document.getElementById('q').value);
  document.getElementById('det-head').innerHTML = head('Nivel / grupo / programa', cols, true);
  const ents = ENT.filter(e => !q || norm(D(e.pk) + ' ' + e.grp + ' ' + e.niv).includes(q));
  const tree = {};
  ents.forEach(e => { const c = tree[e.niv] = tree[e.niv] || {t: Z(), grps: {}}; add(c.t, e);
    const g = c.grps[e.grp] = c.grps[e.grp] || {t: Z(), progs: []}; add(g.t, e); g.progs.push(e) });
  const nvTag = n => n === 'Pregrado' ? '<span class="nv nv-pre">PRE</span>' : n === 'Posgrado' ? '<span class="nv nv-pos">POS</span>' : '<span class="nv nv-gen">GRAL</span>';
  // inversión directa y leads plataforma por jornada (solo programas con campaña nocturna en el rango)
  const f = F(), JOR = {};
  RAW.forEach(r => { if(r.src !== 'rg' || !pasa(r, f)) return; const j = JOR[r.niv + '|' + r.pk] = JOR[r.niv + '|' + r.pk] || {};
    add(j[r.jor] = j[r.jor] || Z(), r) });
  const jornadas = (e, vis, gid, cid) => { const j = JOR[e.niv + '|' + e.pk]; if(!j || !j.Nocturna || !(j.Nocturna.inv || j.Nocturna.lp)) return '';
    const tot = (j.Diurna?.inv || 0) + j.Nocturna.inv;
    return ['Diurna', 'Nocturna'].filter(k => j[k]).map(k => `<tr class="lv4${vis ? '' : ' hidden'}" data-p="${gid}" data-c="${cid}"><td>${k}<span class="t-mute" style="margin-left:6px">${fP(div(j[k].inv, tot))} de la inversión</span></td>` +
      cols.map(c => ['inv', 'lp'].includes(c[0]) ? cell(M(j[k]), c) : `<td class="r${c[3] ? ' grp' : ''}"></td>`).join('') + '</tr>').join('') };
  let h = '';
  NIVELES.filter(n => tree[n]).map(k => ({k, v: tree[k], m: M(tree[k].t)})).forEach(({k, v, m}) => {
    const cid = 'n_' + k, oc = q ? true : !!OPEN[cid];
    h += `<tr class="lv1" onclick="tog('${cid}')"><td><span class="tog${oc ? ' open' : ''}" id="t-${cid}">▶</span>${esc(k)}${nvTag(k)}</td>` + cols.map(c => cell(m, c)).join('') + '</tr>';
    Object.entries(v.grps).map(([gk, gv]) => ({gk, gv, m: M(gv.t)})).sort((a, b) => (GEN_ORDER.indexOf(a.gk) - GEN_ORDER.indexOf(b.gk)) || sorter(a, b)).forEach(({gk, gv, m}) => {
      const gid = cid + '__' + gk.replace(/\W/g, '_'), og = q ? true : !!OPEN[gid];
      h += `<tr class="lv2${oc ? '' : ' hidden'}" data-p="${cid}" onclick="tog('${gid}')"><td><span class="tog${og ? ' open' : ''}" id="t-${gid}">▶</span>${esc(gk)}<span class="t-mute" style="font-weight:400;margin-left:6px">${gv.progs.length}</span></td>` + cols.map(c => cell(m, c)).join('') + '</tr>';
      gv.progs.map(e => ({e, m: M(e)})).sort(sorter).forEach(({e, m}) => {
        const tag = (!e.gen && !e.inv && (e.lc || e.pre)) ? '<span class="nv nv-gen">sin pauta</span>' : '';
        h += `<tr class="lv3${oc && og ? '' : ' hidden'}" data-p="${gid}" data-c="${cid}"><td>${esc(D(e.pk))}${tag}</td>` + cols.map(c => cell(m, c)).join('') + '</tr>' + jornadas(e, oc && og, gid, cid) }) }) });
  const T = M(ents.reduce((a, e) => add(a, e), Z()));
  h += '<tr class="tr-total"><td>Total</td>' + cols.map(c => cell(T, c)).join('') + '</tr>';
  document.getElementById('det-body').innerHTML = h;
}
// ── Branding y eventos (sección aparte: fuera de los costos del embudo y de la tabla de programas) ──
function renderBrand(f, enR, grupoDe){
  const rows = BRAND.filter(r => r.inv && enR(r, f)), metas = BRAND_METAS.filter(m => m.per === META_PER && (!f.niv || !m.niv || m.niv === f.niv) && (!f.mod || !m.mod || m.mod === f.mod));
  const medios = CANAL_ORDER.filter(c => rows.some(r => r.medio === c && r.inv));
  const conLp = rows.some(r => r.lp), G = {};
  rows.forEach(r => { const g = G[grupoDe(r)] = G[grupoDe(r)] || {inv:0, lp:0, ppto:0, items:{}};
    const it = g.items[r.nm] = g.items[r.nm] || {inv:0, lp:0, tipo:r.tipo, med:{}, dias:new Set()};
    g.inv += r.inv; it.inv += r.inv; g.lp += r.lp || 0; it.lp += r.lp || 0; it.med[r.medio] = (it.med[r.medio] || 0) + r.inv; if(r.inv) it.dias.add(r.d) });
  metas.forEach(m => { const s = share(m, f); if(!s) return;
    const g = G[m.grupo] = G[m.grupo] || {inv:0, lp:0, ppto:0, items:{}}; g.ppto += m.ppto * s });
  const tot = Object.values(G).reduce((a, g) => (a.inv += g.inv, a.lp += g.lp, a.ppto += g.ppto, a), {inv:0, lp:0, ppto:0});
  const lpTd = x => conLp ? `<td class="r">${fN(x.lp)}</td><td class="r">${fCOP(div(x.inv, x.lp))}</td>` : '';
  document.getElementById('brand-head').innerHTML = '<tr><th>Campaña</th><th class="r">Inversión</th>' + medios.map(m => `<th class="r">${CANAL_LBL[m] || m}</th>`).join('') +
    (conLp ? '<th class="r">Leads plat.</th><th class="r">CPL plat.</th>' : '') + '<th class="r">% de branding y eventos</th><th class="r">Días con inversión</th><th class="r grp">Presupuesto</th><th class="r">Ejecución</th></tr>';
  const pc = v => `<td class="r ${cls(v)}">${fP(v)}</td>`;
  let h = '';
  Object.entries(G).sort((a, b) => b[1].inv - a[1].inv).forEach(([gk, g]) => {
    const ej = div(g.inv, g.ppto);
    h += `<tr class="lv1"><td>${esc(gk)}</td><td class="r">${fCOP(g.inv)}</td>` + medios.map(m => `<td class="r">${fCOP(Object.values(g.items).reduce((a, it) => a + (it.med[m] || 0), 0))}</td>`).join('') +
      lpTd(g) + `<td class="r">${fP(div(g.inv, tot.inv))}</td><td class="r"></td><td class="r grp">${fCOP(g.ppto)}</td>${pc(ej)}</tr>`;
    Object.entries(g.items).sort((a, b) => b[1].inv - a[1].inv).forEach(([nm, it]) => {
      h += `<tr class="lv3"><td>${esc(nm)}<span class="nv ${it.tipo === 'Evento' ? 'nv-eve' : 'nv-bra'}">${esc(it.tipo)}</span></td><td class="r">${fCOP(it.inv)}</td>` + medios.map(m => `<td class="r">${fCOP(it.med[m])}</td>`).join('') +
        lpTd(it) + `<td class="r">${fP(div(it.inv, tot.inv))}</td><td class="r">${fN(it.dias.size)}</td><td class="r grp"></td><td class="r"></td></tr>` }) });
  h += `<tr class="tr-total"><td>Total</td><td class="r">${fCOP(tot.inv)}</td>` + medios.map(m => `<td class="r">${fCOP(rows.filter(r => r.medio === m).reduce((a, r) => a + r.inv, 0))}</td>`).join('') +
    lpTd(tot) + `<td class="r">${tot.inv ? '100%' : '—'}</td><td class="r"></td><td class="r grp">${fCOP(tot.ppto)}</td>${pc(div(tot.inv, tot.ppto))}</tr>`;
  document.getElementById('brand-body').innerHTML = Object.keys(G).length ? h : '<tr><td colspan="12" class="t-mute" style="padding:16px;text-align:center">Sin inversión en branding ni eventos en el rango</td></tr>';
  return tot;
}
// ── Educación continua (cursos y seminarios: presupuesto aparte, sin CRM) ────
function renderEC(f){
  const rows = EC.filter(r => r.d >= f.desde && r.d <= f.hasta && (!f.medio || r.medio === f.medio));
  const metas = f.medio ? [] : EC_METAS.filter(m => m.per === META_PER);
  const medios = CANAL_ORDER.filter(c => rows.some(r => r.medio === c && r.inv));
  const Ze = () => ({inv:0, lp:0, ppto:0, lm:0, mm:0, med:{}}), G = {};
  const it = (grp, pk) => { const g = G[grp] = G[grp] || {t: Ze(), items: {}}; return [g.t, g.items[pk] = g.items[pk] || Ze()] };
  rows.forEach(r => it(r.grp, r.pk).forEach(x => { x.inv += r.inv; x.lp += r.lp; x.med[r.medio] = (x.med[r.medio] || 0) + r.inv }));
  metas.forEach(m => { const s = share(m, f); if(!s) return; it(m.grp, m.pk).forEach(x => { x.ppto += m.ppto * s; x.lm += m.lm * s; x.mm += m.mm * s }) });
  const tot = Object.values(G).reduce((a, g) => { ['inv','lp','ppto','lm','mm'].forEach(k => a[k] += g.t[k]); Object.entries(g.t.med).forEach(([k, v]) => a.med[k] = (a.med[k] || 0) + v); return a }, Ze());
  const conMm = tot.mm > 0;
  document.getElementById('ec-head').innerHTML = '<tr><th>Modalidad / programa</th><th class="r">Inversión</th>' + medios.map(m => `<th class="r">${CANAL_LBL[m] || m}</th>`).join('') +
    '<th class="r">Leads plat.</th><th class="r">CPL plat.</th><th class="r grp">Meta leads</th><th class="r">Cumpl. leads</th><th class="r">CPL meta</th>' +
    (conMm ? '<th class="r">Meta mat.</th>' : '') + '<th class="r grp">Presupuesto</th><th class="r">Ejecución</th></tr>';
  const pc = v => `<td class="r ${cls(v)}">${fP(v)}</td>`;
  const cplCls = x => { const c = div(x.inv, x.lp), m = div(x.ppto, x.lm); return c === null || !m ? '' : c <= m ? 't-pos' : c <= m * 1.25 ? 't-mid' : 't-neg' };
  const fila = (cl, lab, x) => `<tr class="${cl}"><td>${lab}</td><td class="r">${fCOP(x.inv)}</td>` + medios.map(m => `<td class="r">${fCOP(x.med[m])}</td>`).join('') +
    `<td class="r">${fN(x.lp)}</td><td class="r ${cplCls(x)}">${fCOP(div(x.inv, x.lp))}</td><td class="r grp">${fN(x.lm)}</td>${pc(div(x.lp, x.lm))}<td class="r">${fCOP(div(x.ppto, x.lm))}</td>` +
    (conMm ? `<td class="r">${fN(x.mm)}</td>` : '') + `<td class="r grp">${fCOP(x.ppto)}</td>${pc(div(x.inv, x.ppto))}</tr>`;
  let h = '';
  Object.entries(G).sort((a, b) => b[1].t.inv - a[1].t.inv).forEach(([gk, g]) => {
    h += fila('lv1', esc(gk), g.t);
    Object.entries(g.items).sort((a, b) => b[1].inv - a[1].inv || b[1].ppto - a[1].ppto).forEach(([pk, x]) => { h += fila('lv3', esc(D(pk)), x) }) });
  h += fila('tr-total', 'Total', tot);
  document.getElementById('ec-body').innerHTML = Object.keys(G).length ? h : `<tr><td colspan="12" class="t-mute" style="padding:16px;text-align:center">Sin inversión ni metas de educación continua en el rango${f.medio ? ' (con filtro de medio no se muestran metas)' : ''}</td></tr>`;
}
// ── Pauta vs orgánico y otras fuentes (CRM de todas las fuentes) ─────────────
const FUENTES = ['Pauta', 'Orgánico', 'Otras fuentes'];
const FU_COLOR = {'Pauta':ADC.c.sumi, 'Orgánico':ADC.c.organico, 'Otras fuentes':ADC.c.borde};
const FU_TAG = {'Pauta':'tag-pau', 'Orgánico':'tag-org', 'Otras fuentes':'tag-otr'};
let FUE = [], CHART_FU = null, CHART_FU2 = null, FU_NIV = {};
function renderFuentes(f, enR){
  const rows = FUE.filter(r => enR(r, f)), Zf = () => ({lc:0, mat:0});
  const T = {}, MES = {}; FU_NIV = {};
  FUENTES.forEach(k => T[k] = Zf());
  rows.forEach(r => { const m = r.d.slice(0,7); MES[m] = MES[m] || Object.fromEntries(FUENTES.map(k => [k, Zf()]));
    [T[r.fu], MES[m][r.fu]].forEach(x => { x.lc += r.lc; x.mat += r.mat });
    const n = FU_NIV[r.niv] = FU_NIV[r.niv] || Object.fromEntries(FUENTES.map(k => [k, Zf()])); n[r.fu].lc += r.lc; n[r.fu].mat += r.mat });
  const tl = FUENTES.reduce((a, k) => a + T[k].lc, 0), tm = FUENTES.reduce((a, k) => a + T[k].mat, 0);
  const it = (l, v, c) => `<div><div class="nm-label">${l}</div><div class="nm-value ${c||''}">${v}</div></div>`;
  document.getElementById('fuente-cards').innerHTML = FUENTES.map(k => `<div class="card nivel-card"><span class="nivel-tag ${FU_TAG[k]}">${k}</span><div class="nm-grid">
    ${it('Leads CRM', fN(T[k].lc))}${it('% de los leads', fP(div(T[k].lc, tl)))}${it('Matrículas', fN(T[k].mat))}${it('% de las matrículas', fP(div(T[k].mat, tm)))}
    ${it('Conversión', fP(div(T[k].mat, T[k].lc)))}</div></div>`).join('');
  const ks = Object.keys(MES).sort(), MESES_C = ks.map(k => MESES[+k.slice(5,7)].replace(/^./, c => c.toUpperCase()) + ' ' + k.slice(0,4));
  document.getElementById('fu-head').innerHTML = '<tr><th>Mes</th>' + FUENTES.map(k => `<th class="r grp">Leads ${k.toLowerCase()}</th><th class="r">Matrículas</th><th class="r">Conversión</th>`).join('') + '<th class="r grp">% leads de pauta</th></tr>';
  const tr = (lab, x, tot) => `<tr${tot ? ' class="tr-total"' : ''}><td>${lab}</td>` + FUENTES.map(k => `<td class="r grp">${fN(x[k].lc)}</td><td class="r">${fN(x[k].mat)}</td><td class="r">${fP(div(x[k].mat, x[k].lc))}</td>`).join('') +
    `<td class="r grp">${fP(div(x['Pauta'].lc, FUENTES.reduce((a, k) => a + x[k].lc, 0)))}</td></tr>`;
  document.getElementById('fu-body').innerHTML = ks.slice().reverse().map((k, i) => tr(MESES_C[ks.length - 1 - i], MES[k])).join('') + tr('Total', T, true);
  const base = { responsive:true, maintainAspectRatio:false, interaction:{mode:'index', intersect:false}, plugins:{ legend:{position:'bottom'} } };
  if(CHART_FU) CHART_FU.destroy(); if(CHART_FU2) CHART_FU2.destroy();
  CHART_FU = new Chart(document.getElementById('chart-fu'), { type:'bar', data:{ labels: MESES_C, datasets: FUENTES.map(k => ({ label: k, data: ks.map(m => MES[m][k].lc), backgroundColor: FU_COLOR[k], stack:'leads', maxBarThickness:36 })) },
    options:{ ...base, plugins:{ ...base.plugins, tooltip:{callbacks:{label: c => c.dataset.label + ': ' + fN(c.raw)}} },
      scales:{ x:{stacked:true, grid:{display:false}, ticks:{maxRotation:0, autoSkip:true}}, y:{stacked:true, beginAtZero:true, border:{display:false}, ticks:{maxTicksLimit:5}} } } });
  CHART_FU2 = new Chart(document.getElementById('chart-fu2'), { type:'line', data:{ labels: MESES_C, datasets: FUENTES.map(k => ({ label: k, data: ks.map(m => MES[m][k].lc ? MES[m][k].mat / MES[m][k].lc * 100 : null), borderColor: FU_COLOR[k], backgroundColor: FU_COLOR[k], tension:.25, spanGaps:true, pointRadius: ks.length < 4 ? 4 : 0, borderWidth: k === 'Pauta' ? 3 : 2 })) },
    options:{ ...base, plugins:{ ...base.plugins, tooltip:{callbacks:{label: c => c.dataset.label + ': ' + (c.raw === null ? '—' : c.raw.toLocaleString('es-CO', {maximumFractionDigits:1}) + '%')}} },
      scales:{ x:{grid:{display:false}, ticks:{maxRotation:0, autoSkip:true}}, y:{beginAtZero:true, border:{display:false}, ticks:{maxTicksLimit:5, callback: v => v + '%'}} } } });
}
// fila extra de las tarjetas por nivel
function tog(id){
  OPEN[id] = !OPEN[id]; const ic = document.getElementById('t-' + id); if(ic) ic.classList.toggle('open', OPEN[id]);
  document.querySelectorAll(`tr[data-p="${id}"]`).forEach(tr => {
    tr.classList.toggle('hidden', !OPEN[id]);
    if(tr.classList.contains('lv2')){ const sub = tr.querySelector('.tog').id.slice(2);
      document.querySelectorAll(`tr[data-p="${sub}"]`).forEach(x => x.classList.toggle('hidden', !(OPEN[id] && OPEN[sub]))) } });
}
function expandAll(on){ document.querySelectorAll('#det-body .tog').forEach(t => OPEN[t.id.slice(2)] = on); renderDetalle() }

load();
