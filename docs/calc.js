/* Cálculo de calificaciones — mismo método que el Excel REGISTRO ANUAL:
 *   Calificación del campo = Examen (20%) + Trabajos (60%) + Asistencia (10%) + Disciplina (10%)
 * Cada parte es (logrado / posible) × peso. El resultado se muestra en escala 0–10.
 */
(function (root) {
  /** Materias activas del grupo: { id, nombre (corto), largo }. */
  /** ¿El concepto se califica en esta materia? (sin materias elegidas = en todas) */
  function aplicaEn(k, materia) { return !k.materias || !k.materias.length || k.materias.indexOf(materia) >= 0; }

  /** Conceptos extra de calificación del grupo (participación, proyecto…): { clave, nombre, peso, max, tipo: 'general'|'materia' }. */
  function conceptos(d) {
    return (d.conceptos || []).filter(function (k) { return k.activo !== false; });
  }

  function campos(d) {
    return (d.materias || []).filter(function (m) { return m.activo; })
      .map(function (m) { return { id: m.clave, nombre: m.corto || m.nombre, largo: String(m.nombre).toUpperCase() }; });
  }
  var CUENTA_COMO_ASISTENCIA = { P: true, R: true, J: true };

  function inRange(f, p) { return f >= p.inicio && f <= p.fin; }

  /** Índices rápidos sobre los datos crudos del grupo. */
  function indexar(d) {
    var ix = { sinClase: {}, asis: {}, entregas: {}, resultados: {}, disciplina: {}, carga: {}, puntos: {} };
    (d.puntos || []).forEach(function (r) {
      var k = r[0] + '|' + r[1] + '|' + (r[2] || '');
      (ix.puntos[k] = ix.puntos[k] || {})[r[3]] = r[4];
    });
    d.diasSinClase.forEach(function (x) { ix.sinClase[x.fecha] = x.motivo || 'Sin clase'; });
    d.asistencia.forEach(function (r) { (ix.asis[r[0]] = ix.asis[r[0]] || {})[r[1]] = r[2]; });
    d.entregas.forEach(function (r) { (ix.entregas[r[0]] = ix.entregas[r[0]] || {})[r[1]] = r[2]; });
    d.resultados.forEach(function (r) { (ix.resultados[r[0]] = ix.resultados[r[0]] || {})[r[1]] = r[2]; });
    d.disciplina.forEach(function (r) { (ix.disciplina[r[0]] = ix.disciplina[r[0]] || {})[r[1]] = r[2]; });
    d.carga.forEach(function (r) {
      var k = r[0] + '|' + r[1];
      (ix.carga[k] = ix.carga[k] || {})[r[2]] = r[3];
    });
    return ix;
  }

  function diasDeClase(d, ix, p) {
    return Object.keys(ix.asis).filter(function (f) { return inRange(f, p) && !ix.sinClase[f]; }).sort();
  }

  function examenDe(d, periodoId, campo, tipo) {
    return d.examenes.filter(function (x) {
      return x.campo === campo && x.tipo === (tipo || 'trimestral') && (tipo === 'diagnostico' || x.periodoId === periodoId);
    })[0] || null;
  }

  /**
   * Calcula todo para un periodo.
   * Devuelve { periodo, dias, alumnos: [{ alumno, asis, disc, campos: {LEN: {...}}, promedio }], resumen }
   */
  function calcular(d, periodoId) {
    var ix = indexar(d);
    var p = d.periodos.filter(function (x) { return x.id === periodoId; })[0];
    if (!p) return null;
    var w = d.grupo.pesos;
    var dmax = d.grupo.disciplinaMax || 10;

    var dias = diasDeClase(d, ix, p);
    var cargaAsis = ix.carga[p.id + '|ASIS'] || {};
    var posiblesAsis = dias.length + (Number(cargaAsis.TOTAL) || 0);

    var CAMPOS = campos(d);
    var EXTRAS = conceptos(d);
    var porCampo = {};
    CAMPOS.forEach(function (c) {
      var acts = d.actividades.filter(function (a) { return a.campo === c.id && inRange(a.fecha, p); });
      var carga = ix.carga[p.id + '|TRAB_' + c.id] || {};
      porCampo[c.id] = {
        acts: acts, carga: carga,
        posibles: acts.length + (Number(carga.TOTAL) || 0),
        examen: examenDe(d, p.id, c.id, 'trimestral')
      };
    });

    var activos = d.alumnos.filter(function (a) { return a.activo; });
    var filas = activos.map(function (al) {
      var asistio = dias.reduce(function (n, f) { return n + (CUENTA_COMO_ASISTENCIA[(ix.asis[f] || {})[al.id]] ? 1 : 0); }, 0);
      asistio += Number(cargaAsis[al.id]) || 0;
      var rAsis = posiblesAsis ? asistio / posiblesAsis : 0;

      var puntos = (ix.disciplina[p.id] || {})[al.id];
      var rDisc = puntos == null ? 0 : puntos / dmax;

      var campos = {};
      var suma = 0, n = 0;
      CAMPOS.forEach(function (c) {
        var pc = porCampo[c.id];
        var hechos = pc.acts.reduce(function (n, a) { return n + (Number((ix.entregas[a.id] || {})[al.id]) || 0); }, 0);
        hechos += Number(pc.carga[al.id]) || 0;
        var rTrab = pc.posibles ? hechos / pc.posibles : 0;

        var ex = pc.examen, aciertos = null, rEx = 0;
        if (ex) {
          aciertos = (ix.resultados[ex.id] || {})[al.id];
          if (aciertos == null) aciertos = null;
          rEx = aciertos == null ? 0 : aciertos / ex.reactivos;
        }
        // Materia sin examen ni trabajos en el periodo: no se califica (no baja el promedio)
        var sinDatos = !ex && pc.posibles === 0;
        // Conceptos que no aplican en esta materia: su porcentaje se reparte proporcionalmente en lo demás
        var denom = 100 - EXTRAS.reduce(function (s, k) { return s + (aplicaEn(k, c.id) ? 0 : k.peso); }, 0);
        var f = denom > 0 ? 10 / denom : 0;
        var extras = {}, sumaExtras = 0;
        EXTRAS.forEach(function (k) {
          if (!aplicaEn(k, c.id)) { extras[k.clave] = null; return; }
          var v = (ix.puntos[p.id + '|' + k.clave + '|' + (k.tipo === 'materia' ? c.id : '')] || {})[al.id];
          var r = v == null ? 0 : v / k.max;
          extras[k.clave] = { valor: v == null ? null : v, max: k.max, pts: r * k.peso * f, pesoEf: k.peso * f * 10 };
          sumaExtras += r * k.peso;
        });
        var cal = sinDatos ? null : (rEx * w.examen + rTrab * w.trabajos + rAsis * w.asistencia + rDisc * w.disciplina + sumaExtras) * f;
        campos[c.id] = {
          examen: { reactivos: ex ? ex.reactivos : null, aciertos: aciertos, cal: ex && aciertos != null ? aciertos / ex.reactivos * 10 : null, pts: rEx * w.examen * f, pesoEf: w.examen * f * 10 },
          trabajos: { hechos: hechos, posibles: pc.posibles, pts: rTrab * w.trabajos * f, pesoEf: w.trabajos * f * 10 },
          asistencia: { pts: rAsis * w.asistencia * f, pesoEf: w.asistencia * f * 10 },
          disciplina: { pts: rDisc * w.disciplina * f, pesoEf: w.disciplina * f * 10 },
          extras: extras,
          cal: cal
        };
        if (cal != null) { suma += cal; n++; }
      });
      return {
        alumno: al,
        asis: { asistio: asistio, posibles: posiblesAsis },
        disc: { puntos: puntos == null ? null : puntos, max: dmax },
        campos: campos,
        promedio: n ? suma / n : null
      };
    });

    var resumen = {};
    CAMPOS.forEach(function (c) { resumen[c.id] = distribucion(filas.map(function (f) { return f.campos[c.id].cal; })); });
    resumen.PROM = distribucion(filas.map(function (f) { return f.promedio; }));

    return { campos: CAMPOS, conceptos: EXTRAS, periodo: p, dias: dias, posiblesAsis: posiblesAsis, porCampo: porCampo, alumnos: filas, resumen: resumen };
  }

  /** Igual que el Excel: ≤6.49 → "6", 6.5–8.99 → "7-8", ≥9 → "9-10". */
  function distribucion(cals) {
    var r = { bajo: 0, medio: 0, alto: 0, n: 0, promedio: null };
    var s = 0;
    cals.forEach(function (c) {
      if (c == null || isNaN(c)) return;
      r.n++; s += c;
      if (c < 6.5) r.bajo++; else if (c < 9) r.medio++; else r.alto++;
    });
    r.promedio = r.n ? s / r.n : null;
    return r;
  }

  /** Todo lo de un alumno: calificaciones por trimestre y, del periodo elegido, faltas, trabajos pendientes, exámenes y puntos. */
  function resumenAlumno(d, alumnoId, periodoId) {
    var ix = indexar(d);
    var hoy = new Date(); var hoyIso = hoy.getFullYear() + '-' + ('0' + (hoy.getMonth() + 1)).slice(-2) + '-' + ('0' + hoy.getDate()).slice(-2);
    var periodos = d.periodos.filter(function (p) { return p.inicio <= hoyIso; });
    var porPeriodo = periodos.map(function (p) {
      var R = calcular(d, p.id);
      return { periodo: p, fila: R.alumnos.filter(function (f) { return f.alumno.id === alumnoId; })[0] || null, R: R };
    });
    var p = d.periodos.filter(function (x) { return x.id === periodoId; })[0];
    var actual = porPeriodo.filter(function (x) { return x.periodo.id === periodoId; })[0];
    var dias = p ? diasDeClase(d, ix, p) : [];
    var asis = { F: [], R: [], J: [] };
    dias.forEach(function (fch) { var e = (ix.asis[fch] || {})[alumnoId]; if (asis[e]) asis[e].push(fch); });
    var pendientes = [];
    if (p) campos(d).forEach(function (c) {
      d.actividades.filter(function (a) { return a.campo === c.id && inRange(a.fecha, p); })
        .sort(function (a, b) { return a.fecha < b.fecha ? -1 : 1; })
        .forEach(function (a) {
          var v = (ix.entregas[a.id] || {})[alumnoId];
          if (v == null || Number(v) < 1) pendientes.push({ materia: c.nombre, titulo: a.titulo, fecha: a.fecha, valor: v == null ? 0 : Number(v) });
        });
    });
    var diag = {};
    campos(d).forEach(function (c) {
      var ex = examenDe(d, null, c.id, 'diagnostico');
      var ac = ex ? (ix.resultados[ex.id] || {})[alumnoId] : null;
      diag[c.id] = ex ? { aciertos: ac == null ? null : ac, reactivos: ex.reactivos, cal: ac == null ? null : ac / ex.reactivos * 10 } : null;
    });
    return { porPeriodo: porPeriodo, actual: actual, faltas: asis.F, retardos: asis.R, justificadas: asis.J, pendientes: pendientes, diagnostico: diag };
  }

  /** Resultados de un examen (diagnóstico o trimestral) por campo. */
  function resultadosExamen(d, tipo, periodoId) {
    var ix = indexar(d);
    var out = {};
    campos(d).forEach(function (c) {
      var ex = examenDe(d, periodoId, c.id, tipo);
      var cals = d.alumnos.filter(function (a) { return a.activo; }).map(function (a) {
        if (!ex) return null;
        var ac = (ix.resultados[ex.id] || {})[a.id];
        return ac == null ? null : ac / ex.reactivos * 10;
      });
      out[c.id] = { examen: ex, cals: cals, resumen: distribucion(cals) };
    });
    return out;
  }

  /** Conteo de asistencias por alumno dentro del periodo (para mostrar "36/40"). */
  function asistenciasPeriodo(d, periodoId) {
    var r = calcular(d, periodoId);
    var m = {};
    if (r) r.alumnos.forEach(function (f) { m[f.alumno.id] = f.asis; });
    return m;
  }

  var api = { campos: campos, conceptos: conceptos, aplicaEn: aplicaEn, resumenAlumno: resumenAlumno, calcular: calcular, distribucion: distribucion, resultadosExamen: resultadosExamen,
    asistenciasPeriodo: asistenciasPeriodo, indexar: indexar, examenDe: examenDe };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.Calc = api;
})(this);
