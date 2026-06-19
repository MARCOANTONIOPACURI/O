/* ===================================================================
   OLIMPIADAS ESCOLARES — script.js
   Flujo tipo "kiosco": bienvenida -> tarjeta de participante (hasta 6,
   con botón Siguiente) -> confirmación. Todo se guarda en memoria del
   navegador hasta el envío final; nada usa localStorage. El backend
   (Google Apps Script + Sheets) es la única fuente de verdad para cupos.
   =================================================================== */

// -------------------------------------------------------------------
// 1. CONFIGURACIÓN — PEGA AQUÍ TU URL DE WEB APP
// -------------------------------------------------------------------
// Después de desplegar el Apps Script como "Aplicación web" (ver
// instrucciones en DESPLIEGUE.md), copia la URL que termina en /exec
// y pégala abajo, entre las comillas.
const API_URL = 'https://script.google.com/macros/s/AKfycbxVYL7HmOOthE-0oPgKbBcQZ24ivkxjd2ewjoje1MAa6QcUCjRfeVIc97XfIj5eEeWqzw/exec';

// Cuántos participantes como máximo se pueden agregar en una sesión
const MAX_PARTICIPANTES = 6;

// Cuántos deportes como máximo puede elegir cada participante
const MAX_DEPORTES_POR_PERSONA = 2;

// Cada cuánto se refresca el estado de cupos mientras el usuario llena el formulario (ms)
const POLL_INTERVAL_MS = 8000;

// -------------------------------------------------------------------
// 2. ESTADO EN MEMORIA
// -------------------------------------------------------------------
const state = {
  cupos: [],            // [{ deporte, cupoMaximo, inscritos, disponibles }]
  seleccionActual: [],  // deportes elegidos para el participante que se está llenando ahora
  agregados: [],         // [{ participante, telefono, deportes:[...] }] ya confirmados con "Siguiente"
  cargandoCupos: false,
  pollTimer: null,
  enviando: false
};

// -------------------------------------------------------------------
// 3. HELPERS DE RED
// -------------------------------------------------------------------

async function apiGet(accion) {
  const url = API_URL + '?accion=' + encodeURIComponent(accion);
  const res = await fetch(url, { method: 'GET' });
  if (!res.ok) throw new Error('Error de red: ' + res.status);
  return res.json();
}

async function apiPost(payload) {
  const res = await fetch(API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify(payload)
  });
  if (!res.ok) throw new Error('Error de red: ' + res.status);
  return res.json();
}

// -------------------------------------------------------------------
// 4. CARGA Y RENDER DE CUPOS
// -------------------------------------------------------------------

async function cargarCupos({ silencioso = false } = {}) {
  if (state.cargandoCupos) return;
  state.cargandoCupos = true;

  try {
    const data = await apiGet('obtenerCupos');
    if (!data.exito) throw new Error(data.error || 'No se pudieron obtener los cupos.');

    state.cupos = data.cupos;
    renderSportGrid();
    setHeaderStatus('live');

  } catch (err) {
    console.error('Error cargando cupos:', err);
    setHeaderStatus('error');
    if (!silencioso) mostrarToast('No se pudo conectar con el servidor.', 'error');
  } finally {
    state.cargandoCupos = false;
  }
}

function setHeaderStatus(estado) {
  const dotEl = document.querySelector('.status-dot');
  const text = document.getElementById('header-status-text');
  if (!dotEl || !text) return;

  dotEl.classList.remove('is-live', 'is-error');

  if (estado === 'live') {
    dotEl.classList.add('is-live');
    text.textContent = 'Cupos en vivo';
  } else if (estado === 'error') {
    dotEl.classList.add('is-error');
    text.textContent = 'Sin conexión';
  } else {
    text.textContent = 'Conectando...';
  }
}

function nivelDeCupo(disponibles, maximo) {
  if (disponibles <= 0) return 'full';
  if (maximo > 0 && disponibles / maximo <= 0.34) return 'warning';
  return 'ok';
}

/**
 * Cuenta, dentro de esta misma sesión (agregados + selección actual),
 * cuántos cupos ya está "reservando" mentalmente el usuario para un
 * deporte, para no dejarlo pasar de cupo localmente antes de validar
 * con el servidor.
 */
