/**
 * REGISTRO ESCOLAR — Backend (Google Apps Script)
 * ------------------------------------------------
 * Este script va ligado a la hoja de Google Sheets que funciona como base de datos.
 * Se publica como "Aplicación web" y el frontend (GitHub Pages) le habla por POST con JSON.
 *
 * Seguridad:
 *  - Contraseñas guardadas con sal + SHA-256 iterado (nunca en texto plano).
 *  - Sesiones con token aleatorio y caducidad.
 *  - Roles: "admin" (ve y administra todo) y "maestra" (solo sus grupos).
 *  - Bloqueo temporal tras varios intentos fallidos de inicio de sesión.
 */

// ===================== CONFIGURACIÓN =====================
var SESSION_DAYS = 30;          // días que dura una sesión
var HASH_ITERATIONS = 1000;    // iteraciones del hash de contraseña
var MAX_LOGIN_FAILS = 6;        // intentos antes de bloquear
var LOCK_MINUTES = 15;          // minutos de bloqueo

var CAMPOS = ['LEN', 'SAB', 'ETI', 'HUM'];
var ESTADOS_ASISTENCIA = ['P', 'F', 'R', 'J'];

// Esquema de la base de datos: hoja -> columnas
var SCHEMA = {
  Usuarios:       ['id', 'usuario', 'nombre', 'rol', 'salt', 'hash', 'activo', 'creado'],
  Sesiones:       ['token', 'usuario_id', 'expira'],
  Grupos:         ['id', 'nombre', 'ciclo', 'usuario_id', 'activo', 'peso_examen', 'peso_trabajos', 'peso_asistencia', 'peso_disciplina', 'disciplina_max'],
  Alumnos:        ['id', 'grupo_id', 'num_lista', 'nombre', 'activo'],
  Periodos:       ['id', 'grupo_id', 'nombre', 'inicio', 'fin'],
  DiasSinClase:   ['grupo_id', 'fecha', 'motivo'],
  Asistencia:     ['grupo_id', 'fecha', 'alumno_id', 'estado'],
  Actividades:    ['id', 'grupo_id', 'campo', 'fecha', 'titulo'],
  Entregas:       ['actividad_id', 'alumno_id', 'valor'],
  Examenes:       ['id', 'grupo_id', 'tipo', 'periodo_id', 'campo', 'reactivos'],
  Resultados:     ['examen_id', 'alumno_id', 'aciertos'],
  Disciplina:     ['grupo_id', 'periodo_id', 'alumno_id', 'puntos'],
  CargaInicial:   ['grupo_id', 'periodo_id', 'concepto', 'alumno_id', 'valor']
};

// ===================== MENÚ EN LA HOJA =====================
function onOpen() {
  SpreadsheetApp.getUi().createMenu('Registro Escolar')
    .addItem('1. Preparar hojas', 'setup')
    .addItem('2. Crear administrador', 'crearAdministradorUI')
    .addToUi();
}

/** Crea las hojas que falten con sus encabezados y formato de texto. */
function setup() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  Object.keys(SCHEMA).forEach(function (name) { ensureSheet_(ss, name); });
  return 'ok';
}

function crearAdministradorUI() {
  var ui = SpreadsheetApp.getUi();
  var u = ui.prompt('Usuario del administrador', 'Ej: daniel', ui.ButtonSet.OK_CANCEL);
  if (u.getSelectedButton() !== ui.Button.OK) return;
  var p = ui.prompt('Contraseña (mínimo 8 caracteres)', ui.ButtonSet.OK_CANCEL);
  if (p.getSelectedButton() !== ui.Button.OK) return;
  try {
    crearAdministrador(u.getResponseText(), p.getResponseText(), u.getResponseText());
    ui.alert('Administrador creado. Ya puedes iniciar sesión en la app.');
  } catch (err) {
    ui.alert('Error: ' + err.message);
  }
}

function crearAdministrador(usuario, password, nombre) {
  setup();
  return withLock_(function () {
    return createUser_({ usuario: usuario, password: password, nombre: nombre || usuario, rol: 'admin', activo: true });
  });
}

// ===================== ENTRADA HTTP =====================
function doGet() {
  return json_({ ok: true, app: 'Registro Escolar API' });
}

