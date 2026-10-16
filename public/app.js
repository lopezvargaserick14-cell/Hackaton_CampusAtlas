/* ==========================================================================
   PORTAL ESPACIOS CAMPUSLANDS — CONTROLADOR FRONTEND COMPLETO
   Calendario Semanal Siempre Visible • Motor Python • Alertas en Vivo
   ========================================================================== */

let appData = {
  rulesConfig: {},
  state: {
    spaces: [],
    bookings: [],
    incidents: []
  }
};

let selectedDate = "2026-10-16";
let spaceFilterMode = "ALL"; // ALL | VALIDA | OCUPADO
let enabledSpaceIds = new Set();

const WEEK_DAYS = [
  { date: "2026-10-11", label: "DOM 11", dayNum: 11 },
  { date: "2026-10-12", label: "LUN 12", dayNum: 12 },
  { date: "2026-10-13", label: "MAR 13", dayNum: 13 },
  { date: "2026-10-14", label: "MIÉ 14", dayNum: 14 },
  { date: "2026-10-15", label: "JUE 15", dayNum: 15 },
  { date: "2026-10-16", label: "VIE 16", dayNum: 16 },
  { date: "2026-10-17", label: "SÁB 17", dayNum: 17 }
];

const HOURS_LIST = [
  { hhmm: "06:00", label: "6:00 a. m." },
  { hhmm: "07:00", label: "7:00 a. m." },
  { hhmm: "08:00", label: "8:00 a. m." },
  { hhmm: "09:00", label: "9:00 a. m." },
  { hhmm: "10:00", label: "10:00 a. m." },
  { hhmm: "11:00", label: "11:00 a. m." },
  { hhmm: "12:00", label: "12:00 p. m." },
  { hhmm: "13:00", label: "1:00 p. m." },
  { hhmm: "14:00", label: "2:00 p. m." },
  { hhmm: "15:00", label: "3:00 p. m." },
  { hhmm: "16:00", label: "4:00 p. m." },
  { hhmm: "17:00", label: "5:00 p. m." },
  { hhmm: "18:00", label: "6:00 p. m." },
  { hhmm: "19:00", label: "7:00 p. m." },
  { hhmm: "20:00", label: "8:00 p. m." },
  { hhmm: "21:00", label: "9:00 p. m." }
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

function showToast(msg, type = "success") {
  const container = document.getElementById("toastContainer");
  if (!container) return;
  const el = document.createElement("div");
  el.className = `toast ${type}`;
  el.textContent = msg;
  container.appendChild(el);
  setTimeout(() => el.remove(), 3800);
}

function showBanner(msg, type = "success") {
  const banner = document.getElementById("feedbackBanner");
  if (!banner) return;
  banner.className = `feedback-banner ${type}`;
  banner.style.display = "flex";
  banner.innerHTML = `
    <span>${type === "error" ? "🚨" : "✅"} ${escapeHtml(msg)}</span>
    <button type="button" class="btn-inline" onclick="this.parentElement.style.display='none'">Cerrar ✕</button>
  `;
}

function setLoader(visible, text) {
  const loader = document.getElementById("globalLoader");
  if (!loader) return;
  if (visible) {
    document.getElementById("loaderText").textContent =
      text || "Procesando en el motor de seguridad Python...";
    loader.style.display = "flex";
  } else {
    loader.style.display = "none";
  }
}

function switchView(viewId) {
  document.querySelectorAll(".portal-main, .portal-secondary-view").forEach((el) => {
    el.classList.toggle("active", el.id === viewId);
  });
  document.querySelectorAll(".nav-tab").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.view === viewId);
  });
}

async function loadState() {
  try {
    const res = await fetch("/api/state");
    const data = await res.json();
    if (data.ok) {
      appData = data;
      if (enabledSpaceIds.size === 0) {
        (appData.state.spaces || []).forEach((s) => enabledSpaceIds.add(s.id));
      }
      renderAll();
    }
  } catch (err) {
    showToast("Error conectando con el servidor", "error");
  }
}

function renderAll() {
  updateTopBadges();
  populateFormSelects();
  renderMiniCalendar();
  renderRoomCheckboxes();
  renderSpacesStrip();
  renderWeeklyScheduleGrid();
  onSpaceOrAttendeesChange(false);
  renderDatabaseView();
  renderSecurityView();
}

