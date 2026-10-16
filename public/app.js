/* ==========================================================================
   PORTAL ESPACIOS CAMPUSLANDS — CONTROLADOR FRONTEND ROBUSTO Y SEGURO
   Calendario Semanal Integrado • Selector Confiable • Motor Python y Local
   ========================================================================== */

let appData = {
  rulesConfig: {},
  state: {
    spaces: [
      { id: "SP-APOLO", name: "Nave Apolo", capacity: 35, status: "DISPONIBLE", zone: "Nivel 1 • Norte", color: "#EAB308" },
      { id: "SP-ARTEMIS", name: "Nave Artemis", capacity: 30, status: "DISPONIBLE", zone: "Nivel 1 • Centro", color: "#38BDF8" },
      { id: "SP-SPUTNIK", name: "Nave Sputnik", capacity: 40, status: "DISPONIBLE", zone: "Nivel 1 • Sur", color: "#10B981" },
      { id: "SP-SER-01", name: "Sala del Ser & Inglés", capacity: 20, status: "DISPONIBLE", zone: "Nivel 2 • Este", color: "#F43F5E" },
      { id: "SP-HUNTERS-01", name: "Cabina Review #1", capacity: 6, status: "DISPONIBLE", zone: "Nivel 2 • Evaluaciones", color: "#A855F7" },
      { id: "SP-CORVUS", name: "Auditorio Corvus", capacity: 80, status: "BLOQUEADO_SEGURIDAD", zone: "Planta Central", color: "#EF4444", lockReason: "Falla eléctrica en rack principal" },
      { id: "SP-HOUSTON", name: "Sala Comando Houston", capacity: 14, status: "MANTENIMIENTO", zone: "Nivel 2 • Dirección", color: "#F59E0B", lockReason: "Reparación de ducto de aire y nodo de red" }
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
  { hhmm: "06:00", label: "6:00 a. m." },
  { hhmm: "08:00", label: "8:00 a. m." },
  { hhmm: "10:00", label: "10:00 a. m." },
  { hhmm: "12:00", label: "12:00 p. m." },
  { hhmm: "14:00", label: "2:00 p. m." },
  { hhmm: "16:00", label: "4:00 p. m." },
  { hhmm: "18:00", label: "6:00 p. m." },
  { hhmm: "20:00", label: "8:00 p. m." }
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
  banner.className = `feedback-bar ${type}`;
  banner.style.display = "flex";
  banner.innerHTML = `
    <span>${type === "error" ? "🚨" : "✅"} ${escapeHtml(msg)}</span>
    <button type="button" class="btn-mini" onclick="this.parentElement.style.display='none'">✕</button>
  `;
}

function setLoader(visible, text) {
  const loader = document.getElementById("globalLoader");
  if (!loader) return;
  if (visible) {
    document.getElementById("loaderText").textContent =
      text || "Cargando... Verificando disponibilidad y condiciones de seguridad...";
    loader.style.display = "flex";
  } else {
    loader.style.display = "none";
  }
}

function switchView(viewId) {
  document.querySelectorAll(".view-pane").forEach((el) => {
    el.classList.toggle("active", el.id === viewId);
  });
  document.querySelectorAll(".nav-pill").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.view === viewId);
  });
}

async function loadState() {
  try {
    const res = await fetch("/api/state");
    const data = await res.json();
    if (data.ok) {
      appData = data;
    }
  } catch (err) {
    console.warn("Usando datos locales sincronizados:", err);
  } finally {
    renderAll();
  }
}

function renderAll() {
  renderKpis();
  renderSpacesGrid();
  renderWeeklyScheduleGrid();
  onSpaceOrAttendeesChange(false);
  renderDatabaseView();
  renderSecurityView();
}

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
  if (elBlk) elBlk.textContent = `${problemSpaces} con novedad`;

  const dbBadge = document.getElementById("dbCountBadge");
  if (dbBadge) dbBadge.textContent = bookings.length;
  const secBadge = document.getElementById("secCountBadge");
  if (secBadge) secBadge.textContent = openIncidents;
}

