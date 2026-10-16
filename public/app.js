/* ==========================================================================
   PORTAL ESPACIOS CAMPUSLANDS — CONTROLADOR FRONTEND (OFICIAL CAMPUSLANDS)
   Persistencia Robusta (Server + LocalStorage) • Asistente Dual Infallible
   ========================================================================== */

let appData = {
  rulesConfig: {},
  state: {
    spaces: [
      { id: "SP-AUDITORIO", name: "Auditorio", type: "AUDITORIO", zone: "Planta Principal", color: "#EF4444", status: "DISPONIBLE", lockReason: null },
      { id: "SP-COSMOS", name: "Cosmos", type: "SALA_ENTRENAMIENTO", zone: "Nivel 1 • Ala Este", color: "#8B5CF6", status: "DISPONIBLE", lockReason: null },
      { id: "SP-SKYLAB", name: "Skylab", type: "SALA_ENTRENAMIENTO", zone: "Nivel 1 • Ala Oeste", color: "#06B6D4", status: "DISPONIBLE", lockReason: null },
      { id: "SP-SPUTNIK", name: "Sputnik", type: "SALA_ENTRENAMIENTO", zone: "Nivel 1 • Sur", color: "#10B981", status: "DISPONIBLE", lockReason: null },
      { id: "SP-APOLLO", name: "Apollo", type: "SALA_ENTRENAMIENTO", zone: "Nivel 1 • Norte", color: "#F59E0B", status: "DISPONIBLE", lockReason: null },
      { id: "SP-SALA-BLANCA", name: "Sala Blanca", type: "SALA_ESPECIALIZADA", zone: "Nivel 2 • Innovación", color: "#E2E8F0", status: "DISPONIBLE", lockReason: null },
      { id: "SP-SALA-AZUL", name: "Sala Azul", type: "SALA_ENTRENAMIENTO", zone: "Nivel 2 • Desarrollo", color: "#3B82F6", status: "DISPONIBLE", lockReason: null },
      { id: "SP-SALA-AMARILLA-VERDE", name: "Sala Amarilla / Verde", type: "ZONA_CREATIVA", zone: "Nivel 2 • Creatividad", color: "#84CC16", status: "DISPONIBLE", lockReason: null },
      { id: "SP-ARTEMIS", name: "Artemis", type: "SALA_ENTRENAMIENTO", zone: "Nivel 1 • Centro", color: "#EC4899", status: "DISPONIBLE", lockReason: null }
    ],
    bookings: [],
    incidents: []
  }
};

let currentSelectedDate = "2026-10-16";
let currentFilterMode = "ALL"; // ALL | VALIDA | OCUPADO

const WEEK_DAYS = [
  { date: "2026-10-11", label: "DOM 11" },
  { date: "2026-10-12", label: "LUN 12" },
  { date: "2026-10-13", label: "MAR 13" },
  { date: "2026-10-14", label: "MIÉ 14" },
  { date: "2026-10-15", label: "JUE 15" },
  { date: "2026-10-16", label: "VIE 16" },
  { date: "2026-10-17", label: "SÁB 17" }
];

const SCHEDULE_HOURS = [
  { hhmm: "06:00", label: "06:00" },
  { hhmm: "08:00", label: "08:00" },
  { hhmm: "10:00", label: "10:00" },
  { hhmm: "12:00", label: "12:00" },
  { hhmm: "14:00", label: "14:00" },
  { hhmm: "16:00", label: "16:00" },
  { hhmm: "18:00", label: "18:00" },
  { hhmm: "20:00", label: "20:00" }
];

function escapeHtml(val) {
  return String(val == null ? "" : val)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function toMin(hhmm) {
  const [h, m] = String(hhmm || "00:00").split(":").map(Number);
  return h * 60 + (m || 0);
}

function saveLocalBookings(bookings) {
  try {
    localStorage.setItem("campusatlas_bookings", JSON.stringify(bookings || []));
  } catch (e) {}
}

function getLocalBookings() {
  try {
    const raw = localStorage.getItem("campusatlas_bookings");
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];

    const spaces = appData?.state?.spaces || [
      { id: "SP-AUDITORIO", name: "Auditorio" },
      { id: "SP-COSMOS", name: "Cosmos" },
      { id: "SP-SKYLAB", name: "Skylab" },
      { id: "SP-SPUTNIK", name: "Sputnik" },
      { id: "SP-APOLLO", name: "Apollo" },
      { id: "SP-SALA-BLANCA", name: "Sala Blanca" },
      { id: "SP-SALA-AZUL", name: "Sala Azul" },
      { id: "SP-SALA-AMARILLA-VERDE", name: "Sala Amarilla / Verde" },
      { id: "SP-ARTEMIS", name: "Artemis" }
    ];
    const spaceMap = new Map(spaces.map((s) => [s.id, s]));

    const validBookings = [];
    for (const b of parsed) {
      if (!b || !b.id || !b.spaceId || !b.date || !b.startTime || !b.endTime) continue;

      // Validar orden de horas
      const bStart = toMin(b.startTime);
      const bEnd = toMin(b.endTime);
      if (isNaN(bStart) || isNaN(bEnd) || bEnd <= bStart) continue;

      // Validar que no haya cruce con reservas activas ya admitidas
      if (b.status === "ACTIVA") {
        const hasOverlap = validBookings.some((vb) => {
          if (vb.status !== "ACTIVA" || vb.spaceId !== b.spaceId || vb.date !== b.date) return false;
          const vbStart = toMin(vb.startTime);
          const vbEnd = toMin(vb.endTime);
          return bStart < vbEnd && bEnd > vbStart;
        });
        if (hasOverlap) continue;
      }

      validBookings.push(b);
    }
    return validBookings;
  } catch (e) {
    return [];
  }
}

function startClock() {
  const el = document.getElementById("liveClock");
  const tick = () => {
    if (el) el.textContent = new Date().toLocaleTimeString("es-CO", { hour12: false });
  };
  tick();
  setInterval(tick, 1000);
}