function doPost(e) {
  var req;
  try {
    req = JSON.parse(e.postData.contents);
  } catch (err) {
    return json_({ ok: false, error: 'Solicitud inválida' });
  }
  try {
    var data = route_(req);
    return json_({ ok: true, data: data });
  } catch (err) {
    return json_({ ok: false, error: err.message || String(err), auth: err.auth === true });
  }
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function route_(req) {
  var action = req.action;
  if (action === 'login') return login_(req.usuario, req.password);

  var user = auth_(req.token);
  var p = req.payload || {};

  switch (action) {
    case 'me': return publicUser_(user);
    case 'logout': return logout_(req.token);
    case 'changePassword': return changePassword_(user, p.actual, p.nueva);

    case 'listGroups': return listGroups_(user);
    case 'getGroupData': return getGroupData_(user, p.grupoId);

    case 'saveAttendance': return saveAttendance_(user, p);
    case 'setDaySinClase': return setDaySinClase_(user, p);
    case 'saveActivity': return saveActivity_(user, p);
    case 'deleteActivity': return deleteActivity_(user, p);
    case 'saveEntregas': return saveEntregas_(user, p);
    case 'saveExam': return saveExam_(user, p);
    case 'deleteExam': return deleteExam_(user, p);
    case 'saveDisciplina': return saveDisciplina_(user, p);
    case 'saveCarga': return saveCarga_(user, p);
    case 'saveStudents': return saveStudents_(user, p);
    case 'savePeriodos': return savePeriodos_(user, p);
    case 'saveGroupSettings': return saveGroupSettings_(user, p);

    // Solo administrador
    case 'listUsers': requireAdmin_(user); return listUsers_();
    case 'saveUser': requireAdmin_(user); return saveUser_(user, p);
    case 'saveGroup': requireAdmin_(user); return saveGroup_(p);
  }
  throw new Error('Acción desconocida: ' + action);
}

// ===================== AUTENTICACIÓN =====================
function hashPassword_(password, salt) {
  var value = salt + '|' + password;
  var bytes;
  for (var i = 0; i < HASH_ITERATIONS; i++) {
    bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, value, Utilities.Charset.UTF_8);
    value = Utilities.base64Encode(bytes) + salt;
  }
  return Utilities.base64Encode(bytes);
}

function randomToken_() {
  return (Utilities.getUuid() + Utilities.getUuid()).replace(/-/g, '');
}

function login_(usuario, password) {
  usuario = String(usuario || '').trim().toLowerCase();
  if (!usuario || !password) throw new Error('Escribe usuario y contraseña');

  var cache = CacheService.getScriptCache();
  var failKey = 'fail_' + usuario;
  var fails = Number(cache.get(failKey) || 0);
  if (fails >= MAX_LOGIN_FAILS) throw new Error('Demasiados intentos. Espera ' + LOCK_MINUTES + ' minutos.');

  var users = readTable_('Usuarios');
  var u = users.filter(function (x) { return String(x.usuario).toLowerCase() === usuario; })[0];
  var valid = u && isTrue_(u.activo) && hashPassword_(password, u.salt) === u.hash;
  if (!valid) {
    cache.put(failKey, String(fails + 1), LOCK_MINUTES * 60);
    throw new Error('Usuario o contraseña incorrectos');
  }
  cache.remove(failKey);

  var token = randomToken_();
  var expira = new Date(Date.now() + SESSION_DAYS * 86400000).toISOString();
  withLock_(function () {
    // Limpia sesiones caducadas de paso
    var now = new Date().toISOString();
    var t = loadTable_('Sesiones');
    t.rows = t.rows.filter(function (r) { return String(r.expira) > now; });
    t.rows.push({ token: token, usuario_id: u.id, expira: expira });
    saveTable_(t);
  });
  return { token: token, usuario: publicUser_(u) };
}

function logout_(token) {
  withLock_(function () {
    var t = loadTable_('Sesiones');
    t.rows = t.rows.filter(function (r) { return r.token !== token; });
    saveTable_(t);
  });
  return true;
}

function authError_(msg) {
  var e = new Error(msg);
  e.auth = true;
  return e;
}

function auth_(token) {
  if (!token) throw authError_('Inicia sesión');
  var s = readTable_('Sesiones').filter(function (r) { return r.token === token; })[0];
  if (!s || String(s.expira) < new Date().toISOString()) throw authError_('Tu sesión expiró, vuelve a entrar');
  var userId = s.usuario_id;
  var u = readTable_('Usuarios').filter(function (x) { return x.id === userId; })[0];
  if (!u || !isTrue_(u.activo)) throw authError_('Usuario desactivado');
  return u;
}