function updateTopBadges() {
  const bookings = appData.state.bookings || [];
  const openIncidents = (appData.state.incidents || []).filter((i) => i.status === "ABIERTA").length;
  document.getElementById("dbCountBadge").textContent = bookings.length;
  document.getElementById("secCountBadge").textContent = openIncidents;
}

function populateFormSelects() {
  const spaces = appData.state.spaces || [];
  const bookSel = document.getElementById("bookingSpaceId");
  const incSel = document.getElementById("incidentTargetId");

  const prevBook = bookSel.value;
  bookSel.innerHTML = spaces
    .map((s) => {
      const st =
        s.status === "DISPONIBLE"
          ? `Capacidad: ${s.capacity} personas`
          : `Capacidad: ${s.capacity} — ⚠️ Problema en instalación`;
      return `<option value="${s.id}">${escapeHtml(s.name)} (${st})</option>`;
    })
    .join("");
  if (prevBook && spaces.some((s) => s.id === prevBook)) {
    bookSel.value = prevBook;
  }

  const prevInc = incSel.value;
  incSel.innerHTML = spaces
    .map((s) => `<option value="${s.id}">${escapeHtml(s.name)} (${escapeHtml(s.zone)})</option>`)
    .join("");
  if (prevInc && spaces.some((s) => s.id === prevInc)) {
    incSel.value = prevInc;
  }
}

// ==========================================================================
// MINI CALENDARIO MENSUAL Y CHECKBOXES PLEGABLES
// ==========================================================================

function renderMiniCalendar() {
  const container = document.getElementById("miniCalendarDays");
  if (!container) return;

  // Octubre 2026 empieza en Jueves (día 1 = Jueves, así que DOM 27..MIÉ 30 son de sept)
  const prevDays = [27, 28, 29, 30];
  let html = prevDays.map((d) => `<button type="button" class="mini-day muted" disabled>${d}</button>`).join("");

  for (let d = 1; d <= 31; d++) {
    const dateStr = `2026-10-${String(d).padStart(2, "0")}`;
    const isInWeek = d >= 11 && d <= 17;
    const isSelected = dateStr === selectedDate;
    const cls = ["mini-day", isInWeek ? "in-week" : "", isSelected ? "selected" : ""]
      .filter(Boolean)
      .join(" ");
    html += `<button type="button" class="${cls}" onclick="selectDate('${dateStr}')">${d}</button>`;
  }

  container.innerHTML = html;
}

function selectDate(dateStr) {
  if (!dateStr) return;
  selectedDate = dateStr;
  const dateInput = document.getElementById("bookingDate");
  if (dateInput && dateInput.value !== dateStr) {
    dateInput.value = dateStr;
  }
  renderMiniCalendar();
  renderSpacesStrip();
  renderWeeklyScheduleGrid();
}

function stepSelectedDate(deltaDays) {
  const current = new Date(selectedDate + "T12:00:00");
  current.setDate(current.getDate() + deltaDays);
  const yyyy = current.getFullYear();
  const mm = String(current.getMonth() + 1).padStart(2, "0");
  const dd = String(current.getDate()).padStart(2, "0");
  selectDate(`${yyyy}-${mm}-${dd}`);
}

function setFilterMode(mode) {
  spaceFilterMode = mode;
  document.querySelectorAll('input[name="spaceStateFilter"]').forEach((r) => {
    r.checked = r.value === mode;
  });
  renderSpacesStrip();
  renderWeeklyScheduleGrid();
}

function renderRoomCheckboxes() {
  const container = document.getElementById("roomCheckboxesList");
  if (!container) return;

  const spaces = appData.state.spaces || [];
  container.innerHTML = spaces
    .map((s) => {
      const checked = enabledSpaceIds.has(s.id) ? "checked" : "";
      const warn = s.status !== "DISPONIBLE" ? " ⚠️" : "";
      return `
        <label class="room-check-item">
          <input type="checkbox" ${checked} onchange="toggleRoomCheckbox('${s.id}', this.checked)" />
          <span class="room-color-dot" style="background:${s.color || "#38BDF8"};"></span>
          <span>${escapeHtml(s.name)} <small style="color:var(--text-muted);">(${s.capacity})${warn}</small></span>
        </label>
      `;
    })
    .join("");
}