// ==========================================================================
// FILTROS (TODOS, VÁLIDA / DISPONIBLES, OCUPADO)
// ==========================================================================

function setFilterMode(mode) {
  currentFilterMode = mode;
  document.getElementById("btnModeAll")?.classList.toggle("active", mode === "ALL");
  document.getElementById("btnModeValida")?.classList.toggle("active", mode === "VALIDA");
  document.getElementById("btnModeOcupado")?.classList.toggle("active", mode === "OCUPADO");

  renderSpacesGrid();
  renderWeeklyScheduleGrid();
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

// ==========================================================================
// CUADRÍCULA DE SALONES
// ==========================================================================

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
    grid.innerHTML = `<div style="grid-column: 1/-1; color: var(--text-secondary); font-size: 0.8rem; padding: 10px;">No hay salones en este estado para la fecha seleccionada.</div>`;
    return;
  }

  grid.innerHTML = filtered
    .map((s) => {
      const roomBookings = bookingsToday.filter((b) => b.spaceId === s.id);
      const isSelected = s.id === selectedSpaceId;
      const isBusy = roomBookings.length > 0;
      const hasProblem = s.status !== "DISPONIBLE";

      let statusBadge = `<span class="status-badge low">🟢 DISPONIBLE</span>`;
      let barColor = "var(--prio-low)";
      if (hasProblem) {
        statusBadge = `<span class="status-badge high">🔴 PROBLEMA</span>`;
        barColor = "var(--prio-high)";
      } else if (isBusy) {
        statusBadge = `<span class="status-badge info">🔵 EN USO</span>`;
        barColor = "var(--campus-cyan)";
      }

      const totalPax = roomBookings.reduce((sum, b) => sum + (b.attendees || 0), 0);
      const pct = Math.min(100, Math.round((totalPax / s.capacity) * 100));

      return `
        <article
          class="space-card status-${s.status} ${isSelected ? "active-selected" : ""}"
          onclick="selectSpaceFromCard('${s.id}')"
        >
          <div class="space-card-top">
            <span class="code-pill">${escapeHtml(s.id)}</span>
            ${statusBadge}
          </div>

          <div>
            <h3 class="space-name">${escapeHtml(s.name)}</h3>
            <span class="space-meta">${escapeHtml(s.zone)}</span>
          </div>

          <div class="bar-wrap">
            <div class="bar-labels">
              <span>Capacidad: <strong>${s.capacity} personas</strong></span>
              <span>${isBusy ? `${totalPax}/${s.capacity} pax` : "Libre"}</span>
            </div>
            <div class="bar-track">
              <div class="bar-fill" style="width: ${isBusy ? Math.max(15, pct) : 8}%; background: ${barColor};"></div>
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
    onSpaceOrAttendeesChange(true);
    renderSpacesGrid();
  }
}

// ==========================================================================
// CALENDARIO SEMANAL INTEGRADO (RECUADRO ANTES VACÍO)
// ==========================================================================

function renderWeeklyScheduleGrid() {
  const grid = document.getElementById("weeklyScheduleGrid");
  if (!grid) return;

  const spaces = appData.state.spaces || [];
  const spaceMap = {};
  spaces.forEach((s) => (spaceMap[s.id] = s));

  const activeBookings = (appData.state.bookings || []).filter((b) => b.status === "ACTIVA");

  // 1. Encabezados de columnas
  let html = `<div class="grid-corner">HORA</div>`;
  WEEK_DAYS.forEach((d) => {
    const isCur = d.date === currentSelectedDate ? "current-selected-day" : "";
    html += `<div class="grid-day-col-head ${isCur}" onclick="selectCalendarDate('${d.date}')">${d.label}</div>`;
  });

  // 2. Filas de horas (06:00 a 20:00)
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
          const room = spaceMap[b.spaceId];
          const tag = b.bookingTag || (room && room.status !== "DISPONIBLE" ? "RESERVADO" : "OCUPADO");
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

function clickScheduleSlot(dateStr, timeStr) {
  selectCalendarDate(dateStr);
  const startInput = document.getElementById("bookingStart");
  const endInput = document.getElementById("bookingEnd");
  if (startInput) startInput.value = timeStr;
  if (endInput) {
    const hour = parseInt(timeStr.split(":")[0], 10);
    endInput.value = `${String(Math.min(22, hour + 2)).padStart(2, "0")}:00`;
  }
  document.getElementById("bookingActivity")?.focus();
  showToast(`Horario seleccionado: ${dateStr} a las ${timeStr}`);
}

// ==========================================================================
// CAPACIDAD DINÁMICA SEGÚN SALÓN Y AVISOS AUTOMÁTICOS
// ==========================================================================

function onSpaceOrAttendeesChange(notifyProblem = false) {
  const spaces = appData.state.spaces || [];
  const spaceId = document.getElementById("bookingSpaceId")?.value || "SP-APOLO";
  const attendeesInput = document.getElementById("bookingAttendees");
  const attendees = Number(attendeesInput?.value || 0);
  const activityText = (document.getElementById("bookingActivity")?.value || "").toLowerCase();

  const space = spaces.find((s) => s.id === spaceId) || spaces[0];
  if (!space) return;

  const maxAllowed = space.capacity || 35;

  // 1. Actualizar indicador de capacidad en el título
  const capTag = document.getElementById("selectedSpaceCapTag");
  const maxLabel = document.getElementById("attendeesMaxLabel");
  if (capTag) capTag.textContent = `Capacidad: ${maxAllowed} personas`;
  if (maxLabel) maxLabel.textContent = `(Máx: ${maxAllowed})`;

  // 2. AVISO AUTOMÁTICO 1: Si el salón tiene problema técnico o riesgo de seguridad
  const secWarnEl = document.getElementById("liveSecurityWarning");
  const hasProblem = space.status !== "DISPONIBLE";
  const isRiskyText = /ignorar|desactivar|alarma|220v|sobrecarga|minero|cortocircuito|hack/i.test(activityText);

  if (secWarnEl) {
    if (hasProblem) {
      const reason = space.lockReason || "Instalación en mantenimiento o falla eléctrica";
      secWarnEl.style.display = "block";
      secWarnEl.innerHTML = `
        <strong>🚨 Problema en Instalación Detectado (${escapeHtml(space.name)}):</strong><br/>
        Este salón reporta una falla técnica: <em>${escapeHtml(reason)}</em>.<br/>
        <small style="opacity: 0.9;">Te sugerimos seleccionar un salón habilitado o resolver la alerta en Seguridad.</small>
      `;
      if (notifyProblem) {
        showToast(`⚠️ ${space.name} presenta un problema en la instalación`, "error");
      }
    } else if (isRiskyText) {
      secWarnEl.style.display = "block";
      secWarnEl.innerHTML = `
        <strong>🚨 Riesgo de Seguridad Detectado:</strong><br/>
        La actividad ingresada contiene condiciones de riesgo eléctrico o evasión de protocolos.
      `;
    } else {
      secWarnEl.style.display = "none";
    }
  }

  // 3. AVISO AUTOMÁTICO 2: Si las personas superan la capacidad del salón
  const capWarnEl = document.getElementById("liveCapacityWarning");
  if (capWarnEl) {
    if (attendees > maxAllowed) {
      const excess = attendees - maxAllowed;
      const alternatives = spaces.filter((s) => s.status === "DISPONIBLE" && s.capacity >= attendees);

      const altBtns =
        alternatives.length > 0
          ? `<div style="margin-top: 6px; display: flex; gap: 6px; flex-wrap: wrap;">
              <span>Salones con capacidad suficiente:</span>
              ${alternatives
                .map(
                  (a) =>
                    `<button type="button" class="btn-mini" onclick="selectSpaceFromCard('${a.id}')">
                      Cambiar a ${escapeHtml(a.name)} (Cap: ${a.capacity})
                    </button>`
                )
                .join("")}
            </div>`
          : `<div style="margin-top: 4px;">Reduce el número de asistentes a máximo ${maxAllowed} personas.</div>`;

      capWarnEl.style.display = "block";
      capWarnEl.innerHTML = `
        <strong>⚠️ Exceso de Personal en ${escapeHtml(space.name)}:</strong><br/>
        Ingresaste <strong>${attendees} personas</strong>, pero la capacidad máxima de este salón es de <strong>${maxAllowed} personas</strong> (te pasas por ${excess}).
        ${altBtns}
      `;
    } else {
      capWarnEl.style.display = "none";
    }
  }
}

function setQuickBlock(start, end) {
  const startInput = document.getElementById("bookingStart");
  const endInput = document.getElementById("bookingEnd");
  if (startInput) startInput.value = start;
  if (endInput) endInput.value = end;
}

// ==========================================================================
// ENVÍO DE RESERVA
// ==========================================================================

async function submitBooking(e) {
  e.preventDefault();
  const btn = document.getElementById("btnSubmitBooking");
  const auditBox = document.getElementById("auditBox");

  const payload = {
    spaceId: document.getElementById("bookingSpaceId").value,
    attendees: Number(document.getElementById("bookingAttendees").value),
    requesterName: document.getElementById("bookingRequester").value,
    requesterRole: document.getElementById("bookingRole").value,
    activityTitle: document.getElementById("bookingActivity").value,
    date: document.getElementById("bookingDate").value,
    startTime: document.getElementById("bookingStart").value,
    endTime: document.getElementById("bookingEnd").value
  };

  btn.disabled = true;
  setLoader(true, "Verificando disponibilidad y políticas de seguridad...");

  try {
    const res = await fetch("/api/bookings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    const data = await res.json();

    if (auditBox) {
      auditBox.style.display = "block";
      auditBox.style.borderColor = data.ok ? "var(--prio-low)" : "var(--prio-high)";
      auditBox.innerHTML = `
        <strong style="color: ${data.ok ? "#6EE7B7" : "#FDA4AF"};">
          ${data.ok ? "✅ Reserva Confirmada" : "🚫 Solicitud Bloqueada"}
        </strong>
        <p style="margin-top: 4px; color: var(--text-secondary);">${escapeHtml(data.message)}</p>
      `;
    }

    if (res.ok && data.ok) {
      currentSelectedDate = payload.date;
      showToast(data.message, "success");
      showBanner(data.message, "success");
      document.getElementById("bookingActivity").value = "";
    } else {
      showToast(data.message || "Error al apartar salón", "error");
      showBanner(data.message || "No se pudo completar la reserva", "error");
    }
    await loadState();
  } catch (err) {
    showToast("Error de conexión al procesar la reserva", "error");
  } finally {
    btn.disabled = false;
    setLoader(false);
  }
}

// ==========================================================================
// BASE DE DATOS Y SEGURIDAD
// ==========================================================================

function renderDatabaseView() {
  const spaces = appData.state.spaces || [];
  const bookings = appData.state.bookings || [];

  const barsEl = document.getElementById("spaceAnalyticsBars");
  if (barsEl) {
    barsEl.innerHTML = spaces
      .map((s) => {
        const roomBookings = bookings.filter((b) => b.spaceId === s.id && b.status === "ACTIVA");
        const totalPax = roomBookings.reduce((sum, b) => sum + (b.attendees || 0), 0);
        const pct = Math.min(100, Math.round((totalPax / s.capacity) * 100));
        return `
          <div style="display: flex; flex-direction: column; gap: 3px;">
            <div style="display: flex; justify-content: space-between; font-size: 0.76rem;">
              <span><strong>${escapeHtml(s.name)}</strong> (Capacidad: ${s.capacity})</span>
              <span>${roomBookings.length} reserva(s) • ${totalPax}/${s.capacity} pax (${pct}%)</span>
            </div>
            <div class="bar-track">
              <div class="bar-fill" style="width: ${Math.max(6, pct)}%; background: ${s.color || "var(--campus-cyan)"};"></div>
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
      <div class="sec-stat-card"><span class="kpi-title">TOTAL EN BD</span><strong>${bookings.length}</strong></div>
      <div class="sec-stat-card"><span class="kpi-title">ACTIVAS</span><strong style="color: var(--prio-low);">${active}</strong></div>
      <div class="sec-stat-card"><span class="kpi-title">BLOQUEOS SEGURIDAD</span><strong style="color: var(--prio-high);">${blocked}</strong></div>
      <div class="sec-stat-card"><span class="kpi-title">LIBERADAS</span><strong>${cancelled}</strong></div>
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

  tbody.innerHTML = filtered
    .map((b) => {
      const isAct = b.status === "ACTIVA";
      return `
        <tr>
          <td style="font-family: var(--font-mono);">${escapeHtml(b.id)}</td>
          <td><strong>${escapeHtml(b.spaceName)}</strong></td>
          <td>${escapeHtml(b.requesterName)} <small style="color: var(--text-secondary);">(${escapeHtml(b.requesterRole || "TRAINER")})</small></td>
          <td>${escapeHtml(b.activityTitle)}</td>
          <td style="font-family: var(--font-mono); font-size: 0.72rem;">${escapeHtml(b.date)}<br/>${escapeHtml(b.startTime)}–${escapeHtml(b.endTime)}</td>
          <td>${b.attendees} personas</td>
          <td><span class="status-badge ${b.riskLevel === "CRITICO" ? "high" : "low"}">${escapeHtml(b.riskLevel || "BAJO")}</span></td>
          <td><span class="status-badge ${isAct ? "low" : "high"}">${escapeHtml(b.status)}</span></td>
          <td style="font-size: 0.72rem; color: var(--text-secondary); max-width: 220px;">${escapeHtml(b.securityNote || "Verificado")}</td>
          <td>
            <div style="display: flex; gap: 4px;">
              ${isAct ? `<button type="button" class="btn-mini" onclick="cancelBooking('${b.id}')">Liberar</button>` : ""}
              <button type="button" class="btn-mini" style="color: #FDA4AF;" onclick="deleteBooking('${b.id}')">✕</button>
            </div>
          </td>
        </tr>
      `;
    })
    .join("");
}

async function cancelBooking(bookingId) {
  const res = await fetch("/api/bookings/cancel", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ bookingId })
  });
  const data = await res.json();
  if (data.ok) {
    showToast(data.message);
    await loadState();
  }
}

