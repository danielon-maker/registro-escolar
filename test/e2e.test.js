// Prueba de punta a punta: backend simulado + cálculo del frontend.
const assert = require('assert');
const { load } = require('./gas-mock');
const Calc = require('../docs/calc.js');

const gs = load();
gs.setup();
gs.crearAdministrador('Daniel', 'secreto123', 'Daniel');

let ok = 0;
const t = (name, fn) => { fn(); ok++; console.log('✓', name); };
const must = (r) => { if (!r.ok) throw new Error(r.error); return r.data; };
const fails = (r, re) => { assert.strictEqual(r.ok, false); if (re) assert.match(r.error, re); };

let admin, maestra, grupo, alumnos;

t('login con contraseña incorrecta falla', () => fails(gs.call({ action: 'login', usuario: 'daniel', password: 'malamala' }), /incorrectos/));
t('admin inicia sesión (usuario sin distinguir mayúsculas)', () => { admin = must(gs.call({ action: 'login', usuario: 'DANIEL', password: 'secreto123' })); assert.equal(admin.usuario.rol, 'admin'); });
t('las contraseñas no se guardan en texto plano', () => { const cells = JSON.stringify(gs._sheets.Usuarios._cells()); assert(!cells.includes('secreto123')); });
t('sin token se rechaza con auth', () => { const r = gs.call({ action: 'listGroups' }); assert.equal(r.auth, true); });

const A = (action, payload, tok) => gs.call({ action, token: tok || admin.token, payload });

t('admin crea maestra', () => { must(A('saveUser', { usuario: 'adriana', nombre: 'Adriana', password: 'maestra2026', rol: 'maestra' })); });
t('usuario duplicado se rechaza', () => fails(A('saveUser', { usuario: 'adriana', nombre: 'x', password: 'maestra2026' }), /existe/));
t('contraseña corta se rechaza', () => fails(A('saveUser', { usuario: 'otra', nombre: 'x', password: '123' }), /8/));
t('maestra inicia sesión', () => { maestra = must(gs.call({ action: 'login', usuario: 'adriana', password: 'maestra2026' })); });
t('maestra no puede administrar', () => fails(A('listUsers', {}, maestra.token), /administrador/));

t('admin crea grupo y lo asigna', () => {
  grupo = must(A('saveGroup', { nombre: '6° D', ciclo: '2026-2027', usuarioId: maestra.usuario.id, activo: true }));
  const gsM = must(A('listGroups', {}, maestra.token));
  assert.equal(gsM.length, 1); assert.equal(gsM[0].maestra, 'Adriana');
});
const M = (action, payload) => A(action, Object.assign({ grupoId: grupo.id }, payload), maestra.token);

t('otra maestra no ve el grupo', () => {
  must(A('saveUser', { usuario: 'otra', nombre: 'Otra', password: 'otraotra1' }));
  const o = must(gs.call({ action: 'login', usuario: 'otra', password: 'otraotra1' }));
  assert.equal(must(A('listGroups', {}, o.token)).length, 0);
  fails(A('getGroupData', { grupoId: grupo.id }, o.token), /acceso/);
});

t('alumnos y periodos', () => {
  must(M('saveStudents', { alumnos: [{ nombre: 'acosta angel', num: 1 }, { nombre: 'ACOSTA FATIMA', num: 2 }, { nombre: 'BAJA ALUMNO', num: 3 }] }));
  must(M('savePeriodos', { periodos: [{ nombre: 'T1', inicio: '2026-09-01', fin: '2026-11-27' }, { nombre: 'T2', inicio: '2026-11-30', fin: '2027-03-12' }] }));
  const d = must(M('getGroupData', {}));
  alumnos = d.alumnos; assert.equal(alumnos[0].nombre, 'ACOSTA ANGEL');
  must(M('saveStudents', { alumnos: [{ id: alumnos[2].id, activo: false }] }));
});
t('fechas inválidas se rechazan', () => fails(M('savePeriodos', { periodos: [{ nombre: 'X', inicio: '2026-12-01', fin: '2026-11-01' }] }), /antes/));

const [a1, a2] = [() => alumnos[0].id, () => alumnos[1].id];
t('asistencia: guardar, sobrescribir el mismo día', () => {
  must(M('saveAttendance', { fecha: '2026-11-10', registros: [{ alumnoId: a1(), estado: 'P' }, { alumnoId: a2(), estado: 'F' }] }));
  must(M('saveAttendance', { fecha: '2026-11-10', registros: [{ alumnoId: a1(), estado: 'R' }, { alumnoId: a2(), estado: 'F' }] }));
  must(M('saveAttendance', { fecha: '2026-11-11', registros: [{ alumnoId: a1(), estado: 'J' }, { alumnoId: a2(), estado: 'P' }] }));
  must(M('saveAttendance', { fecha: '2026-11-12', registros: [{ alumnoId: a1(), estado: 'P' }, { alumnoId: a2(), estado: 'P' }] }));
  const d = must(M('getGroupData', {}));
  assert.equal(d.asistencia.length, 6);
});
t('día sin clase borra la asistencia de ese día', () => {
  must(M('setDaySinClase', { fecha: '2026-11-12', motivo: 'CTE' }));
  const d = must(M('getGroupData', {}));
  assert.equal(d.asistencia.length, 4); assert.equal(d.diasSinClase[0].motivo, 'CTE');
});
t('estado inválido se rechaza', () => fails(M('saveAttendance', { fecha: '2026-11-13', registros: [{ alumnoId: a1(), estado: 'X' }] }), /inválido/));