function showToast(msg, type = "success") {
  const container = document.getElementById("toastContainer");
  if (!container) return;
  const el = document.createElement("div");
  el.className = `toast ${type}`;
  el.textContent = msg;
  container.appendChild(el);
  setTimeout(() => el.remove(), 4000);
}

function showBanner(msg, type = "success") {
  const banner = document.getElementById("feedbackBanner");
  if (!banner) return;
  banner.className = `feedback-banner ${type}`;
  banner.style.display = "flex";
  banner.innerHTML = `
    <span>${type === "error" ? "🚨" : "✅"} ${escapeHtml(msg)}</span>
    <button type="button" class="btn-top-action" style="padding: 2px 8px; font-size: 0.7rem;" onclick="this.parentElement.style.display='none'">✕</button>
  `;
}

function setLoader(visible, text) {
  const loader = document.getElementById("globalLoader");
  if (!loader) return;
  if (visible) {
    document.getElementById("loaderText").textContent =
      text || "Verificando disponibilidad y condiciones de seguridad...";
    loader.style.display = "flex";
  } else {
    loader.style.display = "none";
  }
}

// CAMBIO DE VISTAS (SIDEBAR)
function switchView(viewId) {
  document.querySelectorAll(".view-panel").forEach((el) => {
    el.classList.toggle("active", el.id === viewId);
  });
  document.querySelectorAll(".sidebar-link").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.view === viewId);
  });

  if (viewId === "view-calendar") {
    renderExpandedCalendar();
  }
  if (viewId === "view-assistant") {
    setTimeout(() => document.getElementById("assistantInput")?.focus(), 100);
  }
}

// CARGA DE ESTADO EN TIEMPO REAL CON RESPALDO LOCAL HIGIENIZADO
async function loadState() {
  try {
    const res = await fetch("/api/state");
    const data = await res.json();
    if (data.ok && data.state) {
      appData = data;
      // Sincroniza reservas de forma segura sin admitir registros con errores
      const local = getLocalBookings();
      if (local && local.length > 0) {
        const idSet = new Set((appData.state.bookings || []).map((b) => b.id));
        local.forEach((b) => {
          if (!idSet.has(b.id)) {
            // Verificar que no choque con reservas ya autorizadas
            const conflict = (appData.state.bookings || []).some((eb) => {
              if (eb.status !== "ACTIVA" || eb.spaceId !== b.spaceId || eb.date !== b.date) return false;
              return toMin(b.startTime) < toMin(eb.endTime) && toMin(b.endTime) > toMin(eb.startTime);
            });
            if (!conflict) {
              appData.state.bookings.push(b);
            }
          }
        });
      }
      // Asegurar que localStorage quede higienizado
      saveLocalBookings(appData.state.bookings);
    }
  } catch (err) {
    console.warn("Servidor sin conexión, usando almacenamiento local:", err);
    const local = getLocalBookings();
    if (local && local.length > 0) {
      appData.state.bookings = local;
    }
  } finally {
    renderAll();
  }
}

function renderAll() {
  renderKpis();
  renderSpacesGrid();
  renderWeeklyScheduleGrid();
  onSpaceChange(false);
  renderDatabaseView();
  renderSecurityView();
}

// KPIS REALES Y CONCISOS
function renderKpis() {
  const spaces = appData.state.spaces || [];
  const bookings = appData.state.bookings || [];
  const incidents = appData.state.incidents || [];

  const freeSpaces = spaces.filter((s) => s.status === "DISPONIBLE").length;
  const activeBookings = bookings.filter((b) => b.status === "ACTIVA");
  const openIncidents = incidents.filter((i) => i.status === "ABIERTA").length;
  const problemSpaces = spaces.filter((s) => s.status !== "DISPONIBLE").length;

  const elFree = document.getElementById("kpiFreeSpaces");
  if (elFree) elFree.textContent = freeSpaces;
  const elTot = document.getElementById("kpiTotalSpaces");
  if (elTot) elTot.textContent = `/ ${spaces.length} salones`;
  const elAct = document.getElementById("kpiActiveBookings");
  if (elAct) elAct.textContent = activeBookings.length;
  const elSec = document.getElementById("kpiSecurityAlerts");
  if (elSec) elSec.textContent = openIncidents + problemSpaces;
  const elBlk = document.getElementById("kpiBlockedRooms");
  if (elBlk) elBlk.textContent = `${problemSpaces} salones afectados`;

  const dbBadge = document.getElementById("dbCountBadge");
  if (dbBadge) dbBadge.textContent = bookings.length;
  const secBadge = document.getElementById("secCountBadge");
  if (secBadge) secBadge.textContent = openIncidents;
}

// MANEJO UNIFICADO DE CLIC EN LAS 3 TARJETAS KPIS SUPERIORES (SIN TOAST AL CAMBIAR DE PANTALLA)
function handleKpiCardClick(type) {
  if (type === "VALIDA") {
    switchView("view-spaces");
    setFilterMode("VALIDA");
  } else if (type === "OCUPADO") {
    switchView("view-spaces");
    setFilterMode("OCUPADO");
  } else if (type === "SECURITY") {
    switchView("view-security");
  }
}

// FILTRADO DE SALONES (TODOS, DISPONIBLES, EN USO)
function setFilterMode(mode) {
  currentFilterMode = mode;
  document.getElementById("btnModeAll")?.classList.toggle("active", mode === "ALL");
  document.getElementById("btnModeValida")?.classList.toggle("active", mode === "VALIDA");
  document.getElementById("btnModeOcupado")?.classList.toggle("active", mode === "OCUPADO");

  renderSpacesGrid();
}