function reservadosEnSesion(deporte) {
  let total = 0;
  state.agregados.forEach(function (p) {
    if (p.deportes.indexOf(deporte) !== -1) total++;
  });
  if (state.seleccionActual.indexOf(deporte) !== -1) total++;
  return total;
}

function renderSportGrid() {
  const grid = document.getElementById('sport-grid');
  if (!grid) return;

  if (!state.cupos.length) {
    grid.innerHTML = '<p style="color:var(--ink-soft); font-size:0.85rem;">Cargando deportes...</p>';
    return;
  }

  grid.innerHTML = state.cupos.map(function (c) {
    const reservadosSesion = reservadosEnSesion(c.deporte);
    // Disponibilidad efectiva = lo que dice el servidor, menos lo que
    // ya se apartó en esta misma sesión (para participantes anteriores del lote)
    const disponiblesEfectivo = c.disponibles - reservadosSesion + (state.seleccionActual.indexOf(c.deporte) !== -1 ? 1 : 0);
    const lleno = disponiblesEfectivo <= 0 && state.seleccionActual.indexOf(c.deporte) === -1;

    const nivel = nivelDeCupo(c.disponibles - reservadosSesion + (state.seleccionActual.indexOf(c.deporte) !== -1 ? 1 : 0), c.cupoMaximo);
    const seleccionado = state.seleccionActual.indexOf(c.deporte) !== -1;
    const inscritosMostrados = c.inscritos + reservadosSesion - (seleccionado ? 1 : 0);
    const pct = c.cupoMaximo > 0 ? Math.min(100, Math.round((inscritosMostrados / c.cupoMaximo) * 100)) : 0;

    let clases = 'sport-card';
    if (seleccionado) clases += ' is-selected';
    if (lleno) clases += ' is-full';
    if (nivel === 'warning' && !lleno) clases += ' is-warning';
    if (lleno) clases += ' is-full';

    return (
      '<button type="button" class="' + clases + '" data-deporte="' + escapeHTML(c.deporte) + '"' + (lleno ? ' disabled' : '') + '>' +
        '<div class="sport-card-top">' +
          '<span class="sport-card-name">' + escapeHTML(c.deporte) + '</span>' +
          '<span class="sport-card-check" aria-hidden="true"></span>' +
        '</div>' +
        '<div class="sport-card-quota">' +
          '<div class="sport-card-bar"><div class="sport-card-bar-fill" style="width:' + pct + '%"></div></div>' +
          '<span class="sport-card-count">' + inscritosMostrados + '/' + c.cupoMaximo + '</span>' +
        '</div>' +
      '</button>'
    );
  }).join('');
}

// -------------------------------------------------------------------
// 5. SELECCIÓN DE DEPORTES (tarjetas tocables, hasta 2)
// -------------------------------------------------------------------

function initSportGrid() {
  const grid = document.getElementById('sport-grid');
  if (!grid) return;

  grid.addEventListener('click', function (e) {
    const card = e.target.closest('.sport-card');
    if (!card || card.disabled) return;

    const deporte = card.dataset.deporte;
    const idx = state.seleccionActual.indexOf(deporte);

    if (idx !== -1) {
      // Ya estaba elegido: lo quitamos
      state.seleccionActual.splice(idx, 1);
    } else {
      if (state.seleccionActual.length >= MAX_DEPORTES_POR_PERSONA) {
        mostrarToast('Máximo ' + MAX_DEPORTES_POR_PERSONA + ' deportes por participante.', 'error');
        return;
      }
      state.seleccionActual.push(deporte);
    }

    ocultarError();
    renderSportGrid();
  });
}

// -------------------------------------------------------------------
// 6. WIZARD: NAVEGACIÓN ENTRE PANELES
// -------------------------------------------------------------------

function mostrarPanel(id) {
  document.querySelectorAll('.panel').forEach(function (p) { p.classList.remove('is-active'); });
  document.getElementById(id).classList.add('is-active');
}