function publicUser_(u) {
  return { id: u.id, usuario: u.usuario, nombre: u.nombre, rol: u.rol };
}

function requireAdmin_(user) {
  if (user.rol !== 'admin') throw new Error('Solo el administrador puede hacer esto');
}

function changePassword_(user, actual, nueva) {
  if (hashPassword_(actual || '', user.salt) !== user.hash) throw new Error('La contraseña actual no es correcta');
  validatePassword_(nueva);
  withLock_(function () {
    var t = loadTable_('Usuarios');
    t.rows.forEach(function (r) {
      if (r.id === user.id) { r.salt = randomToken_().slice(0, 16); r.hash = hashPassword_(nueva, r.salt); }
    });
    saveTable_(t);
  });
  return true;
}

function validatePassword_(pw) {
  if (!pw || String(pw).length < 8) throw new Error('La contraseña debe tener al menos 8 caracteres');
}

// ===================== USUARIOS Y GRUPOS (ADMIN) =====================
function listUsers_() {
  return readTable_('Usuarios').map(function (u) {
    return { id: u.id, usuario: u.usuario, nombre: u.nombre, rol: u.rol, activo: isTrue_(u.activo) };
  });
}

function createUser_(p) {
  var usuario = String(p.usuario || '').trim().toLowerCase();
  if (!/^[a-z0-9._-]{3,30}$/.test(usuario)) throw new Error('Usuario inválido (3-30 letras, números, . _ -)');
  validatePassword_(p.password);
  var t = loadTable_('Usuarios');
  if (t.rows.some(function (r) { return String(r.usuario).toLowerCase() === usuario; })) throw new Error('Ese usuario ya existe');
  var salt = randomToken_().slice(0, 16);
  var row = {
    id: newId_('U'), usuario: usuario, nombre: p.nombre || usuario, rol: p.rol === 'admin' ? 'admin' : 'maestra',
    salt: salt, hash: hashPassword_(p.password, salt), activo: p.activo === false ? 'NO' : 'SI', creado: new Date().toISOString()
  };
  t.rows.push(row);
  saveTable_(t);
  return publicUser_(row);
}

function saveUser_(admin, p) {
  return withLock_(function () {
    if (!p.id) return createUser_(p);
    var t = loadTable_('Usuarios');
    var r = t.rows.filter(function (x) { return x.id === p.id; })[0];
    if (!r) throw new Error('Usuario no encontrado');
    if (p.id === admin.id && (p.activo === false || (p.rol && p.rol !== 'admin'))) throw new Error('No puedes quitarte el rol de admin ni desactivarte');
    if (p.nombre != null) r.nombre = p.nombre;
    if (p.rol) r.rol = p.rol === 'admin' ? 'admin' : 'maestra';
    if (p.activo != null) r.activo = p.activo ? 'SI' : 'NO';
    if (p.password) { validatePassword_(p.password); r.salt = randomToken_().slice(0, 16); r.hash = hashPassword_(p.password, r.salt); }
    saveTable_(t);
    if (p.password || p.activo === false) {
      // Cierra sesiones abiertas de ese usuario
      var s = loadTable_('Sesiones');
      s.rows = s.rows.filter(function (x) { return x.usuario_id !== r.id; });
      saveTable_(s);
    }
    return publicUser_(r);
  });
}

function saveGroup_(p) {
  return withLock_(function () {
    var t = loadTable_('Grupos');
    var r = p.id ? t.rows.filter(function (x) { return x.id === p.id; })[0] : null;
    if (!r) {
      if (!p.nombre) throw new Error('El grupo necesita nombre');
      r = { id: newId_('G'), peso_examen: 20, peso_trabajos: 60, peso_asistencia: 10, peso_disciplina: 10, disciplina_max: 10, activo: 'SI' };
      t.rows.push(r);
    }
    if (p.nombre != null) r.nombre = p.nombre;
    if (p.ciclo != null) r.ciclo = p.ciclo;
    if (p.usuarioId != null) r.usuario_id = p.usuarioId;
    if (p.activo != null) r.activo = p.activo ? 'SI' : 'NO';
    saveTable_(t);
    return r;
  });
}