function selectCalendarDate(dateStr) {
  currentSelectedDate = dateStr;
  const dateInput = document.getElementById("bookingDate");
  if (dateInput) dateInput.value = dateStr;

  document.querySelectorAll(".day-tab").forEach((btn) => {
    btn.classList.toggle("active", btn.getAttribute("onclick")?.includes(dateStr));
  });

  renderSpacesGrid();
  renderWeeklyScheduleGrid();
}

function onDateInputChange(dateStr) {
  currentSelectedDate = dateStr;
  selectCalendarDate(dateStr);
}

// CUADRÍCULA DE LOS 9 SALONES (SIN RESTRICCIÓN DE AFORO)
function renderSpacesGrid() {
  const grid = document.getElementById("spacesGrid");
  if (!grid) return;

  const spaces = appData.state.spaces || [];
  const bookingsToday = (appData.state.bookings || []).filter(
    (b) => b.status === "ACTIVA" && b.date === currentSelectedDate
  );
  const selectedSpaceId = document.getElementById("bookingSpaceId")?.value;

  const filtered = spaces.filter((s) => {
    const isBusyToday = bookingsToday.some((b) => b.spaceId === s.id);
    if (currentFilterMode === "VALIDA" && s.status !== "DISPONIBLE") return false;
    if (currentFilterMode === "OCUPADO" && !isBusyToday) return false;
    return true;
  });

  if (filtered.length === 0) {
    if (currentFilterMode === "OCUPADO") {
      grid.innerHTML = `
        <div style="grid-column: 1/-1; background: var(--bg-card-subtle); border: 1px dashed var(--border-subtle); border-radius: 10px; padding: 22px; text-align: center;">
          <span style="font-size: 2rem;">🎉</span>
          <p style="margin: 8px 0 4px; color: #FFFFFF; font-weight: 600; font-size: 0.92rem;">No hay salones ocupados el ${currentSelectedDate}</p>
          <p style="color: var(--text-muted); font-size: 0.76rem; margin-bottom: 12px;">Todos los 9 salones e instalaciones están 100% libres para reservar en esta fecha.</p>
          <button type="button" class="btn-top-action btn-purple-action" onclick="setFilterMode('ALL')">Ver Todos los Salones</button>
        </div>
      `;
    } else if (currentFilterMode === "VALIDA") {
      grid.innerHTML = `
        <div style="grid-column: 1/-1; background: var(--bg-card-subtle); border: 1px dashed var(--border-subtle); border-radius: 10px; padding: 22px; text-align: center;">
          <span style="font-size: 2rem;">⚠️</span>
          <p style="margin: 8px 0 4px; color: #FFFFFF; font-weight: 600; font-size: 0.92rem;">No hay salones disponibles en este momento</p>
          <button type="button" class="btn-top-action" onclick="setFilterMode('ALL')">Ver Todos los Salones</button>
        </div>
      `;
    } else {
      grid.innerHTML = `<div style="grid-column: 1/-1; color: var(--text-muted); font-size: 0.8rem; padding: 14px; text-align: center;">No hay salones para el filtro seleccionado.</div>`;
    }
    return;
  }

  grid.innerHTML = filtered
    .map((s) => {
      const roomBookings = bookingsToday.filter((b) => b.spaceId === s.id);
      const isSelected = s.id === selectedSpaceId;
      const isBusy = roomBookings.length > 0;
      const hasProblem = s.status !== "DISPONIBLE";

      let statusBadge = `<span class="status-pill low">🟢 DISPONIBLE</span>`;
      let barColor = "var(--campus-mint)";
      if (hasProblem) {
        statusBadge = `<span class="status-pill high">🔴 NOVEDAD</span>`;
        barColor = "var(--campus-red)";
      } else if (isBusy) {
        statusBadge = `<span class="status-pill info">🔵 EN USO</span>`;
        barColor = "var(--campus-cyan)";
      }

      return `
        <article
          class="space-card ${isSelected ? "active-selected" : ""}"
          onclick="selectSpaceFromCard('${s.id}')"
        >
          <div class="space-card-top">
            <span class="code-badge">${escapeHtml(s.id)}</span>
            ${statusBadge}
          </div>

          <div>
            <h3 class="space-card-name">${escapeHtml(s.name)}</h3>
            <span class="space-card-zone">${escapeHtml(s.zone)}</span>
          </div>

          <div class="space-card-bar-wrap">
            <div class="space-card-bar-labels">
              <span>${isBusy ? `📅 ${roomBookings.length} reserva(s) hoy` : "✔ Libre para apartar"}</span>
            </div>
            <div class="space-card-bar-track">
              <div class="space-card-bar-fill" style="width: ${isBusy ? 100 : 8}%; background: ${barColor};"></div>
            </div>
          </div>
        </article>
      `;
    })
    .join("");
}

function selectSpaceFromCard(spaceId) {
  const sel = document.getElementById("bookingSpaceId");
  if (sel) {
    sel.value = spaceId;
    onSpaceChange(true);
    renderSpacesGrid();
  }
}

// CALENDARIO SEMANAL INTEGRADO
function renderWeeklyScheduleGrid() {
  const grid = document.getElementById("weeklyScheduleGrid");
  if (!grid) return;

  const spaces = appData.state.spaces || [];
  const spaceMap = {};
  spaces.forEach((s) => (spaceMap[s.id] = s));

  const activeBookings = (appData.state.bookings || []).filter((b) => b.status === "ACTIVA");

  let html = `<div class="grid-corner">HORA</div>`;
  WEEK_DAYS.forEach((d) => {
    const isCur = d.date === currentSelectedDate ? "current-selected-day" : "";
    html += `<div class="grid-day-col-head ${isCur}" onclick="selectCalendarDate('${d.date}')">${d.label}</div>`;
  });

  SCHEDULE_HOURS.forEach((h) => {
    const slotMin = toMin(h.hhmm);
    html += `<div class="grid-hour-label">${h.label}</div>`;

    WEEK_DAYS.forEach((day) => {
      const dayBookings = activeBookings.filter((b) => {
        if (b.date !== day.date) return false;
        const bStart = toMin(b.startTime);
        const bEnd = toMin(b.endTime);
        return slotMin >= bStart && slotMin < bEnd;
      });

      const eventsHtml = dayBookings
        .map((b) => {
          const tag = b.bookingTag || "OCUPADO";
          return `
            <div class="schedule-card-ev tag-${tag}" title="${escapeHtml(b.activityTitle)}">
              <div class="ev-head">
                <span>${escapeHtml(b.spaceName)}</span>
                <small>${escapeHtml(b.startTime)}</small>
              </div>
              <div class="ev-desc">${escapeHtml(b.activityTitle)}</div>
            </div>
          `;
        })
        .join("");

      html += `
        <div
          class="grid-cell-slot"
          title="Clic para agendar el ${day.label} a las ${h.label}"
          onclick="clickScheduleSlot('${day.date}', '${h.hhmm}')"
        >
          ${eventsHtml}
        </div>
      `;
    });
  });

  grid.innerHTML = html;
}