function actualizarProgreso() {
  const numero = state.agregados.length + 1;
  document.getElementById('progress-label').textContent =
    'Participante ' + numero + ' de ' + MAX_PARTICIPANTES;
  document.getElementById('form-title').textContent =
    state.agregados.length === 0 ? 'Datos del participante' : 'Agregar otro participante';

  const dotsWrap = document.getElementById('progress-dots');
  let dots = '';
  for (let i = 0; i < MAX_PARTICIPANTES; i++) {
    let cls = 'dot';
    if (i < state.agregados.length) cls += ' is-done';
    else if (i === state.agregados.length) cls += ' is-current';
    dots += '<span class="' + cls + '"></span>';
  }
  dotsWrap.innerHTML = dots;

  const btnText = document.getElementById('btn-siguiente-text');
  const esUltimoPosible = numero >= MAX_PARTICIPANTES;
  btnText.textContent = esUltimoPosible ? 'Finalizar e inscribir' : 'Siguiente';
}

function renderAddedList() {
  const list = document.getElementById('added-list');
  if (!list) return;

  list.innerHTML = state.agregados.map(function (p, i) {
    return (
      '<li class="added-item">' +
        '<div class="added-item-info">' +
          '<span class="added-item-name">' + (i + 1) + '. ' + escapeHTML(p.participante) + '</span>' +
          '<span class="added-item-sports">' + escapeHTML(p.deportes.join(' + ')) + '</span>' +
        '</div>' +
        '<button type="button" class="added-item-remove" data-index="' + i + '" title="Quitar" aria-label="Quitar participante">&times;</button>' +
      '</li>'
    );
  }).join('');
}

function initAddedListRemoval() {
  const list = document.getElementById('added-list');
  if (!list) return;

  list.addEventListener('click', function (e) {
    const btn = e.target.closest('.added-item-remove');
    if (!btn) return;
    const idx = Number(btn.dataset.index);
    state.agregados.splice(idx, 1);
    renderAddedList();
    actualizarProgreso();
    renderSportGrid();
  });
}

// -------------------------------------------------------------------
// 7. FORMULARIO DE PARTICIPANTE (paso "Siguiente")
// -------------------------------------------------------------------

function mostrarError(msg) {
  const el = document.getElementById('form-error');
  el.textContent = msg;
  el.classList.add('is-visible');
}

function ocultarError() {
  const el = document.getElementById('form-error');
  el.textContent = '';
  el.classList.remove('is-visible');
}

function limpiarFormularioParticipante() {
  document.getElementById('input-nombre').value = '';
  document.getElementById('input-telefono').value = '';
  state.seleccionActual = [];
  ocultarError();
  renderSportGrid();
}

function initFormularioParticipante() {
  const form = document.getElementById('form-participante');
  if (!form) return;

  form.addEventListener('submit', async function (e) {
    e.preventDefault();
    if (state.enviando) return;

    ocultarError();

    const nombre = document.getElementById('input-nombre').value.trim();
    const telefono = document.getElementById('input-telefono').value.trim();
    const deportes = state.seleccionActual.slice();

    if (!nombre) { mostrarError('Escribe el nombre completo del participante.'); return; }
    if (!telefono) { mostrarError('Escribe el teléfono de contacto.'); return; }
    if (deportes.length === 0) { mostrarError('Elige al menos un deporte.'); return; }

    // Revalidación local contra cupos reales antes de agregar a la lista
    for (let i = 0; i < deportes.length; i++) {
      const cupo = state.cupos.find(function (c) { return c.deporte === deportes[i]; });
      const reservados = reservadosEnSesion(deportes[i]) - 1; // -1 porque ya cuenta la selección actual
      if (cupo && (cupo.disponibles - reservados) <= 0) {
        mostrarError('"' + deportes[i] + '" ya no tiene cupo disponible. Quítalo y elige otro.');
        return;
      }
    }

    state.agregados.push({ participante: nombre, telefono: telefono, deportes: deportes });

    if (state.agregados.length >= MAX_PARTICIPANTES) {
      await enviarLote();
      return;
    }

    limpiarFormularioParticipante();
    renderAddedList();
    actualizarProgreso();
  });

  document.getElementById('btn-cancelar').addEventListener('click', function () {
    const confirmado = state.agregados.length === 0 || window.confirm('¿Cancelar la inscripción? Se perderá lo que llevas avanzado.');
    if (!confirmado) return;
    reiniciarWizard();
    mostrarPanel('panel-bienvenida');
  });
}