function listGroups_(user) {
  var users = {};
  readTable_('Usuarios').forEach(function (u) { users[u.id] = u.nombre; });
  return readTable_('Grupos')
    .filter(function (g) { return user.rol === 'admin' || (g.usuario_id === user.id && isTrue_(g.activo)); })
    .map(function (g) {
      return { id: g.id, nombre: g.nombre, ciclo: g.ciclo, usuarioId: g.usuario_id, maestra: users[g.usuario_id] || '', activo: isTrue_(g.activo) };
    });
}

function getGroup_(user, grupoId) {
  var g = readTable_('Grupos').filter(function (x) { return x.id === grupoId; })[0];
  if (!g) throw new Error('Grupo no encontrado');
  if (user.rol !== 'admin' && g.usuario_id !== user.id) throw new Error('No tienes acceso a este grupo');
  return g;
}

// ===================== LECTURA DEL GRUPO =====================
function getGroupData_(user, grupoId) {
  var g = getGroup_(user, grupoId);
  var byGroup = function (name) { return readTable_(name).filter(function (r) { return r.grupo_id === grupoId; }); };

  var actividades = byGroup('Actividades');
  var actIds = {}; actividades.forEach(function (a) { actIds[a.id] = true; });
  var examenes = byGroup('Examenes');
  var exIds = {}; examenes.forEach(function (x) { exIds[x.id] = true; });

  return {
    grupo: {
      id: g.id, nombre: g.nombre, ciclo: g.ciclo,
      pesos: { examen: num_(g.peso_examen, 20), trabajos: num_(g.peso_trabajos, 60), asistencia: num_(g.peso_asistencia, 10), disciplina: num_(g.peso_disciplina, 10) },
      disciplinaMax: num_(g.disciplina_max, 10)
    },
    alumnos: byGroup('Alumnos').map(function (a) { return { id: a.id, num: Number(a.num_lista), nombre: a.nombre, activo: isTrue_(a.activo) }; })
      .sort(function (a, b) { return a.num - b.num; }),
    periodos: byGroup('Periodos').map(function (p) { return { id: p.id, nombre: p.nombre, inicio: p.inicio, fin: p.fin }; })
      .sort(function (a, b) { return a.inicio < b.inicio ? -1 : 1; }),
    diasSinClase: byGroup('DiasSinClase').map(function (d) { return { fecha: d.fecha, motivo: d.motivo }; }),
    asistencia: byGroup('Asistencia').map(function (r) { return [r.fecha, r.alumno_id, r.estado]; }),
    actividades: actividades.map(function (a) { return { id: a.id, campo: a.campo, fecha: a.fecha, titulo: a.titulo }; }),
    entregas: readTable_('Entregas').filter(function (e) { return actIds[e.actividad_id]; })
      .map(function (e) { return [e.actividad_id, e.alumno_id, Number(e.valor)]; }),
    examenes: examenes.map(function (x) { return { id: x.id, tipo: x.tipo, periodoId: x.periodo_id, campo: x.campo, reactivos: Number(x.reactivos) }; }),
    resultados: readTable_('Resultados').filter(function (r) { return exIds[r.examen_id]; })
      .map(function (r) { return [r.examen_id, r.alumno_id, r.aciertos === '' ? null : Number(r.aciertos)]; }),
    disciplina: byGroup('Disciplina').map(function (r) { return [r.periodo_id, r.alumno_id, r.puntos === '' ? null : Number(r.puntos)]; }),
    carga: byGroup('CargaInicial').map(function (r) { return [r.periodo_id, r.concepto, r.alumno_id, Number(r.valor)]; })
  };
}

// ===================== ESCRITURAS =====================
function saveAttendance_(user, p) {
  getGroup_(user, p.grupoId);
  var fecha = validDate_(p.fecha);
  return withLock_(function () {
    var t = loadTable_('Asistencia');
    t.rows = t.rows.filter(function (r) { return !(r.grupo_id === p.grupoId && r.fecha === fecha); });
    (p.registros || []).forEach(function (x) {
      if (ESTADOS_ASISTENCIA.indexOf(x.estado) < 0) throw new Error('Estado inválido: ' + x.estado);
      t.rows.push({ grupo_id: p.grupoId, fecha: fecha, alumno_id: x.alumnoId, estado: x.estado });
    });
    saveTable_(t);
    // Si el día estaba marcado "sin clase", se quita
    var d = loadTable_('DiasSinClase');
    var before = d.rows.length;
    d.rows = d.rows.filter(function (r) { return !(r.grupo_id === p.grupoId && r.fecha === fecha); });
    if (d.rows.length !== before) saveTable_(d);
    return true;
  });
}