function renderExpandedCalendar() {
  const grid = document.getElementById("calendarViewGrid");
  if (grid) {
    grid.innerHTML = document.getElementById("weeklyScheduleGrid")?.innerHTML || "";
  }
}

function clickScheduleSlot(dateStr, timeStr) {
  switchView("view-spaces");
  selectCalendarDate(dateStr);
  const startInput = document.getElementById("bookingStart");
  const endInput = document.getElementById("bookingEnd");
  if (startInput) startInput.value = timeStr;
  if (endInput) {
    const hour = parseInt(timeStr.split(":")[0], 10);
    endInput.value = `${String(Math.min(22, hour + 2)).padStart(2, "0")}:00`;
  }
  document.getElementById("bookingActivity")?.focus();
}

// ESTADO Y ALERTAS DEL SALÓN SELECCIONADO
function onSpaceChange(notifyProblem = false) {
  const spaces = appData.state.spaces || [];
  const spaceId = document.getElementById("bookingSpaceId")?.value || "SP-AUDITORIO";
  const space = spaces.find((s) => s.id === spaceId) || spaces[0];
  if (!space) return;

  const statusTag = document.getElementById("selectedSpaceStatusTag");
  const hasProblem = space.status !== "DISPONIBLE";

  if (statusTag) {
    if (hasProblem) {
      statusTag.className = "tag-badge danger";
      statusTag.textContent = "Alerta Técnica";
    } else {
      statusTag.className = "tag-badge ok";
      statusTag.textContent = "Salón Operativo";
    }
  }

  // Alerta de problema en instalación
  const secWarnEl = document.getElementById("liveSecurityWarning");
  if (secWarnEl) {
    if (hasProblem) {
      const reason = space.lockReason || "Instalación en mantenimiento preventivo";
      secWarnEl.style.display = "block";
      secWarnEl.innerHTML = `
        <strong>🚨 Alerta en ${escapeHtml(space.name)}:</strong> ${escapeHtml(reason)}.<br/>
        <small>Te sugerimos seleccionar otro salón habilitado.</small>
      `;
      if (notifyProblem) {
        showToast(`⚠️ ${space.name} presenta una novedad técnica`, "error");
      }
    } else {
      secWarnEl.style.display = "none";
    }
  }
}

function setQuickBlock(start, end) {
  const startInput = document.getElementById("bookingStart");
  const endInput = document.getElementById("bookingEnd");
  if (startInput) startInput.value = start;
  if (endInput) endInput.value = end;
}