let act;
t('actividades y entregas', () => {
  act = must(M('saveActivity', { actividad: { campo: 'LEN', fecha: '2026-11-10', titulo: 'Sustantivos' }, registros: [{ alumnoId: a1(), valor: 1 }, { alumnoId: a2(), valor: 0.5 }] }));
  must(M('saveActivity', { actividad: { campo: 'LEN', fecha: '2026-11-11', titulo: 'Acentos' }, registros: [{ alumnoId: a1(), valor: 1 }, { alumnoId: a2(), valor: 0 }] }));
  const tmp = must(M('saveActivity', { actividad: { campo: 'LEN', fecha: '2026-11-11', titulo: 'Borrar' }, registros: [{ alumnoId: a1(), valor: 1 }] }));
  must(M('deleteActivity', { actividadId: tmp.id }));
  const d = must(M('getGroupData', {}));
  assert.equal(d.actividades.length, 2); assert.equal(d.entregas.length, 4);
});

let periodos;
t('examen, disciplina y carga inicial', () => {
  periodos = must(M('getGroupData', {})).periodos;
  const T1 = periodos[0].id;
  must(M('saveExam', { examen: { tipo: 'trimestral', campo: 'LEN', periodoId: T1, reactivos: 26 }, resultados: [{ alumnoId: a1(), aciertos: 18 }, { alumnoId: a2(), aciertos: null }] }));
  // Volver a guardar no duplica el examen
  must(M('saveExam', { examen: { tipo: 'trimestral', campo: 'LEN', periodoId: T1, reactivos: 26 }, resultados: [{ alumnoId: a1(), aciertos: 18 }, { alumnoId: a2(), aciertos: null }] }));
  fails(M('saveExam', { examen: { tipo: 'trimestral', campo: 'LEN', periodoId: T1, reactivos: 26 }, resultados: [{ alumnoId: a1(), aciertos: 30 }] }), /rango/);
  must(M('saveDisciplina', { periodoId: T1, registros: [{ alumnoId: a1(), puntos: 7 }, { alumnoId: a2(), puntos: null }] }));
  fails(M('saveDisciplina', { periodoId: T1, registros: [{ alumnoId: a1(), puntos: 11 }] }), /rango/);
  // Libreta: 37 días previos (36 asistió Angel) + 3 capturados en app = 40 / 39
  must(M('saveCarga', { periodoId: T1, concepto: 'ASIS', total: 37, registros: [{ alumnoId: a1(), valor: 34 }, { alumnoId: a2(), valor: 37 }] }));
  must(M('saveCarga', { periodoId: T1, concepto: 'TRAB_LEN', total: 42, registros: [{ alumnoId: a1(), valor: 37 }, { alumnoId: a2(), valor: 38.5 }] }));
  const d = must(M('getGroupData', {}));
  assert.equal(d.examenes.length, 1);
});

t('cálculo con la fórmula del Excel (asistencia, trabajos, examen, disciplina)', () => {
  const d = must(M('getGroupData', {}));
  const R = Calc.calcular(d, d.periodos[0].id);
  const angel = R.alumnos.find(f => f.alumno.nombre === 'ACOSTA ANGEL');
  // Días: 37 libreta + 2 en app (el 12 fue CTE) = 39. Angel: 34 + R + J = 36
  assert.equal(R.posiblesAsis, 39); assert.equal(angel.asis.asistio, 36);
  // Trabajos: 42 + 2 = 44; Angel 37 + 2 = 39
  assert.equal(angel.campos.LEN.trabajos.posibles, 44); assert.equal(angel.campos.LEN.trabajos.hechos, 39);
  const esperado = (18 / 26 * 20 + 39 / 44 * 60 + 36 / 39 * 10 + 7 / 10 * 10) / 10;
  assert(Math.abs(angel.campos.LEN.cal - esperado) < 1e-9);
  const fatima = R.alumnos.find(f => f.alumno.nombre === 'ACOSTA FATIMA');
  assert.equal(fatima.campos.LEN.examen.aciertos, null); // faltó al examen → 0 en esa parte
  assert.equal(fatima.asis.asistio, 38); // 37 + F + P
  assert.equal(fatima.campos.LEN.trabajos.hechos, 39); // 38.5 + 0.5 + 0
  assert.equal(R.alumnos.length, 2); // la baja no aparece
});

t('admin desactiva usuario y su sesión deja de servir', () => {
  must(A('saveUser', { id: maestra.usuario.id, activo: false }));
  const r = A('listGroups', {}, maestra.token); assert.equal(r.auth, true);
  fails(gs.call({ action: 'login', usuario: 'adriana', password: 'maestra2026' }));
});
t('admin no puede desactivarse a sí mismo', () => fails(A('saveUser', { id: admin.usuario.id, activo: false }), /No puedes/));
t('cambio de contraseña', () => {
  must(A('changePassword', { actual: 'secreto123', nueva: 'nuevaClave9' }));
  must(gs.call({ action: 'login', usuario: 'daniel', password: 'nuevaClave9' }));
});
t('bloqueo tras muchos intentos fallidos', () => {
  for (let i = 0; i < 6; i++) gs.call({ action: 'login', usuario: 'daniel', password: 'mal' + i });
  fails(gs.call({ action: 'login', usuario: 'daniel', password: 'nuevaClave9' }), /intentos/);
});

console.log(`\n${ok} pruebas pasaron`);
