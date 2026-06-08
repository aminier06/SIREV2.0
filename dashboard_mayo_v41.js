/*
 * dashboard_mayo_v41.js — v5 corregido
 * Carga los CSV publicados de mayo, espera a que el dashboard haya terminado
 * loadData()/init(), inyecta los registros en los arreglos ya existentes y
 * reconstruye los filtros sin envolver apply() ni provocar recursión.
 */
(function () {
  'use strict';

  const URL_CICLO1 = 'https://docs.google.com/spreadsheets/d/e/2PACX-1vSgWQ4GaAwm8gCAkOUU47IM_M0EneHHDg774yY1QfmuZeXyV0VXFJfeO752SP0yhDfVNCvZILpLpHTc/pub?output=csv';
  const URL_CICLO2 = 'https://docs.google.com/spreadsheets/d/e/2PACX-1vSE7lqSqf1Ugps--yciQGl9iXDwcuRXq7DmPolyClxNqtILprSaixafW7j_gFOq_tmePtoY-hpUj6XH/pub?output=csv';

  const AREA_MAP = {
    'LE': 'Lengua Española',
    'LT': 'Lengua Española',
    'MA': 'Matemática',
    'CS': 'Ciencias Sociales',
    'CN': 'Ciencias de la Naturaleza'
  };

  const READ_LEVEL_MAP = {
    'N1': 'Lector de imágenes',
    'N2': 'Lector de sílabas',
    'N3': 'Lector de palabras',
    'N4': 'Lector no fluido',
    'N5': 'Lector fluido'
  };

  const PERF_LEVEL_MAP = {
    'E': 'Elemental',
    'A': 'Aceptable',
    'S': 'Satisfactorio'
  };

  const PERIODO = 'Mayo';

  function normalizeHeader(value) {
    return String(value || '')
      .replace(/\uFEFF/g, '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .trim()
      .toLowerCase();
  }

  function normalizePeriod(value) {
    const t = String(value || '')
      .replace(/\uFEFF/g, '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .trim()
      .toLowerCase();

    if (!t) return PERIODO;
    if (t.includes('may')) return 'Mayo';
    if (t.includes('mar')) return 'Marzo';
    if (t.includes('nov')) return 'Noviembre';
    if (t.includes('sept') || t.includes('set')) return 'Septiembre';
    return String(value || PERIODO).trim();
  }

  function parseCSV(text) {
    const clean = String(text || '').replace(/^\uFEFF/, '').trim();
    if (!clean) return [];
    if (clean.startsWith('<')) {
      throw new Error('Google devolvió HTML en lugar de CSV. Revise que la publicación sea como CSV.');
    }

    const result = [];
    let row = [];
    let cur = '';
    let inq = false;

    for (let i = 0; i < clean.length; i++) {
      const c = clean[i];

      if (c === '"') {
        if (inq && clean[i + 1] === '"') {
          cur += '"';
          i++;
        } else {
          inq = !inq;
        }
      } else if (c === ',' && !inq) {
        row.push(cur.trim());
        cur = '';
      } else if ((c === '\n' || c === '\r') && !inq) {
        if (c === '\r' && clean[i + 1] === '\n') i++;
        row.push(cur.trim());
        if (row.some(v => v !== '')) result.push(row);
        row = [];
        cur = '';
      } else {
        cur += c;
      }
    }

    row.push(cur.trim());
    if (row.some(v => v !== '')) result.push(row);
    return result;
  }

  function gradeFromHeader(h) {
    const m = String(h || '').match(/^G(\d)/i);
    return m ? parseInt(m[1], 10) : null;
  }

  function areaCodeFromHeader(h) {
    const m = String(h || '').match(/^G\d-([A-Z]+)-/i);
    return m ? m[1].toUpperCase() : null;
  }

  function indCodeFromHeader(h) {
    const m = String(h || '').match(/-(IND[\d.]+)\s*\(/i);
    return m ? m[1].toUpperCase() : null;
  }

  function perfLevelFromHeader(h) {
    const m = String(h || '').match(/\(([EAS])\)\s*$/i);
    return m ? m[1].toUpperCase() : null;
  }

  function readLevelFromHeader(h) {
    const m = String(h || '').match(/-(N\d)\s*\(/i);
    return m ? m[1].toUpperCase() : null;
  }

  function compFromInd(ind) {
    if (!ind) return '';
    const m = String(ind).match(/IND(\d+)/i);
    return m ? 'Competencia ' + m[1] : ind;
  }

  function parseHeader(h) {
    h = String(h || '').trim();
    const hl = normalizeHeader(h);

    if (hl === 'codigo sigerd') return { type: 'meta', key: 'sigerd' };
    if (hl === 'regional') return { type: 'meta', key: 'regional' };
    if (hl === 'distrito educativo' || hl === 'distrito') return { type: 'meta', key: 'distrito' };
    if (hl === 'centro educativo' || hl === 'centro') return { type: 'meta', key: 'centro' };
    if (hl === 'sector') return { type: 'meta', key: 'sector' };
    if (hl === 'tipo de centro') return { type: 'meta', key: 'tipo' };
    if (hl === 'tanda') return { type: 'meta', key: 'tanda' };
    if (hl === 'periodo' || hl === 'mes') return { type: 'periodo' };

    const mmat = h.match(/^Matr[ií]cula\s+(\d)/i);
    if (mmat) return { type: 'matricula', grade: parseInt(mmat[1], 10) };

    const mev = h.match(/^EVALUADOS\s+(\d)/i);
    if (mev) return { type: 'evaluados', grade: parseInt(mev[1], 10) };

    const readLv = readLevelFromHeader(h);
    if (readLv && h.match(/^G\d-LT-N/i)) {
      return { type: 'read', grade: gradeFromHeader(h), level: READ_LEVEL_MAP[readLv] || readLv };
    }

    const perfLv = perfLevelFromHeader(h);
    if (perfLv) {
      const grade = gradeFromHeader(h);
      const areaCode = areaCodeFromHeader(h);
      const indCode = indCodeFromHeader(h);
      if (grade && areaCode && indCode) {
        return {
          type: 'perf',
          grade,
          area: AREA_MAP[areaCode] || areaCode,
          comp: compFromInd(indCode),
          ind: indCode,
          level: PERF_LEVEL_MAP[perfLv]
        };
      }
    }

    return { type: 'ignore' };
  }

  function processCiclo(rows) {
    if (!rows || rows.length < 2) {
      return { covRows: [], perfBaseRows: [], perfCompRows: [], perfIndRows: [], readRows: [] };
    }

    const headers = rows[0].map(parseHeader);
    const dataRows = rows.slice(1).filter(r => r && r.some(v => String(v || '').trim() !== ''));

    const covRows = [];
    const perfBaseRows = [];
    const perfCompRows = [];
    const perfIndRows = [];
    const readRows = [];

    for (const row of dataRows) {
      const meta = {};

      for (let i = 0; i < headers.length; i++) {
        const hd = headers[i];
        if (hd.type === 'meta') meta[hd.key] = row[i] || '';
        if (hd.type === 'periodo') meta.periodo = normalizePeriod(row[i]);
      }

      const periodo = normalizePeriod(meta.periodo || PERIODO);
      const regional = meta.regional || '';
      const distrito = meta.distrito || '';
      const centro = meta.centro || '';
      const sector = meta.sector || '';
      const tipo = meta.tipo || '';
      const tanda = meta.tanda || '';

      const grades = new Set();

      for (let i = 0; i < headers.length; i++) {
        const hd = headers[i];
        if ((hd.type === 'matricula' || hd.type === 'evaluados') && hd.grade) grades.add(hd.grade);
      }

      for (const grade of grades) {
        let mat = 0;
        let ev = 0;

        for (let i = 0; i < headers.length; i++) {
          const val = parseFloat(String(row[i] || '').replace(',', '.')) || 0;
          if (headers[i].type === 'matricula' && headers[i].grade === grade) mat += val;
          if (headers[i].type === 'evaluados' && headers[i].grade === grade) ev += val;
        }

        if (mat > 0 || ev > 0) {
          covRows.push([regional, distrito, centro, sector, tipo, tanda, periodo, grade, '', mat, ev]);
        }
      }

      const readMap = {};
      for (let i = 0; i < headers.length; i++) {
        const hd = headers[i];
        if (hd.type === 'read') {
          const val = parseFloat(String(row[i] || '').replace(',', '.')) || 0;
          const k = hd.grade + '|' + hd.level;
          readMap[k] = (readMap[k] || 0) + val;
        }
      }

      for (const [k, val] of Object.entries(readMap)) {
        if (!val) continue;
        const [g, level] = k.split('|');
        readRows.push([regional, distrito, centro, sector, tipo, tanda, periodo, parseInt(g, 10), '', level, val]);
      }

      const bm = {};
      const cm = {};
      const im = {};

      for (let i = 0; i < headers.length; i++) {
        const hd = headers[i];
        if (hd.type !== 'perf') continue;

        const val = parseFloat(String(row[i] || '').replace(',', '.')) || 0;
        if (!val) continue;

        const kb = [hd.grade, hd.area, hd.level].join('|');
        const kc = [hd.grade, hd.area, hd.comp, hd.level].join('|');
        const ki = [hd.grade, hd.area, hd.comp, hd.ind, hd.level].join('|');

        bm[kb] = (bm[kb] || 0) + val;
        cm[kc] = (cm[kc] || 0) + val;
        im[ki] = (im[ki] || 0) + val;
      }

      for (const [k, val] of Object.entries(bm)) {
        const [g, area, level] = k.split('|');
        perfBaseRows.push([regional, distrito, centro, sector, tipo, tanda, periodo, parseInt(g, 10), '', area, '', '', level, val]);
      }

      for (const [k, val] of Object.entries(cm)) {
        const [g, area, comp, level] = k.split('|');
        perfCompRows.push([regional, distrito, centro, sector, tipo, tanda, periodo, parseInt(g, 10), '', area, comp, '', level, val]);
      }

      for (const [k, val] of Object.entries(im)) {
        const [g, area, comp, ind, level] = k.split('|');
        perfIndRows.push([regional, distrito, centro, sector, tipo, tanda, periodo, parseInt(g, 10), '', area, comp, ind, level, val]);
      }
    }

    return { covRows, perfBaseRows, perfCompRows, perfIndRows, readRows };
  }

  async function fetchCiclo(url, num) {
    try {
      const glue = url.includes('?') ? '&' : '?';
      const resp = await fetch(url + glue + 'cache=' + Date.now());
      if (!resp.ok) throw new Error('HTTP ' + resp.status);

      const text = await resp.text();
      return processCiclo(parseCSV(text));
    } catch (e) {
      console.warn('[SIREV Mayo] Error ciclo ' + num + ':', e.message);
      return { covRows: [], perfBaseRows: [], perfCompRows: [], perfIndRows: [], readRows: [] };
    }
  }

  function getDataObject() {
    if (window.DATA && window.DATA.cov) return window.DATA;
    try {
      if (typeof DATA !== 'undefined' && DATA && DATA.cov) return DATA;
    } catch (e) {}
    return null;
  }

  function selectorListo() {
    const sel = document.getElementById('fPeriodo');
    return !!(sel && sel.options && sel.options.length >= 1);
  }

  function waitForDashboardReady() {
    return new Promise((resolve, reject) => {
      const start = Date.now();
      const id = setInterval(() => {
        const data = getDataObject();
        if (data && data.cov && selectorListo() && typeof window.apply === 'function') {
          clearInterval(id);
          resolve(data);
        } else if (Date.now() - start > 30000) {
          clearInterval(id);
          reject(new Error('Timeout esperando que el dashboard cargue DATA/init()'));
        }
      }, 120);
    });
  }

  function removePreviousMayo(data) {
    // Evita duplicados si el navegador ejecuta el módulo más de una vez por caché o recarga parcial.
    const notMayoByPeriod = r => {
      const p = String((typeof idText === 'function' ? idText(r[6]) : r[6]) || '').trim();
      return p !== 'Mayo';
    };

    if (Array.isArray(data.perf_base)) data.perf_base = data.perf_base.filter(notMayoByPeriod);
    if (Array.isArray(data.perf_comp)) data.perf_comp = data.perf_comp.filter(notMayoByPeriod);
    if (Array.isArray(data.read)) data.read = data.read.filter(notMayoByPeriod);
    if (Array.isArray(data.cov)) data.cov = data.cov.filter(notMayoByPeriod);

    try {
      PERF_BASE = data.perf_base;
      PERF_COMP = data.perf_comp;
      READ = data.read;
      COV = data.cov;
      window.PERF_BASE = PERF_BASE;
      window.PERF_COMP = PERF_COMP;
      window.READ = READ;
      window.COV = COV;
    } catch (e) {
      console.warn('[SIREV Mayo] No se pudieron resincronizar arreglos después de limpiar mayo:', e.message);
    }
  }



  function appendRows(target, rows) {
    if (!Array.isArray(target) || !Array.isArray(rows) || !rows.length) return;
    // Evita RangeError: Maximum call stack size exceeded por usar push(...rows)
    // cuando el CSV de mayo genera muchos registros.
    for (let i = 0; i < rows.length; i++) target.push(rows[i]);
  }

  function syncDashboardArrays(data) {
    try {
      PERF_BASE = data.perf_base;
      PERF_COMP = data.perf_comp;
      READ = data.read;
      COV = data.cov;
      window.DATA = data;
      window.PERF_BASE = PERF_BASE;
      window.PERF_COMP = PERF_COMP;
      window.READ = READ;
      window.COV = COV;
    } catch (e) {
      console.warn('[SIREV Mayo] No se pudieron resincronizar arreglos:', e.message);
    }
  }

  async function integrarMayo() {
    if (window.__SIREV_MAYO_INTEGRATING__) return;
    window.__SIREV_MAYO_INTEGRATING__ = true;

    let data;

    try {
      data = await waitForDashboardReady();
    } catch (e) {
      console.warn('[SIREV Mayo]', e.message);
      window.__SIREV_MAYO_INTEGRATING__ = false;
      return;
    }

    console.info('[SIREV Mayo] Dashboard listo. Cargando CSVs...');

    const [p1, p2] = await Promise.all([
      fetchCiclo(URL_CICLO1, 1),
      fetchCiclo(URL_CICLO2, 2)
    ]);

    const covRows = p1.covRows.concat(p2.covRows);
    const perfBaseRows = p1.perfBaseRows.concat(p2.perfBaseRows);
    const perfCompRows = p1.perfCompRows.concat(p2.perfCompRows);
    const perfIndRows = p1.perfIndRows.concat(p2.perfIndRows);
    const readRows = p1.readRows.concat(p2.readRows);

    if (!covRows.length && !perfBaseRows.length && !readRows.length) {
      console.warn('[SIREV Mayo] CSVs vacíos o sin datos válidos.');
      window.__SIREV_MAYO_INTEGRATING__ = false;
      return;
    }

    removePreviousMayo(data);

    appendRows(data.perf_base, perfBaseRows);
    appendRows(data.perf_comp, perfCompRows);
    appendRows(data.read, readRows);
    appendRows(data.cov, covRows);
    syncDashboardArrays(data);

    // PERF_IND se carga bajo demanda. Si ya existe, agregamos mayo; si no, lo guardamos pendiente.
    try {
      if (Array.isArray(PERF_IND)) {
        const notMayoByPeriod = r => {
          const p = String((typeof idText === 'function' ? idText(r[6]) : r[6]) || '').trim();
          return p !== 'Mayo';
        };
        PERF_IND = PERF_IND.filter(notMayoByPeriod);
        appendRows(PERF_IND, perfIndRows);
      } else {
        window.__SIREV_MAYO_PERF_IND_PENDING__ = perfIndRows;
        if (!window.__SIREV_MAYO_PATCHED_ENSURE__) {
          const originalEnsure = window.ensureIndLoaded;
          if (typeof originalEnsure === 'function') {
            window.ensureIndLoaded = function () {
              const ok = originalEnsure.call(this);
              try {
                if (ok && Array.isArray(PERF_IND) && window.__SIREV_MAYO_PERF_IND_PENDING__ && window.__SIREV_MAYO_PERF_IND_PENDING__.length) {
                  const pending = window.__SIREV_MAYO_PERF_IND_PENDING__;
                  window.__SIREV_MAYO_PERF_IND_PENDING__ = [];
                  appendRows(PERF_IND, pending);
                }
              } catch (e) {
                console.warn('[SIREV Mayo] No se pudo anexar detalle de indicadores:', e.message);
              }
              return ok;
            };
            window.__SIREV_MAYO_PATCHED_ENSURE__ = true;
          }
        }
      }
    } catch (e) {
      console.warn('[SIREV Mayo] No se pudo preparar detalle por indicador:', e.message);
    }

    console.info('[SIREV Mayo] Inyectados — COV:', covRows.length, '| PerfBase:', perfBaseRows.length, '| Read:', readRows.length);

    try {
      if (typeof selectedPeriod !== 'undefined') {
        const av = typeof availablePeriods === 'function' ? availablePeriods() : [];
        // Al finalizar la inyección de mayo, dejar Mayo como periodo predeterminado
        // en la carga inicial del dashboard. Antes aparecía Marzo porque init() corría
        // antes de que los CSV de mayo terminaran de integrarse.
        selectedPeriod = av.includes('Mayo') ? 'Mayo' : (av[av.length - 1] || '__ALL__');
      }
      if (typeof buildPeriodButtons === 'function') buildPeriodButtons();
      if (typeof rebuildGradoOptions === 'function') rebuildGradoOptions();

      // Reconstruir los dropdowns territoriales (Regional, Distrito, Sector,
      // Tipo, Tanda) para incluir los valores que solo existen en Mayo.
      // Sin este paso, distritos como "04-04 Villa Altagracia" que no tienen
      // datos en periodos anteriores nunca aparecen en el <select> y el
      // filtro no devuelve resultados aunque los datos estén en COV.
      if (typeof fill === 'function' && typeof idText === 'function' && Array.isArray(COV)) {
        const prevReg   = document.getElementById('fRegional') ? document.getElementById('fRegional').value   : '';
        const prevDist  = document.getElementById('fDistrito') ? document.getElementById('fDistrito').value   : '';
        const prevSec   = document.getElementById('fSector')   ? document.getElementById('fSector').value     : '';
        const prevTipo  = document.getElementById('fTipo')     ? document.getElementById('fTipo').value       : '';
        const prevTanda = document.getElementById('fTanda')    ? document.getElementById('fTanda').value      : '';

        fill('fRegional', COV.map(r => idText(r[0])), 'Todas las regionales');
        fill('fDistrito', COV.map(r => idText(r[1])), 'Todos los distritos');
        fill('fSector',   COV.map(r => idText(r[3])), 'Todos los sectores');
        fill('fTipo',     COV.map(r => idText(r[4])), 'Todos los tipos');
        fill('fTanda',    COV.map(r => idText(r[5])), 'Todas las tandas');

        // Restaurar selecciones previas del usuario si siguen siendo válidas
        const setIfOption = (id, val) => {
          if (!val) return;
          const sel = document.getElementById(id);
          if (sel && [...sel.options].some(o => o.value === val)) sel.value = val;
        };
        setIfOption('fRegional', prevReg);
        setIfOption('fDistrito', prevDist);
        setIfOption('fSector',   prevSec);
        setIfOption('fTipo',     prevTipo);
        setIfOption('fTanda',    prevTanda);
      }

      if (typeof rebuildDependentFilters === 'function') rebuildDependentFilters();
      if (typeof window.apply === 'function') window.apply();
    } catch (e) {
      console.warn('[SIREV Mayo] No se pudo refrescar la interfaz:', e.message);
    } finally {
      window.__SIREV_MAYO_READY__ = true;
      window.__SIREV_MAYO_INTEGRATING__ = false;
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', integrarMayo);
  } else {
    setTimeout(integrarMayo, 0);
  }

  console.info('[SIREV Mayo] Módulo v6 registrado.');
})();