// PROCESAMIENTO Y ALMACENAMIENTO DE RESERVAS (ESTRICTO Y PERSISTENTE)
async function submitBooking(e) {
  e.preventDefault();
  const btn = document.getElementById("btnSubmitBooking");
  const auditBox = document.getElementById("auditBox");

  const payload = {
    spaceId: document.getElementById("bookingSpaceId").value,
    attendees: 1,
    requesterName: (document.getElementById("bookingRequester").value || "").trim(),
    requesterRole: document.getElementById("bookingRole").value,
    activityTitle: (document.getElementById("bookingActivity").value || "").trim(),
    date: document.getElementById("bookingDate").value,
    startTime: document.getElementById("bookingStart").value,
    endTime: document.getElementById("bookingEnd").value
  };

  const spaces = appData.state.spaces || [];
  const space = spaces.find((s) => s.id === payload.spaceId);

  // 1. Validar existencia del salón
  if (!space) {
    showToast("Por favor selecciona un salón válido.", "error");
    showBanner("El salón seleccionado no existe en el sistema.", "error");
    return;
  }

  // 2. Validar estado de seguridad del salón
  if (space.status !== "DISPONIBLE") {
    const reason = space.lockReason || "Salón no disponible por novedad técnica o seguridad";
    const msg = `El salón '${space.name}' está bloqueado (${reason}).`;
    showToast(msg, "error");
    showBanner(msg, "error");
    if (auditBox) {
      auditBox.style.display = "block";
      auditBox.style.borderColor = "var(--campus-red)";
      auditBox.innerHTML = `
        <strong style="color: #FF4757;">🚫 Salón Bloqueado por Seguridad</strong>
        <p style="margin-top: 4px; color: var(--text-muted);">${escapeHtml(reason)}</p>
      `;
    }
    return;
  }

  // 3. Validar campos requeridos
  if (!payload.requesterName || !payload.activityTitle) {
    showToast("Completa el nombre del responsable y la actividad.", "error");
    return;
  }

  // 4. Validar formato de horario y límites de la franja oficial
  if (!payload.startTime || !payload.endTime) {
    showToast("Por favor define las horas de inicio y fin.", "error");
    return;
  }

  const reqStart = toMin(payload.startTime);
  const reqEnd = toMin(payload.endTime);
  const openMin = toMin("06:00");
  const closeMin = toMin("22:00");

  if (isNaN(reqStart) || isNaN(reqEnd) || reqEnd <= reqStart) {
    const msg = "La hora de fin debe ser posterior a la hora de inicio.";
    showToast(msg, "error");
    showBanner(msg, "error");
    return;
  }

  if (reqStart < openMin || reqEnd > closeMin) {
    const msg = "El horario debe encontrarse dentro de la jornada oficial de Campuslands (06:00 a 22:00).";
    showToast(msg, "error");
    showBanner(msg, "error");
    return;
  }

  const durationMin = reqEnd - reqStart;
  if (durationMin < 15 || durationMin > 240) {
    const msg = `La reserva debe durar entre 15 minutos y 4 horas (la duración solicitada es de ${durationMin} min).`;
    showToast(msg, "error");
    showBanner(msg, "error");
    return;
  }

  // 5. Validar colisión / doble reserva (cero solapamiento en el mismo salón y franja)
  const conflicting = (appData.state.bookings || []).find((b) => {
    if (b.status !== "ACTIVA" || b.spaceId !== payload.spaceId || b.date !== payload.date) return false;
    const bStart = toMin(b.startTime);
    const bEnd = toMin(b.endTime);
    return reqStart < bEnd && reqEnd > bStart;
  });

  if (conflicting) {
    const msg = `Cruce de horario: '${space.name}' ya está reservado el ${payload.date} de ${conflicting.startTime} a ${conflicting.endTime} por ${conflicting.requesterName} ("${conflicting.activityTitle}"). Elige otra hora o salón libre.`;
    showToast(msg, "error");
    showBanner(msg, "error");
    if (auditBox) {
      auditBox.style.display = "block";
      auditBox.style.borderColor = "var(--campus-red)";
      auditBox.innerHTML = `
        <strong style="color: #FF4757;">🚫 Cruce de Horario Detectado</strong>
        <p style="margin-top: 4px; color: var(--text-muted);">${escapeHtml(msg)}</p>
      `;
    }
    return;
  }

  btn.disabled = true;
  setLoader(true, "Verificando disponibilidad y guardando reserva...");

  try {
    const res = await fetch("/api/bookings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    const data = await res.json();

    if (auditBox) {
      auditBox.style.display = "block";
      auditBox.style.borderColor = (res.ok && data.ok) ? "var(--campus-mint)" : "var(--campus-red)";
      auditBox.innerHTML = `
        <strong style="color: ${(res.ok && data.ok) ? "#34D399" : "#FF4757"};">
          ${(res.ok && data.ok) ? "✅ Reserva Confirmada" : "🚫 Solicitud Bloqueada"}
        </strong>
        <p style="margin-top: 4px; color: var(--text-muted);">${escapeHtml(data.message || "Error al procesar reserva")}</p>
      `;
    }

    if (res.ok && data.ok) {
      currentSelectedDate = payload.date;
      showToast(data.message, "success");
      showBanner(data.message, "success");
      document.getElementById("bookingActivity").value = "";

      // Inmediata actualización en memoria y persistencia
      if (data.booking) {
        appData.state.bookings = appData.state.bookings || [];
        appData.state.bookings = appData.state.bookings.filter((b) => b.id !== data.booking.id);
        appData.state.bookings.unshift(data.booking);
        saveLocalBookings(appData.state.bookings);
      }
      renderAll();
    } else {
      // SI EL SERVIDOR RECHAZA (422, 403, ETC.), SE MUESTRA EL ERROR CLARO Y NO SE GUARDA NINGÚN REGISTRO
      showToast(data.message || "No se pudo completar la reserva", "error");
      showBanner(data.message || "Solicitud rechazada por las reglas de Campuslands", "error");
    }
  } catch (err) {
    console.error("Error al registrar reserva:", err);
    showToast("Error de conexión al servidor al registrar la reserva.", "error");
    showBanner("No se pudo conectar con el servidor para registrar la reserva.", "error");
  } finally {
    btn.disabled = false;
    setLoader(false);
  }
}

// BASE DE DATOS EN VIVO
function renderDatabaseView() {
  const spaces = appData.state.spaces || [];
  const bookings = appData.state.bookings || [];

  const barsEl = document.getElementById("spaceAnalyticsBars");
  if (barsEl) {
    barsEl.innerHTML = spaces
      .map((s) => {
        const roomBookings = bookings.filter((b) => b.spaceId === s.id && b.status === "ACTIVA");
        const count = roomBookings.length;
        const isOk = s.status === "DISPONIBLE";
        const pct = count > 0 ? Math.min(100, count * 25) : 0;
        return `
          <div style="display: flex; flex-direction: column; gap: 4px;">
            <div style="display: flex; justify-content: space-between; font-size: 0.74rem;">
              <span><strong>${escapeHtml(s.name)}</strong> (${escapeHtml(s.zone || "Campus")})</span>
              <span>${count} reserva(s) • <strong style="color: ${isOk ? "var(--campus-mint)" : "var(--campus-red)"};">${escapeHtml(s.status)}</strong></span>
            </div>
            <div style="height: 6px; background: rgba(255,255,255,0.08); border-radius: 99px; overflow: hidden;">
              <div style="height: 100%; width: ${Math.max(6, pct)}%; background: ${s.color || "var(--campus-purple)"}; border-radius: 99px;"></div>
            </div>
          </div>
        `;
      })
      .join("");
  }

  const summaryEl = document.getElementById("securityStatsSummary");
  if (summaryEl) {
    const active = bookings.filter((b) => b.status === "ACTIVA").length;
    const blocked = bookings.filter((b) => b.status === "BLOQUEADA_SEGURIDAD").length;
    const cancelled = bookings.filter((b) => b.status === "CANCELADA").length;

    summaryEl.innerHTML = `
      <div class="sec-stat-card"><span class="kpi-label">TOTAL EN BD</span><strong>${bookings.length}</strong></div>
      <div class="sec-stat-card"><span class="kpi-label">ACTIVAS</span><strong style="color: var(--campus-mint);">${active}</strong></div>
      <div class="sec-stat-card"><span class="kpi-label">BLOQUEOS SEGURIDAD</span><strong style="color: var(--campus-red);">${blocked}</strong></div>
      <div class="sec-stat-card"><span class="kpi-label">LIBERADAS</span><strong>${cancelled}</strong></div>
    `;
  }

  const tbody = document.getElementById("dbTableBody");
  if (!tbody) return;

  const q = (document.getElementById("dbSearchInput")?.value || "").trim().toLowerCase();
  const st = document.getElementById("dbStatusFilter")?.value || "ALL";

  const filtered = bookings.filter((b) => {
    if (st !== "ALL" && b.status !== st) return false;
    if (q) {
      const hay = `${b.id} ${b.spaceName} ${b.requesterName} ${b.activityTitle}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });

  if (filtered.length === 0) {
    tbody.innerHTML = `<tr><td colspan="8" style="text-align: center; color: var(--text-dim); padding: 18px;">No hay registros en la base de datos aún. Realiza una reserva para verla aquí en tiempo real.</td></tr>`;
    return;
  }

  tbody.innerHTML = filtered
    .map((b) => {
      const isAct = b.status === "ACTIVA";
      return `
        <tr>
          <td style="font-family: var(--font-mono);">${escapeHtml(b.id)}</td>
          <td><strong>${escapeHtml(b.spaceName)}</strong></td>
          <td>${escapeHtml(b.requesterName)} <small style="color: var(--text-dim);">(${escapeHtml(b.requesterRole || "TRAINER")})</small></td>
          <td>${escapeHtml(b.activityTitle)}</td>
          <td style="font-family: var(--font-mono); font-size: 0.72rem;">${escapeHtml(b.date)}<br/>${escapeHtml(b.startTime)}–${escapeHtml(b.endTime)}</td>
          <td><span class="status-pill ${isAct ? "low" : "high"}">${escapeHtml(b.status)}</span></td>
          <td style="font-size: 0.72rem; color: var(--text-muted); max-width: 200px;">${escapeHtml(b.securityNote || "Verificado")}</td>
          <td>
            <div style="display: flex; gap: 4px;">
              ${isAct ? `<button type="button" class="btn-top-action" style="padding: 2px 6px; font-size: 0.7rem;" onclick="cancelBooking('${b.id}')">Liberar</button>` : ""}
              <button type="button" class="btn-top-action" style="padding: 2px 6px; font-size: 0.7rem; color: #FDA4AF;" onclick="deleteBooking('${b.id}')">✕</button>
            </div>
          </td>
        </tr>
      `;
    })
    .join("");
}

async function cancelBooking(bookingId) {
  try {
    await fetch("/api/bookings/cancel", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ bookingId })
    });
  } catch (e) {}

  const b = (appData.state.bookings || []).find((x) => x.id === bookingId);
  if (b) b.status = "CANCELADA";
  saveLocalBookings(appData.state.bookings);
  showToast(`Reserva ${bookingId} liberada con éxito.`, "success");
  renderAll();
}

async function deleteBooking(bookingId) {
  try {
    await fetch("/api/bookings/delete", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ bookingId })
    });
  } catch (e) {}

  appData.state.bookings = (appData.state.bookings || []).filter((x) => x.id !== bookingId);
  saveLocalBookings(appData.state.bookings);
  showToast(`Registro ${bookingId} eliminado de la base de datos.`, "success");
  renderAll();
}

// VISTA DE SEGURIDAD Y FALLAS
function renderSecurityView() {
  const incidents = appData.state.incidents || [];
  const list = document.getElementById("incidentsList");
  if (!list) return;

  if (incidents.length === 0) {
    list.innerHTML = `
      <div style="padding: 20px; text-align: center; color: var(--campus-mint);">
        <span style="font-size: 1.8rem;">✔</span>
        <p style="margin-top: 6px; font-size: 0.84rem;">Todas las instalaciones operativas sin novedades activas.</p>
      </div>
    `;
    return;
  }

  list.innerHTML = incidents
    .map(
      (inc) => `
      <article class="sec-stat-card" style="margin-bottom: 8px;">
        <div style="display: flex; justify-content: space-between; align-items: center;">
          <strong>${escapeHtml(inc.title)}</strong>
          <span class="status-pill high">${escapeHtml(inc.severity)}</span>
        </div>
        <p style="color: var(--text-muted); font-size: 0.75rem; margin: 4px 0;">${escapeHtml(inc.description)}</p>
        ${
          inc.status === "ABIERTA"
            ? `<button type="button" class="btn-top-action" style="color: var(--campus-mint); margin-top: 6px;" onclick="resolveIncident('${inc.id}')">
                ✅ Resolver y Habilitar Salón
              </button>`
            : `<span style="color: var(--campus-mint); font-size: 0.74rem;">✔ Resuelto</span>`
        }
      </article>
    `
    )
    .join("");
}

async function submitIncident(e) {
  if (e && e.preventDefault) e.preventDefault();
  const targetId = document.getElementById("incidentTargetId")?.value;
  const title = (document.getElementById("incidentTitle")?.value || "").trim();
  const description = (document.getElementById("incidentDesc")?.value || "").trim();

  if (!targetId || !title || !description) {
    showToast("Completa el salón, título y descripción del reporte.", "error");
    return;
  }

  setLoader(true, "Registrando novedad técnica en el salón...");
  try {
    const res = await fetch("/api/incidents", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ targetId, title, description })
    });
    const data = await res.json();
    if (res.ok && data.ok) {
      showToast(data.message || "Novedad técnica registrada con éxito en el salón.", "success");
      document.getElementById("incidentTitle").value = "";
      document.getElementById("incidentDesc").value = "";
      await loadState();
      switchView("view-security");
    } else {
      showToast(data.message || "No se pudo registrar la novedad técnica.", "error");
    }
  } catch (err) {
    console.error("Error al registrar novedad:", err);
    showToast("Error de conexión al registrar la novedad técnica.", "error");
  } finally {
    setLoader(false);
  }
}

async function resolveIncident(incidentId) {
  setLoader(true, "Resolviendo problema y habilitando salón...");
  try {
    const res = await fetch("/api/incidents/resolve", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ incidentId })
    });
    const data = await res.json();
    if (res.ok && data.ok) {
      showToast(data.message || "Problema resuelto y salón habilitado.", "success");
      await loadState();
    } else {
      showToast(data.message || "No se pudo resolver la incidencia.", "error");
    }
  } catch (err) {
    console.error("Error al resolver incidencia:", err);
    showToast("Error de conexión al resolver la incidencia.", "error");
  } finally {
    setLoader(false);
  }
}

// ==========================================================================
// ASISTENTE DE IA DEDICADO (INFALIBLE: GEMINI + LOCAL SMART ENGINE)
// ==========================================================================

function formatAssistantReply(text) {
  if (!text) return "";
  let formatted = escapeHtml(text);
  formatted = formatted.replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>");
  formatted = formatted.replace(/\n/g, "<br/>");
  return formatted;
}

function askQuickPrompt(q) {
  const input = document.getElementById("assistantInput");
  if (input) input.value = q;
  submitAssistantChat(new Event("submit"));
}

// Motor semántico de contingencia en el navegador (garantía de respuesta instantánea)
function localClientAssistantSolver(question) {
  const q = String(question || "").toLowerCase();
  const spaces = appData.state.spaces || [];
  const bookings = (appData.state.bookings || []).filter((b) => b.status === "ACTIVA");

  // Saludo
  if (/^(hola|buen|buenas|hey|saludos|ayuda)/i.test(q)) {
    const free = spaces.filter((s) => s.status === "DISPONIBLE").length;
    return `¡Hola! Soy el Asistente Oficial con IA de Campuslands.\nActualmente hay ${free} salones disponibles para reserva. Pregúntame qué salones están libres a cualquier hora (ej: '¿qué aulas están libres a las 3?'), el estado de un salón en específico o fallas técnicas reportadas.`;
  }

  // Horas
  const cleaned = q.replace(/\b\d+\s*(?:personas?|campers?|pax)\b/g, "");
  const mColon = cleaned.match(/\b(\d{1,2}):(\d{2})\b/);
  const mHour = cleaned.match(/(?:a\s+las\s+|las\s+|\b)(\d{1,2})\s*(?:de\s+la\s+(ma[ñn]ana|tarde|noche)|pm|am)?/);

  let targetMin = null;
  let targetLabel = "";
  if (mColon) {
    let h = parseInt(mColon[1], 10);
    const m = parseInt(mColon[2], 10);
    if ((q.includes("pm") || q.includes("tarde")) && h < 12) h += 12;
    targetMin = h * 60 + m;
    targetLabel = `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
  } else if (mHour) {
    let h = parseInt(mHour[1], 10);
    if ((q.includes("pm") || q.includes("tarde") || [1, 2, 3, 4, 5].includes(h)) && h < 12 && !q.includes("am")) {
      h += 12;
    }
    if (h >= 6 && h <= 22) {
      targetMin = h * 60;
      targetLabel = `${String(h).padStart(2, "0")}:00`;
    }
  }

  if (targetMin !== null) {
    const free = [];
    const busy = [];
    spaces.forEach((s) => {
      if (s.status !== "DISPONIBLE") return;
      const conflict = bookings.find((b) => {
        if (b.spaceId !== s.id || b.date !== currentSelectedDate) return false;
        const st = toMin(b.startTime);
        const en = toMin(b.endTime);
        return targetMin >= st && targetMin < en;
      });
      if (conflict) {
        busy.push(`${s.name} (${conflict.startTime}–${conflict.endTime} por ${conflict.activityTitle})`);
      } else {
        free.push(`${s.name}`);
      }
    });

    let ans = `A las ${targetLabel} del ${currentSelectedDate}:\n`;
    if (free.length > 0) ans += `• Salones disponibles (${free.length}): ${free.join(", ")}.\n`;
    else ans += `• No hay salones libres en esa franja.\n`;
    if (busy.length > 0) ans += `• En uso / Reservados: ${busy.join(", ")}.`;
    return ans.trim();
  }

  // Específico (9 salones oficiales)
  const roomKeys = [
    { key: "auditorio", id: "SP-AUDITORIO" },
    { key: "cosmos", id: "SP-COSMOS" },
    { key: "skylab", id: "SP-SKYLAB" },
    { key: "sputnik", id: "SP-SPUTNIK" },
    { key: "apollo", id: "SP-APOLLO" },
    { key: "apolo", id: "SP-APOLLO" },
    { key: "blanca", id: "SP-SALA-BLANCA" },
    { key: "azul", id: "SP-SALA-AZUL" },
    { key: "amarill", id: "SP-SALA-AMARILLA-VERDE" },
    { key: "verde", id: "SP-SALA-AMARILLA-VERDE" },
    { key: "artemis", id: "SP-ARTEMIS" }
  ];

  for (const item of roomKeys) {
    if (q.includes(item.key)) {
      const sp = spaces.find((s) => s.id === item.id || s.name.toLowerCase().includes(item.key));
      if (sp) {
        if (sp.status !== "DISPONIBLE") return `⚠️ ${sp.name} no está disponible: ${sp.lockReason || sp.status}.`;
        const bks = bookings.filter((b) => b.spaceId === sp.id && b.date === currentSelectedDate);
        if (bks.length > 0) {
          return `${sp.name} está operativo, con reservas hoy: ` + bks.map((b) => `${b.startTime}–${b.endTime} (${b.activityTitle})`).join(", ");
        }
        return `✅ ${sp.name} está 100% disponible hoy en ${sp.zone || "Campus"}.`;
      }
    }
  }

  // Fallas y alertas
  if (/(problema|falla|bloquead|seguridad|alerta|danad|dañad)/i.test(q)) {
    const prob = spaces.filter((s) => s.status !== "DISPONIBLE");
    if (prob.length === 0) return "Todas las instalaciones del campus están 100% operativas y sin alertas técnicas activas.";
    return "Salones con alerta técnica:\n" + prob.map((s) => `• ${s.name}: ${s.lockReason || s.status}`).join("\n");
  }

  const freeSpaces = spaces.filter((s) => s.status === "DISPONIBLE").map((s) => s.name);
  return `Estado de salones en Campuslands:\n• Habilitados (${freeSpaces.length} de ${spaces.length}): ${freeSpaces.join(", ")}.\n• Reservas activas: ${bookings.length}.`;
}

async function submitAssistantChat(e) {
  if (e && e.preventDefault) e.preventDefault();
  const input = document.getElementById("assistantInput");
  const msgs = document.getElementById("assistantViewMessages");
  const btn = document.getElementById("btnSendAssistant");
  const q = (input?.value || "").trim();
  if (!q) return;

  input.value = "";
  msgs.innerHTML += `<div class="chat-bubble user">${escapeHtml(q)}</div>`;

  const loadId = "load-" + Date.now();
  msgs.innerHTML += `<div id="${loadId}" class="chat-bubble bot">⏳ Pensando con IA (Google Gemini + Python Core)...</div>`;
  msgs.scrollTop = msgs.scrollHeight;
  if (btn) btn.disabled = true;

  try {
    const res = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ question: q, date: currentSelectedDate })
    });
    const data = await res.json();
    const el = document.getElementById(loadId);
    if (el) {
      const reply = data.reply || data.message;
      if (reply) {
        el.innerHTML = formatAssistantReply(reply);
      } else {
        el.innerHTML = formatAssistantReply(localClientAssistantSolver(q));
      }
    }
  } catch (err) {
    const el = document.getElementById(loadId);
    if (el) {
      el.innerHTML = formatAssistantReply(localClientAssistantSolver(q));
    }
  } finally {
    if (btn) btn.disabled = false;
    msgs.scrollTop = msgs.scrollHeight;
  }
}