function setDaySinClase_(user, p) {
  getGroup_(user, p.grupoId);
  var fecha = validDate_(p.fecha);
  return withLock_(function () {
    var d = loadTable_('DiasSinClase');
    d.rows = d.rows.filter(function (r) { return !(r.grupo_id === p.grupoId && r.fecha === fecha); });
    if (p.motivo) {
      d.rows.push({ grupo_id: p.grupoId, fecha: fecha, motivo: String(p.motivo).slice(0, 120) });
      var a = loadTable_('Asistencia');
      a.rows = a.rows.filter(function (r) { return !(r.grupo_id === p.grupoId && r.fecha === fecha); });
      saveTable_(a);
    }
    saveTable_(d);
    return true;
  });
}

function saveActivity_(user, p) {
  getGroup_(user, p.grupoId);
  var a = p.actividad || {};
  if (CAMPOS.indexOf(a.campo) < 0) throw new Error('Campo formativo inválido');
  if (!a.titulo) throw new Error('La actividad necesita un nombre');
  var fecha = validDate_(a.fecha);
  return withLock_(function () {
    var t = loadTable_('Actividades');
    var r = a.id ? t.rows.filter(function (x) { return x.id === a.id && x.grupo_id === p.grupoId; })[0] : null;
    if (!r) { r = { id: newId_('A'), grupo_id: p.grupoId }; t.rows.push(r); }
    r.campo = a.campo; r.fecha = fecha; r.titulo = String(a.titulo).slice(0, 120);
    saveTable_(t);
    if (p.registros) writeEntregas_(r.id, p.registros);
    return { id: r.id, campo: r.campo, fecha: r.fecha, titulo: r.titulo };
  });
}

function deleteActivity_(user, p) {
  getGroup_(user, p.grupoId);
  return withLock_(function () {
    var t = loadTable_('Actividades');
    t.rows = t.rows.filter(function (x) { return !(x.id === p.actividadId && x.grupo_id === p.grupoId); });
    saveTable_(t);
    var e = loadTable_('Entregas');
    e.rows = e.rows.filter(function (x) { return x.actividad_id !== p.actividadId; });
    saveTable_(e);
    return true;
  });
}

function saveEntregas_(user, p) {
  getGroup_(user, p.grupoId);
  var act = readTable_('Actividades').filter(function (x) { return x.id === p.actividadId && x.grupo_id === p.grupoId; })[0];
  if (!act) throw new Error('Actividad no encontrada');
  return withLock_(function () { writeEntregas_(p.actividadId, p.registros || []); return true; });
}

function writeEntregas_(actividadId, registros) {
  var e = loadTable_('Entregas');
  e.rows = e.rows.filter(function (x) { return x.actividad_id !== actividadId; });
  registros.forEach(function (x) {
    var v = Number(x.valor);
    if ([0, 0.5, 1].indexOf(v) < 0) throw new Error('Valor de entrega inválido');
    e.rows.push({ actividad_id: actividadId, alumno_id: x.alumnoId, valor: v });
  });
  saveTable_(e);
}

function saveExam_(user, p) {
  getGroup_(user, p.grupoId);
  var x = p.examen || {};
  if (CAMPOS.indexOf(x.campo) < 0) throw new Error('Campo formativo inválido');
  if (['diagnostico', 'trimestral'].indexOf(x.tipo) < 0) throw new Error('Tipo de examen inválido');
  var reactivos = Number(x.reactivos);
  if (!(reactivos > 0)) throw new Error('Indica el número de reactivos');
  return withLock_(function () {
    var t = loadTable_('Examenes');
    var r = t.rows.filter(function (e) {
      return e.grupo_id === p.grupoId && e.tipo === x.tipo && e.campo === x.campo &&
        (x.tipo === 'diagnostico' || e.periodo_id === x.periodoId);
    })[0];
    if (!r) { r = { id: newId_('E'), grupo_id: p.grupoId, tipo: x.tipo, campo: x.campo }; t.rows.push(r); }
    r.periodo_id = x.tipo === 'diagnostico' ? '' : x.periodoId;
    r.reactivos = reactivos;
    saveTable_(t);
    var res = loadTable_('Resultados');
    res.rows = res.rows.filter(function (e) { return e.examen_id !== r.id; });
    (p.resultados || []).forEach(function (e) {
      var ac = e.aciertos === null || e.aciertos === '' || e.aciertos === undefined ? '' : Number(e.aciertos);
      if (ac !== '' && (ac < 0 || ac > reactivos)) throw new Error('Aciertos fuera de rango');
      res.rows.push({ examen_id: r.id, alumno_id: e.alumnoId, aciertos: ac });
    });
    saveTable_(res);
    return { id: r.id };
  });
}

