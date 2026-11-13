/* Registro Escolar — frontend (GitHub Pages). Sin dependencias; SheetJS se carga solo al exportar. */
(function () {
  'use strict';
  var CFG = window.APP_CONFIG || {};
  function CAMPOS() { return S.data ? Calc.campos(S.data) : []; }
  function campoValido(id) { var c = CAMPOS(); return c.some(function (x) { return x.id === id; }) ? id : (c[0] && c[0].id); }
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
    disc: { key: null }, carga: { concepto: 'ASIS', key: null }, cal: { tab: 'TODOS' }, admin: { users: null }, schools: null, pts: { key: null }
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
  function campoNombre(id) { var c = CAMPOS().filter(function (x) { return x.id === id; })[0]; return c ? c.nombre : ''; }
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
        var iniciados = d.periodos.filter(function (x) { return x.inicio <= today(); });
        var p = periodoDeFecha(today()) || iniciados[iniciados.length - 1] || d.periodos[0];
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
    if (S.user && !S.user.aceptoAviso) return renderAviso();
    if (!S.groupsLoaded) return renderShell('<div class="loading"><div class="spinner"></div>Cargando…</div>', false);
    if (!S.grupoId || S.view === 'grupos') return renderShell(viewGrupos(), false);
    if (S.loading || !S.data) return renderShell('<div class="loading"><div class="spinner"></div>Cargando grupo…</div>', true);
    var html;
    switch (S.view) {
      case 'asistencia': html = viewAsistencia(); break;
      case 'trabajos': html = viewTrabajos(); break;
      case 'examenes': html = viewExamenes(); break;
      case 'calificaciones': html = viewCalificaciones(); break;
      case 'alumno': html = viewResumenAlumno(); break;
      default: html = viewMas();
    }
    renderShell(html, true);
  }

  function renderShell(content, withNav) {
    var g = S.groups.filter(function (x) { return x.id === S.grupoId; })[0];
    var periodos = S.data && withNav ? S.data.periodos : [];
    var top = '<header class="topbar">' +
      '<div class="title"><b>' + esc(g ? g.nombre : (CFG.NOMBRE_APP || 'Registro Escolar')) + '</b><span>' + esc(g && g.escuela ? g.escuela : S.user.nombre) + (g && g.ciclo ? ' · ' + esc(g.ciclo) : '') + '</span></div>' +
      (periodos.length ? '<select data-change="periodo" aria-label="Periodo">' + periodos.map(function (p) {
        var futuro = p.inicio > today();
        return '<option value="' + p.id + '"' + (p.id === S.periodoId ? ' selected' : '') + (futuro ? ' disabled' : '') + '>' + esc(p.nombre) + (futuro ? ' (aún no)' : '') + '</option>';
      }).join('') + '</select>' : '') +
      (S.grupoId ? '<button class="icon-btn" data-act="cambiar-grupo" title="Mis grupos" aria-label="Mis grupos">⇄</button>' : '') +
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
      '<button class="btn primary block" type="submit">Entrar</button>' +
      '<p class="muted small" style="text-align:center">Al usar la app aceptas el <a href="aviso-privacidad.html" target="_blank">aviso de privacidad</a>.</p></form></div>';
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

  // ===================== Aviso de privacidad =====================
  function renderAviso() {
    $app.innerHTML = '<div class="login"><div class="card stack">' +
      '<div class="logo">🔒</div><h2>Aviso de privacidad</h2>' +
      '<p>En esta app vas a registrar datos de tus alumnos (nombres, asistencias y calificaciones), que son datos personales de menores de edad.</p>' +
      '<ul class="small" style="padding-left:18px;margin:0"><li>Solo se usan para tu registro escolar y el cálculo de calificaciones.</li><li>No se venden ni se comparten con terceros.</li><li>Se guardan en una cuenta de Google privada del administrador.</li><li>Te comprometes a usarlos solo para fines escolares.</li></ul>' +
      '<p class="small"><a href="aviso-privacidad.html" target="_blank">Leer el aviso de privacidad completo</a></p>' +
      '<label class="row small"><input type="checkbox" id="acepto"> He leído y acepto el aviso de privacidad</label>' +
      '<button class="btn primary block" id="btn-acepto">Continuar</button>' +
      '<button class="btn ghost block" data-act="logout">Salir</button></div></div>';
    document.getElementById('btn-acepto').addEventListener('click', function (e) {
      if (!document.getElementById('acepto').checked) return toast('Marca la casilla para continuar', true);
      busy(e.target, api('acceptPrivacy')).then(function () {
        S.user.aceptoAviso = true; saveSession();
        if (!S.groupsLoaded) return loadGroups().then(function () { render(); if (S.grupoId) loadGroupData(); });
        render();
      });
    });
  }

  // ===================== Grupos =====================
  function viewGrupos() {
    var gs = S.groups;
    var html = '<h2>Elige un grupo</h2>';
    if (!gs.length) html += '<div class="banner info">Todavía no tienes grupos. Crea el tuyo con “+ Nuevo grupo”.</div>';
    html += '<div class="list menu-list">' + gs.map(function (g) {
      return '<div class="item" data-act="elegir-grupo" data-id="' + g.id + '"><span class="ic">🏫</span><div class="name"><b>' + esc(g.nombre) + '</b><small>' + [g.escuela, g.ciclo, S.user.rol === 'admin' ? g.maestra : ''].filter(Boolean).map(esc).join(' · ') + '</small></div>' + (g.activo ? '' : '<span class="badge off">Archivado</span>') + '<span>›</span></div>';
    }).join('') + '</div>';
    html += '<div style="margin-top:12px"><button class="btn primary block" data-act="grupo-nuevo">+ Nuevo grupo</button></div>';
    if (S.user.rol === 'admin') html += '<div style="margin-top:12px" class="list menu-list"><div class="item" data-act="admin-sin-grupo"><span class="ic">🔐</span><div class="name">Administración (usuarios y grupos)</div><span>›</span></div></div>';
    html += '<div style="margin-top:12px"><button class="btn ghost" data-act="logout">Cerrar sesión</button></div>';
    if (S.mas === 'admin' && S.view === 'grupos') html = viewAdmin(true);
    return html;
  }

  // ===================== Asistencia =====================
  function ensureAsis(fecha) {
    if (!fecha && !(S.asis && S.asis.fecha)) {
      fecha = today();
      while ([0, 6].indexOf(new Date(fecha + 'T12:00:00').getDay()) >= 0) fecha = addDays(fecha, -1);
    }
    fecha = fecha || S.asis.fecha;
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
      '<input type="date" class="grow" value="' + f + '" data-change="asis-fecha" min="' + (S.data.periodos[0] ? S.data.periodos[0].inicio : '') + '" max="' + today() + '">' +
      '<button class="icon-btn" data-act="asis-dia" data-d="1">›</button></div>' +
      '<div class="muted small" style="margin-top:6px">' + esc(fmtDate(f)) + ' · ' + (p ? esc(p.nombre) : 'Fuera de los periodos configurados') +
      (f > today() || dow === 0 || dow === 6 || !p || sinClase ? '' : A.saved ? ' · <b style="color:var(--ok)">Guardada</b>' : ' · <b style="color:var(--warn)">Sin capturar</b>') + '</div></div>';

    if (f > today()) return html + '<div class="banner warn">Ese día todavía no llega; no se puede pasar lista por adelantado.</div><button class="btn block" data-act="asis-hoy">Ir a hoy</button>';
    if (dow === 0 || dow === 6) return html + '<div class="banner info">Es fin de semana, no hay clases.</div><button class="btn block" data-act="asis-hoy">Ir a hoy</button>';
    if (!p) return html + '<div class="banner warn">Esta fecha está fuera del ciclo escolar (ningún trimestre la incluye).</div><button class="btn block" data-act="asis-hoy">Ir a hoy</button>';

    if (sinClase) {
      html += '<div class="banner warn"><b>Día sin clase:</b> ' + esc(sinClase.motivo) + '<br><span class="small">No cuenta para asistencias.</span></div>' +
        '<button class="btn block" data-act="asis-quitar-sinclase">Quitar “sin clase” y pasar lista</button>';
      return html;
    }

    if (!alumnosActivos().length) return html + '<div class="banner info">Este grupo todavía no tiene alumnos. Agrégalos en <b>Más → Alumnos</b> (puedes pegar la lista completa).</div><button class="btn primary block" data-act="mas" data-v="alumnos">Agregar alumnos</button>';
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
    return '<div class="chips">' + CAMPOS().map(function (c) {
      return '<button class="chip' + (c.id === sel ? ' active' : '') + '" data-act="' + act + '" data-v="' + c.id + '">' + c.nombre + '</button>';
    }).join('') + '</div>';
  }

  function viewTrabajos() {
    var T = S.trab;
    if (T.editing) return viewActividad();
    T.campo = campoValido(T.campo);
    if (!T.campo) return '<div class="banner warn">Este grupo no tiene materias activas. Agrégalas en Más → Materias.</div>';
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
    var per = periodo(), fDef = today();
    if (per && (fDef < per.inicio || fDef > per.fin)) fDef = per.fin < today() ? per.fin : per.inicio;
    S.trab.editing = { id: a && a.id, titulo: a ? a.titulo : '', fecha: a ? a.fecha : fDef, campo: a ? a.campo : S.trab.campo, valores: valores };
    S.dirty = !(a && a.id);
  }

  function viewActividad() {
    var E = S.trab.editing;
    var hechos = 0;
    Object.keys(E.valores).forEach(function (k) { hechos += E.valores[k]; });
    var html = '<div class="row" style="margin-bottom:8px"><button class="btn ghost" data-act="trab-volver">‹ Volver</button><span class="grow"></span><span class="badge">' + esc(campoNombre(E.campo)) + '</span></div>' +
      '<div class="card stack"><label class="field"><span>Nombre de la actividad</span><input type="text" data-input="trab-titulo" value="' + esc(E.titulo) + '" placeholder="Ej: Sustantivos y adjetivos"></label>' +
      '<label class="field"><span>Fecha</span><input type="date" data-input="trab-fecha" value="' + E.fecha + '"' + (periodo() ? ' min="' + periodo().inicio + '" max="' + periodo().fin + '"' : '') + '></label></div>' +
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
    if (X.campo === 'DISC') return chipsExamen(p) + viewDisciplina(true);
    if (String(X.campo).indexOf('K:') === 0) {
      var kk = conceptoPorClave(X.campo.slice(2));
      if (kk) return chipsExamen(p) + viewPuntos(kk);
      X.campo = null;
    }
    X.campo = campoValido(X.campo);
    if (!X.campo) return '<div class="banner warn">Este grupo no tiene materias activas. Agrégalas en Más → Materias.</div>';
    if (X.tipo === 'trimestral' && !p) return '<div class="banner warn">Configura los periodos en Más → Periodos.</div>';
    cargarExamen();
    var html = chipsExamen(p);
    var r = Number(X.reactivos) || 0;
    var cals = alumnosActivos().map(function (a) { var v = X.valores[a.id]; return v === '' || !r ? null : Number(v) / r * 10; });
    var d = Calc.distribucion(cals);
    html += '<div class="card" style="margin-top:12px"><div class="row nowrap"><label class="field grow"><span>Número de reactivos (preguntas)</span><input type="number" min="1" inputmode="numeric" data-input="ex-reactivos" value="' + esc(X.reactivos) + '"></label></div>' +
      '<div class="muted small" style="margin-top:8px">Promedio: <b>' + fmt1(d.promedio) + '</b> · 6: ' + d.bajo + ' · 7-8: ' + d.medio + ' · 9-10: ' + d.alto + (X.existe ? '' : ' · <b style="color:var(--warn)">Sin capturar</b>') + '</div></div>';
    html += '<div class="row" style="margin-bottom:8px"><p class="muted small grow" style="margin:0">Escribe los aciertos. Déjalo vacío si el alumno faltó al examen.</p><button class="btn" data-act="pegar-abrir" data-tipo="ex">📋 Pegar lista</button></div>';
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

  /** Porcentaje efectivo en una materia (si hay conceptos que no aplican ahí, lo demás se escala para sumar 100). */
  function pctEf(peso, materia) {
    var fuera = Calc.conceptos(S.data).reduce(function (s, k) { return s + (Calc.aplicaEn(k, materia) ? 0 : k.peso); }, 0);
    var v = 100 - fuera > 0 ? peso * 100 / (100 - fuera) : 0;
    return (Math.round(v * 10) / 10) + '%';
  }
  function conceptosDe(materia) { return Calc.conceptos(S.data).filter(function (k) { return Calc.aplicaEn(k, materia); }); }

  function conceptoPorClave(c) { return Calc.conceptos(S.data).filter(function (k) { return k.clave === c; })[0]; }

  function chipsExamen(p) {
    var X = S.ex, disc = X.campo === 'DISC' || String(X.campo).indexOf('K:') === 0;
    return (disc ? '' : '<div class="chips" style="margin-bottom:8px">' +
      '<button class="chip' + (X.tipo === 'diagnostico' ? ' active' : '') + '" data-act="ex-tipo" data-v="diagnostico">Diagnóstico</button>' +
      '<button class="chip' + (X.tipo === 'trimestral' ? ' active' : '') + '" data-act="ex-tipo" data-v="trimestral">Examen ' + esc(p ? p.nombre : 'trimestral') + '</button></div>') +
      '<div class="chips">' + CAMPOS().map(function (c) {
        return '<button class="chip' + (c.id === X.campo ? ' active' : '') + '" data-act="ex-campo" data-v="' + c.id + '">' + c.nombre + '</button>';
      }).join('') + '<button class="chip' + (X.campo === 'DISC' ? ' active' : '') + '" data-act="ex-campo" data-v="DISC">⭐ Disciplina</button>' +
      Calc.conceptos(S.data).map(function (k) {
        return '<button class="chip' + (X.campo === 'K:' + k.clave ? ' active' : '') + '" data-act="ex-campo" data-v="K:' + esc(k.clave) + '">🏷️ ' + esc(k.nombre) + '</button>';
      }).join('') + '</div>';
  }

  /** Captura de un concepto extra (participación, proyecto…). */
  function viewPuntos(k) {
    var p = periodo();
    if (!p) return '<div class="banner warn">Configura los periodos primero.</div>';
    var P = S.pts;
    var materia = '';
    if (k.tipo === 'materia') {
      var aplic = CAMPOS().filter(function (c) { return Calc.aplicaEn(k, c.id); });
      if (!aplic.length) return '<div class="banner warn" style="margin-top:12px">' + esc(k.nombre) + ' no aplica en ninguna materia visible. Revísalo en Más → Periodos y porcentajes.</div>';
      if (!aplic.some(function (c) { return c.id === P.materia; })) P.materia = aplic[0].id;
      materia = P.materia;
    }
    var key = p.id + '|' + k.clave + '|' + materia + '|' + (S.data.puntos || []).length;
    if (P.key !== key) {
      var m = Calc.indexar(S.data).puntos[p.id + '|' + k.clave + '|' + materia] || {};
      P.valores = {}; alumnosActivos().forEach(function (a) { P.valores[a.id] = m[a.id] == null ? '' : m[a.id]; });
      P.key = key; S.dirty = false;
    }
    var html = '<div style="margin-top:12px"></div>';
    if (k.tipo === 'materia') {
      html += '<p class="muted small" style="margin:0 0 6px">' + esc(k.nombre) + ' se califica por materia. Elige la materia:</p><div class="chips" style="margin-bottom:10px">' + CAMPOS().filter(function (c) { return Calc.aplicaEn(k, c.id); }).map(function (c) {
        return '<button class="chip' + (c.id === materia ? ' active' : '') + '" data-act="pts-materia" data-v="' + c.id + '">' + c.nombre + '</button>';
      }).join('') + '</div>';
    }
    html += '<div class="banner info small"><b>' + esc(k.nombre) + '</b> de <b>' + esc(p.nombre) + '</b>' + (k.tipo === 'materia' ? ' en <b>' + esc(campoNombre(materia)) + '</b>' : '') + ': puntos de 0 a ' + k.max + '. Vale ' + (k.tipo === 'materia' ? pctEf(k.peso, materia) + ' de la calificación de esta materia' : k.peso + '% de ' + (k.materias && k.materias.length ? 'la calificación de: <b>' + k.materias.map(campoNombre).filter(Boolean).map(esc).join(', ') + '</b>' : 'la calificación de <b>cada</b> materia')) + '.</div>' +
      '<div class="row" style="margin-bottom:10px"><button class="btn" data-act="pts-todos">Poner ' + k.max + ' a los vacíos</button><button class="btn" data-act="pegar-abrir" data-tipo="pts">📋 Pegar lista</button></div>' +
      '<div class="list">' + alumnosActivos().map(function (a) {
        return '<div class="item"><span class="num">' + a.num + '</span><div class="name">' + esc(a.nombre) + '</div><input type="number" min="0" max="' + k.max + '" step="0.5" inputmode="decimal" data-input="pts" data-id="' + a.id + '" value="' + esc(P.valores[a.id]) + '"></div>';
      }).join('') + '</div><div class="sticky-actions"><div class="inner"><button class="btn primary" data-act="pts-guardar">Guardar ' + esc(k.nombre.toLowerCase()) + '</button></div></div>';
    return html;
  }

  /** Ventana para pegar calificaciones desde Excel u otro lado. tipo: 'ex' | 'disc' */
  function modalPegar(tipo) {
    var kp = tipo === 'pts' ? conceptoPorClave(S.ex.campo.slice(2)) : null;
    var max = tipo === 'ex' ? Number(S.ex.reactivos) : kp ? kp.max : S.data.grupo.disciplinaMax;
    if (tipo === 'ex' && !(max > 0)) return toast('Primero escribe el número de reactivos', true);
    openModal('<div class="row"><h2 class="grow">Pegar ' + (tipo === 'ex' ? 'aciertos' : kp ? esc(kp.nombre.toLowerCase()) : 'puntos de disciplina') + '</h2><button class="icon-btn" data-act="cerrar-modal">✕</button></div>' +
      '<p class="muted small">Copia la columna desde Excel (o escribe un renglón por alumno) y pégala aquí. Puede ser:</p>' +
      '<ul class="muted small" style="margin:0 0 8px;padding-left:18px"><li>Solo los números, en el orden de la lista. Un renglón vacío o “F” = ' + (tipo === 'ex' ? 'faltó' : 'sin dato') + '.</li><li>Número de lista y valor: <code>5 18</code></li><li>Nombre y valor: <code>Acosta Angel 18</code></li></ul>' +
      '<textarea id="pegar-texto" style="min-height:180px;font-family:ui-monospace,monospace" placeholder="18&#10;16&#10;17&#10;…"></textarea>' +
      '<div id="pegar-resultado" class="small" style="margin:8px 0"></div>' +
      '<div class="row"><button class="btn grow" data-act="pegar-revisar" data-tipo="' + tipo + '" data-max="' + max + '">Revisar</button><button class="btn primary grow" data-act="pegar-aplicar" data-tipo="' + tipo + '" data-max="' + max + '" disabled>Llenar lista</button></div>' +
      '<p class="muted small" style="margin-top:8px">Después de llenar la lista revisa los valores y toca <b>Guardar</b>.</p>');
    setTimeout(function () { var t = document.getElementById('pegar-texto'); if (t) t.focus(); }, 50);
  }

  function revisarPegado(el) {
    var res = Pegado.interpretar(document.getElementById('pegar-texto').value, alumnosActivos(), { max: Number(el.dataset.max) });
    var out = document.getElementById('pegar-resultado');
    out.innerHTML = '<div class="banner ' + (res.problemas.length ? 'warn' : 'ok') + '" style="margin:0"><b>' + res.asignados + ' de ' + alumnosActivos().length + ' alumnos</b> se llenarán' +
      (res.modo === 'nombre' ? ' (buscando por nombre)' : ' (por orden de lista)') + '.' +
      (res.problemas.length ? '<ul style="margin:6px 0 0;padding-left:18px">' + res.problemas.slice(0, 8).map(function (p) { return '<li>' + esc(p) + '</li>'; }).join('') + (res.problemas.length > 8 ? '<li>…y ' + (res.problemas.length - 8) + ' más</li>' : '') + '</ul>' : '') + '</div>';
    document.querySelector('[data-act="pegar-aplicar"]').disabled = res.asignados === 0;
    return res;
  }

  // ===================== Calificaciones =====================
  function viewCalificaciones() {
    var p = periodo();
    if (!p) return '<div class="banner warn">Configura los periodos en Más → Periodos.</div>';
    var R = Calc.calcular(S.data, p.id);
    var w = S.data.grupo.pesos;
    var tab = S.cal.tab === 'TODOS' ? 'TODOS' : (campoValido(S.cal.tab) === S.cal.tab ? S.cal.tab : 'TODOS');
    var html = '<div class="chips" style="margin-bottom:10px"><button class="chip' + (tab === 'TODOS' ? ' active' : '') + '" data-act="cal-tab" data-v="TODOS">Resumen</button>' +
      CAMPOS().map(function (c) { return '<button class="chip' + (tab === c.id ? ' active' : '') + '" data-act="cal-tab" data-v="' + c.id + '">' + c.nombre + '</button>'; }).join('') + '</div>';
    html += '<div class="muted small" style="margin-bottom:4px">Toca a un alumno para ver su resumen completo.</div>';
    html += '<div class="muted small" style="margin-bottom:8px">' + esc(p.nombre) + ' · Examen ' + w.examen + '% · Trabajos ' + w.trabajos + '% · Asistencia ' + w.asistencia + '% · Disciplina ' + w.disciplina + '% · ' + R.posiblesAsis + ' días de clase</div>';

    var sinDisc = w.disciplina > 0 ? R.alumnos.filter(function (f) { return f.disc.puntos == null; }).length : 0;
    if (sinDisc) html += '<div class="banner warn small">' + sinDisc + ' alumnos sin puntos de disciplina en este periodo (cuentan como 0). <a href="#" data-act="ir-disciplina">Capturar disciplina</a></div>';
    R.conceptos.forEach(function (k) {
      if (!k.peso) return;
      var falta = 0;
      R.alumnos.forEach(function (f) { R.campos.forEach(function (c) { if (f.campos[c.id].cal != null && f.campos[c.id].extras[k.clave] && f.campos[c.id].extras[k.clave].valor == null) falta++; }); });
      if (falta) html += '<div class="banner warn small">Falta capturar <b>' + esc(k.nombre) + '</b> (' + falta + ' ' + (k.tipo === 'materia' ? 'calificaciones' : 'en total') + '; cuentan como 0). <a href="#" data-act="ir-concepto" data-v="' + esc(k.clave) + '">Capturar</a></div>';
    });

    if (tab === 'TODOS') {
      html += '<div class="table-wrap"><table><thead><tr><th>#</th><th class="left">Alumno</th>' + CAMPOS().map(function (c) { return '<th>' + c.nombre.slice(0, 4) + '</th>'; }).join('') + '<th title="Disciplina (puntos)">⭐ Disc.</th><th>Prom.</th></tr></thead><tbody>' +
        R.alumnos.map(function (f) {
          var dp = f.disc.puntos;
          return '<tr class="clickable" data-act="cal-detalle" data-id="' + f.alumno.id + '"><td>' + f.alumno.num + '</td><td class="name">' + esc(f.alumno.nombre) + '</td>' +
            CAMPOS().map(function (c) { return '<td>' + gradeHtml(f.campos[c.id].cal) + '</td>'; }).join('') +
            '<td>' + (dp == null ? '<span class="muted">—</span>' : '<span class="g ' + nivel(dp / f.disc.max * 10) + '">' + dp + '</span>') + '</td><td>' + gradeHtml(f.promedio) + '</td></tr>';
        }).join('') + '</tbody></table></div>';
    } else {
      var pc = R.porCampo[tab];
      html += '<div class="table-wrap"><table><thead><tr><th>#</th><th class="left">Alumno</th><th>Examen<br>' + (pc.examen ? pc.examen.reactivos + ' r.' : '—') + '</th><th>Trabajos<br>de ' + pc.posibles + '</th><th>Asist.<br>de ' + R.posiblesAsis + '</th><th>Disc.</th>' +
        conceptosDe(tab).map(function (k) { return '<th>' + esc(k.nombre.slice(0, 10)) + '<br>de ' + k.max + '</th>'; }).join('') + '<th>Cal.</th></tr></thead><tbody>' +
        R.alumnos.map(function (f) {
          var c = f.campos[tab];
          return '<tr class="clickable" data-act="cal-detalle" data-id="' + f.alumno.id + '"><td>' + f.alumno.num + '</td><td class="name">' + esc(f.alumno.nombre) + '</td><td>' + (c.examen.aciertos == null ? 'Faltó' : c.examen.aciertos) + '</td><td>' + fmt1(c.trabajos.hechos).replace('.0', '') + '</td><td>' + f.asis.asistio + '</td><td>' + (f.disc.puntos == null ? '—' : f.disc.puntos) + '</td>' +
            conceptosDe(tab).map(function (k) { var e = c.extras[k.clave]; return '<td>' + (e.valor == null ? '—' : e.valor) + '</td>'; }).join('') + '<td>' + gradeHtml(c.cal) + '</td></tr>';
        }).join('') + '</tbody></table></div>';
    }

    html += '<h3 style="margin-top:16px">Distribución</h3><div class="table-wrap"><table><thead><tr><th class="left">Campo</th><th>6</th><th>7-8</th><th>9-10</th><th>Prom.</th></tr></thead><tbody>' +
      CAMPOS().concat([{ id: 'PROM', nombre: 'Promedio general' }]).map(function (c) {
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
    html += desgloseMaterias(f, R, w);
    openModal(html);
  }

  /** Desglose por materia: cuánto aportó cada parte, en porcentaje (la suma de la columna = calificación × 10). */
  function desgloseMaterias(f, R, w) {
    var pct = function (pts) { return (Math.round(pts * 100) / 10) + '%'; };
    var fila = function (nombre, peso, detalle, pts) {
      return '<tr><td class="left">' + nombre + '</td><td>' + detalle + '</td><td><b>' + pct(pts) + '</b> <span class="muted">/ ' + peso + '</span></td></tr>';
    };
    var html = '<p class="muted small">Cada parte muestra cuánto porcentaje obtuvo de lo que vale. La suma es la calificación de la materia.</p>';
    CAMPOS().forEach(function (c) {
      var x = f.campos[c.id];
      html += '<div class="card" style="background:#faf9ff"><div class="row"><b class="grow">' + c.nombre + '</b>' + gradeHtml(x.cal) + '</div>';
      if (x.cal == null) { html += '<p class="muted small" style="margin:6px 0 0">Sin examen ni trabajos en este trimestre; no se califica.</p></div>'; return; }
      html += '<table style="margin-top:6px"><thead><tr><th class="left">Parte</th><th>Obtuvo</th><th>Aporta</th></tr></thead><tbody>' +
        fila('Examen', pctEf(w.examen, c.id), x.examen.reactivos == null ? 'Sin examen' : x.examen.aciertos == null ? 'Faltó' : x.examen.aciertos + '/' + x.examen.reactivos, x.examen.pts) +
        fila('Trabajos', pctEf(w.trabajos, c.id), fmt1(x.trabajos.hechos).replace('.0', '') + '/' + x.trabajos.posibles, x.trabajos.pts) +
        fila('Asistencia', pctEf(w.asistencia, c.id), f.asis.asistio + '/' + f.asis.posibles, x.asistencia.pts) +
        fila('Disciplina', pctEf(w.disciplina, c.id), f.disc.puntos == null ? '—' : f.disc.puntos + '/' + f.disc.max, x.disciplina.pts) +
        conceptosDe(c.id).map(function (k) { var e = x.extras[k.clave]; return fila(esc(k.nombre), pctEf(k.peso, c.id), e.valor == null ? '—' : e.valor + '/' + e.max, e.pts); }).join('') +
        '<tr><td class="left"><b>Total</b></td><td></td><td><b>' + pct(x.cal) + '</b> <span class="muted">/ 100%</span></td></tr>' +
        '</tbody></table></div>';
    });
    return html;
  }

  // ===================== Resumen de un alumno =====================
  function abrirResumen(id) {
    if (!confirmLeave()) return;
    closeModal();
    S.resumen = { id: id, volver: { view: S.view, mas: S.mas } };
    S.view = 'alumno'; render(); window.scrollTo(0, 0);
  }

  function viewResumenAlumno() {
    var a = S.data.alumnos.filter(function (x) { return x.id === S.resumen.id; })[0];
    if (!a) return '<div class="banner warn">Alumno no encontrado.</div>';
    var p = periodo(), w = S.data.grupo.pesos;
    var Z = Calc.resumenAlumno(S.data, a.id, S.periodoId);
    var html = '<div class="row no-print" style="margin-bottom:8px"><button class="btn ghost" data-act="resumen-volver">‹ Volver</button><span class="grow"></span><button class="btn" data-act="imprimir">🖨 Imprimir / PDF</button></div>' +
      '<div class="card"><div class="muted small">' + esc(S.data.grupo.nombre) + (S.data.escuela ? ' · ' + esc(S.data.escuela.nombre) : '') + ' · Ciclo ' + esc(S.data.grupo.ciclo || '') + '</div>' +
      '<h2 style="margin:4px 0">' + esc(a.nombre) + '</h2><div class="muted small">' + (a.activo ? 'Número de lista ' + a.num : '<b>' + esc(ESTADO_ALUMNO[a.estado]) + '</b>' + (a.fechaBaja ? ' el ' + esc(fmtDate(a.fechaBaja)) : '') + (a.nota ? ' · ' + esc(a.nota) : '')) + '</div></div>';
    if (!a.activo) return html + '<div class="banner info">El alumno ya no está activo en el grupo; sus calificaciones no se calculan.</div>';

    // Calificaciones por trimestre
    var pers = Z.porPeriodo;
    html += '<h3>Calificaciones por trimestre</h3><div class="table-wrap"><table><thead><tr><th class="left">Materia</th>' + pers.map(function (x) { return '<th>' + esc(x.periodo.nombre) + '</th>'; }).join('') + '</tr></thead><tbody>' +
      CAMPOS().map(function (c) {
        return '<tr><td class="left">' + esc(c.nombre) + '</td>' + pers.map(function (x) { return '<td>' + (x.fila ? gradeHtml(x.fila.campos[c.id].cal) : '—') + '</td>'; }).join('') + '</tr>';
      }).join('') +
      '<tr><td class="left"><b>Promedio</b></td>' + pers.map(function (x) { return '<td>' + (x.fila ? gradeHtml(x.fila.promedio) : '—') + '</td>'; }).join('') + '</tr></tbody></table></div>';

    if (!p || !Z.actual || !Z.actual.fila) return html;
    var f = Z.actual.fila;
    html += '<h3 style="margin-top:16px">' + esc(p.nombre) + ' en detalle</h3>';

    // Asistencia
    html += '<div class="stats" style="margin-bottom:8px">' +
      '<div class="stat"><b style="color:var(--ok)">' + f.asis.asistio + '/' + f.asis.posibles + '</b><span>Asistencias</span></div>' +
      '<div class="stat"><b style="color:var(--bad)">' + Z.faltas.length + '</b><span>Faltas</span></div>' +
      '<div class="stat"><b style="color:var(--warn)">' + Z.retardos.length + '</b><span>Retardos</span></div>' +
      '<div class="stat"><b style="color:var(--info)">' + Z.justificadas.length + '</b><span>Justificadas</span></div></div>';
    var lista = function (t, arr) { return arr.length ? '<div class="small"><b>' + t + ':</b> ' + arr.map(fmtDate).join(', ') + '</div>' : ''; };
    var fechas = lista('Faltas', Z.faltas) + lista('Retardos', Z.retardos) + lista('Justificadas', Z.justificadas);
    if (fechas) html += '<div class="card stack">' + fechas + '<div class="muted small">Solo incluye los días capturados en la app.</div></div>';

    // Trabajos pendientes
    html += '<h3>Trabajos no entregados</h3>';
    html += Z.pendientes.length ? '<div class="table-wrap"><table><thead><tr><th class="left">Materia</th><th class="left">Actividad</th><th>Fecha</th><th></th></tr></thead><tbody>' +
      Z.pendientes.map(function (t) { return '<tr><td class="left">' + esc(t.materia) + '</td><td class="left">' + esc(t.titulo) + '</td><td>' + esc(fmtDate(t.fecha)) + '</td><td>' + (t.valor === 0.5 ? '<span class="g g-medio">½</span>' : '<span class="g g-bajo">No</span>') + '</td></tr>'; }).join('') + '</tbody></table></div>'
      : '<div class="banner ok small">Entregó todos los trabajos registrados en la app este trimestre.</div>';

    // Exámenes
    html += '<h3 style="margin-top:16px">Exámenes</h3><div class="table-wrap"><table><thead><tr><th class="left">Materia</th><th>Diagnóstico</th><th>' + esc(p.nombre) + '</th></tr></thead><tbody>' +
      CAMPOS().map(function (c) {
        var dg = Z.diagnostico[c.id], ex = f.campos[c.id].examen;
        var celda = function (ac, re, cal) { return re == null ? '<span class="muted">—</span>' : ac == null ? 'Faltó' : ac + '/' + re + ' ' + gradeHtml(cal); };
        return '<tr><td class="left">' + esc(c.nombre) + '</td><td>' + (dg ? celda(dg.aciertos, dg.reactivos, dg.cal) : '<span class="muted">—</span>') + '</td><td>' + celda(ex.aciertos, ex.reactivos, ex.cal) + '</td></tr>';
      }).join('') + '</tbody></table></div>';

    // Disciplina y conceptos generales
    var gen = Calc.conceptos(S.data).filter(function (k) { return k.tipo === 'general'; });
    html += '<div class="card stack" style="margin-top:12px"><div class="row"><span class="grow">⭐ Disciplina</span><b>' + (f.disc.puntos == null ? 'sin capturar' : f.disc.puntos + '/' + f.disc.max) + '</b></div>' +
      gen.map(function (k) {
        var c = CAMPOS().filter(function (m) { return Calc.aplicaEn(k, m.id); })[0];
        var e = c ? f.campos[c.id].extras[k.clave] : null;
        return '<div class="row"><span class="grow">🏷️ ' + esc(k.nombre) + '</span><b>' + (!e || e.valor == null ? 'sin capturar' : e.valor + '/' + e.max) + '</b></div>';
      }).join('') + '</div>';

    // Desglose
    html += '<h3>Cómo se calculó cada materia</h3>' + desgloseMaterias(f, Z.actual.R, w);
    return html;
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
      case 'grupo': return back() + viewMiGrupo();
      case 'materias': return back() + viewMaterias();
    }
    var items = [
      ['disciplina', '⭐', 'Disciplina', 'Puntos por periodo'],
      ['diagnostico', '🧾', 'Resultados de exámenes', 'Diagnóstico y trimestrales por campo'],
      ['grupos', '🗂️', 'Mis grupos', 'Cambiar de grupo o crear uno nuevo'],
      ['grupo', '🏫', 'Mi grupo y escuela', 'Grado, grupo, ciclo escolar y escuela'],
      ['materias', '📚', 'Materias', 'Agregar, renombrar u ocultar materias'],
      ['alumnos', '👧', 'Alumnos', 'Lista, altas y bajas'],
      ['periodos', '📅', 'Periodos y porcentajes', 'Trimestres y ponderación'],
      ['carga', '📥', 'Totales de la libreta', 'Lo que ya tenías registrado antes de la app'],
      ['password', '🔑', 'Cambiar mi contraseña', ''],
      ['aviso', '🔒', 'Aviso de privacidad', '']
    ];
    if (S.user.rol === 'admin') items.push(['admin', '🔐', 'Administración', 'Usuarios y grupos']);
    return '<div class="list menu-list">' + items.map(function (i) {
      return '<div class="item" data-act="mas" data-v="' + i[0] + '"><span class="ic">' + i[1] + '</span><div class="name"><b>' + i[2] + '</b>' + (i[3] ? '<small>' + i[3] + '</small>' : '') + '</div><span>›</span></div>';
    }).join('') + '</div><div style="margin-top:14px"><button class="btn ghost" data-act="logout">Cerrar sesión</button></div>';
  }
  function back() { return '<button class="btn ghost" data-act="mas" data-v="" style="margin-bottom:8px">‹ Más</button>'; }

  function viewDisciplina(enExamenes) {
    var p = periodo();
    if (!p) return '<div class="banner warn">Configura los periodos primero.</div>';
    var D = S.disc, key = p.id + '|' + S.data.disciplina.length;
    if (D.key !== key) {
      var ix = Calc.indexar(S.data), m = ix.disciplina[p.id] || {};
      D.valores = {}; alumnosActivos().forEach(function (a) { D.valores[a.id] = m[a.id] == null ? '' : m[a.id]; });
      D.key = key; S.dirty = false;
    }
    var max = S.data.grupo.disciplinaMax;
    return (enExamenes ? '<div style="margin-top:12px"></div>' : '<h2>Disciplina · ' + esc(p.nombre) + '</h2>') +
      '<div class="banner info small">Disciplina de <b>' + esc(p.nombre) + '</b>: puntos de 0 a ' + max + '. No es una materia aparte: cuenta ' + S.data.grupo.pesos.disciplina + '% dentro de la calificación de <b>cada</b> materia.</div>' +
      '<div class="row" style="margin-bottom:10px"><button class="btn" data-act="disc-todos">Poner ' + max + ' a los vacíos</button><button class="btn" data-act="pegar-abrir" data-tipo="disc">📋 Pegar lista</button></div>' +
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
        CAMPOS().map(function (c) {
          var x = r[c.id];
          if (!x.examen) return '<tr><td class="left">' + c.nombre + '</td><td colspan="5" class="muted">Sin capturar</td></tr>';
          return '<tr><td class="left">' + c.nombre + '</td><td>' + x.examen.reactivos + '</td><td>' + x.resumen.bajo + '</td><td>' + x.resumen.medio + '</td><td>' + x.resumen.alto + '</td><td>' + gradeHtml(x.resumen.promedio) + '</td></tr>';
        }).join('') + '</tbody></table></div>';
    });
    html += '<p class="muted small" style="margin-top:10px">Para capturar o corregir un examen ve a la pestaña Exámenes.</p>';
    return html;
  }

  var ESTADO_ALUMNO = { activo: 'Activo', baja: 'Baja', transferencia: 'Transferencia' };

  function viewAlumnos() {
    var all = S.data.alumnos.slice().sort(function (a, b) { return a.num - b.num; });
    var activos = all.filter(function (a) { return a.activo; });
    var otros = all.filter(function (a) { return !a.activo; });
    var fila = function (a) {
      return '<div class="item clickable" data-act="alumno-editar" data-id="' + a.id + '"><span class="num">' + (a.activo ? a.num : '') + '</span><div class="name">' + esc(a.nombre) +
        (a.activo ? '' : '<small>' + ESTADO_ALUMNO[a.estado] + (a.fechaBaja ? ' · ' + esc(fmtDate(a.fechaBaja)) : '') + (a.nota ? ' · ' + esc(a.nota) : '') + '</small>') + '</div>' +
        (a.activo ? '' : '<span class="badge off">' + ESTADO_ALUMNO[a.estado] + '</span>') + '<span>›</span></div>';
    };
    return '<h2>Alumnos (' + activos.length + ' activos)</h2><p class="muted small">La lista se ordena sola por orden alfabético (apellido paterno, materno y nombre) cada vez que agregas o corriges un alumno.</p>' +
      '<div class="list">' + (activos.length ? activos.map(fila).join('') : '<div class="item muted">Sin alumnos activos</div>') + '</div>' +
      (otros.length ? '<h3 style="margin-top:16px">Bajas y transferencias (' + otros.length + ')</h3><p class="muted small">Ya no aparecen en la lista ni en las calificaciones, pero su historial se conserva.</p><div class="list">' + otros.map(fila).join('') + '</div>' : '') +
      tarjetaAgregar();
  }

  var FORMATOS = {
    apellidos: { titulo: 'Apellidos primero', ej: 'PÉREZ LÓPEZ MARÍA FERNANDA', corto: 'apellidos primero (paterno, materno y nombre)' },
    nombre: { titulo: 'Nombre primero', ej: 'MARÍA FERNANDA PÉREZ LÓPEZ', corto: 'nombre primero y después los apellidos' }
  };

  function tarjetaAgregar() {
    var fmt = S.data.grupo.formatoNombre;
    if (!fmt || S.elegirFormato) {
      return '<div class="card stack" style="margin-top:14px"><h3>¿Cómo escribes los nombres en este grupo?</h3>' +
        '<p class="muted small">La lista se ordena alfabéticamente según como estén escritos, así que todos los alumnos del grupo deben escribirse igual.' + (S.data.alumnos.length && !fmt ? ' Revisa cómo están los que ya tienes y elige ese mismo formato.' : '') + '</p>' +
        Object.keys(FORMATOS).map(function (k) {
          return '<button class="btn block' + (k === fmt ? ' primary' : '') + '" style="text-align:left" data-act="formato-elegir" data-v="' + k + '"><b>' + FORMATOS[k].titulo + '</b><br><span class="small" style="font-weight:400">Ej: ' + FORMATOS[k].ej + '</span></button>';
        }).join('') +
        (fmt ? '<p class="muted small">Cambiar el formato no modifica los nombres que ya registraste; si cambias, corrígelos para que el orden quede bien.</p><button class="btn ghost" data-act="formato-cancelar">Cancelar</button>' : '') + '</div>';
    }
    var F = FORMATOS[fmt];
    return '<div class="card stack" style="margin-top:14px"><h3>Agregar alumnos</h3>' +
      '<div class="banner info small" style="margin:0">📌 En este grupo los nombres se escriben con <b>' + F.corto + '</b>.<br>Ejemplo: <b>' + F.ej + '</b> <a href="#" data-act="formato-cambiar" style="margin-left:6px">cambiar</a></div>' +
      '<p class="muted small" style="margin:0">Uno por renglón. Se acomodan en orden alfabético automáticamente.</p>' +
      '<textarea id="nuevos-alumnos" placeholder="' + F.ej + '" autocapitalize="characters" spellcheck="false"></textarea><button class="btn primary" data-act="alumnos-agregar">Agregar</button></div>';
  }

  function viewPeriodos() {
    var w = S.data.grupo.pesos;
    var sep = S.data.grupo.calendarioSep;
    var html = '<h2>Periodos</h2><p class="muted small">Las asistencias, trabajos y exámenes se agrupan por estas fechas. Un trimestre que todavía no empieza no se puede seleccionar.</p>' +
      (sep ? '<div class="card"><b>Calendario oficial SEP ' + esc(S.data.grupo.ciclo) + '</b><p class="muted small" style="margin:4px 0 10px">Pone las fechas oficiales de T1, T2 y T3 y marca los días sin clase (CTE, suspensiones y vacaciones). Lo que ya capturaste se conserva.</p><button class="btn primary" data-act="aplicar-sep">Usar calendario SEP</button></div>' : '') +
      '<div id="periodos">' +
      S.data.periodos.map(function (p) { return periodoRow(p); }).join('') + '</div>' +
      '<div class="row" style="margin:10px 0 18px"><button class="btn" data-act="periodo-agregar">+ Agregar periodo</button><button class="btn primary" data-act="periodos-guardar">Guardar periodos</button></div>' +
      '<h2>Porcentajes de la calificación</h2><p class="muted small">Cuánto vale cada parte dentro de la calificación de cada materia. Todo junto debe sumar 100%.</p><div class="card stack">' +
      [['examen', 'Examen'], ['trabajos', 'Trabajos y tareas'], ['asistencia', 'Asistencia'], ['disciplina', 'Disciplina']].map(function (k) {
        return '<label class="field"><span>' + k[1] + ' (%)</span><input type="number" min="0" max="100" class="peso-input" data-input="peso" id="peso-' + k[0] + '" value="' + w[k[0]] + '"></label>';
      }).join('') +
      '<label class="field"><span>Puntos máximos de disciplina</span><input type="number" min="1" id="disc-max" value="' + S.data.grupo.disciplinaMax + '"></label></div>' +
      '<h3>Otros conceptos</h3><p class="muted small">Agrega lo que también califiques: participación, proyecto, cuaderno, tareas en casa… Se capturan en la pestaña Exámenes, junto a Disciplina.</p>' +
      '<div id="conceptos">' + Calc.conceptos(S.data).map(conceptoRow).join('') + '</div>' +
      '<div class="row" style="margin:6px 0 10px"><button class="btn" data-act="concepto-agregar">+ Agregar concepto</button></div>' +
      '<div class="card row"><span class="grow">Total</span><b id="peso-suma"></b></div>' +
      '<button class="btn primary block" data-act="pesos-guardar">Guardar porcentajes</button>';
    setTimeout(actualizarSumaPesos, 0);
    return html;
  }
  function conceptoRow(k) {
    k = k || { nombre: '', peso: '', max: 10, tipo: 'general' };
    return '<div class="card concepto" data-clave="' + esc(k.clave || '') + '">' +
      '<label class="field"><span>Nombre</span><input type="text" class="k-nombre" maxlength="40" value="' + esc(k.nombre) + '" placeholder="Ej: Participación"></label>' +
      '<div class="row nowrap" style="margin-top:8px"><label class="field grow"><span>Porcentaje (%)</span><input type="number" min="0" max="100" class="k-peso peso-input" data-input="peso" value="' + esc(k.peso) + '"></label>' +
      '<label class="field grow"><span>Puntos máximos</span><input type="number" min="1" class="k-max" value="' + esc(k.max) + '"></label></div>' +
      '<div class="field" style="margin-top:8px"><span>Aplica en</span><div class="chips" style="flex-wrap:wrap">' + CAMPOS().map(function (c) {
        var on = !k.materias || !k.materias.length || k.materias.indexOf(c.id) >= 0;
        return '<label class="chip" style="display:inline-flex;gap:6px;align-items:center"><input type="checkbox" class="k-mat" value="' + c.id + '"' + (on ? ' checked' : '') + '>' + esc(c.nombre) + '</label>';
      }).join('') + '</div><span class="muted small">En las materias donde no aplica, su porcentaje se reparte proporcionalmente en las demás partes.</span></div>' +
      '<label class="field" style="margin-top:8px"><span>Se califica</span><select class="k-tipo"><option value="general"' + (k.tipo === 'general' ? ' selected' : '') + '>Una sola vez para todas las materias (como disciplina)</option><option value="materia"' + (k.tipo === 'materia' ? ' selected' : '') + '>Por separado en cada materia</option></select></label>' +
      '<div class="row" style="margin-top:8px"><span class="grow"></span><button class="btn ghost small" style="color:var(--bad)" data-act="concepto-quitar">' + (k.clave ? 'Eliminar' : 'Quitar') + '</button></div></div>';
  }

  function actualizarSumaPesos() {
    var el = document.getElementById('peso-suma');
    if (!el) return;
    var sum = Array.prototype.reduce.call(document.querySelectorAll('.peso-input'), function (s, i) { return s + (Number(i.value) || 0); }, 0);
    sum = Math.round(sum * 100) / 100;
    el.textContent = sum + '%';
    el.style.color = sum === 100 ? 'var(--ok)' : 'var(--bad)';
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
    var conceptos = [['ASIS', 'Asistencia']].concat(CAMPOS().map(function (c) { return ['TRAB_' + c.id, 'Trabajos ' + c.nombre]; }));
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
        return '<div class="item clickable" data-act="usuario-editar" data-id="' + u.id + '"><div class="name"><b>' + esc(u.nombre) + '</b><small>@' + esc(u.usuario) + '</small></div><span class="badge' + (u.activo ? '' : ' off') + '">' + (u.activo ? (u.rol === 'admin' ? 'admin' : u.rol === 'maestro' ? 'Maestro' : 'Maestra') : 'inactivo') + '</span><span>›</span></div>';
      }).join('') + '</div>' +
      '<div class="row" style="margin-top:18px"><h2 class="grow">Grupos</h2><button class="btn primary" data-act="grupo-nuevo">+ Grupo</button></div>' +
      '<div class="list">' + S.groups.map(function (g) {
        return '<div class="item clickable" data-act="grupo-editar" data-id="' + g.id + '"><div class="name"><b>' + esc(g.nombre) + '</b><small>' + [g.escuela, g.ciclo, g.maestra || 'Sin docente asignado'].filter(Boolean).map(esc).join(' · ') + '</small></div>' + (g.activo ? '' : '<span class="badge off">Inactivo</span>') + '<span>›</span></div>';
      }).join('') + '</div>';
    return html;
  }

  function modalUsuario(u) {
    u = u || { rol: '', activo: true };
    openModal('<div class="row"><h2 class="grow">' + (u.id ? 'Editar usuario' : 'Nuevo usuario') + '</h2><button class="icon-btn" data-act="cerrar-modal">✕</button></div><form id="form-usuario" class="stack">' +
      '<label class="field"><span>Usuario (para entrar)</span><input type="text" name="usuario" value="' + esc(u.usuario || '') + '" ' + (u.id ? 'disabled' : 'required') + ' autocapitalize="none" placeholder="adriana"></label>' +
      '<label class="field"><span>Nombre</span><input type="text" name="nombre" value="' + esc(u.nombre || '') + '" required></label>' +
      '<label class="field"><span>Rol</span><select name="rol" required>' + (u.id ? '' : '<option value="">— Elige —</option>') + '<option value="maestra"' + (u.rol === 'maestra' ? ' selected' : '') + '>Maestra</option><option value="maestro"' + (u.rol === 'maestro' ? ' selected' : '') + '>Maestro</option><option value="admin"' + (u.rol === 'admin' ? ' selected' : '') + '>Administrador</option></select></label>' +
      '<label class="field"><span>' + (u.id ? 'Nueva contraseña (déjalo vacío para no cambiarla)' : 'Contraseña inicial (mínimo 8)') + '</span><input type="text" name="password" autocomplete="off"' + (u.id ? '' : ' required minlength="8"') + '></label>' +
      '<label class="row"><input type="checkbox" name="activo"' + (u.activo ? ' checked' : '') + '> Activo (puede entrar)</label>' +
      '<button class="btn primary block" type="submit">Guardar</button></form>' +
      (u.id && u.id !== S.user.id ? '<div style="margin-top:18px;border-top:1px solid var(--line);padding-top:14px"><button class="btn danger block" data-act="usuario-eliminar" data-id="' + u.id + '">Eliminar usuario</button></div>' : ''));
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

  function loadSchools() {
    return api('listSchools').then(function (l) { S.schools = l; return l; });
  }

  function escuelaOptions(sel) {
    return '<option value="">— Sin escuela —</option>' + (S.schools || []).map(function (e) {
      return '<option value="' + e.id + '"' + (e.id === sel ? ' selected' : '') + '>' + esc(e.nombre) + (e.cct ? ' (' + esc(e.cct) + ')' : '') + '</option>';
    }).join('') + '<option value="__nueva">+ Registrar otra escuela…</option>';
  }

  function gradoOptions(sel) {
    return [1, 2, 3, 4, 5, 6].map(function (n) { return '<option value="' + n + '"' + (String(n) === String(sel) ? ' selected' : '') + '>' + n + '°</option>'; }).join('');
  }

  function cicloActual() { var d = new Date(), y = d.getFullYear(); return d.getMonth() >= 7 ? y + '-' + (y + 1) : (y - 1) + '-' + y; }

  function modalGrupo(g) {
    var esAdmin = S.user.rol === 'admin';
    g = g || { activo: true, ciclo: cicloActual(), grado: '', letra: '' };
    var ready = [loadSchools()];
    if (esAdmin && !S.admin.users) ready.push(api('listUsers').then(function (u) { S.admin.users = u; }));
    openModal('<div class="loading"><div class="spinner"></div></div>');
    Promise.all(ready).then(function () {
      var users = S.admin.users || [];
      openModal('<div class="row"><h2 class="grow">' + (g.id ? 'Editar grupo' : 'Nuevo grupo') + '</h2><button class="icon-btn" data-act="cerrar-modal">✕</button></div><form id="form-grupo" class="stack" data-id="' + (g.id || '') + '">' +
        '<div class="row nowrap"><label class="field grow"><span>Grado</span><select name="grado" required><option value="">—</option>' + gradoOptions(g.grado) + '</select></label>' +
        '<label class="field grow"><span>Grupo</span><input type="text" name="letra" value="' + esc(g.letra || '') + '" maxlength="3" placeholder="D" required style="text-transform:uppercase"></label></div>' +
        '<label class="field"><span>Ciclo escolar</span><input type="text" name="ciclo" value="' + esc(g.ciclo || '') + '" placeholder="2026-2027"></label>' +
        '<label class="field"><span>Escuela</span><select name="escuelaId" data-change="escuela-select">' + escuelaOptions(g.escuelaId) + '</select></label>' +
        (esAdmin ? '<label class="field"><span>Docente asignado</span><select name="usuarioId"><option value="">— Sin asignar —</option>' + users.map(function (u) {
          return '<option value="' + u.id + '"' + (u.id === g.usuarioId ? ' selected' : '') + '>' + esc(u.nombre) + ' (@' + esc(u.usuario) + ')</option>';
        }).join('') + '</select></label>' : '') +
        '<label class="row"><input type="checkbox" name="activo"' + (g.activo ? ' checked' : '') + '> Activo (desmárcalo para archivar el grupo al terminar el ciclo)</label>' +
        '<button class="btn primary block" type="submit">Guardar</button></form>' +
        (esAdmin && g.id ? '<div style="margin-top:18px;border-top:1px solid var(--line);padding-top:14px"><button class="btn danger block" data-act="grupo-eliminar" data-id="' + g.id + '">Eliminar grupo</button></div>' : ''));
      document.getElementById('form-grupo').addEventListener('submit', function (e) {
        e.preventDefault();
        var f = e.target;
        var p = { id: g.id, grado: f.grado.value, letra: f.letra.value, ciclo: f.ciclo.value.trim(), escuelaId: f.escuelaId.value === '__nueva' ? '' : f.escuelaId.value, activo: f.activo.checked };
        if (esAdmin) p.usuarioId = f.usuarioId.value;
        busy(f.querySelector('button[type=submit]'), api('saveGroup', p), 'Grupo guardado').then(function (r) {
          closeModal();
          var esNuevo = !g.id;
          if (esNuevo && (!esAdmin || p.usuarioId === S.user.id || !p.usuarioId)) { S.grupoId = r.id; S.view = 'asistencia'; S.mas = null; S.data = null; S.periodoId = null; saveSession(); }
          return loadGroups().then(function () { render(); return esNuevo && S.grupoId === r.id ? loadGroupData() : refresh(); });
        });
      });
    }).catch(function (e) { closeModal(); toast(e.message, true); });
  }

  function modalEscuela(e, onSaved) {
    e = e || {};
    var turnos = ['Matutino', 'Vespertino', 'Tiempo completo', 'Nocturno', 'Discontinuo'];
    openModal('<div class="row"><h2 class="grow">' + (e.id ? 'Editar escuela' : 'Registrar escuela') + '</h2><button class="icon-btn" data-act="cerrar-modal">✕</button></div><form id="form-escuela" class="stack">' +
      '<label class="field"><span>Nombre de la escuela</span><input type="text" name="nombre" value="' + esc(e.nombre || '') + '" required placeholder="Esc. Prim. Benito Juárez"></label>' +
      '<label class="field"><span>Clave de centro de trabajo (CCT), opcional</span><input type="text" name="cct" value="' + esc(e.cct || '') + '" placeholder="14DPR1234X" style="text-transform:uppercase"></label>' +
      '<label class="field"><span>Turno</span><select name="turno"><option value="">—</option>' + turnos.map(function (t) { return '<option' + (t === e.turno ? ' selected' : '') + '>' + t + '</option>'; }).join('') + '</select></label>' +
      '<label class="field"><span>Municipio</span><input type="text" name="municipio" value="' + esc(e.municipio || '') + '" placeholder="Zapopan"></label>' +
      '<button class="btn primary block" type="submit">Guardar escuela</button></form>');
    document.getElementById('form-escuela').addEventListener('submit', function (ev) {
      ev.preventDefault();
      var f = ev.target;
      busy(f.querySelector('button[type=submit]'), api('saveSchool', { id: e.id, nombre: f.nombre.value, cct: f.cct.value, turno: f.turno.value, municipio: f.municipio.value }), 'Escuela guardada')
        .then(function (r) { closeModal(); if (onSaved) onSaved(r); });
    });
  }

  function viewMiGrupo() {
    var G = S.data.grupo, E = S.data.escuela;
    if (S.schools === null) { S.schools = undefined; loadSchools().then(render).catch(function (e) { toast(e.message, true); }); }
    var puede = E && (S.schools || []).some(function (x) { return x.id === E.id && x.puedeEditar; });
    return '<h2>Mi grupo</h2><div class="card"><div class="row"><div class="grow"><b style="font-size:1.2rem">' + esc(G.nombre) + '</b><div class="muted small">Ciclo ' + esc(G.ciclo || 'sin definir') + '</div></div>' +
      '<button class="btn" data-act="mi-grupo-editar">Editar</button></div></div>' +
      '<h2>Escuela</h2><div class="card">' + (E ?
        '<b>' + esc(E.nombre) + '</b><div class="muted small">' + [E.cct, E.turno, E.municipio].filter(Boolean).map(esc).join(' · ') + '</div>' +
        '<div class="row" style="margin-top:10px">' + (puede ? '<button class="btn" data-act="escuela-editar">Editar datos de la escuela</button>' : '') + '<button class="btn ghost" data-act="mi-grupo-editar">Cambiar de escuela</button></div>'
        : '<p class="muted">Este grupo no tiene escuela asignada.</p><button class="btn primary" data-act="mi-grupo-editar">Asignar escuela</button>') + '</div>' +
      '<p class="muted small">Los alumnos se editan en Más → Alumnos y las materias en Más → Materias.</p>';
  }

  function viewMaterias() {
    if (!S.matEdit) S.matEdit = S.data.materias.map(function (m) { return { clave: m.clave, nombre: m.nombre, corto: m.corto, activo: m.activo }; });
    var L = S.matEdit;
    return '<h2>Materias</h2><p class="muted small">Cada materia tiene sus propios trabajos y exámenes. Ocultarla no borra lo que ya capturaste. El “nombre corto” se usa en botones y tablas.</p>' +
      L.map(function (m, i) {
        return '<div class="card" style="' + (m.activo ? '' : 'opacity:.6') + '"><label class="field"><span>Nombre</span><input type="text" data-input="mat-nombre" data-i="' + i + '" value="' + esc(m.nombre) + '" placeholder="Ej: Inglés"></label>' +
          '<div class="row nowrap" style="margin-top:8px"><label class="field grow"><span>Nombre corto</span><input type="text" maxlength="20" data-input="mat-corto" data-i="' + i + '" value="' + esc(m.corto) + '"></label>' +
          '<button class="icon-btn" data-act="mat-mover" data-i="' + i + '" data-d="-1" title="Subir">↑</button><button class="icon-btn" data-act="mat-mover" data-i="' + i + '" data-d="1" title="Bajar">↓</button></div>' +
          '<div class="row" style="margin-top:8px"><label class="row small grow"><input type="checkbox" data-act="mat-activo" data-i="' + i + '"' + (m.activo ? ' checked' : '') + '> Visible</label>' +
          (m.clave ? '<button class="btn ghost small" style="color:var(--bad)" data-act="mat-eliminar" data-clave="' + esc(m.clave) + '">Eliminar</button>' : '<button class="btn ghost small" style="color:var(--bad)" data-act="mat-quitar-nueva" data-i="' + i + '">Quitar</button>') + '</div></div>';
      }).join('') +
      '<div class="row" style="margin-top:6px"><button class="btn" data-act="mat-agregar">+ Agregar materia</button></div>' +
      '<p class="muted small" style="margin-top:10px"><b>Ocultar</b> (quitar “Visible”) conserva lo capturado y puedes volver a mostrarla. <b>Eliminar</b> borra la materia y todos sus trabajos y exámenes para siempre.</p>' +
      '<div class="sticky-actions"><div class="inner"><button class="btn primary" data-act="mat-guardar">Guardar materias</button></div></div>';
  }

  function modalAlumno(a) {
    var estadoSel = a.estado || (a.activo ? 'activo' : 'baja');
    openModal('<div class="row"><h2 class="grow">Editar alumno</h2><button class="icon-btn" data-act="cerrar-modal">✕</button></div><form id="form-alumno" class="stack">' +
      '<label class="field"><span>Nombre completo' + (FORMATOS[S.data.grupo.formatoNombre] ? ' (' + FORMATOS[S.data.grupo.formatoNombre].corto + ')' : '') + '</span><input type="text" name="nombre" value="' + esc(a.nombre) + '" required autocapitalize="characters" spellcheck="false"></label>' +
      '<label class="field"><span>Situación</span><select name="estado" id="alumno-estado">' + Object.keys(ESTADO_ALUMNO).map(function (k) {
        return '<option value="' + k + '"' + (k === estadoSel ? ' selected' : '') + '>' + ESTADO_ALUMNO[k] + '</option>';
      }).join('') + '</select></label>' +
      '<div id="alumno-baja" class="stack"' + (estadoSel === 'activo' ? ' hidden' : '') + '>' +
      '<label class="field"><span>Fecha</span><input type="date" name="fechaBaja" value="' + esc(a.fechaBaja || today()) + '"></label>' +
      '<label class="field"><span id="alumno-nota-label">' + (estadoSel === 'transferencia' ? 'Escuela o grupo de destino' : 'Motivo (opcional)') + '</span><input type="text" name="nota" maxlength="200" value="' + esc(a.nota || '') + '"></label>' +
      '<p class="muted small">El alumno sale de la lista y de las calificaciones, pero su historial se conserva. Puedes reactivarlo cuando quieras.</p></div>' +
      '<button class="btn primary block" type="submit">Guardar</button></form>' +
      '<button class="btn block" style="margin-top:10px" data-act="resumen-abrir" data-id="' + a.id + '">📄 Ver resumen del alumno</button>');
    var sel = document.getElementById('alumno-estado');
    sel.addEventListener('change', function () {
      document.getElementById('alumno-baja').hidden = sel.value === 'activo';
      document.getElementById('alumno-nota-label').textContent = sel.value === 'transferencia' ? 'Escuela o grupo de destino' : 'Motivo (opcional)';
    });
    document.getElementById('form-alumno').addEventListener('submit', function (e) {
      e.preventDefault();
      var f = e.target;
      var nombre = limpiarNombre(f.nombre.value);
      if (!nombre) return toast('Escribe el nombre con letras', true);
      var al = { id: a.id, nombre: nombre, estado: f.estado.value };
      if (al.estado !== 'activo') { al.fechaBaja = f.fechaBaja.value; al.nota = f.nota.value; }
      var msg = al.estado === 'activo' ? 'Alumno guardado' : (al.estado === 'baja' ? 'Alumno dado de baja' : 'Transferencia registrada');
      busy(f.querySelector('button[type=submit]'), api('saveStudents', { grupoId: S.grupoId, alumnos: [al] }), msg)
        .then(function () { closeModal(); S.asis = null; return refresh(); });
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
      var usadas = {};
      var nombreHoja = function (n) {
        var base = String(n).toUpperCase().replace(/[\\\/\?\*\[\]:]/g, ' ').trim().slice(0, 28) || 'HOJA', k = base, i = 2;
        while (usadas[k]) k = base + ' ' + i++;
        usadas[k] = true; return k;
      };
      var r2 = function (n) { return n == null ? '' : Math.round(n * 100) / 100; };
      // Resumen
      var res = [['CALIFICACIONES ' + p.nombre + ' — ' + g.nombre + ' ' + (g.ciclo || '')], [S.data.escuela ? S.data.escuela.nombre + (S.data.escuela.cct ? ' · CCT ' + S.data.escuela.cct : '') : ''], ['# LISTA', 'ALUMNO'].concat(CAMPOS().map(function (c) { return c.largo; })).concat(['PROMEDIO'])];
      R.alumnos.forEach(function (f) { res.push([f.alumno.num, f.alumno.nombre].concat(CAMPOS().map(function (c) { return r2(f.campos[c.id].cal); })).concat([r2(f.promedio)])); });
      res.push([], ['DISTRIBUCIÓN', '', 'CAL 6', 'CAL 7-8', 'CAL 9-10', 'PROMEDIO']);
      CAMPOS().forEach(function (c) { var d = R.resumen[c.id]; res.push([c.largo, '', d.bajo, d.medio, d.alto, r2(d.promedio)]); });
      XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(res), nombreHoja('RESUMEN ' + p.nombre));
      // Una hoja por campo, mismo formato que el Excel original
      CAMPOS().forEach(function (c) {
        var pc = R.porCampo[c.id];
        var rows = [['CAMPO FORMATIVO DE ' + c.largo + ' — ' + p.nombre],
          ['# LISTA', 'ALUMNO', 'REACTIVOS', 'ACIERTOS', 'CALIFICACIÓN', 'EXAMEN ' + pctEf(g.pesos.examen, c.id), 'TRABAJOS REALIZADOS (de ' + pc.posibles + ')', 'TRABAJOS ' + pctEf(g.pesos.trabajos, c.id), 'ASISTENCIAS (de ' + R.posiblesAsis + ')', 'ASISTENCIA ' + pctEf(g.pesos.asistencia, c.id), 'DISCIPLINA (de ' + g.disciplinaMax + ')', 'DISCIPLINA ' + pctEf(g.pesos.disciplina, c.id)].concat([].concat.apply([], conceptosDe(c.id).map(function (k) { return [k.nombre.toUpperCase() + ' (de ' + k.max + ')', k.nombre.toUpperCase() + ' ' + pctEf(k.peso, c.id)]; }))).concat(['PROMEDIO'])];
        R.alumnos.forEach(function (f) {
          var x = f.campos[c.id];
          rows.push([f.alumno.num, f.alumno.nombre, x.examen.reactivos == null ? '' : x.examen.reactivos, x.examen.aciertos == null ? '' : x.examen.aciertos,
            x.examen.cal == null ? 'Faltó' : r2(x.examen.cal), r2(x.examen.pts), x.trabajos.hechos, r2(x.trabajos.pts), f.asis.asistio, r2(x.asistencia.pts),
            f.disc.puntos == null ? '' : f.disc.puntos, r2(x.disciplina.pts)].concat([].concat.apply([], conceptosDe(c.id).map(function (k) { var e = x.extras[k.clave]; return [e.valor == null ? '' : e.valor, r2(e.pts)]; }))).concat([r2(x.cal)]));
        });
        XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), nombreHoja(c.nombre));
      });
      // Diagnóstico
      var diag = Calc.resultadosExamen(S.data, 'diagnostico');
      var ix = Calc.indexar(S.data);
      var drows = [['RESULTADOS EXAMEN DIAGNÓSTICO'], ['# LISTA', 'ALUMNO'].concat([].concat.apply([], CAMPOS().map(function (c) { return [c.nombre + ' REACTIVOS', 'ACIERTOS', 'CALIFICACIÓN']; })))];
      alumnosActivos().forEach(function (a) {
        var row = [a.num, a.nombre];
        CAMPOS().forEach(function (c) {
          var ex = diag[c.id].examen, ac = ex ? (ix.resultados[ex.id] || {})[a.id] : null;
          row.push(ex ? ex.reactivos : '', ac == null ? '' : ac, ex && ac != null ? r2(ac / ex.reactivos * 10) : 'Faltó');
        });
        drows.push(row);
      });
      XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(drows), nombreHoja('DIAGNÓSTICO'));
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
    mas: function (el) {
      if (!confirmLeave()) return;
      if (S.view !== 'mas') S.view = 'mas'; S.mas = el.dataset.v || null; S.matEdit = null; S.elegirFormato = false;
      if (S.mas === 'aviso') { S.mas = null; window.open('aviso-privacidad.html', '_blank'); return; }
      if (S.mas === 'grupos') { S.mas = null; S.view = 'grupos'; render(); window.scrollTo(0, 0); return; } if (S.mas === 'admin') S.admin.users = null; S.disc.key = null; S.carga.key = null; render(); window.scrollTo(0, 0); },

    // Asistencia
    'asis-dia': function (el) {
      if (!confirmLeave()) return;
      var d = Number(el.dataset.d), f = addDays(S.asis.fecha, d);
      // Brinca fines de semana
      while ([0, 6].indexOf(new Date(f + 'T12:00:00').getDay()) >= 0) f = addDays(f, d);
      if (f > today()) return toast('No puedes pasar lista de días que todavía no llegan', true);
      ensureAsis(f); render();
    },
    'asis-hoy': function () {
      var f = today();
      while ([0, 6].indexOf(new Date(f + 'T12:00:00').getDay()) >= 0) f = addDays(f, -1);
      ensureAsis(f); render();
    },
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
      var per = periodo();
      if (per && (E.fecha < per.inicio || E.fecha > per.fin)) return toast('La fecha debe estar dentro de ' + per.nombre + ' (' + fmtDate(per.inicio) + ' – ' + fmtDate(per.fin) + ')', true);
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
    'ex-campo': function (el) { if (!confirmLeave()) return; S.ex.campo = el.dataset.v; S.ex.key = null; S.disc.key = null; S.pts.key = null; render(); },
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

    'pegar-abrir': function (el) { modalPegar(el.dataset.tipo); },
    'pegar-revisar': function (el) { revisarPegado(el); },
    'pegar-aplicar': function (el) {
      var res = revisarPegado(el);
      var dest = el.dataset.tipo === 'ex' ? S.ex.valores : el.dataset.tipo === 'pts' ? S.pts.valores : S.disc.valores;
      Object.keys(res.valores).forEach(function (k) { dest[k] = res.valores[k]; });
      S.dirty = true; closeModal(); render();
      toast(res.asignados + ' alumnos llenados. Revisa y toca Guardar.');
    },
    'pts-materia': function (el) { if (!confirmLeave()) return; S.pts.materia = el.dataset.v; S.pts.key = null; render(); },
    'pts-todos': function () { var k = conceptoPorClave(S.ex.campo.slice(2)); Object.keys(S.pts.valores).forEach(function (a) { if (S.pts.valores[a] === '') S.pts.valores[a] = k.max; }); S.dirty = true; render(); },
    'pts-guardar': function (el) {
      var k = conceptoPorClave(S.ex.campo.slice(2)), P = S.pts;
      var regs = Object.keys(P.valores).map(function (a) { return { alumnoId: a, valor: P.valores[a] === '' ? null : Number(P.valores[a]) }; });
      busy(el, api('savePuntos', { grupoId: S.grupoId, periodoId: S.periodoId, concepto: k.clave, materia: k.tipo === 'materia' ? P.materia : '', registros: regs }), k.nombre + ' guardado')
        .then(function () { S.dirty = false; P.key = null; return refresh(); });
    },
    'ir-concepto': function (el) { if (!confirmLeave()) return; S.view = 'examenes'; S.ex.campo = 'K:' + el.dataset.v; S.pts.key = null; render(); window.scrollTo(0, 0); },
    'ir-disciplina': function () { if (!confirmLeave()) return; S.view = 'examenes'; S.ex.campo = 'DISC'; S.disc.key = null; render(); window.scrollTo(0, 0); },

    // Calificaciones
    'cal-tab': function (el) { S.cal.tab = el.dataset.v; render(); },
    'cal-detalle': function (el) { abrirResumen(el.dataset.id); },
    'resumen-abrir': function (el) { abrirResumen(el.dataset.id); },
    'resumen-volver': function () { var v = S.resumen && S.resumen.volver; S.view = v ? v.view : 'calificaciones'; S.mas = v ? v.mas : null; render(); },
    imprimir: function () { window.print(); },
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
      var lines = document.getElementById('nuevos-alumnos').value.split(/\n+/).map(limpiarNombre).filter(function (s) { return /[A-ZÀ-Þ]/.test(s); });
      if (!lines.length) return toast('Escribe al menos un nombre', true);
      var F = FORMATOS[S.data.grupo.formatoNombre];
      if (F && !confirm('Recordatorio: en este grupo los nombres van con ' + F.corto + '.\nEjemplo: ' + F.ej + '\n\nVas a agregar:\n' + lines.slice(0, 10).join('\n') + (lines.length > 10 ? '\n…y ' + (lines.length - 10) + ' más' : '') + '\n\n¿Están escritos así?')) return;
      var alumnos = lines.map(function (n) { return { nombre: n }; });
      busy(el, api('saveStudents', { grupoId: S.grupoId, alumnos: alumnos }), lines.length + ' alumno(s) agregado(s)').then(function () { S.asis = null; return refresh(); });
    },

    // Periodos
    'aplicar-sep': function (el) {
      if (!confirm('¿Aplicar el calendario oficial SEP? Se ajustarán las fechas de los trimestres y se marcarán los días sin clase.')) return;
      busy(el, api('applySepCalendar', { grupoId: S.grupoId })).then(function (r) {
        toast('Calendario aplicado: ' + r.diasAgregados + ' días sin clase marcados' + (r.omitidos.length ? ' (' + r.omitidos.length + ' ya tenían lista y se respetaron)' : ''));
        S.periodoId = null; S.asis = null; return loadGroupData(true);
      });
    },
    'periodo-agregar': function () { document.getElementById('periodos').insertAdjacentHTML('beforeend', periodoRow({ nombre: 'T' + (document.querySelectorAll('.periodo').length + 1) })); },
    'periodos-guardar': function (el) {
      var ps = Array.prototype.map.call(document.querySelectorAll('.periodo'), function (c) {
        return { id: c.dataset.id || null, nombre: c.querySelector('.p-nombre').value, inicio: c.querySelector('.p-inicio').value, fin: c.querySelector('.p-fin').value };
      }).filter(function (p) { return p.nombre && p.inicio && p.fin; });
      busy(el, api('savePeriodos', { grupoId: S.grupoId, periodos: ps }), 'Periodos guardados').then(function () { S.dirty = false; return refresh(); });
    },
    'pesos-guardar': function (el) {
      var w = {}; ['examen', 'trabajos', 'asistencia', 'disciplina'].forEach(function (k) { w[k] = Number(document.getElementById('peso-' + k).value); });
      var ks = Array.prototype.map.call(document.querySelectorAll('.concepto'), function (c) {
        var todas = c.querySelectorAll('.k-mat'), marcadas = Array.prototype.filter.call(todas, function (i) { return i.checked; }).map(function (i) { return i.value; });
        return { clave: c.dataset.clave || null, nombre: c.querySelector('.k-nombre').value, peso: Number(c.querySelector('.k-peso').value), max: Number(c.querySelector('.k-max').value), tipo: c.querySelector('.k-tipo').value,
          materias: marcadas.length === todas.length ? [] : marcadas, ninguna: !marcadas.length };
      });
      var vacia = ks.filter(function (k) { return k.ninguna; })[0];
      if (vacia) return toast('Marca al menos una materia en "' + (vacia.nombre || 'el concepto') + '"', true);
      busy(el, api('saveGroupSettings', { grupoId: S.grupoId, pesos: w, conceptos: ks, disciplinaMax: Number(document.getElementById('disc-max').value) }), 'Porcentajes guardados').then(function () { S.dirty = false; return refresh(); });
    },
    'concepto-agregar': function () { document.getElementById('conceptos').insertAdjacentHTML('beforeend', conceptoRow(null)); actualizarSumaPesos(); },
    'concepto-quitar': function (el) {
      var card = el.closest('.concepto'), clave = card.dataset.clave;
      if (!clave) { card.remove(); actualizarSumaPesos(); return; }
      var k = conceptoPorClave(clave);
      var r = prompt('Vas a ELIMINAR el concepto "' + k.nombre + '" y todo lo capturado en él. No se puede deshacer.\n\nDespués ajusta los porcentajes para que vuelvan a sumar 100%.\n\nEscribe ELIMINAR para confirmar:');
      if (r === null) return;
      if (r.trim().toUpperCase() !== 'ELIMINAR') return toast('No se eliminó: no escribiste ELIMINAR', true);
      busy(el, api('deleteConcepto', { grupoId: S.grupoId, clave: clave })).then(function (res) {
        toast('Concepto eliminado. Reparte su ' + res.peso + '% en otra parte y guarda.');
        card.remove(); actualizarSumaPesos();
        S.data.conceptos = S.data.conceptos.filter(function (x) { return x.clave !== clave; });
      });
    },

    // Contraseña
    'pw-guardar': function (el) {
      var a = document.getElementById('pw-actual').value, n = document.getElementById('pw-nueva').value, n2 = document.getElementById('pw-nueva2').value;
      if (n !== n2) return toast('Las contraseñas nuevas no coinciden', true);
      busy(el, api('changePassword', { actual: a, nueva: n }), 'Contraseña cambiada').then(function () { S.mas = null; render(); });
    },

    // Admin
    'usuario-nuevo': function () { modalUsuario(null); },
    'usuario-eliminar': function (el) {
      var u = (S.admin.users || []).filter(function (x) { return x.id === el.dataset.id; })[0];
      if (!u) return;
      var suyos = S.groups.filter(function (g) { return g.usuarioId === u.id; });
      var borrarGrupos = false;
      if (suyos.length) {
        borrarGrupos = confirm(u.nombre + ' tiene ' + suyos.length + ' grupo(s): ' + suyos.map(function (g) { return g.nombre; }).join(', ') +
          '.\n\nAceptar = eliminar también esos grupos con TODOS sus datos.\nCancelar = conservar los grupos sin docente asignado (podrás reasignarlos).');
      }
      var r = prompt('Vas a ELIMINAR al usuario @' + u.usuario + (borrarGrupos ? ' y sus ' + suyos.length + ' grupo(s)' : '') + '. No se puede deshacer.\n\nEscribe ELIMINAR para confirmar:');
      if (r === null) return;
      if (r.trim().toUpperCase() !== 'ELIMINAR') return toast('No se eliminó: no escribiste ELIMINAR', true);
      busy(el, api('deleteUser', { id: u.id, borrarGrupos: borrarGrupos })).then(function (res) {
        toast('Usuario eliminado' + (res.gruposEliminados ? ' junto con ' + res.gruposEliminados + ' grupo(s)' : res.grupos ? '; sus grupos quedaron sin asignar' : ''));
        closeModal(); S.admin.users = null;
        return loadGroups().then(function () { if (!S.grupoId) { S.data = null; S.view = 'grupos'; S.mas = 'admin'; } render(); });
      });
    },
    'grupo-eliminar': function (el) {
      var g = S.groups.filter(function (x) { return x.id === el.dataset.id; })[0];
      if (!g) return;
      var r = prompt('Vas a ELIMINAR el grupo ' + g.nombre + (g.escuela ? ' (' + g.escuela + ')' : '') + ' con TODOS sus alumnos, asistencias, trabajos, exámenes y calificaciones. No se puede deshacer.\n\nSi solo ya no se usa, mejor desmarca "Activo" para archivarlo.\n\nEscribe ELIMINAR para confirmar:');
      if (r === null) return;
      if (r.trim().toUpperCase() !== 'ELIMINAR') return toast('No se eliminó: no escribiste ELIMINAR', true);
      busy(el, api('deleteGroup', { id: g.id })).then(function (res) {
        toast('Grupo eliminado (' + res.alumnos + ' alumnos)');
        closeModal();
        if (S.grupoId === g.id) { S.grupoId = null; S.data = null; S.periodoId = null; saveSession(); }
        return loadGroups().then(function () {
          if (!S.grupoId) { S.view = 'grupos'; S.mas = 'admin'; }
          render();
        });
      });
    },
    'usuario-editar': function (el) { modalUsuario(S.admin.users.filter(function (u) { return u.id === el.dataset.id; })[0]); },
    'grupo-nuevo': function () { modalGrupo(null); },
    'mi-grupo-editar': function () { var g = S.groups.filter(function (x) { return x.id === S.grupoId; })[0]; modalGrupo(g); },
    'escuela-editar': function () { modalEscuela(S.data.escuela, function () { S.schools = null; loadGroups().then(refresh); }); },
    'mat-agregar': function () { S.matEdit.push({ nombre: '', corto: '', activo: true }); S.dirty = true; render(); },
    'mat-mover': function (el) {
      var i = Number(el.dataset.i), j = i + Number(el.dataset.d), L = S.matEdit;
      if (j < 0 || j >= L.length) return;
      var t = L[i]; L[i] = L[j]; L[j] = t; S.dirty = true; render();
    },
    'formato-elegir': function (el) {
      var v = el.dataset.v;
      busy(el, api('saveGroup', { id: S.grupoId, formatoNombre: v }), 'Formato guardado: ' + FORMATOS[v].titulo.toLowerCase()).then(function () {
        S.elegirFormato = false; S.data.grupo.formatoNombre = v; render(); return loadGroups().then(refresh);
      });
    },
    'formato-cambiar': function () { S.elegirFormato = true; render(); },
    'formato-cancelar': function () { S.elegirFormato = false; render(); },
    'mat-quitar-nueva': function (el) { S.matEdit.splice(Number(el.dataset.i), 1); render(); },
    'mat-eliminar': function (el) {
      var clave = el.dataset.clave;
      var m = S.data.materias.filter(function (x) { return x.clave === clave; })[0];
      if (!m) return;
      if (S.dirty && !confirm('Tienes cambios sin guardar en las materias; se perderán. ¿Continuar?')) return;
      var acts = S.data.actividades.filter(function (a) { return a.campo === clave; }).length;
      var exs = S.data.examenes.filter(function (x) { return x.campo === clave; }).length;
      var detalle = acts || exs ? 'Se borrarán también ' + acts + ' actividad(es) y ' + exs + ' examen(es) con todas sus calificaciones.' : 'No tiene trabajos ni exámenes capturados.';
      var r = prompt('Vas a ELIMINAR "' + m.nombre + '" para siempre. ' + detalle + '\n\nEsto no se puede deshacer. Si solo quieres que no aparezca, mejor desmarca "Visible".\n\nEscribe ELIMINAR para confirmar:');
      if (r === null) return;
      if (r.trim().toUpperCase() !== 'ELIMINAR') return toast('No se eliminó: no escribiste ELIMINAR', true);
      busy(el, api('deleteMateria', { grupoId: S.grupoId, clave: clave }), 'Materia eliminada').then(function () {
        S.dirty = false; S.matEdit = null; S.ex.key = null; S.carga.key = null; return refresh();
      });
    },
    'mat-guardar': function (el) {
      var L = S.matEdit.filter(function (m) { return m.clave || m.nombre.trim(); });
      busy(el, api('saveMaterias', { grupoId: S.grupoId, materias: L }), 'Materias guardadas').then(function () { S.dirty = false; S.matEdit = null; return refresh(); });
    },
    'grupo-editar': function (el) { modalGrupo(S.groups.filter(function (g) { return g.id === el.dataset.id; })[0]); }
  };

  document.addEventListener('click', function (e) {
    var el = e.target.closest('[data-act]');
    if (!el) return;
    if (el.type === 'checkbox') return; // se maneja en 'change'
    var fn = actions[el.dataset.act];
    if (fn) { e.preventDefault(); fn(el); }
  });

  document.addEventListener('change', function (e) {
    var k = e.target.dataset.change;
    if (e.target.dataset.act === 'mat-activo') { S.matEdit[Number(e.target.dataset.i)].activo = e.target.checked; S.dirty = true; render(); return; }
    if (k === 'escuela-select' && e.target.value === '__nueva') {
      // Conserva lo capturado en el formulario del grupo y abre el de escuela
      var f = document.getElementById('form-grupo');
      var borrador = { id: f.dataset.id || null, grado: f.grado.value, letra: f.letra.value, ciclo: f.ciclo.value, activo: f.activo.checked, usuarioId: f.usuarioId ? f.usuarioId.value : undefined };
      modalEscuela(null, function (r) { S.schools = null; borrador.escuelaId = r.id; modalGrupo(borrador); });
      return;
    }
    if (k === 'periodo') {
      if (!confirmLeave()) { e.target.value = S.periodoId; return; }
      S.periodoId = e.target.value; S.ex.key = null; S.disc.key = null; S.carga.key = null; S.trab.editing = null; render();
    } else if (k === 'asis-fecha') {
      if (!e.target.value) return;
      if (!confirmLeave()) { e.target.value = S.asis.fecha; return; }
      ensureAsis(e.target.value); render();
    }
  });

  // Nombres de alumnos: solo letras, espacios, guion y apóstrofo (sin números)
  var NO_PERMITIDO_NOMBRE = /[^A-Za-zÀ-ÖØ-öø-ÿ\s'’-]/g;
  function limpiarNombre(s) { return String(s || '').replace(/[0-9]/g, '').replace(NO_PERMITIDO_NOMBRE, ' ').replace(/[ \t]+/g, ' ').replace(/^[ \t'’-]+|[ \t'’-]+$/gm, '').toUpperCase(); }
  document.addEventListener('input', function (e) {
    var t = e.target;
    if (t.id !== 'nuevos-alumnos' && !(t.name === 'nombre' && t.closest('#form-alumno'))) return;
    if (!/[^A-Za-zÀ-ÖØ-öø-ÿ\s'’-]/.test(t.value)) return;
    var pos = t.selectionStart, antes = t.value.length;
    t.value = t.value.replace(NO_PERMITIDO_NOMBRE, '');
    try { t.setSelectionRange(pos - (antes - t.value.length), pos - (antes - t.value.length)); } catch (err) { /* nada */ }
    toast('Los nombres solo pueden llevar letras');
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
    else if (k === 'pts') S.pts.valores[t.dataset.id] = t.value;
    else if (k === 'peso') actualizarSumaPesos();
    else if (k === 'carga') S.carga.valores[t.dataset.id] = t.value;
    else if (k === 'carga-total') S.carga.total = t.value;
    else if (k === 'mat-nombre') S.matEdit[Number(t.dataset.i)].nombre = t.value;
    else if (k === 'mat-corto') S.matEdit[Number(t.dataset.i)].corto = t.value;
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