async function exportReportCSV() {
  setLoader(true, "Generando reporte CSV...");
  try {
    const res = await fetch("/api/export/csv");
    if (res.ok) {
      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.style.display = "none";
      a.href = url;
      a.download = `Campuslands_Reporte_${new Date().toISOString().slice(0, 10)}.csv`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      a.remove();
      showToast("Reporte CSV descargado con éxito.", "success");
      return;
    }
  } catch (err) {
    console.warn("Fallo descarga de servidor, generando CSV en cliente:", err);
  } finally {
    setLoader(false);
  }

  // Fallback infalible en el cliente
  try {
    const spaces = appData.state.spaces || [];
    const bookings = appData.state.bookings || [];
    const incidents = appData.state.incidents || [];

    const escapeCsv = (val) => {
      if (val === null || val === undefined) return '""';
      const s = String(val).replace(/"/g, '""');
      return `"${s}"`;
    };

    const rows = [
      ["REPORTE OFICIAL DE ESPACIOS Y RESERVAS - CAMPUSLANDS"],
      [`Generado: ${new Date().toLocaleString("es-CO")}`],
      [],
      ["--- SECCIÓN 1: RESERVAS REGISTRADAS ---"],
      ["ID", "SALON_ID", "SALON_NOMBRE", "RESPONSABLE", "ROL", "ACTIVIDAD", "FECHA", "HORA_INICIO", "HORA_FIN", "ESTADO", "OBSERVACION_SEGURIDAD"]
    ];

    bookings.forEach((b) => {
      rows.push([
        b.id,
        b.spaceId,
        b.spaceName,
        b.requesterName,
        b.requesterRole,
        b.activityTitle,
        b.date,
        b.startTime,
        b.endTime,
        b.status,
        b.securityNote || "Verificado"
      ].map(escapeCsv).join(","));
    });

    rows.push([]);
    rows.push(["--- SECCIÓN 2: SALONES E INSTALACIONES (9 OFICIALES) ---"]);
    rows.push(["ID", "NOMBRE", "TIPO", "ZONA", "ESTADO", "NOVEDAD_O_BLOQUEO"]);
    spaces.forEach((s) => {
      rows.push([
        s.id,
        s.name,
        s.type,
        s.zone,
        s.status,
        s.lockReason || "Operativo"
      ].map(escapeCsv).join(","));
    });

    rows.push([]);
    rows.push(["--- SECCIÓN 3: NOVEDADES Y FALLAS TÉCNICAS REPORTADAS ---"]);
    rows.push(["ID", "SALON_AFECTADO", "TITULO", "FECHA_REPORTE", "SEVERIDAD", "ESTADO", "DESCRIPCION", "RECOMENDACION"]);
    incidents.forEach((inc) => {
      rows.push([
        inc.id,
        inc.targetId,
        inc.title,
        inc.createdAt ? inc.createdAt.slice(0, 10) : "-",
        inc.severity,
        inc.status,
        inc.description,
        inc.aiRecommendation || "Revisión técnica"
      ].map(escapeCsv).join(","));
    });

    const csvContent = "\uFEFF" + rows.map((r) => Array.isArray(r) ? r.join(",") : r).join("\r\n");
    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.style.display = "none";
    a.href = url;
    a.download = `Campuslands_Reporte_${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    window.URL.revokeObjectURL(url);
    a.remove();
    showToast("Reporte CSV descargado con éxito.", "success");
  } catch (err2) {
    console.error("Error generando CSV:", err2);
    showToast("No se pudo exportar el CSV.", "error");
  }
}

document.addEventListener("DOMContentLoaded", () => {
  startClock();
  loadState();
});