function toggleRoomCheckbox(spaceId, isChecked) {
  if (isChecked) {
    enabledSpaceIds.add(spaceId);
  } else {
    enabledSpaceIds.delete(spaceId);
  }
  renderSpacesStrip();
  renderWeeklyScheduleGrid();
}

// ==========================================================================
// TIRA DE SALONES Y CALENDARIO SEMANAL SIEMPRE VISIBLE
// ==========================================================================

function renderSpacesStrip() {
  const strip = document.getElementById("spacesStrip");
  if (!strip) return;

  const spaces = appData.state.spaces || [];
  const activeBookingsToday = (appData.state.bookings || []).filter(
    (b) => b.status === "ACTIVA" && b.date === selectedDate
  );
  const currentSelectedSpaceId = document.getElementById("bookingSpaceId")?.value;

  const visibleSpaces = spaces.filter((s) => {
    if (!enabledSpaceIds.has(s.id)) return false;
    const isBusyToday = activeBookingsToday.some((b) => b.spaceId === s.id);
    if (spaceFilterMode === "VALIDA" && s.status !== "DISPONIBLE") return false;
    if (spaceFilterMode === "OCUPADO" && !isBusyToday) return false;
    return true;
  });

  if (visibleSpaces.length === 0) {
    strip.innerHTML = `<div style="color:var(--text-muted); font-size:0.78rem; padding:4px;">No hay salones activos con el filtro seleccionado.</div>`;
    return;
  }

  strip.innerHTML = visibleSpaces
    .map((s) => {
      const roomBookings = activeBookingsToday.filter((b) => b.spaceId === s.id);
      const hasProblem = s.status !== "DISPONIBLE";
      const isSelected = s.id === currentSelectedSpaceId;

      let statusLabel = "🟢 Disponible";
      if (hasProblem) {
        statusLabel = "🔴 Problema Instalación";
      } else if (roomBookings.length > 0) {
        statusLabel = `🔵 ${roomBookings[0].bookingTag || "Ocupado"} (${roomBookings[0].startTime})`;
      }

      return `
        <article
          class="strip-room-card ${hasProblem ? "problem" : ""} ${isSelected ? "active-selected" : ""}"
          style="border-left-color:${hasProblem ? "var(--accent-red)" : s.color || "var(--accent-green)"};"
          onclick="selectSpaceInForm('${s.id}')"
        >
          <div class="strip-room-top">
            <span>${escapeHtml(s.name)}</span>
            <span style="font-family:var(--font-mono); font-size:0.7rem; color:var(--accent-cyan);">Cap: ${s.capacity}</span>
          </div>
          <div class="strip-room-sub">
            <span>${statusLabel}</span>
          </div>
        </article>
      `;
    })
    .join("");
}

function renderWeeklyScheduleGrid() {
  const grid = document.getElementById("weeklyScheduleGrid");
  if (!grid) return;

  const spaces = appData.state.spaces || [];
  const spaceMap = {};
  spaces.forEach((s) => (spaceMap[s.id] = s));

  const activeBookings = (appData.state.bookings || []).filter((b) => {
    if (b.status !== "ACTIVA") return false;
    if (!enabledSpaceIds.has(b.spaceId)) return false;
    const sp = spaceMap[b.spaceId];
    if (spaceFilterMode === "VALIDA" && sp && sp.status !== "DISPONIBLE") return false;
    return true;
  });

  // 1. Fila de encabezados (Esquina + 7 días de la semana)
  let html = `<div class="grid-head-corner">HORA</div>`;
  WEEK_DAYS.forEach((d) => {
    const isAct = d.date === selectedDate ? "active-day" : "";
    html += `<div class="grid-day-header ${isAct}" onclick="selectDate('${d.date}')">${d.label}</div>`;
  });

  // 2. Filas horarias (06:00 a 21:00)
  HOURS_LIST.forEach((hr) => {
    const hrMin = toMin(hr.hhmm);
    html += `<div class="grid-time-label">${hr.label}</div>`;

    WEEK_DAYS.forEach((day) => {
      const cellBookings = activeBookings.filter((b) => {
        if (b.date !== day.date) return false;
        const bStart = toMin(b.startTime);
        const bEnd = toMin(b.endTime);
        return hrMin >= bStart && hrMin < bEnd;
      });

      const eventsHtml = cellBookings
        .map((b) => {
          const tag = b.bookingTag || "OCUPADO";
          const room = spaceMap[b.spaceId];
          const cap = room ? room.capacity : 35;
          return `
            <div class="cal-event-block tag-${tag}" onclick="event.stopPropagation(); inspectBooking('${b.id}')">
              <div class="ev-room">
                <span>${escapeHtml(b.spaceName)} ✅</span>
                <small>${escapeHtml(tag)}</small>
              </div>
              <div class="ev-title">${escapeHtml(b.activityTitle)}</div>
              <div class="ev-meta">${escapeHtml(b.startTime)}–${escapeHtml(b.endTime)} • ${b.attendees}/${cap} pax</div>
            </div>
          `;
        })
        .join("");

      html += `
        <div
          class="grid-slot-cell"
          title="Clic para apartar el ${day.label} a las ${hr.label}"
          onclick="selectCalendarCell('${day.date}', '${hr.hhmm}')"
        >
          ${eventsHtml}
        </div>
      `;
    });
  });

  grid.innerHTML = html;
}