async function deleteBooking(bookingId) {
  const res = await fetch("/api/bookings/delete", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ bookingId })
  });
  const data = await res.json();
  if (data.ok) {
    showToast(data.message);
    await loadState();
  }
}

function renderSecurityView() {
  const container = document.getElementById("incidentsList");
  if (!container) return;

  const incidents = appData.state.incidents || [];
  container.innerHTML = incidents
    .map((inc) => {
      const cls = inc.severity === "CRITICA" ? "high" : inc.severity === "MEDIA" ? "med" : "low";
      return `
        <article class="sec-stat-card" style="gap: 6px;">
          <div style="display: flex; justify-content: space-between; align-items: center;">
            <strong>${escapeHtml(inc.targetId)} — ${escapeHtml(inc.title)}</strong>
            <span class="status-badge ${cls}">${escapeHtml(inc.severity)} (${escapeHtml(inc.status)})</span>
          </div>
          <p style="color: var(--text-secondary); font-size: 0.76rem;">${escapeHtml(inc.description)}</p>
          ${
            inc.status === "ABIERTA"
              ? `<button type="button" class="btn-mini" style="color: #34D399; width: fit-content;" onclick="resolveIncident('${inc.id}')">
                  ✅ Resolver Falla y Habilitar Salón
                </button>`
              : `<span style="color: #34D399; font-size: 0.74rem;">✔ Problema resuelto</span>`
          }
        </article>
      `;
    })
    .join("");
}