// -------------------------------------------------------------------
// 8. ENVÍO FINAL AL BACKEND
// -------------------------------------------------------------------

async function enviarLote() {
  state.enviando = true;
  const btn = document.getElementById('btn-siguiente');
  btn.disabled = true;
  document.getElementById('btn-siguiente-text').textContent = 'Enviando...';

  try {
    const resp = await apiPost({
      accion: 'registrarLote',
      participantes: state.agregados
    });

    if (!resp.exito) {
      mostrarError(resp.error || 'No se pudo completar la inscripción.');
      btn.disabled = false;
      actualizarProgreso();
      await cargarCupos(); // refrescar por si algo cambió
      return;
    }

    mostrarExito();
    await cargarCupos();

  } catch (err) {
    console.error('Error registrando lote:', err);
    mostrarError('Error de conexión. Intenta nuevamente en unos segundos.');
    btn.disabled = false;
    actualizarProgreso();
  } finally {
    state.enviando = false;
  }
}

function mostrarExito() {
  const nombres = state.agregados.map(function (p) { return p.participante; });
  const resumen = nombres.length === 1
    ? nombres[0] + ' quedó inscrito correctamente.'
    : nombres.join(', ') + ' quedaron inscritos correctamente.';

  document.getElementById('exito-resumen').textContent = resumen;
  mostrarPanel('panel-exito');
  mostrarToast('Inscripción enviada con éxito', 'success');
}

// -------------------------------------------------------------------
// 9. REINICIO DEL WIZARD
// -------------------------------------------------------------------

function reiniciarWizard() {
  state.agregados = [];
  state.seleccionActual = [];
  limpiarFormularioParticipante();
  renderAddedList();
  actualizarProgreso();
}

function initNavegacionWizard() {
  document.getElementById('btn-comenzar').addEventListener('click', function () {
    reiniciarWizard();
    mostrarPanel('panel-formulario');
  });

  document.getElementById('btn-nueva-inscripcion').addEventListener('click', function () {
    reiniciarWizard();
    mostrarPanel('panel-bienvenida');
  });
}

// -------------------------------------------------------------------
// 10. TOAST
// -------------------------------------------------------------------

let toastTimer = null;

function mostrarToast(mensaje, tipo) {
  const toast = document.getElementById('toast');
  if (!toast) return;

  toast.textContent = mensaje;
  toast.className = 'toast is-visible' + (tipo ? ' is-' + tipo : '');

  clearTimeout(toastTimer);
  toastTimer = setTimeout(function () { toast.classList.remove('is-visible'); }, 3600);
}

// -------------------------------------------------------------------
// 11. UTILIDADES
// -------------------------------------------------------------------

function escapeHTML(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

// -------------------------------------------------------------------
// 12. POLLING DE CUPOS (mientras el usuario llena el formulario)
// -------------------------------------------------------------------

function iniciarPollingCupos() {
  if (state.pollTimer) clearInterval(state.pollTimer);
  state.pollTimer = setInterval(function () {
    cargarCupos({ silencioso: true });
  }, POLL_INTERVAL_MS);

  document.addEventListener('visibilitychange', function () {
    if (document.hidden) {
      clearInterval(state.pollTimer);
    } else {
      cargarCupos({ silencioso: true });
      state.pollTimer = setInterval(function () {
        cargarCupos({ silencioso: true });
      }, POLL_INTERVAL_MS);
    }
  });
}

// -------------------------------------------------------------------
// 13. INICIALIZACIÓN
// -------------------------------------------------------------------

function init() {
  if (!API_URL || API_URL.includes('PEGA_AQUI_TU_URL_DE_WEB_APP')) {
    setHeaderStatus('error');
    console.warn('⚠️ Configura API_URL en script.js con la URL de tu Web App de Apps Script.');
  }

  initSportGrid();
  initFormularioParticipante();
  initAddedListRemoval();
  initNavegacionWizard();
  actualizarProgreso();

  cargarCupos();
  iniciarPollingCupos();
}

document.addEventListener('DOMContentLoaded', init);