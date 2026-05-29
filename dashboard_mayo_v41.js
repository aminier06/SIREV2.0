/*
 * dashboard_mayo_v41.js  — v2
 * Integración de datos de Mayo desde Google Sheets CSV.
 * Estrategia: espera a que DATA esté listo y luego inyecta directamente,
 * sin depender de parchear loadData.
 */
(function () {
  'use strict';

  const URL_CICLO1 = 'https://docs.google.com/spreadsheets/d/e/2PACX-1vSgWQ4GaAwm8gCAkOUU47IM_M0EneHHDg774yY1QfmuZeXyV0VXFJfeO752SP0yhDfVNCvZILpLpHTc/pub?output=csv';
  const URL_CICLO2 = 'https://docs.google.com/spreadsheets/d/e/2PACX-1vSE7lqSqf1Ugps--yciQGl9iXDwcuRXq7DmPolyClxNqtILprSaixafW7j_gFOq_tmePtoY-hpUj6XH/pub?output=csv';

  const AREA_MAP = { 'LE':'Lengua Española','LT':'Lengua Española','MA':'Matemática','CS':'Ciencias Sociales','CN':'Ciencias de la Naturaleza' };
  const READ_LEVEL_MAP = { 'N1':'Lector de imágenes','N2':'Lector de sílabas','N3':'Lector de palabras','N4':'Lector no fluido','N5':'Lector fluido' };
  const PERF_LEVEL_MAP = { 'E':'Elemental','A':'Aceptable','S':'Satisfactorio' };
  const PERIODO = 'Mayo';

  function parseCSV(text) {
    const lines = text.trim().split(/\r?\n/);
    const result = [];
    for (const line of lines) {
      const row = []; let cur = '', inq = false;
      for (let i = 0; i < line.length; i++) {
        const c = line[i];
        if (c === '"') { if (inq && line[i+1]==='"'){cur+='"';i++;}else inq=!inq; }
        else if (c === ',' && !inq) { row.push(cur.trim()); cur = ''; }
        else cur += c;
      }
      row.push(cur.trim());
      result.push(row);
    }
    return result;
  }

  function gradeFromHeader(h)   { const m=h.match(/^G(\d)/); return m?parseInt(m[1]):null; }
  function areaCodeFromHeader(h){ const m=h.match(/^G\d-([A-Z]+)-/); return m?m[1]:null; }
  function indCodeFromHeader(h) { const m=h.match(/-(IND[\d.]+)\s*\(/); return m?m[1]:null; }
  function perfLevelFromHeader(h){ const m=h.match(/\(([EAS])\)\s*$/); return m?m[1]:null; }
  function readLevelFromHeader(h){ const m=h.match(/-(N\d)\s*\(/); return m?m[1]:null; }
  function compFromInd(indCode) { if(!indCode)return ''; const m=indCode.match(/IND(\d)/); return m?'Competencia '+m[1]:indCode; }

  function parseHeader(h) {
    h = h.trim();
    const hl = h.toLowerCase();
    if (hl==='código sigerd'||hl==='codigo sigerd') return {type:'meta',key:'sigerd'};
    if (hl==='regional')           return {type:'meta',key:'regional'};
    if (hl==='distrito educativo') return {type:'meta',key:'distrito'};
    if (hl==='centro educativo')   return {type:'meta',key:'centro'};
    if (hl==='sector')             return {type:'meta',key:'sector'};
    if (hl==='tipo de centro')     return {type:'meta',key:'tipo'};
    if (hl==='tanda')              return {type:'meta',key:'tanda'};
    if (hl==='periodo')            return {type:'periodo'};
    const mmat = h.match(/^Matr[ií]cula\s+(\d)/i);
    if (mmat) return {type:'matricula',grade:parseInt(mmat[1])};
    const mev = h.match(/^EVALUADOS\s+(\d)/i);
    if (mev) return {type:'evaluados',grade:parseInt(mev[1])};
    const readLv = readLevelFromHeader(h);
    if (readLv && h.match(/^G\d-LT-N/i)) {
      return {type:'read',grade:gradeFromHeader(h),level:READ_LEVEL_MAP[readLv]||readLv};
    }
    const perfLv = perfLevelFromHeader(h);
    if (perfLv) {
      const grade=gradeFromHeader(h), areaCode=areaCodeFromHeader(h), indCode=indCodeFromHeader(h);
      if (grade&&areaCode&&indCode) return {type:'perf',grade,area:AREA_MAP[areaCode]||areaCode,comp:compFromInd(indCode),ind:indCode,level:PERF_LEVEL_MAP[perfLv]};
    }
    return {type:'ignore'};
  }

  function processCiclo(rows) {
    if (rows.length < 2) return {covRows:[],perfBaseRows:[],perfCompRows:[],perfIndRows:[],readRows:[]};
    const headers = rows[0].map(parseHeader);
    const dataRows = rows.slice(1).filter(r=>r.some(v=>v!==''));
    const covRows=[],perfBaseRows=[],perfCompRows=[],perfIndRows=[],readRows=[];

    for (const row of dataRows) {
      const meta = {};
      for (let i=0;i<headers.length;i++) {
        if (headers[i].type==='meta')    meta[headers[i].key]=row[i]||'';
        if (headers[i].type==='periodo') meta.periodo=row[i]||PERIODO;
      }
      const periodo=meta.periodo||PERIODO, regional=meta.regional||'', distrito=meta.distrito||'';
      const centro=meta.centro||'', sector=meta.sector||'', tipo=meta.tipo||'', tanda=meta.tanda||'';

      // Cobertura por grado
      const grades=new Set();
      for (let i=0;i<headers.length;i++) {
        const hd=headers[i];
        if ((hd.type==='matricula'||hd.type==='evaluados')&&hd.grade) grades.add(hd.grade);
      }
      for (const grade of grades) {
        let mat=0,ev=0;
        for (let i=0;i<headers.length;i++) {
          const val=parseFloat(row[i])||0;
          if (headers[i].type==='matricula'&&headers[i].grade===grade) mat+=val;
          if (headers[i].type==='evaluados'&&headers[i].grade===grade) ev+=val;
        }
        if (mat>0||ev>0) covRows.push([regional,distrito,centro,sector,tipo,tanda,periodo,grade,'',mat,ev]);
      }

      // Lectura
      const readMap={};
      for (let i=0;i<headers.length;i++) {
        const hd=headers[i];
        if (hd.type==='read') { const key=hd.grade+'|'+hd.level; readMap[key]=(readMap[key]||0)+(parseFloat(row[i])||0); }
      }
      for (const [key,val] of Object.entries(readMap)) {
        if (!val) continue;
        const [gradeStr,level]=key.split('|');
        readRows.push([regional,distrito,centro,sector,tipo,tanda,periodo,parseInt(gradeStr),'',level,val]);
      }

      // Desempeño
      const perfBaseMap={},perfCompMap={},perfIndMap={};
      for (let i=0;i<headers.length;i++) {
        const hd=headers[i];
        if (hd.type==='perf') {
          const val=parseFloat(row[i])||0; if(!val) continue;
          const kb=[hd.grade,hd.area,hd.level].join('|');
          perfBaseMap[kb]=(perfBaseMap[kb]||0)+val;
          const kc=[hd.grade,hd.area,hd.comp,hd.level].join('|');
          perfCompMap[kc]=(perfCompMap[kc]||0)+val;
          const ki=[hd.grade,hd.area,hd.comp,hd.ind,hd.level].join('|');
          perfIndMap[ki]=(perfIndMap[ki]||0)+val;
        }
      }
      for (const [key,val] of Object.entries(perfBaseMap)) {
        if (!val) continue;
        const [gradeStr,area,level]=key.split('|');
        perfBaseRows.push([regional,distrito,centro,sector,tipo,tanda,periodo,parseInt(gradeStr),'',area,'','',level,val]);
      }
      for (const [key,val] of Object.entries(perfCompMap)) {
        if (!val) continue;
        const [gradeStr,area,comp,level]=key.split('|');
        perfCompRows.push([regional,distrito,centro,sector,tipo,tanda,periodo,parseInt(gradeStr),'',area,comp,'',level,val]);
      }
      for (const [key,val] of Object.entries(perfIndMap)) {
        if (!val) continue;
        const [gradeStr,area,comp,ind,level]=key.split('|');
        perfIndRows.push([regional,distrito,centro,sector,tipo,tanda,periodo,parseInt(gradeStr),'',area,comp,ind,level,val]);
      }
    }
    return {covRows,perfBaseRows,perfCompRows,perfIndRows,readRows};
  }

  async function fetchCiclo(url, num) {
    try {
      const resp = await fetch(url);
      if (!resp.ok) throw new Error('HTTP '+resp.status);
      const text = await resp.text();
      return processCiclo(parseCSV(text));
    } catch(e) {
      console.warn('[SIREV Mayo] Error cargando ciclo '+num+':', e.message);
      return {covRows:[],perfBaseRows:[],perfCompRows:[],perfIndRows:[],readRows:[]};
    }
  }

  // Espera a que DATA esté disponible (poll cada 100ms, máx 20s)
  function waitForData() {
    return new Promise((resolve, reject) => {
      const start = Date.now();
      const id = setInterval(() => {
        if (window.DATA && window.DATA.cov && window.COV && window.PERF_BASE && window.READ) {
          clearInterval(id); resolve();
        } else if (Date.now()-start > 20000) {
          clearInterval(id); reject(new Error('Timeout esperando DATA'));
        }
      }, 100);
    });
  }

  async function integrarMayo() {
    console.info('[SIREV Mayo] Esperando datos base...');
    try {
      await waitForData();
    } catch(e) {
      console.warn('[SIREV Mayo] '+e.message); return;
    }

    console.info('[SIREV Mayo] Cargando CSVs de Mayo...');
    const [p1, p2] = await Promise.all([fetchCiclo(URL_CICLO1,1), fetchCiclo(URL_CICLO2,2)]);

    const covRows      = [...p1.covRows,      ...p2.covRows];
    const perfBaseRows = [...p1.perfBaseRows, ...p2.perfBaseRows];
    const perfCompRows = [...p1.perfCompRows, ...p2.perfCompRows];
    const perfIndRows  = [...p1.perfIndRows,  ...p2.perfIndRows];
    const readRows     = [...p1.readRows,     ...p2.readRows];

    if (!covRows.length && !perfBaseRows.length) {
      console.warn('[SIREV Mayo] No se obtuvieron datos.'); return;
    }

    // Inyectar en las estructuras globales
    window.DATA.perf_base.push(...perfBaseRows);
    window.DATA.perf_comp.push(...perfCompRows);
    window.DATA.read.push(...readRows);
    window.DATA.cov.push(...covRows);

    // Sincronizar variables globales
    window.PERF_BASE = window.DATA.perf_base;
    window.PERF_COMP = window.DATA.perf_comp;
    window.READ      = window.DATA.read;
    window.COV       = window.DATA.cov;

    // Guardar PERF_IND pendiente para inyectar cuando se cargue bajo demanda
    window._MAYO_PERF_IND = perfIndRows;
    const _origEnsure = window.ensureIndLoaded;
    window.ensureIndLoaded = function() {
      const ok = _origEnsure.call(this);
      if (ok && window._MAYO_PERF_IND && window._MAYO_PERF_IND.length) {
        window.PERF_IND.push(...window._MAYO_PERF_IND);
        window._MAYO_PERF_IND = [];
      }
      return ok;
    };

    console.info('[SIREV Mayo] Inyectados — COV:', covRows.length, '| PerfBase:', perfBaseRows.length, '| Read:', readRows.length);

    // Re-renderizar
    if (typeof window.buildPeriodButtons === 'function') buildPeriodButtons();
    if (typeof window.setupFilters       === 'function') setupFilters();
    if (typeof window.apply              === 'function') apply();
  }

  // Arrancar después de que la página cargue
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', integrarMayo);
  } else {
    // DOM ya listo, esperar un tick para que loadData arranque primero
    setTimeout(integrarMayo, 0);
  }

  console.info('[SIREV Mayo] Módulo v2 registrado.');
})();