function deleteExam_(user, p) {
  getGroup_(user, p.grupoId);
  return withLock_(function () {
    var t = loadTable_('Examenes');
    t.rows = t.rows.filter(function (x) { return !(x.id === p.examenId && x.grupo_id === p.grupoId); });
    saveTable_(t);
    var r = loadTable_('Resultados');
    r.rows = r.rows.filter(function (x) { return x.examen_id !== p.examenId; });
    saveTable_(r);
    return true;
  });
}

function saveDisciplina_(user, p) {
  var g = getGroup_(user, p.grupoId);
  var max = num_(g.disciplina_max, 10);
  return withLock_(function () {
    var t = loadTable_('Disciplina');
    t.rows = t.rows.filter(function (r) { return !(r.grupo_id === p.grupoId && r.periodo_id === p.periodoId); });
    (p.registros || []).forEach(function (x) {
      if (x.puntos === null || x.puntos === '' || x.puntos === undefined) return;
      var v = Number(x.puntos);
      if (isNaN(v) || v < 0 || v > max) throw new Error('Puntos de disciplina fuera de rango (0-' + max + ')');
      t.rows.push({ grupo_id: p.grupoId, periodo_id: p.periodoId, alumno_id: x.alumnoId, puntos: v });
    });
    saveTable_(t);
    return true;
  });
}

/** Totales que ya existían antes de usar la app (libreta). concepto: ASIS o TRAB_<CAMPO>; alumno_id TOTAL = posibles. */
function saveCarga_(user, p) {
  getGroup_(user, p.grupoId);
  var conceptos = ['ASIS'].concat(CAMPOS.map(function (c) { return 'TRAB_' + c; }));
  if (conceptos.indexOf(p.concepto) < 0) throw new Error('Concepto inválido');
  return withLock_(function () {
    var t = loadTable_('CargaInicial');
    t.rows = t.rows.filter(function (r) { return !(r.grupo_id === p.grupoId && r.periodo_id === p.periodoId && r.concepto === p.concepto); });
    var total = Number(p.total) || 0;
    if (total > 0) {
      t.rows.push({ grupo_id: p.grupoId, periodo_id: p.periodoId, concepto: p.concepto, alumno_id: 'TOTAL', valor: total });
      (p.registros || []).forEach(function (x) {
        if (x.valor === null || x.valor === '' || x.valor === undefined) return;
        var v = Number(x.valor);
        if (isNaN(v) || v < 0 || v > total) throw new Error('Valor fuera de rango (0-' + total + ')');
        t.rows.push({ grupo_id: p.grupoId, periodo_id: p.periodoId, concepto: p.concepto, alumno_id: x.alumnoId, valor: v });
      });
    }
    saveTable_(t);
    return true;
  });
}

function saveStudents_(user, p) {
  getGroup_(user, p.grupoId);
  return withLock_(function () {
    var t = loadTable_('Alumnos');
    (p.alumnos || []).forEach(function (a) {
      var nombre = String(a.nombre || '').trim().toUpperCase();
      var r = a.id ? t.rows.filter(function (x) { return x.id === a.id && x.grupo_id === p.grupoId; })[0] : null;
      if (!r) {
        if (!nombre) return;
        r = { id: newId_('S'), grupo_id: p.grupoId, activo: 'SI' };
        t.rows.push(r);
      }
      if (nombre) r.nombre = nombre;
      if (a.num != null) r.num_lista = Number(a.num);
      if (a.activo != null) r.activo = a.activo ? 'SI' : 'NO';
    });
    saveTable_(t);
    return true;
  });
}

