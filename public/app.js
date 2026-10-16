/* ==========================================================================
   CAMPUSATLAS — CONTROLADOR FRONTEND ADAPTATIVO
   Capacidad dinámica por salón • Avisos en vivo de Aforo y Problemas de Instalación
   ========================================================================== */

let appData = {
  rulesConfig: {},
  state: {
    spaces: [],
    bookings: [],
    incidents: []
  }
};

function startClock() {
  const el = document.getElementById("liveClock");
  const tick = () => {
    if (el) el.textContent = new Date().toLocaleTimeString("es-CO", { hour12: false });
  };
  tick();
  setInterval(tick, 1000);
}

function escapeHtml(val) {
  return String(val == null ? "" : val)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function showToast(msg, type = "success") {
  const container = document.getElementById("toastContainer");
  if (!container) return;
  const el = document.createElement("div");
  el.className = `toast ${type}`;
  el.textContent = msg;
  container.appendChild(el);
  setTimeout(() => el.remove(), 4200);
}

function showBanner(msg, type = "success") {
  const banner = document.getElementById("feedbackBanner");
  if (!banner) return;
  banner.className = `feedback-bar ${type}`;
  banner.style.display = "flex";
  banner.innerHTML = `
    <span>${type === "error" ? "🚨" : "✅"} ${escapeHtml(msg)}</span>
    <button class="btn-mini" onclick="this.parentElement.style.display='none'">✕</button>
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
      renderAll();
    }
  } catch (err) {
    showToast("Error de conexión con el servidor", "error");
  }
}

function renderAll() {
  renderKpis();
  populateSelects();
  onSpaceOrAttendeesChange();
  renderSpacesGrid();
  renderCalendar();
  renderDatabaseView();
  renderSecurityView();
}

function renderKpis() {
  const spaces = appData.state.spaces || [];
  const bookings = appData.state.bookings || [];
  const incidents = appData.state.incidents || [];

  const freeSpaces = spaces.filter((s) => s.status === "DISPONIBLE").length;
  const activeBookings = bookings.filter((b) => b.status === "ACTIVA");
  const openAlerts = incidents.filter((i) => i.status === "ABIERTA").length;
  const problemSpaces = spaces.filter((s) => s.status !== "DISPONIBLE").length;

  const totalCap = spaces.reduce((acc, s) => acc + (s.capacity || 0), 0) || 1;
  const occupiedPax = activeBookings.reduce((acc, b) => acc + (b.attendees || 0), 0);
  const occPct = Math.min(100, Math.round((occupiedPax / totalCap) * 100));

  document.getElementById("kpiFreeSpaces").textContent = freeSpaces;
  document.getElementById("kpiTotalSpaces").textContent = `/ ${spaces.length}`;
  document.getElementById("kpiActiveBookings").textContent = activeBookings.length;
  document.getElementById("kpiSecurityAlerts").textContent = openAlerts;
  document.getElementById("kpiBlockedRooms").textContent = `${problemSpaces} salón(es) afectado(s)`;
  document.getElementById("kpiOccupancyRate").textContent = `${occPct}%`;
  document.getElementById("kpiTotalPax").textContent = `${occupiedPax} personas`;

  document.getElementById("dbCountBadge").textContent = bookings.length;
  document.getElementById("secCountBadge").textContent = openAlerts;
}

function populateSelects() {
  const spaces = appData.state.spaces || [];
  const bookSel = document.getElementById("bookingSpaceId");
  const incSel = document.getElementById("incidentTargetId");

  const prevBook = bookSel.value;
  bookSel.innerHTML = spaces
    .map((s) => {
      const statusTag =
        s.status === "DISPONIBLE"
          ? `Cap. ${s.capacity} personas — Disponible`
          : `Cap. ${s.capacity} personas — ⚠️ Problema en instalación`;
      return `<option value="${s.id}">${escapeHtml(s.name)} (${statusTag})</option>`;
    })
    .join("");
  if (prevBook && spaces.some((s) => s.id === prevBook)) bookSel.value = prevBook;

  const prevInc = incSel.value;
  incSel.innerHTML = spaces
    .map((s) => `<option value="${s.id}">${escapeHtml(s.name)} (${escapeHtml(s.zone)})</option>`)
    .join("");
  if (prevInc && spaces.some((s) => s.id === prevInc)) incSel.value = prevInc;
}

// ==========================================================================
// CAPACIDAD DINÁMICA POR SALÓN + AVISOS EN VIVO (EXCESO PERSONAL Y SEGURIDAD)
// ==========================================================================

function onSpaceOrAttendeesChange(triggerToastOnProblem = false) {
  const spaces = appData.state.spaces || [];
  const incidents = appData.state.incidents || [];
  const spaceId = document.getElementById("bookingSpaceId")?.value;
  const attendeesInput = document.getElementById("bookingAttendees");
  const activityText = (document.getElementById("bookingActivity")?.value || "").toLowerCase();
  const attendees = Number(attendeesInput?.value || 0);

  const space = spaces.find((s) => s.id === spaceId) || spaces[0];
  if (!space) return;

  const maxRatio = appData.rulesConfig?.MAX_CAPACITY_OVERFLOW_RATIO || 1.0;
  const maxAllowed = Math.floor(space.capacity * maxRatio);

  // 1. Actualizar etiquetas de capacidad dependiendo del salón elegido
  const capTag = document.getElementById("selectedSpaceCapTag");
  const maxLabel = document.getElementById("attendeesMaxLabel");
  if (capTag) capTag.textContent = `${space.name} • Capacidad: ${maxAllowed} personas`;
  if (maxLabel) maxLabel.textContent = `(Máx: ${maxAllowed})`;

  // 2. Actualizar tarjeta dinámica del salón
  const dynCard = document.getElementById("spaceDynamicCard");
  if (dynCard) {
    const pct = Math.min(100, Math.round((attendees / maxAllowed) * 100));
    const isOver = attendees > maxAllowed;
    const hasProblem = space.status !== "DISPONIBLE";
    const barColor = hasProblem
      ? "var(--prio-high)"
      : isOver
      ? "var(--prio-med)"
      : "var(--prio-low)";

    dynCard.innerHTML = `
      <div style="display:flex; justify-content:space-between; align-items:center;">
        <span>📍 <strong>${escapeHtml(space.name)}</strong> (${escapeHtml(space.zone)})</span>
        <span class="status-badge ${hasProblem ? "high" : isOver ? "med" : "low"}">
          ${hasProblem ? "⚠️ CON NOVEDAD" : isOver ? "🚫 EXCESO AFORO" : "✅ CAPACIDAD OK"}
        </span>
      </div>
      <div class="bar-labels">
        <span>Personas ingresadas: <strong>${attendees}</strong></span>
        <span>Capacidad máxima del salón: <strong>${maxAllowed} personas</strong></span>
      </div>
      <div class="bar-track">
        <div class="bar-fill" style="width:${Math.max(6, pct)}%; background:${barColor};"></div>
      </div>
    `;
  }

  // 3. AVISO EN VIVO: Si el lugar tiene algún problema en la instalación o riesgo de seguridad
  const secWarnEl = document.getElementById("liveSecurityWarning");
  const openRoomIncidents = incidents.filter(
    (i) => i.targetId === space.id && i.status === "ABIERTA"
  );
  const riskyActivityPattern = /ignorar|desactivar|alarma|220v|sobrecarga|minero|cortocircuito|hack/i.test(
    activityText
  );

  if (secWarnEl) {
    if (space.status !== "DISPONIBLE" || openRoomIncidents.length > 0) {
      const incDetail =
        openRoomIncidents.length > 0
          ? `${openRoomIncidents[0].title}: ${openRoomIncidents[0].description}`
          : space.lockReason || "Instalación en revisión técnica o mantenimiento.";

      secWarnEl.style.display = "block";
      secWarnEl.innerHTML = `
        <strong>🚨 Aviso de Problema en Instalación (${escapeHtml(space.name)}):</strong><br/>
        Este espacio presenta una alerta activa: <em>${escapeHtml(incDetail)}</em>.<br/>
        <span style="color:#FDA4AF; font-size:0.74rem;">Por seguridad, selecciona un salón habilitado o resuelve la novedad en la pestaña de Seguridad.</span>
      `;
      if (triggerToastOnProblem) {
        showToast(`⚠️ Atención: ${space.name} presenta un problema en la instalación`, "error");
      }
    } else if (riskyActivityPattern) {
      secWarnEl.style.display = "block";
      secWarnEl.innerHTML = `
        <strong>🚨 Alerta de Riesgo de Seguridad Detectado:</strong><br/>
        La actividad ingresada contiene condiciones de riesgo eléctrico o de seguridad para las instalaciones. El escudo bloqueará esta solicitud.
      `;
    } else {
      secWarnEl.style.display = "none";
    }
  }

  // 4. AVISO EN VIVO: Si el usuario ingresa más personas de la capacidad del salón
  const capWarnEl = document.getElementById("liveCapacityWarning");
  if (capWarnEl) {
    if (attendees > maxAllowed) {
      const excess = attendees - maxAllowed;
      const validAlternatives = spaces.filter(
        (s) => s.status === "DISPONIBLE" && Math.floor(s.capacity * maxRatio) >= attendees
      );

      const altButtons =
        validAlternatives.length > 0
          ? `<div style="margin-top:6px; display:flex; gap:6px; flex-wrap:wrap;">
              <span>Salones disponibles con capacidad suficiente:</span>
              ${validAlternatives
                .map(
                  (alt) =>
                    `<button type="button" class="btn-mini" onclick="selectSpace('${alt.id}')">
                      Cambiar a ${escapeHtml(alt.name)} (Cap: ${alt.capacity})
                    </button>`
                )
                .join("")}
            </div>`
          : `<div style="margin-top:4px; font-size:0.74rem;">Reduce la cantidad de asistentes a máximo ${maxAllowed} personas.</div>`;

      capWarnEl.style.display = "block";
      capWarnEl.innerHTML = `
        <strong>⚠️ Aviso de Exceso de Personal:</strong> Has ingresado <strong>${attendees} personas</strong>, pero la capacidad máxima de <strong>${escapeHtml(
        space.name
      )}</strong> es de <strong>${maxAllowed} personas</strong> (te pasas por ${excess}).
        ${altButtons}
      `;
    } else {
      capWarnEl.style.display = "none";
    }
  }
}

// ==========================================================================
// FILTROS DE DOS OPCIONES PRINCIPALES: 'VALIDA' (DISPONIBLES) Y 'OCUPADO'
// ==========================================================================

function setFilterMode(mode) {
  switchView("view-spaces");
  const sel = document.getElementById("filterStatus");
  if (sel) sel.value = mode;

  document.getElementById("btnModeAll")?.classList.toggle("active", mode === "ALL");
  document.getElementById("btnModeValida")?.classList.toggle("active", mode === "VALIDA");
  document.getElementById("btnModeOcupado")?.classList.toggle("active", mode === "OCUPADO");

  handleFiltersChange();
}

function handleFiltersChange() {
  const mode = document.getElementById("filterStatus")?.value || "ALL";
  document.getElementById("btnModeAll")?.classList.toggle("active", mode === "ALL");
  document.getElementById("btnModeValida")?.classList.toggle("active", mode === "VALIDA");
  document.getElementById("btnModeOcupado")?.classList.toggle("active", mode === "OCUPADO");

  renderSpacesGrid();
  renderCalendar();
}

// ==========================================================================
// VISTA 1: ESPACIOS & RESERVAS
// ==========================================================================

function renderSpacesGrid() {
  const grid = document.getElementById("spacesGrid");
  if (!grid) return;

  const query = (document.getElementById("searchInput")?.value || "").trim().toLowerCase();
  const statusFilter = document.getElementById("filterStatus")?.value || "ALL";
  const typeFilter = document.getElementById("filterType")?.value || "ALL";
  const dateFilter = document.getElementById("filterDate")?.value || "2026-10-16";

  const spaces = appData.state.spaces || [];
  const activeBookings = (appData.state.bookings || []).filter(
    (b) => b.status === "ACTIVA" && (!dateFilter || b.date === dateFilter)
  );

  const filtered = spaces.filter((s) => {
    const busy = activeBookings.some((b) => b.spaceId === s.id);
    // Opción 1: 'VALIDA' -> muestra los espacios disponibles/válidos para reservar
    if (statusFilter === "VALIDA" && s.status !== "DISPONIBLE") return false;
    // Opción 2: 'OCUPADO' -> muestra los espacios actualmente ocupados / en uso
    if (statusFilter === "OCUPADO" && !busy) return false;

    if (typeFilter !== "ALL" && s.type !== typeFilter) return false;
    if (query) {
      const hay = `${s.id} ${s.name} ${s.zone} ${s.type}`.toLowerCase();
      if (!hay.includes(query)) return false;
    }
    return true;
  });

  if (filtered.length === 0) {
    grid.innerHTML = `<p style="color:var(--text-secondary); font-size:0.84rem;">No hay salones en este estado para el filtro actual.</p>`;
    return;
  }

  grid.innerHTML = filtered
    .map((s) => {
      const roomBooking = activeBookings.find((b) => b.spaceId === s.id);
      const pax = roomBooking ? roomBooking.attendees : 0;
      const pct = Math.min(100, Math.round((pax / s.capacity) * 100));

      let badgeClass = "low";
      let badgeText = "DISPONIBLE";
      let barColor = "var(--prio-low)";

      if (s.status === "BLOQUEADO_SEGURIDAD") {
        badgeClass = "high";
        badgeText = "RIESGO INSTALACIÓN";
        barColor = "var(--prio-high)";
      } else if (s.status === "MANTENIMIENTO") {
        badgeClass = "med";
        badgeText = "EN REPARACIÓN";
        barColor = "var(--prio-med)";
      } else if (roomBooking) {
        badgeClass = "info";
        badgeText = `EN USO (${roomBooking.startTime}–${roomBooking.endTime})`;
        barColor = "var(--campus-cyan)";
      }

      return `
        <article class="space-card status-${s.status}" onclick="selectSpace('${s.id}')">
          <div class="space-card-top">
            <span class="code-pill">${escapeHtml(s.id)}</span>
            <span class="status-badge ${badgeClass}">${escapeHtml(badgeText)}</span>
          </div>

          <div>
            <h3 class="space-name">${escapeHtml(s.name)}</h3>
            <span class="space-meta">${escapeHtml(s.zone)}</span>
          </div>

          <div class="bar-wrap">
            <div class="bar-labels">
              <span>Capacidad máx: <strong>${s.capacity}</strong></span>
              <span>${roomBooking ? `${pax}/${s.capacity} personas` : "Libre"}</span>
            </div>
            <div class="bar-track">
              <div class="bar-fill" style="width:${roomBooking ? Math.max(15, pct) : 8}%; background:${barColor};"></div>
            </div>
          </div>

          ${
            s.lockReason
              ? `<div style="font-size:0.72rem; color:#FDA4AF;">⚠️ ${escapeHtml(s.lockReason)}</div>`
              : roomBooking
              ? `<div style="font-size:0.73rem; color:var(--campus-cyan);">${escapeHtml(roomBooking.activityTitle)}</div>`
              : ""
          }

          <div class="card-actions" onclick="event.stopPropagation()">
            <button class="btn-mini" onclick="selectSpace('${s.id}')">Seleccionar</button>
            ${
              s.status === "DISPONIBLE"
                ? `<button class="btn-mini" style="color:#FDA4AF;" onclick="setSpaceStatus('${s.id}','BLOQUEADO_SEGURIDAD')">Reportar Fallo</button>`
                : `<button class="btn-mini" style="color:#6EE7B7;" onclick="setSpaceStatus('${s.id}','DISPONIBLE')">Habilitar</button>`
            }
          </div>
        </article>
      `;
    })
    .join("");
}

function selectSpace(spaceId) {
  switchView("view-spaces");
  const sel = document.getElementById("bookingSpaceId");
  if (sel) {
    sel.value = spaceId;
    onSpaceOrAttendeesChange(true);
  }
  const space = (appData.state.spaces || []).find((s) => s.id === spaceId);
  if (space && space.status === "DISPONIBLE") {
    showToast(`${space.name} seleccionado (Capacidad máx: ${space.capacity} personas)`);
  }
}

async function setSpaceStatus(spaceId, newStatus) {
  try {
    const res = await fetch("/api/spaces/status", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        spaceId,
        newStatus,
        lockReason:
          newStatus === "DISPONIBLE"
            ? null
            : "Problema técnico en instalación reportado por personal autorizado"
      })
    });
    const data = await res.json();
    if (data.ok) {
      showToast(`Estado de ${spaceId} actualizado`);
      await loadState();
    }
  } catch (err) {
    showToast("Error al actualizar salón", "error");
  }
}

function setBlock(start, end) {
  document.getElementById("bookingStart").value = start;
  document.getElementById("bookingEnd").value = end;
}

async function submitBooking(e) {
  e.preventDefault();
  const btn = document.getElementById("btnSubmitBooking");
  const auditBox = document.getElementById("auditBox");

  const payload = {
    spaceId: document.getElementById("bookingSpaceId").value,
    requesterName: document.getElementById("bookingRequester").value,
    requesterRole: document.getElementById("bookingRole").value,
    attendees: Number(document.getElementById("bookingAttendees").value),
    date: document.getElementById("bookingDate").value,
    activityTitle: document.getElementById("bookingActivity").value,
    startTime: document.getElementById("bookingStart").value,
    endTime: document.getElementById("bookingEnd").value
  };

  btn.disabled = true;
  setLoader(true, "Cargando... Verificando capacidad del salón, estado de instalación y seguridad...");

  try {
    const res = await fetch("/api/bookings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    const data = await res.json();

    auditBox.style.display = "block";
    auditBox.style.borderColor = data.ok ? "var(--prio-low)" : "var(--prio-high)";
    const alts = (data.alternativeSpaces || [])
      .map(
        (a) =>
          `<button type="button" class="btn-mini" onclick="selectSpace('${a.id}')">Usar ${escapeHtml(
            a.name
          )} (Cap. ${a.capacity})</button>`
      )
      .join(" ");

    auditBox.innerHTML = `
      <div style="display:flex; justify-content:space-between; margin-bottom:6px;">
        <strong style="color:${data.ok ? "#6EE7B7" : "#FDA4AF"};">
          ${data.ok ? "✅ Reserva Confirmada" : "🚫 No se pudo completar la reserva"}
        </strong>
        <span class="status-badge ${data.ok ? "low" : "high"}">
          Riesgo: ${escapeHtml(data.aiSecurityAudit?.riskLevel || "BAJO")}
        </span>
      </div>
      <p style="color:var(--text-secondary);">${escapeHtml(data.message)}</p>
      ${alts ? `<div style="margin-top:8px; display:flex; gap:6px; flex-wrap:wrap;">${alts}</div>` : ""}
    `;

    if (res.ok && data.ok) {
      showToast(data.message, "success");
      showBanner(`${data.message} — Sincronizada en Base de Datos`, "success");
    } else {
      showToast(data.message, "error");
      showBanner(data.message, "error");
    }
    await loadState();
  } catch (err) {
    showToast("Error procesando la solicitud", "error");
  } finally {
    btn.disabled = false;
    setLoader(false);
  }
}

// ==========================================================================
// VISTA 2: CALENDARIO VISUAL
// ==========================================================================

function renderCalendar() {
  const container = document.getElementById("calendarMatrix");
  if (!container) return;

  const spaces = appData.state.spaces || [];
  const dateFilter = document.getElementById("filterDate")?.value || "2026-10-16";
  const activeBookings = (appData.state.bookings || []).filter(
    (b) => b.status === "ACTIVA" && b.date === dateFilter
  );

  const blocks = [
    { name: "M1", start: "06:00", end: "09:30" },
    { name: "M2", start: "10:00", end: "13:30" },
    { name: "T1", start: "14:00", end: "17:30" },
    { name: "T2", start: "18:00", end: "21:30" }
  ];

  const toMin = (t) => {
    const [h, m] = String(t).split(":").map(Number);
    return h * 60 + (m || 0);
  };

  const head = `
    <div class="cal-row">
      <div class="cal-head">SALÓN (${escapeHtml(dateFilter)})</div>
      ${blocks.map((b) => `<div class="cal-head">${b.name} (${b.start}–${b.end})</div>`).join("")}
    </div>
  `;

  const rows = spaces.map((s) => {
    const cells = blocks
      .map((blk) => {
        if (s.status !== "DISPONIBLE") {
          return `<div class="cal-slot locked" onclick="selectSpace('${s.id}')">⚠️ Problema en instalación</div>`;
        }
        const match = activeBookings.find(
          (b) =>
            b.spaceId === s.id &&
            toMin(b.startTime) < toMin(blk.end) &&
            toMin(b.endTime) > toMin(blk.start)
        );
        if (match) {
          return `
            <div class="cal-slot busy">
              <strong>🔵 ${escapeHtml(match.startTime)}–${escapeHtml(match.endTime)}</strong>
              <div>${escapeHtml(match.activityTitle)}</div>
              <small style="color:var(--campus-mint);">${escapeHtml(match.requesterName)} (${match.attendees} pax)</small>
            </div>
          `;
        }
        return `
          <div class="cal-slot free" onclick="quickSlot('${s.id}','${blk.start}','${blk.end}')">
            <strong>🟢 Disponible</strong>
            <div>Cap. ${s.capacity} personas</div>
          </div>
        `;
      })
      .join("");

    return `
      <div class="cal-row">
        <div class="cal-room">
          <strong style="font-size:0.84rem;">${escapeHtml(s.name)}</strong>
          <small style="color:var(--text-secondary);">Capacidad: ${s.capacity}</small>
        </div>
        ${cells}
      </div>
    `;
  });

  container.innerHTML = head + rows.join("");
}

function quickSlot(spaceId, start, end) {
  switchView("view-spaces");
  document.getElementById("bookingSpaceId").value = spaceId;
  setBlock(start, end);
  onSpaceOrAttendeesChange(true);
}

// ==========================================================================
// VISTA 3: BASE DE DATOS EN VIVO & ANALÍTICA DE RESERVAS
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
        const color =
          s.status !== "DISPONIBLE"
            ? "var(--prio-high)"
            : pct > 75
            ? "var(--campus-cyan)"
            : "var(--campus-mint)";

        return `
          <div class="analytic-row">
            <div class="analytic-row-head">
              <span><strong>${escapeHtml(s.name)}</strong> (Capacidad máx: ${s.capacity})</span>
              <span style="font-family:var(--font-mono);">${totalPax}/${s.capacity} personas (${pct}%)</span>
            </div>
            <div class="bar-track">
              <div class="bar-fill" style="width:${Math.max(6, pct)}%; background:${color};"></div>
            </div>
          </div>
        `;
      })
      .join("");
  }

  const secSummaryEl = document.getElementById("securityStatsSummary");
  if (secSummaryEl) {
    const total = bookings.length;
    const active = bookings.filter((b) => b.status === "ACTIVA").length;
    const blocked = bookings.filter((b) => b.status === "BLOQUEADA_SEGURIDAD").length;
    const cancelled = bookings.filter((b) => b.status === "CANCELADA").length;

    secSummaryEl.innerHTML = `
      <div class="sec-stat-card">
        <span class="kpi-title">TOTAL REGISTROS BD</span>
        <strong>${total}</strong>
      </div>
      <div class="sec-stat-card">
        <span class="kpi-title">RESERVAS VÁLIDAS</span>
        <strong style="color:var(--prio-low);">${active}</strong>
      </div>
      <div class="sec-stat-card">
        <span class="kpi-title">BLOQUEOS DE SEGURIDAD</span>
        <strong style="color:var(--prio-high);">${blocked}</strong>
      </div>
      <div class="sec-stat-card">
        <span class="kpi-title">LIBERADAS</span>
        <strong style="color:var(--text-secondary);">${cancelled}</strong>
      </div>
    `;
  }

  const tbody = document.getElementById("dbTableBody");
  if (!tbody) return;

  const q = (document.getElementById("dbSearchInput")?.value || "").trim().toLowerCase();
  const st = document.getElementById("dbStatusFilter")?.value || "ALL";

  const filtered = bookings.filter((b) => {
    if (st !== "ALL" && b.status !== st) return false;
    if (q) {
      const hay = `${b.id} ${b.spaceName} ${b.requesterName} ${b.activityTitle} ${b.status}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });

  tbody.innerHTML = filtered
    .map((b) => {
      const risk = b.riskLevel || "BAJO";
      const riskBadge =
        risk === "CRITICO" || risk === "ALTO" ? "high" : risk === "MEDIO" ? "med" : "low";
      const statusBadge =
        b.status === "ACTIVA" ? "low" : b.status === "BLOQUEADA_SEGURIDAD" ? "high" : "info";

      return `
        <tr>
          <td><span class="code-pill">${escapeHtml(b.id)}</span></td>
          <td><strong>${escapeHtml(b.spaceName)}</strong></td>
          <td>${escapeHtml(b.requesterName)} <small style="color:var(--text-secondary);">(${escapeHtml(
        b.requesterRole || "TRAINER"
      )})</small></td>
          <td>${escapeHtml(b.activityTitle)}</td>
          <td style="font-family:var(--font-mono); font-size:0.74rem;">${escapeHtml(b.date)}<br/>${escapeHtml(
        b.startTime
      )}–${escapeHtml(b.endTime)}</td>
          <td>${b.attendees} personas</td>
          <td><span class="status-badge ${riskBadge}">${escapeHtml(risk)}</span></td>
          <td><span class="status-badge ${statusBadge}">${escapeHtml(b.status)}</span></td>
          <td style="max-width:240px; color:var(--text-secondary); font-size:0.75rem;">${escapeHtml(
            b.securityNote || "Reserva verificada"
          )}</td>
          <td>
            <div style="display:flex; gap:6px;">
              ${
                b.status === "ACTIVA"
                  ? `<button class="btn-mini" onclick="cancelBooking('${b.id}')">Liberar</button>`
                  : ""
              }
              <button class="btn-mini" style="color:#FDA4AF;" onclick="deleteBooking('${b.id}')">✕</button>
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
// VISTA 4: SEGURIDAD DE INSTALACIONES
// ==========================================================================

function renderSecurityView() {
  const container = document.getElementById("incidentsList");
  if (!container) return;

  const incidents = appData.state.incidents || [];
  container.innerHTML = incidents
    .map((inc) => {
      const badge =
        inc.severity === "CRITICA" || inc.severity === "ALTA"
          ? "high"
          : inc.severity === "MEDIA"
          ? "med"
          : "low";

      return `
        <article class="incident-item sev-${inc.severity}">
          <div style="display:flex; justify-content:space-between; align-items:center;">
            <div>
              <span class="code-pill">${escapeHtml(inc.id)} • ${escapeHtml(inc.targetId)}</span>
              <span class="status-badge ${badge}">PRIORIDAD ${escapeHtml(inc.severity)}</span>
            </div>
            <span class="status-badge ${inc.status === "ABIERTA" ? "high" : "low"}">${escapeHtml(inc.status)}</span>
          </div>
          <strong>${escapeHtml(inc.title)}</strong>
          <p style="font-size:0.78rem; color:var(--text-secondary);">${escapeHtml(inc.description)}</p>
          <div style="font-size:0.76rem; color:var(--campus-cyan);">🛡️ ${escapeHtml(inc.aiRecommendation)}</div>
          ${
            inc.status === "ABIERTA"
              ? `<div><button class="btn-mini" style="color:#6EE7B7;" onclick="resolveIncident('${inc.id}')">Marcar Resuelta y Habilitar Salón</button></div>`
              : ""
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
  setLoader(true, "Cargando... Evaluando riesgo en la instalación y aplicando bloqueo preventivo...");

  try {
    const res = await fetch("/api/incidents", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    const data = await res.json();
    if (data.ok) {
      showToast(data.message);
      showBanner(data.message, data.incident?.severity === "CRITICA" ? "error" : "success");
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
    showToast(data.message);
    await loadState();
  }
}

// ==========================================================================
// EXPORTAR CSV, RESET Y ASISTENTE
// ==========================================================================

function exportReportCSV() {
  window.location.href = "/api/export/csv";
}

async function resetDataset() {
  const res = await fetch("/api/reset", { method: "POST" });
  const data = await res.json();
  if (data.ok) {
    showToast(data.message);
    await loadState();
  }
}

function toggleChat() {
  document.getElementById("chatDrawer").classList.toggle("open");
}

function askQuick(q) {
  const drawer = document.getElementById("chatDrawer");
  if (!drawer.classList.contains("open")) drawer.classList.add("open");
  document.getElementById("chatInput").value = q;
  submitChat(new Event("submit"));
}

async function submitChat(e) {
  if (e && e.preventDefault) e.preventDefault();
  const input = document.getElementById("chatInput");
  const msgs = document.getElementById("chatMessages");
  const q = (input.value || "").trim();
  if (!q) return;

  input.value = "";
  msgs.innerHTML += `<div class="bubble user">${escapeHtml(q)}</div>`;
  const tempId = "m-" + Date.now();
  msgs.innerHTML += `<div id="${tempId}" class="bubble bot">⏳ Cargando...</div>`;
  msgs.scrollTop = msgs.scrollHeight;

  try {
    const res = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ question: q })
    });
    const data = await res.json();
    const el = document.getElementById(tempId);
    if (el) el.textContent = data.reply || "Sin respuesta.";
  } catch (err) {
    const el = document.getElementById(tempId);
    if (el) el.textContent = "Error al consultar.";
  }
  msgs.scrollTop = msgs.scrollHeight;
}

document.addEventListener("DOMContentLoaded", () => {
  startClock();
  loadState();
});