async function submitIncident(e) {
  e.preventDefault();
  const payload = {
    targetId: document.getElementById("incidentTargetId").value,
    title: document.getElementById("incidentTitle").value,
    description: document.getElementById("incidentDesc").value
  };

  setLoader(true, "Registrando alerta de instalación...");
  try {
    const res = await fetch("/api/incidents", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    const data = await res.json();
    if (data.ok) {
      showToast(data.message, "error");
      showBanner(data.message, "error");
      document.getElementById("incidentTitle").value = "";
      document.getElementById("incidentDesc").value = "";
      await loadState();
    }
  } finally {
    setLoader(false);
  }
}

async function resolveIncident(incidentId) {
  const res = await fetch("/api/incidents/resolve", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ incidentId })
  });
  const data = await res.json();
  if (data.ok) {
    showToast(data.message, "success");
    await loadState();
  }
}

// ==========================================================================
// ASISTENTE DE SALONES Y EXPORTACIÓN CSV
// ==========================================================================

function exportReportCSV() {
  window.location.href = "/api/export/csv";
}

function formatChatReply(text) {
  if (!text) return "";
  let formatted = escapeHtml(text);
  // Negrita **texto**
  formatted = formatted.replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>");
  // Saltos de línea
  formatted = formatted.replace(/\n/g, "<br/>");
  return formatted;
}

