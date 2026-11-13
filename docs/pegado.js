/* Carga masiva: interpreta lo que se pega desde Excel, una libreta escaneada, WhatsApp, etc.
 * Formatos aceptados, un alumno por renglón:
 *   18                     → por orden de lista (renglón 1 = alumno #1). Un renglón vacío = sin dato.
 *   5  18                  → número de lista y valor
 *   ACOSTA ANGEL   18      → nombre (o parte del nombre) y valor; el valor es el último número del renglón
 *   Faltó / F / -          → sin dato (en exámenes cuenta como que faltó)
 */
(function (root) {
  function norm(s) {
    return String(s || '').toUpperCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
      .replace(/[^A-Z0-9Ñ ]/g, ' ').replace(/\s+/g, ' ').trim();
  }
  var VACIO = /^(F|FALTO|FALTA|NP|SC|-|—|X)$/;

  function numero(t) {
    var v = Number(String(t).replace(',', '.'));
    return isNaN(v) ? null : v;
  }

  function buscarAlumno(alumnos, texto) {
    var q = norm(texto);
    if (!q) return { error: 'sin nombre' };
    var exactos = alumnos.filter(function (a) { return norm(a.nombre) === q; });
    if (exactos.length === 1) return { alumno: exactos[0] };
    var palabras = q.split(' ');
    var cands = alumnos.filter(function (a) {
      var n = ' ' + norm(a.nombre) + ' ';
      return palabras.every(function (p) { return n.indexOf(' ' + p + ' ') >= 0 || n.indexOf(' ' + p) >= 0; });
    });
    if (cands.length === 1) return { alumno: cands[0] };
    return { error: cands.length ? 'coincide con ' + cands.length + ' alumnos' : 'no se encontró' };
  }

  /**
   * @param texto lo pegado
   * @param alumnos activos [{id, num, nombre}] en orden de lista
   * @param opts { max, decimales }
   * @returns { valores: {alumnoId: number|''}, asignados, problemas: [string], modo }
   */
  function interpretar(texto, alumnos, opts) {
    opts = opts || {};
    var max = opts.max == null ? Infinity : Number(opts.max);
    var lineas = String(texto || '').replace(/\r/g, '').split('\n');
    while (lineas.length && !lineas[lineas.length - 1].trim()) lineas.pop();
    var porNombre = lineas.some(function (l) { return /[A-Za-zÀ-ÿ]{3,}/.test(l.replace(/\b(falt[oó]|falta)\b/ig, '')); });
    var lista = alumnos.slice().sort(function (a, b) { return a.num - b.num; });
    var porNum = {}; lista.forEach(function (a) { porNum[a.num] = a; });
    var res = { valores: {}, asignados: 0, problemas: [], modo: porNombre ? 'nombre' : 'orden' };
    var usados = {};

    lineas.forEach(function (linea, i) {
      var renglon = 'Renglón ' + (i + 1);
      var tokens = linea.trim().split(/[\t;]+|\s{1,}/).filter(Boolean);
      var alumno = null, valorTxt = null;

      if (porNombre) {
        if (!linea.trim()) return;
        var ult = tokens[tokens.length - 1];
        var esVacio = VACIO.test(norm(ult));
        if (numero(ult) == null && !esVacio) { res.problemas.push(renglon + ': falta la calificación (' + linea.trim() + ')'); return; }
        valorTxt = ult;
        var nombre = tokens.slice(0, -1).filter(function (t) { return numero(t) == null; }).join(' ');
        var b = buscarAlumno(lista, nombre);
        if (!b.alumno) { res.problemas.push(renglon + ': "' + nombre + '" ' + b.error); return; }
        alumno = b.alumno;
      } else {
        var nums = tokens.filter(function (t) { return numero(t) != null || VACIO.test(norm(t)); });
        if (nums.length >= 2 && numero(nums[0]) != null && porNum[numero(nums[0])] && Number.isInteger(numero(nums[0]))) {
          alumno = porNum[numero(nums[0])]; valorTxt = nums[nums.length - 1];
        } else {
          alumno = lista[i];
          valorTxt = nums.length ? nums[nums.length - 1] : '';
          if (!alumno) { res.problemas.push(renglon + ': hay más renglones que alumnos (' + lista.length + ')'); return; }
        }
      }

      if (usados[alumno.id]) { res.problemas.push(renglon + ': ' + alumno.nombre + ' aparece dos veces'); return; }
      var v = valorTxt === '' || valorTxt == null || VACIO.test(norm(valorTxt)) ? '' : numero(valorTxt);
      if (v !== '' && (v < 0 || v > max)) { res.problemas.push(renglon + ': ' + alumno.nombre + ' tiene ' + v + ' (máximo ' + max + ')'); return; }
      usados[alumno.id] = true;
      res.valores[alumno.id] = v;
      res.asignados++;
    });

    if (res.modo === 'orden' && lineas.length && lineas.length < lista.length) {
      res.problemas.push('Pegaste ' + lineas.length + ' renglones y hay ' + lista.length + ' alumnos: los últimos ' + (lista.length - lineas.length) + ' no se tocarán.');
    }
    return res;
  }

  var api = { interpretar: interpretar, norm: norm };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.Pegado = api;
})(this);
