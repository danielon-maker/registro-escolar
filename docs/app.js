/* Registro Escolar — frontend (GitHub Pages). Sin dependencias; SheetJS se carga solo al exportar. */
(function () {
  'use strict';
  var CFG = window.APP_CONFIG || {};
  var CAMPOS = Calc.CAMPOS;
  var LS_KEY = 'registro_escolar_sesion';

  var ESTADOS = {
    P: { label: 'Asistió', short: '•' },
    F: { label: 'Faltó', short: '/' },
    R: { label: 'Retardo', short: 'R' },
    J: { label: 'Justif.', short: 'J' }
  };
  var CICLO_ASIS = { P: 'F', F: 'R', R: 'J', J: 'P' };
  var ENTREGA = { 1: { label: '✓ Entregó', cls: 'st-1' }, 0: { label: '✗ No', cls: 'st-0' }, 0.5: { label: '½ Medio', cls: 'st-05' } };
  var CICLO_ENT = { 1: 0, 0: 0.5, 0.5: 1 };

  var S = {
    token: null, user: null, groups: [], grupoId: null, data: null,
    view: 'asistencia', mas: null, periodoId: null, loading: false, dirty: false,
    asis: null, trab: { campo: 'LEN', editing: null }, ex: { tipo: 'trimestral', campo: 'LEN', key: null },
    disc: { key: null }, carga: { concepto: 'ASIS', key: null }, cal: { tab: 'TODOS' }, admin: { users: null }
  };

  var $app = document.getElementById('app');

  // ===================== Utilidades =====================
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function iso(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
  function today() { return iso(new Date()); }
  function addDays(f, n) { var d = new Date(f + 'T12:00:00'); d.setDate(d.getDate() + n); return iso(d); }
  var DIAS = ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb'];
  var MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
  function fmtDate(f) { if (!f) return ''; var d = new Date(f + 'T12:00:00'); return DIAS[d.getDay()] + ' ' + d.getDate() + ' ' + MESES[d.getMonth()]; }
  function fmt1(n) { return n == null || isNaN(n) ? '—' : (Math.round(n * 10) / 10).toFixed(1); }
  function nivel(c) { return c == null ? '' : c < 6.5 ? 'g-bajo' : c < 9 ? 'g-medio' : 'g-alto'; }
  function gradeHtml(c) { return '<span class="g ' + nivel(c) + '">' + fmt1(c) + '</span>'; }
  function campoNombre(id) { return CAMPOS.filter(function (c) { return c.id === id; })[0].nombre; }
  function alumnosActivos() { return S.data ? S.data.alumnos.filter(function (a) { return a.activo; }) : []; }
  function periodo() { return S.data && S.data.periodos.filter(function (p) { return p.id === S.periodoId; })[0]; }
  function periodoDeFecha(f) { return S.data.periodos.filter(function (p) { return f >= p.inicio && f <= p.fin; })[0]; }

  function toast(msg, isError) {
    var t = document.getElementById('toast');
    t.textContent = msg; t.className = 'toast' + (isError ? ' error' : ''); t.hidden = false;
    clearTimeout(toast._t); toast._t = setTimeout(function () { t.hidden = true; }, isError ? 4500 : 2200);
  }

  function openModal(html) { document.getElementById('modal-card').innerHTML = html; document.getElementById('modal').hidden = false; }
  function closeModal() { document.getElementById('modal').hidden = true; }
  document.getElementById('modal').addEventListener('click', function (e) { if (e.target.id === 'modal') closeModal(); });

  function confirmLeave() {
    if (!S.dirty) return true;
    if (confirm('Tienes cambios sin guardar. ¿Salir sin guardar?')) { S.dirty = false; return true; }
    return false;
  }
  window.addEventListener('beforeunload', function (e) { if (S.dirty) { e.preventDefault(); e.returnValue = ''; } });

  // ===================== API =====================
  function api(action, payload, extra) {
    if (!CFG.API_URL || CFG.API_URL.indexOf('http') !== 0) return Promise.reject(new Error('Falta configurar API_URL en config.js'));
    var body = Object.assign({ action: action, token: S.token, payload: payload || {} }, extra || {});
    return fetch(CFG.API_URL, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify(body) })
      .then(function (r) { return r.json(); })
      .catch(function () { throw new Error('Sin conexión con el servidor'); })
      .then(function (j) {
        if (!j.ok) {
          if (j.auth) { clearSession(); render(); }
          throw new Error(j.error || 'Error');
        }
        return j.data;
      });
  }

  function busy(btn, promise, okMsg) {
    var txt = btn ? btn.textContent : '';
    if (btn) { btn.disabled = true; btn.textContent = 'Guardando…'; }
    return promise.then(function (r) {
      if (okMsg) toast(okMsg);
      return r;
    }).catch(function (e) { toast(e.message, true); throw e; })
      .finally(function () { if (btn) { btn.disabled = false; btn.textContent = txt; } });
  }

  function saveSession() { localStorage.setItem(LS_KEY, JSON.stringify({ token: S.token, user: S.user, grupoId: S.grupoId })); }
  function clearSession() { S.groupsLoaded = false; S.token = null; S.user = null; S.data = null; S.grupoId = null; S.dirty = false; localStorage.removeItem(LS_KEY); }

  function loadGroups() {
    return api('listGroups').then(function (g) {
      S.groups = g; S.groupsLoaded = true;
      var visibles = g.filter(function (x) { return x.activo; });
      if (S.grupoId && !g.some(function (x) { return x.id === S.grupoId; })) S.grupoId = null;
      if (!S.grupoId && visibles.length === 1) S.grupoId = visibles[0].id;
    });
  }

  function loadGroupData(silent) {
    if (!S.grupoId) return Promise.resolve();
    if (!silent) { S.loading = true; render(); }
    return api('getGroupData', { grupoId: S.grupoId }).then(function (d) {
      S.data = d;
      if (!S.periodoId || !d.periodos.some(function (p) { return p.id === S.periodoId; })) {
        var p = periodoDeFecha(today()) || d.periodos[d.periodos.length - 1];
        S.periodoId = p ? p.id : null;
      }
      S.loading = false;
      if (!silent) { S.asis = null; S.ex.key = null; S.disc.key = null; S.carga.key = null; }
      render();
    }).catch(function (e) { S.loading = false; toast(e.message, true); render(); });
  }

  function refresh() { return loadGroupData(true); }

  // ===================== Render principal =====================
  function render() {
    if (!S.token) return renderLogin();
    if (!S.groupsLoaded) return renderShell('<div class="loading"><div class="spinner"></div>Cargando…</div>', false);
    if (!S.grupoId || S.view === 'grupos') return renderShell(viewGrupos(), false);
    if (S.loading || !S.data) return renderShell('<div class="loading"><div class="spinner"></div>Cargando grupo…</div>', true);
    var html;
    switch (S.view) {
      case 'asistencia': html = viewAsistencia(); break;
      case 'trabajos': html = viewTrabajos(); break;
      case 'examenes': html = viewExamenes(); break;
      case 'calificaciones': html = viewCalificaciones(); break;
      default: html = viewMas();
    }
    renderShell(html, true);
  }

  function renderShell(content, withNav) {
    var g = S.groups.filter(function (x) { return x.id === S.grupoId; })[0];
    var periodos = S.data && withNav ? S.data.periodos : [];
    var top = '<header class="topbar">' +
      '<div class="title"><b>' + esc(g ? g.nombre : (CFG.NOMBRE_APP || 'Registro Escolar')) + '</b><span>' + esc(S.user.nombre) + (g && g.ciclo ? ' · ' + esc(g.ciclo) : '') + '</span></div>' +
      (periodos.length ? '<select data-change="periodo" aria-label="Periodo">' + periodos.map(function (p) {
        return '<option value="' + p.id + '"' + (p.id === S.periodoId ? ' selected' : '') + '>' + esc(p.nombre) + '</option>';
      }).join('') + '</select>' : '') +
      (S.grupoId && (S.groups.length > 1 || S.user.rol === 'admin') ? '<button class="icon-btn" data-act="cambiar-grupo" title="Cambiar grupo">⇄</button>' : '') +
      '</header>';
    var nav = '';
    if (withNav) {
      var tabs = [['asistencia', '📋', 'Asistencia'], ['trabajos', '📝', 'Trabajos'], ['examenes', '🧪', 'Exámenes'], ['calificaciones', '📊', 'Calificaciones'], ['mas', '☰', 'Más']];
      nav = '<nav class="bottomnav">' + tabs.map(function (t) {
        return '<button data-act="nav" data-v="' + t[0] + '" class="' + (S.view === t[0] ? 'active' : '') + '"><span class="ic">' + t[1] + '</span>' + t[2] + '</button>';
      }).join('') + '</nav>';
    }
    $app.innerHTML = top + '<main>' + content + '</main>' + nav;
  }

  // ===================== Login =====================
  function renderLogin() {
    $app.innerHTML = '<div class="login"><form class="card stack" id="login-form">' +
      '<div class="logo">📚</div><h1>' + esc(CFG.NOMBRE_APP || 'Registro Escolar') + '</h1>' +
      '<p class="muted">Entra con el usuario que te dio el administrador.</p>' +
      '<label class="field"><span>Usuario</span><input type="text" name="usuario" autocomplete="username" autocapitalize="none" required></label>' +
      '<label class="field"><span>Contraseña</span><input type="password" name="password" autocomplete="current-password" required></label>' +
      '<button class="btn primary block" type="submit">Entrar</button></form></div>';
    document.getElementById('login-form').addEventListener('submit', function (e) {
      e.preventDefault();
      var f = e.target, btn = f.querySelector('button');
      btn.disabled = true; btn.textContent = 'Entrando…';
      api('login', null, { usuario: f.usuario.value, password: f.password.value }).then(function (r) {
        S.token = r.token; S.user = r.usuario; S.view = 'asistencia';
        return loadGroups();
      }).then(function () { saveSession(); render(); if (S.grupoId) loadGroupData(); })
        .catch(function (err) { toast(err.message, true); btn.disabled = false; btn.textContent = 'Entrar'; });
    });
  }

  // ===================== Grupos =====================
  function viewGrupos() {
    var gs = S.groups;
    var html = '<h2>Elige un grupo</h2>';
    if (!gs.length) html += '<div class="banner info">Todavía no tienes grupos asignados.' + (S.user.rol === 'admin' ? ' Créalos en Administración.' : ' Pídele al administrador que te asigne uno.') + '</div>';
    html += '<div class="list menu-list">' + gs.map(function (g) {
      return '<div class="item" data-act="elegir-grupo" data-id="' + g.id + '"><span class="ic">🏫</span><div class="name"><b>' + esc(g.nombre) + '</b><small>' + esc(g.ciclo || '') + (g.maestra ? ' · ' + esc(g.maestra) : '') + '</small></div>' + (g.activo ? '' : '<span class="badge off">Inactivo</span>') + '<span>›</span></div>';
    }).join('') + '</div>';
    if (S.user.rol === 'admin') html += '<div style="margin-top:12px" class="list menu-list"><div class="item" data-act="admin-sin-grupo"><span class="ic">🔐</span><div class="name">Administración (usuarios y grupos)</div><span>›</span></div></div>';
    html += '<div style="margin-top:12px"><button class="btn ghost" data-act="logout">Cerrar sesión</button></div>';
    if (S.mas === 'admin' && S.view === 'grupos') html = viewAdmin(true);
    return html;
  }

  // ===================== Asistencia =====================
  function ensureAsis(fecha) {
    fecha = fecha || (S.asis && S.asis.fecha) || today();
    var rec = {};
    S.data.asistencia.forEach(function (r) { if (r[0] === fecha) rec[r[1]] = r[2]; });
    var saved = Object.keys(rec).length > 0;
    var estados = {};
    alumnosActivos().forEach(function (a) { estados[a.id] = rec[a.id] || 'P'; });
    S.asis = { fecha: fecha, estados: estados, saved: saved };
    S.dirty = false;
  }

  function viewAsistencia() {
    if (!S.asis) ensureAsis();
    var A = S.asis, f = A.fecha;
    var sinClase = S.data.diasSinClase.filter(function (d) { return d.fecha === f; })[0];
    var p = periodoDeFecha(f);
    var dow = new Date(f + 'T12:00:00').getDay();

    var html = '<div class="card"><div class="row nowrap">' +
      '<button class="icon-btn" data-act="asis-dia" data-d="-1">‹</button>' +
      '<input type="date" class="grow" value="' + f + '" data-change="asis-fecha">' +
      '<button class="icon-btn" data-act="asis-dia" data-d="1">›</button></div>' +
      '<div class="muted small" style="margin-top:6px">' + esc(fmtDate(f)) + ' · ' + (p ? esc(p.nombre) : 'Fuera de los periodos configurados') +
      (A.saved ? ' · <b style="color:var(--ok)">Guardada</b>' : ' · <b style="color:var(--warn)">Sin capturar</b>') + '</div></div>';

    if (dow === 0 || dow === 6) html += '<div class="banner info">Es fin de semana.</div>';

    if (sinClase) {
      html += '<div class="banner warn"><b>Día sin clase:</b> ' + esc(sinClase.motivo) + '<br><span class="small">No cuenta para asistencias.</span></div>' +
        '<button class="btn block" data-act="asis-quitar-sinclase">Quitar “sin clase” y pasar lista</button>';
      return html;
    }

    var cuenta = { P: 0, F: 0, R: 0, J: 0 };
    Object.keys(A.estados).forEach(function (k) { cuenta[A.estados[k]]++; });
    html += '<div class="stats" style="margin-bottom:12px">' + ['P', 'F', 'R', 'J'].map(function (k) {
      return '<div class="stat"><b class="st-' + k + '" style="background:none">' + cuenta[k] + '</b><span>' + ESTADOS[k].label + '</span></div>';
    }).join('') + '</div>';

    var totales = p ? Calc.asistenciasPeriodo(S.data, p.id) : {};
    html += '<p class="muted small">Toca el estado para cambiarlo: Asistió → Faltó → Retardo → Justificada.</p>';
    html += '<div class="list">' + alumnosActivos().map(function (a) {
      var e = A.estados[a.id], t = totales[a.id];
      return '<div class="item"><span class="num">' + a.num + '</span><div class="name">' + esc(a.nombre) +
        (t ? '<small>' + t.asistio + '/' + t.posibles + ' en ' + esc(p.nombre) + '</small>' : '') + '</div>' +
        '<button class="state st-' + e + '" data-act="asis-toggle" data-id="' + a.id + '">' + ESTADOS[e].label + '</button></div>';
    }).join('') + '</div>';
    html += '<div style="margin-top:12px" class="row"><button class="btn" data-act="asis-todos">Todos asistieron</button><button class="btn ghost" data-act="asis-sinclase">Marcar día sin clase</button></div>';
    html += '<div class="sticky-actions"><div class="inner"><button class="btn primary" data-act="asis-guardar">' + (A.saved ? 'Guardar cambios' : 'Guardar asistencia') + '</button></div></div>';
    return html;
  }

  // ===================== Trabajos =====================
  function campoChips(sel, act) {
    return '<div class="chips">' + CAMPOS.map(function (c) {
      return '<button class="chip' + (c.id === sel ? ' active' : '') + '" data-act="' + act + '" data-v="' + c.id + '">' + c.nombre + '</button>';
    }).join('') + '</div>';
  }

  function viewTrabajos() {
    var T = S.trab;
    if (T.editing) return viewActividad();
    var p = periodo();
    var html = campoChips(T.campo, 'trab-campo');
    if (!p) return html + '<div class="banner warn">Configura los periodos en Más → Periodos.</div>';
    var ix = Calc.indexar(S.data);
    var acts = S.data.actividades.filter(function (a) { return a.campo === T.campo && a.fecha >= p.inicio && a.fecha <= p.fin; })
      .sort(function (a, b) { return a.fecha < b.fecha ? 1 : -1; });
    var n = alumnosActivos().length;
    var carga = ix.carga[p.id + '|TRAB_' + T.campo];
    html += '<div class="row" style="margin:12px 0"><div class="grow"><h2 style="margin:0">' + esc(campoNombre(T.campo)) + '</h2><span class="muted small">' + acts.length + ' actividades en ' + esc(p.nombre) +
      (carga ? ' + ' + carga.TOTAL + ' de la libreta' : '') + '</span></div><button class="btn primary" data-act="trab-nueva">+ Nueva</button></div>';
    if (!acts.length) html += '<div class="banner info">Aún no hay actividades de este campo en el periodo. Toca “+ Nueva” para registrar la primera.</div>';
    html += '<div class="list">' + acts.map(function (a) {
      var e = ix.entregas[a.id] || {};
      var hechos = alumnosActivos().reduce(function (s, al) { return s + (Number(e[al.id]) || 0); }, 0);
      return '<div class="item clickable" data-act="trab-abrir" data-id="' + a.id + '"><div class="name"><b>' + esc(a.titulo) + '</b><small>' + esc(fmtDate(a.fecha)) + '</small></div><span class="badge">' + fmt1(hechos).replace('.0', '') + '/' + n + '</span><span>›</span></div>';
    }).join('') + '</div>';
    return html;
  }

  function abrirActividad(a) {
    var ix = Calc.indexar(S.data);
    var e = a && a.id ? (ix.entregas[a.id] || {}) : {};
    var valores = {};
    alumnosActivos().forEach(function (al) { valores[al.id] = a && a.id && e[al.id] != null ? Number(e[al.id]) : 1; });
    S.trab.editing = { id: a && a.id, titulo: a ? a.titulo : '', fecha: a ? a.fecha : today(), campo: a ? a.campo : S.trab.campo, valores: valores };
    S.dirty = !(a && a.id);
  }

  function viewActividad() {
    var E = S.trab.editing;
    var hechos = 0;
    Object.keys(E.valores).forEach(function (k) { hechos += E.valores[k]; });
    var html = '<div class="row" style="margin-bottom:8px"><button class="btn ghost" data-act="trab-volver">‹ Volver</button><span class="grow"></span><span class="badge">' + esc(campoNombre(E.campo)) + '</span></div>' +
      '<div class="card stack"><label class="field"><span>Nombre de la actividad</span><input type="text" data-input="trab-titulo" value="' + esc(E.titulo) + '" placeholder="Ej: Sustantivos y adjetivos"></label>' +
      '<label class="field"><span>Fecha</span><input type="date" data-input="trab-fecha" value="' + E.fecha + '"></label></div>' +
      '<p class="muted small">Todos inician como “Entregó”. Toca para cambiar: Entregó → No → Medio.</p>' +
      '<div class="row" style="margin-bottom:10px"><span class="grow"><b>' + fmt1(hechos).replace('.0', '') + '</b> de ' + alumnosActivos().length + ' entregaron</span><button class="btn" data-act="trab-todos">Todos entregaron</button></div>' +
      '<div class="list">' + alumnosActivos().map(function (a) {
        var v = E.valores[a.id];
        return '<div class="item"><span class="num">' + a.num + '</span><div class="name">' + esc(a.nombre) + '</div><button class="state ' + ENTREGA[v].cls + '" data-act="trab-toggle" data-id="' + a.id + '">' + ENTREGA[v].label + '</button></div>';
      }).join('') + '</div>';
    if (E.id) html += '<div style="margin-top:14px"><button class="btn danger block" data-act="trab-eliminar">Eliminar actividad</button></div>';
    html += '<div class="sticky-actions"><div class="inner"><button class="btn primary" data-act="trab-guardar">Guardar actividad</button></div></div>';
    return html;
  }

  // ===================== Exámenes =====================
  function cargarExamen() {
    var X = S.ex;
    var key = X.tipo + '|' + X.campo + '|' + (X.tipo === 'diagnostico' ? '' : S.periodoId) + '|' + S.data.examenes.length;
    if (X.key === key) return;
    var ex = Calc.examenDe(S.data, S.periodoId, X.campo, X.tipo);
    var ix = Calc.indexar(S.data);
    var res = ex ? (ix.resultados[ex.id] || {}) : {};
    X.reactivos = ex ? ex.reactivos : '';
    X.valores = {};
    alumnosActivos().forEach(function (a) { X.valores[a.id] = res[a.id] == null ? '' : res[a.id]; });
    X.existe = !!ex; X.key = key; S.dirty = false;
  }

  function viewExamenes() {
    var X = S.ex, p = periodo();
    if (X.tipo === 'trimestral' && !p) return '<div class="banner warn">Configura los periodos en Más → Periodos.</div>';
    cargarExamen();
    var html = '<div class="chips" style="margin-bottom:8px">' +
      '<button class="chip' + (X.tipo === 'diagnostico' ? ' active' : '') + '" data-act="ex-tipo" data-v="diagnostico">Diagnóstico</button>' +
      '<button class="chip' + (X.tipo === 'trimestral' ? ' active' : '') + '" data-act="ex-tipo" data-v="trimestral">Examen ' + esc(p ? p.nombre : 'trimestral') + '</button></div>' +
      campoChips(X.campo, 'ex-campo');
    var r = Number(X.reactivos) || 0;
    var cals = alumnosActivos().map(function (a) { var v = X.valores[a.id]; return v === '' || !r ? null : Number(v) / r * 10; });
    var d = Calc.distribucion(cals);
    html += '<div class="card" style="margin-top:12px"><div class="row nowrap"><label class="field grow"><span>Número de reactivos (preguntas)</span><input type="number" min="1" inputmode="numeric" data-input="ex-reactivos" value="' + esc(X.reactivos) + '"></label></div>' +
      '<div class="muted small" style="margin-top:8px">Promedio: <b>' + fmt1(d.promedio) + '</b> · 6: ' + d.bajo + ' · 7-8: ' + d.medio + ' · 9-10: ' + d.alto + (X.existe ? '' : ' · <b style="color:var(--warn)">Sin capturar</b>') + '</div></div>';
    html += '<p class="muted small">Escribe los aciertos. Déjalo vacío si el alumno faltó al examen.</p>';
    html += '<div class="list">' + alumnosActivos().map(function (a, i) {
      var v = X.valores[a.id];
      var cal = v === '' || !r ? null : Number(v) / r * 10;
      return '<div class="item"><span class="num">' + a.num + '</span><div class="name">' + esc(a.nombre) + '<small>' + (v === '' ? 'Faltó / sin capturar' : 'Calificación ' + fmt1(cal)) + '</small></div>' +
        '<input type="number" min="0" inputmode="numeric" data-input="ex-aciertos" data-id="' + a.id + '" data-i="' + i + '" value="' + esc(v) + '" enterkeyhint="next"></div>';
    }).join('') + '</div>';
    if (X.existe) html += '<div style="margin-top:14px"><button class="btn danger block" data-act="ex-eliminar">Eliminar este examen</button></div>';
    html += '<div class="sticky-actions"><div class="inner"><button class="btn primary" data-act="ex-guardar">Guardar examen</button></div></div>';
    return html;
  }

  // ===================== Calificaciones =====================
  function viewCalificaciones() {
    var p = periodo();
    if (!p) return '<div class="banner warn">Configura los periodos en Más → Periodos.</div>';
    var R = Calc.calcular(S.data, p.id);
    var w = S.data.grupo.pesos;
    var tab = S.cal.tab;
    var html = '<div class="chips" style="margin-bottom:10px"><button class="chip' + (tab === 'TODOS' ? ' active' : '') + '" data-act="cal-tab" data-v="TODOS">Resumen</button>' +
      CAMPOS.map(function (c) { return '<button class="chip' + (tab === c.id ? ' active' : '') + '" data-act="cal-tab" data-v="' + c.id + '">' + c.nombre + '</button>'; }).join('') + '</div>';
    html += '<div class="muted small" style="margin-bottom:8px">' + esc(p.nombre) + ' · Examen ' + w.examen + '% · Trabajos ' + w.trabajos + '% · Asistencia ' + w.asistencia + '% · Disciplina ' + w.disciplina + '% · ' + R.posiblesAsis + ' días de clase</div>';

    var sinDisc = R.alumnos.filter(function (f) { return f.disc.puntos == null; }).length;
    if (sinDisc) html += '<div class="banner warn small">' + sinDisc + ' alumnos sin puntos de disciplina en este periodo (cuentan como 0). Captúralos en Más → Disciplina.</div>';

    if (tab === 'TODOS') {
      html += '<div class="table-wrap"><table><thead><tr><th>#</th><th class="left">Alumno</th>' + CAMPOS.map(function (c) { return '<th>' + c.nombre.slice(0, 4) + '</th>'; }).join('') + '<th>Prom.</th></tr></thead><tbody>' +
        R.alumnos.map(function (f) {
          return '<tr class="clickable" data-act="cal-detalle" data-id="' + f.alumno.id + '"><td>' + f.alumno.num + '</td><td class="name">' + esc(f.alumno.nombre) + '</td>' +
            CAMPOS.map(function (c) { return '<td>' + gradeHtml(f.campos[c.id].cal) + '</td>'; }).join('') + '<td>' + gradeHtml(f.promedio) + '</td></tr>';
        }).join('') + '</tbody></table></div>';
    } else {
      var pc = R.porCampo[tab];
      html += '<div class="table-wrap"><table><thead><tr><th>#</th><th class="left">Alumno</th><th>Examen<br>' + (pc.examen ? pc.examen.reactivos + ' r.' : '—') + '</th><th>Trabajos<br>de ' + pc.posibles + '</th><th>Asist.<br>de ' + R.posiblesAsis + '</th><th>Disc.</th><th>Cal.</th></tr></thead><tbody>' +
        R.alumnos.map(function (f) {
          var c = f.campos[tab];
          return '<tr class="clickable" data-act="cal-detalle" data-id="' + f.alumno.id + '"><td>' + f.alumno.num + '</td><td class="name">' + esc(f.alumno.nombre) + '</td><td>' + (c.examen.aciertos == null ? 'Faltó' : c.examen.aciertos) + '</td><td>' + fmt1(c.trabajos.hechos).replace('.0', '') + '</td><td>' + f.asis.asistio + '</td><td>' + (f.disc.puntos == null ? '—' : f.disc.puntos) + '</td><td>' + gradeHtml(c.cal) + '</td></tr>';
        }).join('') + '</tbody></table></div>';
    }

    html += '<h3 style="margin-top:16px">Distribución</h3><div class="table-wrap"><table><thead><tr><th class="left">Campo</th><th>6</th><th>7-8</th><th>9-10</th><th>Prom.</th></tr></thead><tbody>' +
      CAMPOS.concat([{ id: 'PROM', nombre: 'Promedio general' }]).map(function (c) {
        var d = R.resumen[c.id];
        return '<tr><td class="left">' + c.nombre + '</td><td>' + d.bajo + '</td><td>' + d.medio + '</td><td>' + d.alto + '</td><td>' + gradeHtml(d.promedio) + '</td></tr>';
      }).join('') + '</tbody></table></div>';
    html += '<div style="margin-top:14px" class="row"><button class="btn primary grow" data-act="exportar">⬇ Descargar Excel</button></div>';
    return html;
  }

  function detalleAlumno(id) {
    var R = Calc.calcular(S.data, S.periodoId);
    var f = R.alumnos.filter(function (x) { return x.alumno.id === id; })[0];
    if (!f) return;
    var w = S.data.grupo.pesos;
    var html = '<div class="row"><h2 class="grow">' + esc(f.alumno.nombre) + '</h2><button class="icon-btn" data-act="cerrar-modal">✕</button></div>' +
      '<p class="muted small">' + esc(R.periodo.nombre) + ' · Asistencias ' + f.asis.asistio + '/' + f.asis.posibles + ' · Disciplina ' + (f.disc.puntos == null ? 'sin capturar' : f.disc.puntos + '/' + f.disc.max) + '</p>';
    CAMPOS.forEach(function (c) {
      var x = f.campos[c.id];
      html += '<div class="card" style="background:#faf9ff"><div class="row"><b class="grow">' + c.nombre + '</b>' + gradeHtml(x.cal) + '</div><table style="margin-top:6px"><tbody>' +
        '<tr><td class="left">Examen (' + w.examen + '%)</td><td>' + (x.examen.reactivos == null ? 'Sin examen' : x.examen.aciertos == null ? 'Faltó' : x.examen.aciertos + '/' + x.examen.reactivos) + '</td><td>' + x.examen.pts.toFixed(2) + '</td></tr>' +
        '<tr><td class="left">Trabajos (' + w.trabajos + '%)</td><td>' + fmt1(x.trabajos.hechos).replace('.0', '') + '/' + x.trabajos.posibles + '</td><td>' + x.trabajos.pts.toFixed(2) + '</td></tr>' +
        '<tr><td class="left">Asistencia (' + w.asistencia + '%)</td><td>' + f.asis.asistio + '/' + f.asis.posibles + '</td><td>' + x.asistencia.pts.toFixed(2) + '</td></tr>' +
        '<tr><td class="left">Disciplina (' + w.disciplina + '%)</td><td>' + (f.disc.puntos == null ? '—' : f.disc.puntos + '/' + f.disc.max) + '</td><td>' + x.disciplina.pts.toFixed(2) + '</td></tr>' +
        '</tbody></table></div>';
    });
    openModal(html);
  }

  // ===================== Más =====================
  function viewMas() {
    switch (S.mas) {
      case 'disciplina': return back() + viewDisciplina();
      case 'alumnos': return back() + viewAlumnos();
      case 'periodos': return back() + viewPeriodos();
      case 'carga': return back() + viewCarga();
      case 'diagnostico': return back() + viewDiagnostico();
      case 'admin': return back() + viewAdmin(false);
      case 'password': return back() + viewPassword();
    }
    var items = [
      ['disciplina', '⭐', 'Disciplina', 'Puntos por periodo'],
      ['diagnostico', '🧾', 'Resultados de exámenes', 'Diagnóstico y trimestrales por campo'],
      ['alumnos', '👧', 'Alumnos', 'Lista, altas y bajas'],
      ['periodos', '📅', 'Periodos y porcentajes', 'Trimestres y ponderación'],
      ['carga', '📥', 'Totales de la libreta', 'Lo que ya tenías registrado antes de la app'],
      ['password', '🔑', 'Cambiar mi contraseña', '']
    ];
    if (S.user.rol === 'admin') items.push(['admin', '🔐', 'Administración', 'Usuarios y grupos']);
    return '<div class="list menu-list">' + items.map(function (i) {
      return '<div class="item" data-act="mas" data-v="' + i[0] + '"><span class="ic">' + i[1] + '</span><div class="name"><b>' + i[2] + '</b>' + (i[3] ? '<small>' + i[3] + '</small>' : '') + '</div><span>›</span></div>';
    }).join('') + '</div><div style="margin-top:14px"><button class="btn ghost" data-act="logout">Cerrar sesión</button></div>';
  }
  function back() { return '<button class="btn ghost" data-act="mas" data-v="" style="margin-bottom:8px">‹ Más</button>'; }

  function viewDisciplina() {
    var p = periodo();
    if (!p) return '<div class="banner warn">Configura los periodos primero.</div>';
    var D = S.disc, key = p.id + '|' + S.data.disciplina.length;
    if (D.key !== key) {
      var ix = Calc.indexar(S.data), m = ix.disciplina[p.id] || {};
      D.valores = {}; alumnosActivos().forEach(function (a) { D.valores[a.id] = m[a.id] == null ? '' : m[a.id]; });
      D.key = key; S.dirty = false;
    }
    var max = S.data.grupo.disciplinaMax;
    return '<h2>Disciplina · ' + esc(p.nombre) + '</h2><p class="muted small">Puntos de 0 a ' + max + '. Vale ' + S.data.grupo.pesos.disciplina + '% de cada campo formativo.</p>' +
      '<div class="row" style="margin-bottom:10px"><button class="btn" data-act="disc-todos">Poner ' + max + ' a los vacíos</button></div>' +
      '<div class="list">' + alumnosActivos().map(function (a) {
        return '<div class="item"><span class="num">' + a.num + '</span><div class="name">' + esc(a.nombre) + '</div><input type="number" min="0" max="' + max + '" step="0.5" inputmode="decimal" data-input="disc" data-id="' + a.id + '" value="' + esc(D.valores[a.id]) + '"></div>';
      }).join('') + '</div><div class="sticky-actions"><div class="inner"><button class="btn primary" data-act="disc-guardar">Guardar disciplina</button></div></div>';
  }

  function viewDiagnostico() {
    var html = '<h2>Resultados de exámenes</h2>';
    var tipos = [['diagnostico', 'Diagnóstico', null]].concat(S.data.periodos.map(function (p) { return ['trimestral', 'Examen ' + p.nombre, p.id]; }));
    tipos.forEach(function (t) {
      var r = Calc.resultadosExamen(S.data, t[0], t[2]);
      html += '<h3 style="margin-top:14px">' + esc(t[1]) + '</h3><div class="table-wrap"><table><thead><tr><th class="left">Campo</th><th>Reactivos</th><th>6</th><th>7-8</th><th>9-10</th><th>Prom.</th></tr></thead><tbody>' +
        CAMPOS.map(function (c) {
          var x = r[c.id];
          if (!x.examen) return '<tr><td class="left">' + c.nombre + '</td><td colspan="5" class="muted">Sin capturar</td></tr>';
          return '<tr><td class="left">' + c.nombre + '</td><td>' + x.examen.reactivos + '</td><td>' + x.resumen.bajo + '</td><td>' + x.resumen.medio + '</td><td>' + x.resumen.alto + '</td><td>' + gradeHtml(x.resumen.promedio) + '</td></tr>';
        }).join('') + '</tbody></table></div>';
    });
    html += '<p class="muted small" style="margin-top:10px">Para capturar o corregir un examen ve a la pestaña Exámenes.</p>';
    return html;
  }

  function viewAlumnos() {
    var all = S.data.alumnos;
    return '<h2>Alumnos (' + alumnosActivos().length + ' activos)</h2>' +
      '<div class="list">' + all.map(function (a) {
        return '<div class="item clickable" data-act="alumno-editar" data-id="' + a.id + '"><span class="num">' + a.num + '</span><div class="name">' + esc(a.nombre) + '</div>' + (a.activo ? '' : '<span class="badge off">Baja</span>') + '<span>›</span></div>';
      }).join('') + '</div>' +
      '<div class="card stack" style="margin-top:14px"><h3>Agregar alumnos</h3><p class="muted small">Pega uno o varios nombres, uno por renglón (APELLIDOS NOMBRES). Se agregan al final de la lista.</p>' +
      '<textarea id="nuevos-alumnos" placeholder="PEREZ LOPEZ MARIA FERNANDA"></textarea><button class="btn primary" data-act="alumnos-agregar">Agregar</button></div>';
  }

  function viewPeriodos() {
    var w = S.data.grupo.pesos;
    var html = '<h2>Periodos</h2><p class="muted small">Las asistencias, trabajos y exámenes se agrupan por estas fechas.</p><div id="periodos">' +
      S.data.periodos.map(function (p) { return periodoRow(p); }).join('') + '</div>' +
      '<div class="row" style="margin:10px 0 18px"><button class="btn" data-act="periodo-agregar">+ Agregar periodo</button><button class="btn primary" data-act="periodos-guardar">Guardar periodos</button></div>' +
      '<h2>Porcentajes de la calificación</h2><div class="card stack">' +
      [['examen', 'Examen'], ['trabajos', 'Trabajos y tareas'], ['asistencia', 'Asistencia'], ['disciplina', 'Disciplina']].map(function (k) {
        return '<label class="field"><span>' + k[1] + ' (%)</span><input type="number" min="0" max="100" id="peso-' + k[0] + '" value="' + w[k[0]] + '"></label>';
      }).join('') +
      '<label class="field"><span>Puntos máximos de disciplina</span><input type="number" min="1" id="disc-max" value="' + S.data.grupo.disciplinaMax + '"></label>' +
      '<button class="btn primary" data-act="pesos-guardar">Guardar porcentajes</button></div>';
    return html;
  }
  function periodoRow(p) {
    return '<div class="card periodo" data-id="' + (p.id || '') + '"><div class="row"><label class="field grow"><span>Nombre</span><input type="text" class="p-nombre" value="' + esc(p.nombre) + '"></label></div>' +
      '<div class="row nowrap" style="margin-top:8px"><label class="field grow"><span>Inicio</span><input type="date" class="p-inicio" value="' + (p.inicio || '') + '"></label><label class="field grow"><span>Fin</span><input type="date" class="p-fin" value="' + (p.fin || '') + '"></label></div></div>';
  }

  function viewCarga() {
    var p = periodo();
    if (!p) return '<div class="banner warn">Configura los periodos primero.</div>';
    var C = S.carga, key = p.id + '|' + C.concepto + '|' + S.data.carga.length;
    if (C.key !== key) {
      var ix = Calc.indexar(S.data), m = ix.carga[p.id + '|' + C.concepto] || {};
      C.total = m.TOTAL || ''; C.valores = {};
      alumnosActivos().forEach(function (a) { C.valores[a.id] = m[a.id] == null ? '' : m[a.id]; });
      C.key = key; S.dirty = false;
    }
    var conceptos = [['ASIS', 'Asistencia']].concat(CAMPOS.map(function (c) { return ['TRAB_' + c.id, 'Trabajos ' + c.nombre]; }));
    return '<h2>Totales de la libreta · ' + esc(p.nombre) + '</h2>' +
      '<div class="banner info small">Úsalo para lo que ya estaba registrado en la libreta antes de usar la app. Lo que captures día a día en la app se <b>suma</b> a estos totales. Si empiezas un periodo desde cero en la app, déjalo vacío.</div>' +
      '<div class="chips" style="margin-bottom:10px">' + conceptos.map(function (c) { return '<button class="chip' + (c[0] === C.concepto ? ' active' : '') + '" data-act="carga-concepto" data-v="' + c[0] + '">' + c[1] + '</button>'; }).join('') + '</div>' +
      '<div class="card"><label class="field"><span>' + (C.concepto === 'ASIS' ? 'Días de clase registrados en la libreta' : 'Trabajos registrados en la libreta') + '</span><input type="number" min="0" inputmode="numeric" data-input="carga-total" value="' + esc(C.total) + '"></label></div>' +
      '<div class="list">' + alumnosActivos().map(function (a) {
        return '<div class="item"><span class="num">' + a.num + '</span><div class="name">' + esc(a.nombre) + '</div><input type="number" min="0" inputmode="decimal" data-input="carga" data-id="' + a.id + '" value="' + esc(C.valores[a.id]) + '"></div>';
      }).join('') + '</div><div class="sticky-actions"><div class="inner"><button class="btn primary" data-act="carga-guardar">Guardar totales</button></div></div>';
  }

  function viewPassword() {
    return '<h2>Cambiar mi contraseña</h2><div class="card stack"><label class="field"><span>Contraseña actual</span><input type="password" id="pw-actual" autocomplete="current-password"></label>' +
      '<label class="field"><span>Nueva contraseña (mínimo 8)</span><input type="password" id="pw-nueva" autocomplete="new-password"></label>' +
      '<label class="field"><span>Repite la nueva</span><input type="password" id="pw-nueva2" autocomplete="new-password"></label>' +
      '<button class="btn primary" data-act="pw-guardar">Cambiar contraseña</button></div>';
  }

  // ===================== Administración =====================
  function viewAdmin(sinGrupo) {
    if (!S.admin.users) {
      api('listUsers').then(function (u) { S.admin.users = u; render(); }).catch(function (e) { toast(e.message, true); });
      return (sinGrupo ? '<button class="btn ghost" data-act="admin-salir">‹ Grupos</button>' : '') + '<div class="loading"><div class="spinner"></div>Cargando…</div>';
    }
    var users = S.admin.users;
    var html = (sinGrupo ? '<button class="btn ghost" data-act="admin-salir" style="margin-bottom:8px">‹ Grupos</button>' : '') +
      '<div class="row"><h2 class="grow">Usuarios</h2><button class="btn primary" data-act="usuario-nuevo">+ Usuario</button></div>' +
      '<div class="list">' + users.map(function (u) {
        return '<div class="item clickable" data-act="usuario-editar" data-id="' + u.id + '"><div class="name"><b>' + esc(u.nombre) + '</b><small>@' + esc(u.usuario) + '</small></div><span class="badge' + (u.activo ? '' : ' off') + '">' + (u.activo ? u.rol : 'inactivo') + '</span><span>›</span></div>';
      }).join('') + '</div>' +
      '<div class="row" style="margin-top:18px"><h2 class="grow">Grupos</h2><button class="btn primary" data-act="grupo-nuevo">+ Grupo</button></div>' +
      '<div class="list">' + S.groups.map(function (g) {
        return '<div class="item clickable" data-act="grupo-editar" data-id="' + g.id + '"><div class="name"><b>' + esc(g.nombre) + '</b><small>' + esc(g.ciclo || '') + ' · ' + esc(g.maestra || 'Sin maestra asignada') + '</small></div>' + (g.activo ? '' : '<span class="badge off">Inactivo</span>') + '<span>›</span></div>';
      }).join('') + '</div>';
    return html;
  }

  function modalUsuario(u) {
    u = u || { rol: 'maestra', activo: true };
    openModal('<div class="row"><h2 class="grow">' + (u.id ? 'Editar usuario' : 'Nuevo usuario') + '</h2><button class="icon-btn" data-act="cerrar-modal">✕</button></div><form id="form-usuario" class="stack">' +
      '<label class="field"><span>Usuario (para entrar)</span><input type="text" name="usuario" value="' + esc(u.usuario || '') + '" ' + (u.id ? 'disabled' : 'required') + ' autocapitalize="none" placeholder="adriana"></label>' +
      '<label class="field"><span>Nombre</span><input type="text" name="nombre" value="' + esc(u.nombre || '') + '" required></label>' +
      '<label class="field"><span>Rol</span><select name="rol"><option value="maestra"' + (u.rol === 'maestra' ? ' selected' : '') + '>Maestra</option><option value="admin"' + (u.rol === 'admin' ? ' selected' : '') + '>Administrador</option></select></label>' +
      '<label class="field"><span>' + (u.id ? 'Nueva contraseña (déjalo vacío para no cambiarla)' : 'Contraseña inicial (mínimo 8)') + '</span><input type="text" name="password" autocomplete="off"' + (u.id ? '' : ' required minlength="8"') + '></label>' +
      '<label class="row"><input type="checkbox" name="activo"' + (u.activo ? ' checked' : '') + '> Activo (puede entrar)</label>' +
      '<button class="btn primary block" type="submit">Guardar</button></form>');
    document.getElementById('form-usuario').addEventListener('submit', function (e) {
      e.preventDefault();
      var f = e.target;
      var p = { id: u.id, usuario: f.usuario.value, nombre: f.nombre.value, rol: f.rol.value, activo: f.activo.checked };
      if (f.password.value) p.password = f.password.value;
      busy(f.querySelector('button[type=submit]'), api('saveUser', p), 'Usuario guardado').then(function () {
        closeModal(); S.admin.users = null; render();
      });
    });
  }

  function modalGrupo(g) {
    g = g || { activo: true };
    var users = S.admin.users || [];
    openModal('<div class="row"><h2 class="grow">' + (g.id ? 'Editar grupo' : 'Nuevo grupo') + '</h2><button class="icon-btn" data-act="cerrar-modal">✕</button></div><form id="form-grupo" class="stack">' +
      '<label class="field"><span>Nombre del grupo</span><input type="text" name="nombre" value="' + esc(g.nombre || '') + '" required placeholder="6° D"></label>' +
      '<label class="field"><span>Ciclo escolar</span><input type="text" name="ciclo" value="' + esc(g.ciclo || '') + '" placeholder="2026-2027"></label>' +
      '<label class="field"><span>Maestra asignada</span><select name="usuarioId"><option value="">— Sin asignar —</option>' + users.map(function (u) {
        return '<option value="' + u.id + '"' + (u.id === g.usuarioId ? ' selected' : '') + '>' + esc(u.nombre) + ' (@' + esc(u.usuario) + ')</option>';
      }).join('') + '</select></label>' +
      '<label class="row"><input type="checkbox" name="activo"' + (g.activo ? ' checked' : '') + '> Activo</label>' +
      '<button class="btn primary block" type="submit">Guardar</button></form>');
    document.getElementById('form-grupo').addEventListener('submit', function (e) {
      e.preventDefault();
      var f = e.target;
      var p = { id: g.id, nombre: f.nombre.value, ciclo: f.ciclo.value, usuarioId: f.usuarioId.value, activo: f.activo.checked };
      busy(f.querySelector('button[type=submit]'), api('saveGroup', p), 'Grupo guardado').then(function () {
        closeModal(); return loadGroups();
      }).then(render);
    });
  }

  function modalAlumno(a) {
    openModal('<div class="row"><h2 class="grow">Editar alumno</h2><button class="icon-btn" data-act="cerrar-modal">✕</button></div><form id="form-alumno" class="stack">' +
      '<label class="field"><span>Número de lista</span><input type="number" name="num" value="' + a.num + '" required></label>' +
      '<label class="field"><span>Nombre completo</span><input type="text" name="nombre" value="' + esc(a.nombre) + '" required></label>' +
      '<label class="row"><input type="checkbox" name="activo"' + (a.activo ? ' checked' : '') + '> Activo (desmarca si se dio de baja; su historial se conserva)</label>' +
      '<button class="btn primary block" type="submit">Guardar</button></form>');
    document.getElementById('form-alumno').addEventListener('submit', function (e) {
      e.preventDefault();
      var f = e.target;
      busy(f.querySelector('button[type=submit]'), api('saveStudents', { grupoId: S.grupoId, alumnos: [{ id: a.id, num: Number(f.num.value), nombre: f.nombre.value, activo: f.activo.checked }] }), 'Alumno guardado')
        .then(function () { closeModal(); return refresh(); });
    });
  }

  // ===================== Exportar a Excel =====================
  function loadSheetJS() {
    if (window.XLSX) return Promise.resolve();
    return new Promise(function (res, rej) {
      var s = document.createElement('script');
      s.src = 'https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js';
      s.onload = res; s.onerror = function () { rej(new Error('No se pudo cargar el exportador')); };
      document.head.appendChild(s);
    });
  }

  function exportar() {
    var p = periodo();
    var R = Calc.calcular(S.data, p.id);
    var g = S.data.grupo;
    loadSheetJS().then(function () {
      var wb = XLSX.utils.book_new();
      var r2 = function (n) { return n == null ? '' : Math.round(n * 100) / 100; };
      // Resumen
      var res = [['CALIFICACIONES ' + p.nombre + ' — ' + g.nombre + ' ' + (g.ciclo || '')], [], ['# LISTA', 'ALUMNO'].concat(CAMPOS.map(function (c) { return c.largo; })).concat(['PROMEDIO'])];
      R.alumnos.forEach(function (f) { res.push([f.alumno.num, f.alumno.nombre].concat(CAMPOS.map(function (c) { return r2(f.campos[c.id].cal); })).concat([r2(f.promedio)])); });
      res.push([], ['DISTRIBUCIÓN', '', 'CAL 6', 'CAL 7-8', 'CAL 9-10', 'PROMEDIO']);
      CAMPOS.forEach(function (c) { var d = R.resumen[c.id]; res.push([c.largo, '', d.bajo, d.medio, d.alto, r2(d.promedio)]); });
      XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(res), 'RESUMEN ' + p.nombre.slice(0, 20));
      // Una hoja por campo, mismo formato que el Excel original
      CAMPOS.forEach(function (c) {
        var pc = R.porCampo[c.id];
        var rows = [['CAMPO FORMATIVO DE ' + c.largo + ' — ' + p.nombre],
          ['# LISTA', 'ALUMNO', 'REACTIVOS', 'ACIERTOS', 'CALIFICACIÓN', 'EXAMEN ' + g.pesos.examen + '%', 'TRABAJOS REALIZADOS (de ' + pc.posibles + ')', 'TRABAJOS ' + g.pesos.trabajos + '%', 'ASISTENCIAS (de ' + R.posiblesAsis + ')', 'ASISTENCIA ' + g.pesos.asistencia + '%', 'DISCIPLINA (de ' + g.disciplinaMax + ')', 'DISCIPLINA ' + g.pesos.disciplina + '%', 'PROMEDIO']];
        R.alumnos.forEach(function (f) {
          var x = f.campos[c.id];
          rows.push([f.alumno.num, f.alumno.nombre, x.examen.reactivos == null ? '' : x.examen.reactivos, x.examen.aciertos == null ? '' : x.examen.aciertos,
            x.examen.cal == null ? 'Faltó' : r2(x.examen.cal), r2(x.examen.pts), x.trabajos.hechos, r2(x.trabajos.pts), f.asis.asistio, r2(x.asistencia.pts),
            f.disc.puntos == null ? '' : f.disc.puntos, r2(x.disciplina.pts), r2(x.cal)]);
        });
        XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), c.hoja);
      });
      // Diagnóstico
      var diag = Calc.resultadosExamen(S.data, 'diagnostico');
      var ix = Calc.indexar(S.data);
      var drows = [['RESULTADOS EXAMEN DIAGNÓSTICO'], ['# LISTA', 'ALUMNO'].concat([].concat.apply([], CAMPOS.map(function (c) { return [c.nombre + ' REACTIVOS', 'ACIERTOS', 'CALIFICACIÓN']; })))];
      alumnosActivos().forEach(function (a) {
        var row = [a.num, a.nombre];
        CAMPOS.forEach(function (c) {
          var ex = diag[c.id].examen, ac = ex ? (ix.resultados[ex.id] || {})[a.id] : null;
          row.push(ex ? ex.reactivos : '', ac == null ? '' : ac, ex && ac != null ? r2(ac / ex.reactivos * 10) : 'Faltó');
        });
        drows.push(row);
      });
      XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(drows), 'DIAGNÓSTICO');
      XLSX.writeFile(wb, 'Registro_' + g.nombre.replace(/[^\w]+/g, '_') + '_' + p.nombre.replace(/[^\w]+/g, '_') + '.xlsx');
    }).catch(function (e) { toast(e.message, true); });
  }

  // ===================== Eventos =====================
  var actions = {
    nav: function (el) { if (!confirmLeave()) return; S.view = el.dataset.v; S.mas = null; S.trab.editing = null; S.asis = null; S.ex.key = null; render(); window.scrollTo(0, 0); },
    'cambiar-grupo': function () { if (!confirmLeave()) return; S.view = 'grupos'; S.mas = null; render(); },
    'elegir-grupo': function (el) { S.grupoId = el.dataset.id; S.view = 'asistencia'; S.mas = null; S.data = null; S.periodoId = null; saveSession(); loadGroupData(); },
    'admin-sin-grupo': function () { S.view = 'grupos'; S.mas = 'admin'; S.admin.users = null; render(); },
    'admin-salir': function () { S.mas = null; render(); },
    logout: function () { if (!confirmLeave()) return; api('logout').catch(function () {}); clearSession(); render(); },
    'cerrar-modal': closeModal,
    mas: function (el) { if (!confirmLeave()) return; S.mas = el.dataset.v || null; if (S.mas === 'admin') S.admin.users = null; S.disc.key = null; S.carga.key = null; render(); window.scrollTo(0, 0); },

    // Asistencia
    'asis-dia': function (el) { if (!confirmLeave()) return; ensureAsis(addDays(S.asis.fecha, Number(el.dataset.d))); render(); },
    'asis-toggle': function (el) { var id = el.dataset.id; S.asis.estados[id] = CICLO_ASIS[S.asis.estados[id]]; S.dirty = true; render(); },
    'asis-todos': function () { Object.keys(S.asis.estados).forEach(function (k) { S.asis.estados[k] = 'P'; }); S.dirty = true; render(); },
    'asis-guardar': function (el) {
      var A = S.asis;
      var regs = Object.keys(A.estados).map(function (k) { return { alumnoId: k, estado: A.estados[k] }; });
      busy(el, api('saveAttendance', { grupoId: S.grupoId, fecha: A.fecha, registros: regs }), 'Asistencia guardada').then(function () {
        S.data.asistencia = S.data.asistencia.filter(function (r) { return r[0] !== A.fecha; }).concat(regs.map(function (r) { return [A.fecha, r.alumnoId, r.estado]; }));
        S.data.diasSinClase = S.data.diasSinClase.filter(function (d) { return d.fecha !== A.fecha; });
        A.saved = true; S.dirty = false; render();
      });
    },
    'asis-sinclase': function () {
      var motivo = prompt('Motivo (ej: CTE, día festivo, suspensión):');
      if (!motivo) return;
      var f = S.asis.fecha;
      api('setDaySinClase', { grupoId: S.grupoId, fecha: f, motivo: motivo }).then(function () {
        S.data.diasSinClase = S.data.diasSinClase.filter(function (d) { return d.fecha !== f; }).concat([{ fecha: f, motivo: motivo }]);
        S.data.asistencia = S.data.asistencia.filter(function (r) { return r[0] !== f; });
        ensureAsis(f); toast('Día marcado sin clase'); render();
      }).catch(function (e) { toast(e.message, true); });
    },
    'asis-quitar-sinclase': function () {
      var f = S.asis.fecha;
      api('setDaySinClase', { grupoId: S.grupoId, fecha: f, motivo: null }).then(function () {
        S.data.diasSinClase = S.data.diasSinClase.filter(function (d) { return d.fecha !== f; });
        ensureAsis(f); render();
      }).catch(function (e) { toast(e.message, true); });
    },

    // Trabajos
    'trab-campo': function (el) { S.trab.campo = el.dataset.v; render(); },
    'trab-nueva': function () { abrirActividad(null); render(); window.scrollTo(0, 0); },
    'trab-abrir': function (el) { abrirActividad(S.data.actividades.filter(function (a) { return a.id === el.dataset.id; })[0]); render(); window.scrollTo(0, 0); },
    'trab-volver': function () { if (!confirmLeave()) return; S.trab.editing = null; render(); },
    'trab-toggle': function (el) { var E = S.trab.editing; E.valores[el.dataset.id] = CICLO_ENT[E.valores[el.dataset.id]]; S.dirty = true; render(); },
    'trab-todos': function () { var E = S.trab.editing; Object.keys(E.valores).forEach(function (k) { E.valores[k] = 1; }); S.dirty = true; render(); },
    'trab-guardar': function (el) {
      var E = S.trab.editing;
      if (!E.titulo.trim()) return toast('Escribe el nombre de la actividad', true);
      var regs = Object.keys(E.valores).map(function (k) { return { alumnoId: k, valor: E.valores[k] }; });
      busy(el, api('saveActivity', { grupoId: S.grupoId, actividad: { id: E.id, campo: E.campo, fecha: E.fecha, titulo: E.titulo }, registros: regs }), 'Actividad guardada')
        .then(function () { S.dirty = false; S.trab.editing = null; return refresh(); });
    },
    'trab-eliminar': function (el) {
      if (!confirm('¿Eliminar esta actividad y sus entregas?')) return;
      busy(el, api('deleteActivity', { grupoId: S.grupoId, actividadId: S.trab.editing.id }), 'Actividad eliminada')
        .then(function () { S.dirty = false; S.trab.editing = null; return refresh(); });
    },

    // Exámenes
    'ex-tipo': function (el) { if (!confirmLeave()) return; S.ex.tipo = el.dataset.v; S.ex.key = null; render(); },
    'ex-campo': function (el) { if (!confirmLeave()) return; S.ex.campo = el.dataset.v; S.ex.key = null; render(); },
    'ex-guardar': function (el) {
      var X = S.ex;
      if (!(Number(X.reactivos) > 0)) return toast('Escribe el número de reactivos', true);
      var bad = Object.keys(X.valores).filter(function (k) { var v = X.valores[k]; return v !== '' && (Number(v) < 0 || Number(v) > Number(X.reactivos)); });
      if (bad.length) return toast('Hay aciertos mayores que el número de reactivos', true);
      var res = Object.keys(X.valores).map(function (k) { return { alumnoId: k, aciertos: X.valores[k] === '' ? null : Number(X.valores[k]) }; });
      busy(el, api('saveExam', { grupoId: S.grupoId, examen: { tipo: X.tipo, campo: X.campo, periodoId: S.periodoId, reactivos: Number(X.reactivos) }, resultados: res }), 'Examen guardado')
        .then(function () { S.dirty = false; X.key = null; return refresh(); });
    },
    'ex-eliminar': function (el) {
      var ex = Calc.examenDe(S.data, S.periodoId, S.ex.campo, S.ex.tipo);
      if (!ex || !confirm('¿Eliminar este examen y sus resultados?')) return;
      busy(el, api('deleteExam', { grupoId: S.grupoId, examenId: ex.id }), 'Examen eliminado').then(function () { S.dirty = false; S.ex.key = null; return refresh(); });
    },

    // Calificaciones
    'cal-tab': function (el) { S.cal.tab = el.dataset.v; render(); },
    'cal-detalle': function (el) { detalleAlumno(el.dataset.id); },
    exportar: exportar,

    // Disciplina
    'disc-todos': function () { var D = S.disc, max = S.data.grupo.disciplinaMax; Object.keys(D.valores).forEach(function (k) { if (D.valores[k] === '') D.valores[k] = max; }); S.dirty = true; render(); },
    'disc-guardar': function (el) {
      var D = S.disc;
      var regs = Object.keys(D.valores).map(function (k) { return { alumnoId: k, puntos: D.valores[k] === '' ? null : Number(D.valores[k]) }; });
      busy(el, api('saveDisciplina', { grupoId: S.grupoId, periodoId: S.periodoId, registros: regs }), 'Disciplina guardada')
        .then(function () { S.dirty = false; D.key = null; return refresh(); });
    },

    // Carga inicial
    'carga-concepto': function (el) { if (!confirmLeave()) return; S.carga.concepto = el.dataset.v; S.carga.key = null; render(); },
    'carga-guardar': function (el) {
      var C = S.carga;
      var regs = Object.keys(C.valores).map(function (k) { return { alumnoId: k, valor: C.valores[k] === '' ? null : Number(C.valores[k]) }; });
      busy(el, api('saveCarga', { grupoId: S.grupoId, periodoId: S.periodoId, concepto: C.concepto, total: Number(C.total) || 0, registros: regs }), 'Totales guardados')
        .then(function () { S.dirty = false; C.key = null; return refresh(); });
    },

    // Alumnos
    'alumno-editar': function (el) { modalAlumno(S.data.alumnos.filter(function (a) { return a.id === el.dataset.id; })[0]); },
    'alumnos-agregar': function (el) {
      var lines = document.getElementById('nuevos-alumnos').value.split(/\n+/).map(function (s) { return s.trim(); }).filter(Boolean);
      if (!lines.length) return toast('Escribe al menos un nombre', true);
      var max = S.data.alumnos.reduce(function (m, a) { return Math.max(m, a.num); }, 0);
      var alumnos = lines.map(function (n, i) { return { nombre: n, num: max + i + 1 }; });
      busy(el, api('saveStudents', { grupoId: S.grupoId, alumnos: alumnos }), lines.length + ' alumno(s) agregado(s)').then(refresh);
    },

    // Periodos
    'periodo-agregar': function () { document.getElementById('periodos').insertAdjacentHTML('beforeend', periodoRow({ nombre: 'T' + (document.querySelectorAll('.periodo').length + 1) })); },
    'periodos-guardar': function (el) {
      var ps = Array.prototype.map.call(document.querySelectorAll('.periodo'), function (c) {
        return { id: c.dataset.id || null, nombre: c.querySelector('.p-nombre').value, inicio: c.querySelector('.p-inicio').value, fin: c.querySelector('.p-fin').value };
      }).filter(function (p) { return p.nombre && p.inicio && p.fin; });
      busy(el, api('savePeriodos', { grupoId: S.grupoId, periodos: ps }), 'Periodos guardados').then(refresh);
    },
    'pesos-guardar': function (el) {
      var w = {}; ['examen', 'trabajos', 'asistencia', 'disciplina'].forEach(function (k) { w[k] = Number(document.getElementById('peso-' + k).value); });
      busy(el, api('saveGroupSettings', { grupoId: S.grupoId, pesos: w, disciplinaMax: Number(document.getElementById('disc-max').value) }), 'Porcentajes guardados').then(refresh);
    },

    // Contraseña
    'pw-guardar': function (el) {
      var a = document.getElementById('pw-actual').value, n = document.getElementById('pw-nueva').value, n2 = document.getElementById('pw-nueva2').value;
      if (n !== n2) return toast('Las contraseñas nuevas no coinciden', true);
      busy(el, api('changePassword', { actual: a, nueva: n }), 'Contraseña cambiada').then(function () { S.mas = null; render(); });
    },

    // Admin
    'usuario-nuevo': function () { modalUsuario(null); },
    'usuario-editar': function (el) { modalUsuario(S.admin.users.filter(function (u) { return u.id === el.dataset.id; })[0]); },
    'grupo-nuevo': function () { modalGrupo(null); },
    'grupo-editar': function (el) { modalGrupo(S.groups.filter(function (g) { return g.id === el.dataset.id; })[0]); }
  };

  document.addEventListener('click', function (e) {
    var el = e.target.closest('[data-act]');
    if (!el) return;
    var fn = actions[el.dataset.act];
    if (fn) { e.preventDefault(); fn(el); }
  });

  document.addEventListener('change', function (e) {
    var k = e.target.dataset.change;
    if (k === 'periodo') {
      if (!confirmLeave()) { e.target.value = S.periodoId; return; }
      S.periodoId = e.target.value; S.ex.key = null; S.disc.key = null; S.carga.key = null; S.trab.editing = null; render();
    } else if (k === 'asis-fecha') {
      if (!e.target.value) return;
      if (!confirmLeave()) { e.target.value = S.asis.fecha; return; }
      ensureAsis(e.target.value); render();
    }
  });

  // Inputs que no re-renderizan (para no perder el foco)
  document.addEventListener('input', function (e) {
    var t = e.target, k = t.dataset.input;
    if (!k) return;
    S.dirty = true;
    if (k === 'trab-titulo') S.trab.editing.titulo = t.value;
    else if (k === 'trab-fecha') S.trab.editing.fecha = t.value;
    else if (k === 'ex-reactivos') S.ex.reactivos = t.value;
    else if (k === 'ex-aciertos') {
      S.ex.valores[t.dataset.id] = t.value;
      var r = Number(S.ex.reactivos), small = t.parentNode.querySelector('small');
      if (small) small.textContent = t.value === '' ? 'Faltó / sin capturar' : (r ? 'Calificación ' + fmt1(Number(t.value) / r * 10) : '');
    }
    else if (k === 'disc') S.disc.valores[t.dataset.id] = t.value;
    else if (k === 'carga') S.carga.valores[t.dataset.id] = t.value;
    else if (k === 'carga-total') S.carga.total = t.value;
  });

  // Enter en aciertos pasa al siguiente alumno
  document.addEventListener('keydown', function (e) {
    if (e.key !== 'Enter' || !e.target.dataset || e.target.dataset.input !== 'ex-aciertos') return;
    e.preventDefault();
    var next = document.querySelector('[data-input="ex-aciertos"][data-i="' + (Number(e.target.dataset.i) + 1) + '"]');
    if (next) next.focus(); else e.target.blur();
  });

  // ===================== Arranque =====================
  try {
    var saved = JSON.parse(localStorage.getItem(LS_KEY) || 'null');
    if (saved && saved.token) { S.token = saved.token; S.user = saved.user; S.grupoId = saved.grupoId; }
  } catch (e) { /* ignorar */ }

  if (S.token) {
    render();
    api('me').then(function (u) { S.user = u; return loadGroups(); })
      .then(function () { saveSession(); render(); if (S.grupoId) loadGroupData(); })
      .catch(function (e) { if (S.token) toast(e.message, true); render(); });
  } else {
    render();
  }
})();