function selectCalendarCell(dateStr, startTime) {
  selectDate(dateStr);
  const startSel = document.getElementById("bookingStart");
  if (startSel) {
    startSel.value = startTime;
    syncEndHour();
  }
  document.getElementById("bookingActivity")?.focus();
  showToast(`Horario seleccionado: ${dateStr} a las ${startTime}`);
}

function syncEndHour() {
  const startVal = document.getElementById("bookingStart")?.value || "14:00";
  const endSel = document.getElementById("bookingEnd");
  if (!endSel) return;
  const startHour = parseInt(startVal.split(":")[0], 10);
  const nextHour = Math.min(22, startHour + 2);
  endSel.value = `${String(nextHour).padStart(2, "0")}:00`;
}

function inspectBooking(bookingId) {
  const b = (appData.state.bookings || []).find((x) => x.id === bookingId);
  if (!b) return;
  showBanner(
    `${b.spaceName} (${b.bookingTag || "RESERVADO"}): "${b.activityTitle}" — Responsable: ${b.requesterName} (${b.attendees} personas, ${b.date} ${b.startTime}–${b.endTime})`,
    "success"
  );
}

// ==========================================================================
// CAPACIDAD DINÁMICA POR SALÓN + AVISOS AUTOMÁTICOS EN VIVO
// ==========================================================================

function selectSpaceInForm(spaceId) {
  const sel = document.getElementById("bookingSpaceId");
  if (sel) {
    sel.value = spaceId;
    onSpaceOrAttendeesChange(true);
    renderSpacesStrip();
  }
}