function toggleChat() {
  const drawer = document.getElementById("chatDrawer");
  const backdrop = document.getElementById("chatBackdrop");
  if (!drawer) return;
  const isOpen = drawer.classList.toggle("open");
  if (backdrop) backdrop.style.display = isOpen ? "block" : "none";
  if (isOpen) {
    setTimeout(() => document.getElementById("chatInput")?.focus(), 120);
  }
}

function askQuick(q) {
  const drawer = document.getElementById("chatDrawer");
  if (drawer && !drawer.classList.contains("open")) {
    toggleChat();
  }
  const input = document.getElementById("chatInput");
  if (input) input.value = q;
  submitChat(new Event("submit"));
}

function submitQuickChat() {
  const quickInput = document.getElementById("quickChatInput");
  const q = (quickInput?.value || "").trim();
  if (!q) return;
  quickInput.value = "";
  const drawer = document.getElementById("chatDrawer");
  if (drawer && !drawer.classList.contains("open")) {
    toggleChat();
  }
  const input = document.getElementById("chatInput");
  if (input) input.value = q;
  submitChat(new Event("submit"));
}

async function submitChat(e) {
  if (e && e.preventDefault) e.preventDefault();
  const input = document.getElementById("chatInput");
  const msgs = document.getElementById("chatMessages");
  const btn = document.getElementById("btnSendChat");
  const q = (input?.value || "").trim();
  if (!q) return;

  input.value = "";
  msgs.innerHTML += `<div class="bubble user">${escapeHtml(q)}</div>`;

  const loadId = "load-" + Date.now();
  msgs.innerHTML += `<div id="${loadId}" class="bubble bot">⏳ Pensando con IA... analizando salones y seguridad...</div>`;
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
      const replyHtml = formatChatReply(data.reply || data.message || "Consulta completada.");
      const badgeHtml =
        data.engine === "PYTHON_GEMINI_AI"
          ? `<small style="display:block;margin-top:6px;opacity:0.75;font-size:0.68rem;color:var(--campus-mint);">⚡ Respuesta generada con IA (Google Gemini + Python Core)</small>`
          : `<small style="display:block;margin-top:6px;opacity:0.75;font-size:0.68rem;color:var(--campus-cyan);">⚡ Motor Analítico en Python</small>`;
      el.innerHTML = `${replyHtml}${badgeHtml}`;
    }
  } catch (err) {
    const el = document.getElementById(loadId);
    if (el) el.textContent = "Error al consultar el asistente. Inténtalo de nuevo.";
  } finally {
    if (btn) btn.disabled = false;
    msgs.scrollTop = msgs.scrollHeight;
  }
}

document.addEventListener("DOMContentLoaded", () => {
  startClock();
  loadState();
});
