/* Gráficas SVG ligeras (sin librerías). Colores validados para daltonismo:
 *  serie 1 (azul) / serie 2 (naranja); bandas de calificación rojo / ámbar / verde, siempre con etiqueta y leyenda.
 */
(function (root) {
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function f1(n) { return n == null || isNaN(n) ? '—' : (Math.round(n * 10) / 10).toFixed(1); }
  var W = 360, LBL = 104, X0 = LBL, X1 = W - 34;
  // Colores y estilos en línea (no clases ni variables CSS) para que también salgan al generar PDF o imagen
  var COL = { '--s1': '#2a78d6', '--s2': '#eb6834', '--b-bajo': '#d63d4b', '--b-medio': '#e0a100', '--b-alto': '#1e9e63' };
  var FONT = 'font-family="system-ui, -apple-system, Segoe UI, Roboto, sans-serif"';
  var ST = {
    grid: 'stroke="#e9e7f0" stroke-width="1"',
    umbral: 'stroke="#d63d4b" stroke-width="1" stroke-dasharray="3 3" stroke-opacity="0.6"',
    axis: FONT + ' font-size="9" fill="#6b6880"',
    label: FONT + ' font-size="11" fill="#1f1d2b"',
    value: FONT + ' font-size="10" font-weight="600" fill="#1f1d2b"',
    muted: FONT + ' font-size="10" fill="#6b6880"',
    inn: FONT + ' font-size="10" font-weight="700" fill="#ffffff"',
    innDark: FONT + ' font-size="10" font-weight="700" fill="#0b0b0b"'
  };
  function col(v) { return COL[v] || v; }

  function leyenda(items) {
    return '<div class="viz-legend">' + items.map(function (i) {
      return '<span><i class="viz-sw" style="background:' + col(i.color) + '"></i>' + esc(i.nombre) + '</span>';
    }).join('') + '</div>';
  }

  function corta(t, n) { t = String(t); return t.length > n ? t.slice(0, n - 1) + '…' : t; }

  /** Barras horizontales agrupadas en escala 0–max. series: [{nombre, color:'--s1', valores:[n|null]}] */
  function barrasH(o) {
    var max = o.max || 10, n = o.series.length, bh = 12, gap = 3, rowH = n * bh + (n - 1) * gap + 16;
    var H = 18 + o.categorias.length * rowH;
    var x = function (v) { return X0 + (X1 - X0) * Math.max(0, Math.min(v, max)) / max; };
    var s = '<svg class="viz" xmlns="http://www.w3.org/2000/svg" width="' + W + '" height="' + H + '" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="' + esc(o.titulo || '') + '">';
    [0, max / 2, max].forEach(function (t) {
      s += '<line x1="' + x(t) + '" x2="' + x(t) + '" y1="12" y2="' + H + '" ' + ST.grid + '/><text x="' + x(t) + '" y="9" ' + ST.axis + ' text-anchor="middle">' + t + '</text>';
    });
    if (o.umbral != null) s += '<line x1="' + x(o.umbral) + '" x2="' + x(o.umbral) + '" y1="12" y2="' + H + '" ' + ST.umbral + '/>';
    o.categorias.forEach(function (c, i) {
      var y0 = 18 + i * rowH + 8;
      s += '<text x="' + (LBL - 8) + '" y="' + (y0 + (rowH - 16) / 2 + 4) + '" ' + ST.label + ' text-anchor="end">' + esc(corta(c, 15)) + '</text>';
      o.series.forEach(function (se, k) {
        var v = se.valores[i], y = y0 + k * (bh + gap);
        if (v == null) { s += '<text x="' + (X0 + 4) + '" y="' + (y + 10) + '" ' + ST.muted + '>sin dato</text>'; return; }
        var w = Math.max(2, x(v) - X0);
        s += '<rect x="' + X0 + '" y="' + y + '" width="' + w + '" height="' + bh + '" rx="3" fill="' + col(se.color) + '"><title>' + esc(se.nombre + ' · ' + c + ': ' + f1(v)) + '</title></rect>' +
          '<text x="' + (X0 + w + 4) + '" y="' + (y + 10) + '" ' + ST.value + '>' + f1(v) + '</text>';
      });
    });
    return leyenda(o.series) + s + '</svg>';
  }

  /** Barras 100% apiladas: cuántos alumnos en cada banda por categoría. bandas: [{nombre, color, valores:[conteo]}] */
  function apiladas(o) {
    var rowH = 30, H = 8 + o.categorias.length * rowH;
    var s = '<svg class="viz" xmlns="http://www.w3.org/2000/svg" width="' + W + '" height="' + H + '" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="' + esc(o.titulo || '') + '">';
    o.categorias.forEach(function (c, i) {
      var y = 8 + i * rowH, total = o.bandas.reduce(function (t, b) { return t + (b.valores[i] || 0); }, 0);
      s += '<text x="' + (LBL - 8) + '" y="' + (y + 13) + '" ' + ST.label + ' text-anchor="end">' + esc(corta(c, 15)) + '</text>';
      if (!total) { s += '<text x="' + (X0 + 4) + '" y="' + (y + 13) + '" ' + ST.muted + '>sin calificaciones</text>'; return; }
      var xx = X0, ancho = X1 + 26 - X0;
      o.bandas.forEach(function (b) {
        var v = b.valores[i] || 0;
        if (!v) return;
        var w = ancho * v / total;
        s += '<rect x="' + xx + '" y="' + y + '" width="' + Math.max(1, w - 2) + '" height="18" rx="3" fill="' + col(b.color) + '"><title>' + esc(c + ' · ' + b.nombre + ': ' + v + ' alumno' + (v === 1 ? '' : 's')) + '</title></rect>';
        if (w > 20) s += '<text x="' + (xx + (w - 2) / 2) + '" y="' + (y + 13) + '" text-anchor="middle" ' + (b.oscuro ? ST.innDark : ST.inn) + '>' + v + '</text>';
        xx += w;
      });
    });
    return leyenda(o.bandas) + s + '</svg>';
  }

  /** Línea por trimestre, escala 0–10. series: [{nombre, color, valores:[n|null]}] */
  function lineas(o) {
    var H = 170, top = 14, bot = H - 24, L = 30, R = W - 54;
    var nx = o.categorias.length, x = function (i) { return nx === 1 ? (L + R) / 2 : L + (R - L) * i / (nx - 1); };
    var y = function (v) { return bot - (bot - top) * v / 10; };
    var s = '<svg class="viz" xmlns="http://www.w3.org/2000/svg" width="' + W + '" height="' + H + '" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="' + esc(o.titulo || '') + '">';
    [0, 5, 10].forEach(function (t) { s += '<line x1="' + L + '" x2="' + R + '" y1="' + y(t) + '" y2="' + y(t) + '" ' + ST.grid + '/><text x="' + (L - 6) + '" y="' + (y(t) + 4) + '" ' + ST.axis + ' text-anchor="end">' + t + '</text>'; });
    if (o.umbral != null) s += '<line x1="' + L + '" x2="' + R + '" y1="' + y(o.umbral) + '" y2="' + y(o.umbral) + '" ' + ST.umbral + '/>';
    o.categorias.forEach(function (c, i) { s += '<text x="' + x(i) + '" y="' + (H - 6) + '" ' + ST.axis + ' text-anchor="middle">' + esc(c) + '</text>'; });
    var etiquetas = [];
    o.series.forEach(function (se) {
      var pts = se.valores.map(function (v, i) { return v == null ? null : [x(i), y(v), v]; });
      var d = '', pen = false;
      pts.forEach(function (p) { if (!p) { pen = false; return; } d += (pen ? 'L' : 'M') + p[0].toFixed(1) + ' ' + p[1].toFixed(1); pen = true; });
      if (d) s += '<path d="' + d + '" fill="none" stroke-width="2" stroke="' + col(se.color) + '"/>';
      var last = null;
      pts.forEach(function (p) {
        if (!p) return;
        last = p;
        s += '<circle cx="' + p[0] + '" cy="' + p[1] + '" r="5" stroke="#ffffff" stroke-width="2" fill="' + col(se.color) + '"><title>' + esc(se.nombre + ': ' + f1(p[2])) + '</title></circle>';
      });
      if (last) etiquetas.push({ x: last[0] + 9, y: last[1] + 4, t: f1(last[2]) });
    });
    // Separa etiquetas finales que se encimen (mínimo 12px)
    etiquetas.sort(function (a, b) { return a.y - b.y; });
    for (var i = 1; i < etiquetas.length; i++) if (etiquetas[i].y - etiquetas[i - 1].y < 12) etiquetas[i].y = etiquetas[i - 1].y + 12;
    etiquetas.forEach(function (e) { s += '<text x="' + e.x + '" y="' + e.y + '" ' + ST.value + '>' + e.t + '</text>'; });
    return leyenda(o.series) + s + '</svg>';
  }

  root.Graficas = { barrasH: barrasH, apiladas: apiladas, lineas: lineas };
})(this);