function savePeriodos_(user, p) {
  getGroup_(user, p.grupoId);
  return withLock_(function () {
    var t = loadTable_('Periodos');
    (p.periodos || []).forEach(function (x) {
      var r = x.id ? t.rows.filter(function (y) { return y.id === x.id && y.grupo_id === p.grupoId; })[0] : null;
      if (!r) { r = { id: newId_('P'), grupo_id: p.grupoId }; t.rows.push(r); }
      r.nombre = String(x.nombre || '').slice(0, 40);
      r.inicio = validDate_(x.inicio);
      r.fin = validDate_(x.fin);
      if (r.fin < r.inicio) throw new Error('En ' + r.nombre + ' la fecha final es antes que la inicial');
    });
    saveTable_(t);
    return true;
  });
}

function saveGroupSettings_(user, p) {
  getGroup_(user, p.grupoId);
  var w = p.pesos || {};
  var sum = Number(w.examen) + Number(w.trabajos) + Number(w.asistencia) + Number(w.disciplina);
  if (Math.abs(sum - 100) > 0.001) throw new Error('Los porcentajes deben sumar 100 (suman ' + sum + ')');
  return withLock_(function () {
    var t = loadTable_('Grupos');
    var r = t.rows.filter(function (x) { return x.id === p.grupoId; })[0];
    r.peso_examen = Number(w.examen); r.peso_trabajos = Number(w.trabajos);
    r.peso_asistencia = Number(w.asistencia); r.peso_disciplina = Number(w.disciplina);
    if (p.disciplinaMax) r.disciplina_max = Number(p.disciplinaMax);
    saveTable_(t);
    return true;
  });
}

// ===================== CAPA DE DATOS =====================
function ensureSheet_(ss, name) {
  var sh = ss.getSheetByName(name);
  var headers = SCHEMA[name];
  if (!sh) {
    sh = ss.insertSheet(name);
    sh.getRange(1, 1, 1, headers.length).setValues([headers]).setFontWeight('bold');
    sh.setFrozenRows(1);
  } else {
    // Agrega columnas nuevas si faltan (por actualizaciones de la app)
    var current = sh.getLastColumn() > 0 ? sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0] : [];
    headers.forEach(function (h) {
      if (current.indexOf(h) < 0) { current.push(h); sh.getRange(1, current.length).setValue(h); }
    });
  }
  // Texto plano para que Sheets no convierta fechas/IDs
  sh.getRange(1, 1, sh.getMaxRows(), Math.max(sh.getMaxColumns(), headers.length)).setNumberFormat('@');
  return sh;
}

function sheet_(name) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  return ss.getSheetByName(name) || ensureSheet_(ss, name);
}

function loadTable_(name) {
  var sh = sheet_(name);
  var lastRow = sh.getLastRow(), lastCol = sh.getLastColumn();
  var values = lastRow > 0 ? sh.getRange(1, 1, lastRow, lastCol).getValues() : [SCHEMA[name]];
  var headers = values[0].map(String);
  var rows = [];
  for (var i = 1; i < values.length; i++) {
    var row = values[i];
    if (row.join('') === '') continue;
    var o = {};
    for (var j = 0; j < headers.length; j++) o[headers[j]] = normalize_(row[j]);
    rows.push(o);
  }
  return { name: name, sheet: sh, headers: headers, rows: rows, prevCount: values.length - 1 };
}

function readTable_(name) { return loadTable_(name).rows; }

function saveTable_(t) {
  var sh = t.sheet, h = t.headers;
  var data = t.rows.map(function (r) {
    return h.map(function (k) { return r[k] === undefined || r[k] === null ? '' : String(r[k]); });
  });
  if (data.length) sh.getRange(2, 1, data.length, h.length).setNumberFormat('@').setValues(data);
  if (t.prevCount > data.length) sh.getRange(data.length + 2, 1, t.prevCount - data.length, h.length).clearContent();
  t.prevCount = data.length;
}

function normalize_(v) {
  if (v instanceof Date) return Utilities.formatDate(v, Session.getScriptTimeZone(), 'yyyy-MM-dd');
  return v === null || v === undefined ? '' : String(v);
}

function withLock_(fn) {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(20000)) throw new Error('El servidor está ocupado, intenta de nuevo');
  try { return fn(); } finally { lock.releaseLock(); }
}

function newId_(prefix) {
  return prefix + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

function validDate_(s) {
  s = String(s || '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) throw new Error('Fecha inválida: ' + s);
  return s;
}

function isTrue_(v) { return v === true || String(v).toUpperCase() === 'SI' || String(v).toUpperCase() === 'TRUE'; }
function num_(v, def) { var n = Number(v); return v === '' || v === null || isNaN(n) ? def : n; }