function onSpaceOrAttendeesChange(notifyOnProblem = false) {
  const spaces = appData.state.spaces || [];
  const incidents = appData.state.incidents || [];
  const spaceId = document.getElementById("bookingSpaceId")?.value;
  const attendees = Number(document.getElementById("bookingAttendees")?.value || 0);
  const activityText = (document.getElementById("bookingActivity")?.value || "").toLowerCase();

  const space = spaces.find((s) => s.id === spaceId) || spaces[0];
  if (!space) return;

  const maxRatio = appData.rulesConfig?.MAX_CAPACITY_OVERFLOW_RATIO || 1.0;
  const maxAllowed = Math.floor(space.capacity * maxRatio);

  // 1. Cambiar capacidad mostrada según el salón seleccionado
  const capTag = document.getElementById("selectedSpaceCapTag");
  const maxLabel = document.getElementById("attendeesMaxLabel");
  if (capTag) capTag.textContent = `Capacidad: ${maxAllowed} personas`;
  if (maxLabel) maxLabel.textContent = `(Máx: ${maxAllowed})`;

  // 2. Actualizar recuadro dinámico del salón
  const dynBox = document.getElementById("spaceDynamicCard");
  if (dynBox) {
    const pct = Math.min(100, Math.round((attendees / maxAllowed) * 100));
    const isOver = attendees > maxAllowed;
    const hasProblem = space.status !== "DISPONIBLE";
    const color = hasProblem ? "var(--accent-red)" : isOver ? "var(--accent-yellow)" : "var(--accent-green)";

    dynBox.innerHTML = `
      <div style="display:flex; justify-content:space-between; align-items:center;">
        <strong>📍 ${escapeHtml(space.name)} (${escapeHtml(space.zone)})</strong>
        <span class="badge-pill ${hasProblem ? "high" : isOver ? "med" : "low"}">
          ${hasProblem ? "⚠️ PROBLEMA INSTALACIÓN" : isOver ? "🚫 EXCESO PERSONAL" : "✅ DISPONIBLE"}
        </span>
      </div>
      <div style="display:flex; justify-content:space-between; font-size:0.72rem; color:var(--text-muted);">
        <span>Personas ingresadas: <strong>${attendees}</strong></span>
        <span>Capacidad del salón: <strong>${maxAllowed} personas</strong></span>
      </div>
      <div class="bar-track">
        <div class="bar-fill" style="width:${Math.max(8, pct)}%; background:${color};"></div>
      </div>
    `;
  }

  // 3. AVISO AUTOMÁTICO 1: Problema en la instalación o riesgo de seguridad al seleccionar el lugar
  const secWarnEl = document.getElementById("liveSecurityWarning");
  const openRoomIncidents = incidents.filter(
    (i) => i.targetId === space.id && i.status === "ABIERTA"
  );
  const riskyInput = /ignorar|desactivar|alarma|220v|sobrecarga|minero|cortocircuito|hack|<script/i.test(
    activityText
  );

  if (secWarnEl) {
    if (space.status !== "DISPONIBLE" || openRoomIncidents.length > 0) {
      const reason =
        openRoomIncidents.length > 0
          ? `${openRoomIncidents[0].title} — ${openRoomIncidents[0].description}`
          : space.lockReason || "Instalación con novedad técnica.";

      secWarnEl.style.display = "block";
      secWarnEl.innerHTML = `
        <strong>🚨 Aviso de Problema en Instalación (${escapeHtml(space.name)}):</strong><br/>
        Este salón reporta un fallo activo: <em>${escapeHtml(reason)}</em>.<br/>
        <small>Selecciona otro salón disponible o habilítalo desde la pestaña Problemas de Instalación.</small>
      `;
      if (notifyOnProblem) {
        showToast(`⚠️ ${space.name} tiene un problema en la instalación`, "error");
      }
    } else if (riskyInput) {
      secWarnEl.style.display = "block";
      secWarnEl.innerHTML = `
        <strong>🚨 Riesgo de Seguridad Detectado:</strong><br/>
        La actividad descrita representa un riesgo para la instalación o intenta evadir las reglas.
      `;
    } else {
      secWarnEl.style.display = "none";
    }
  }

  // 4. AVISO AUTOMÁTICO 2: Si las personas ingresadas superan la capacidad del salón
  const capWarnEl = document.getElementById("liveCapacityWarning");
  if (capWarnEl) {
    if (attendees > maxAllowed) {
      const excess = attendees - maxAllowed;
      const alternatives = spaces.filter(
        (s) => s.status === "DISPONIBLE" && Math.floor(s.capacity * maxRatio) >= attendees
      );

      const altBtns =
        alternatives.length > 0
          ? `<div style="margin-top:6px; display:flex; gap:6px; flex-wrap:wrap;">
              ${alternatives
                .map(
                  (a) =>
                    `<button type="button" class="btn-inline" onclick="selectSpaceInForm('${a.id}')">
                      Cambiar a ${escapeHtml(a.name)} (Cap: ${a.capacity})
                    </button>`
                )
                .join("")}
            </div>`
          : `<div style="margin-top:4px;">Reduce el grupo a máximo <strong>${maxAllowed} personas</strong>.</div>`;

      capWarnEl.style.display = "block";
      capWarnEl.innerHTML = `
        <strong>⚠️ Exceso de Personal en ${escapeHtml(space.name)}:</strong><br/>
        Ingresaste <strong>${attendees} personas</strong> y la capacidad máxima de este salón es de <strong>${maxAllowed} personas</strong> (exceso de ${excess}).
        ${altBtns}
      `;
    } else {
      capWarnEl.style.display = "none";
    }
  }

  renderSpacesStrip();
}

async function submitBooking(e) {
  e.preventDefault();
  const btn = document.getElementById("btnSubmitBooking");
  const auditBox = document.getElementById("auditBox");

  const payload = {
    spaceId: document.getElementById("bookingSpaceId").value,
    attendees: Number(document.getElementById("bookingAttendees").value),
    bookingTag: document.getElementById("bookingTag").value,
    requesterName: document.getElementById("bookingRequester").value,
    requesterRole: document.getElementById("bookingRole").value,
    activityTitle: document.getElementById("bookingActivity").value,
    date: document.getElementById("bookingDate").value,
    startTime: document.getElementById("bookingStart").value,
    endTime: document.getElementById("bookingEnd").value
  };

  btn.disabled = true;
  setLoader(true, "Verificando aforo, horario y seguridad en motor Python...");

  try {
    const res = await fetch("/api/bookings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    const data = await res.json();

    auditBox.style.display = "block";
    auditBox.style.borderColor = data.ok ? "var(--accent-green)" : "var(--accent-red)";
    auditBox.innerHTML = `
      <strong style="color:${data.ok ? "#34D399" : "#FB7185"};">
        ${data.ok ? "✅ Reserva Registrada en Calendario" : "🚫 Reserva Rechazada"}
      </strong>
      <p style="margin-top:4px; color:var(--text-muted);">${escapeHtml(data.message)}</p>
    `;

    if (res.ok && data.ok) {
      selectedDate = payload.date;
      showToast(data.message, "success");
      showBanner(data.message, "success");
      document.getElementById("bookingActivity").value = "";
    } else {
      showToast(data.message, "error");
      showBanner(data.message, "error");
    }
    await loadState();
  } catch (err) {
    showToast("Error al guardar la reserva", "error");
  } finally {
    btn.disabled = false;
    setLoader(false);
  }
}

// ==========================================================================
// VISTA 2: BASE DE DATOS Y ANALÍTICA
// ==========================================================================

function renderDatabaseView() {
  const spaces = appData.state.spaces || [];
  const bookings = appData.state.bookings || [];

  const barsEl = document.getElementById("spaceAnalyticsBars");
  if (barsEl) {
    barsEl.innerHTML = spaces
      .map((s) => {
        const roomBookings = bookings.filter((b) => b.spaceId === s.id && b.status === "ACTIVA");
        const maxPax = roomBookings.reduce((m, b) => Math.max(m, b.attendees || 0), 0);
        const pct = Math.min(100, Math.round((maxPax / s.capacity) * 100));
        return `
          <div style="display:flex; flex-direction:column; gap:4px;">
            <div style="display:flex; justify-content:space-between; font-size:0.78rem;">
              <span><strong>${escapeHtml(s.name)}</strong> (Capacidad: ${s.capacity})</span>
              <span>${roomBookings.length} reserva(s) • Pico: ${maxPax}/${s.capacity} pax</span>
            </div>
            <div class="bar-track">
              <div class="bar-fill" style="width:${Math.max(6, pct)}%; background:${s.color || "var(--accent-cyan)"};"></div>
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
      <div class="stat-tile"><span>TOTAL REGISTROS BD</span><strong>${bookings.length}</strong></div>
      <div class="stat-tile"><span>ACTIVAS EN CALENDARIO</span><strong style="color:var(--accent-green);">${active}</strong></div>
      <div class="stat-tile"><span>BLOQUEOS DE SEGURIDAD</span><strong style="color:var(--accent-red);">${blocked}</strong></div>
      <div class="stat-tile"><span>LIBERADAS</span><strong>${cancelled}</strong></div>
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
      const badgeCls =
        b.status === "ACTIVA" ? "low" : b.status === "BLOQUEADA_SEGURIDAD" ? "high" : "med";
      return `
        <tr>
          <td style="font-family:var(--font-mono);">${escapeHtml(b.id)}</td>
          <td><strong>${escapeHtml(b.spaceName)}</strong></td>
          <td><span class="badge-pill ${badgeCls}">${escapeHtml(b.bookingTag || b.status)}</span></td>
          <td>${escapeHtml(b.requesterName)} <small style="color:var(--text-muted);">(${escapeHtml(
        b.requesterRole
      )})</small></td>
          <td>${escapeHtml(b.activityTitle)}</td>
          <td style="font-family:var(--font-mono);">${escapeHtml(b.date)} ${escapeHtml(b.startTime)}–${escapeHtml(
        b.endTime
      )}</td>
          <td>${b.attendees} personas</td>
          <td style="color:var(--text-muted);">${escapeHtml(b.securityNote || "Verificado")}</td>
          <td>
            <div style="display:flex; gap:6px;">
              ${
                b.status === "ACTIVA"
                  ? `<button type="button" class="btn-inline" onclick="cancelBooking('${b.id}')">Liberar</button>`
                  : ""
              }
              <button type="button" class="btn-inline" style="color:#FB7185;" onclick="deleteBooking('${b.id}')">✕</button>
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

// ==========================================================================
// VISTA 3: PROBLEMAS DE INSTALACIÓN Y SEGURIDAD EN SALONES
// ==========================================================================

function renderSecurityView() {
  const container = document.getElementById("incidentsList");
  if (!container) return;

  const incidents = appData.state.incidents || [];
  container.innerHTML = incidents
    .map((inc) => {
      const cls = inc.severity === "CRITICA" ? "high" : inc.severity === "MEDIA" ? "med" : "low";
      return `
        <article class="card-panel" style="padding:12px;">
          <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:6px;">
            <strong>${escapeHtml(inc.targetId)} — ${escapeHtml(inc.title)}</strong>
            <span class="badge-pill ${cls}">${escapeHtml(inc.severity)} (${escapeHtml(inc.status)})</span>
          </div>
          <p style="color:var(--text-muted); font-size:0.78rem; margin-bottom:8px;">${escapeHtml(inc.description)}</p>
          ${
            inc.status === "ABIERTA"
              ? `<button type="button" class="btn-inline" style="color:#34D399;" onclick="resolveIncident('${inc.id}')">
                  ✅ Solucionar Problema y Habilitar Salón
                </button>`
              : `<span style="color:#34D399; font-size:0.74rem;">✔ Problema solucionado</span>`
          }
        </article>
      `;
    })
    .join("");
}

async function submitIncident(e) {
  e.preventDefault();
  const btn = document.getElementById("btnSubmitIncident");
  const payload = {
    targetId: document.getElementById("incidentTargetId").value,
    title: document.getElementById("incidentTitle").value,
    description: document.getElementById("incidentDesc").value
  };

  btn.disabled = true;
  setLoader(true, "Registrando problema en la instalación del salón...");

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
    btn.disabled = false;
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
// ASISTENTE PYTHON (src/assistant_engine.py) Y EXPORTACIÓN CSV
// ==========================================================================

function exportReportCSV() {
  window.location.href = "/api/export/csv";
}

function toggleChatDrawer() {
  const drawer = document.getElementById("chatDrawer");
  if (!drawer) return;
  drawer.classList.toggle("open");
  if (drawer.classList.contains("open")) {
    document.getElementById("chatInput")?.focus();
  }
}

function askAssistant(questionText) {
  const drawer = document.getElementById("chatDrawer");
  if (drawer && !drawer.classList.contains("open")) {
    drawer.classList.add("open");
  }
  const input = document.getElementById("chatInput");
  if (input) input.value = questionText;
  submitAssistantChat(new Event("submit"));
}

async function submitAssistantChat(e) {
  if (e && e.preventDefault) e.preventDefault();
  const input = document.getElementById("chatInput");
  const msgs = document.getElementById("chatMessages");
  const btn = document.getElementById("btnSendChat");
  const q = (input?.value || "").trim();
  if (!q) return;

  input.value = "";
  msgs.innerHTML += `<article class="msg-bubble user">${escapeHtml(q)}</article>`;

  const loadId = "py-msg-" + Date.now();
  msgs.innerHTML += `<article id="${loadId}" class="msg-bubble bot">⏳ Consultando motor Python (<code>assistant_engine.py</code>)...</article>`;
  msgs.scrollTop = msgs.scrollHeight;
  if (btn) btn.disabled = true;

  try {
    const res = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ question: q, date: selectedDate })
    });
    const data = await res.json();
    const bubble = document.getElementById(loadId);
    if (bubble) {
      bubble.textContent = data.reply || data.message || "Consulta completada.";
    }
  } catch (err) {
    const bubble = document.getElementById(loadId);
    if (bubble) bubble.textContent = "Error al consultar el motor Python.";
  } finally {
    if (btn) btn.disabled = false;
    msgs.scrollTop = msgs.scrollHeight;
  }
}

document.addEventListener("DOMContentLoaded", () => {
  loadState();
});
