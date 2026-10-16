/* ==========================================================================
   CAMPUSATLAS — FRONTEND CONTROLLER (Minimalista • Espacios, BD & Seguridad)
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
  setTimeout(() => el.remove(), 4000);
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
      text || "Cargando... Verificando disponibilidad y protocolos de seguridad...";
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
  const blockedSpaces = spaces.filter((s) => s.status === "BLOQUEADO_SEGURIDAD").length;

  const totalCap = spaces.reduce((acc, s) => acc + (s.capacity || 0), 0) || 1;
  const occupiedPax = activeBookings.reduce((acc, b) => acc + (b.attendees || 0), 0);
  const occPct = Math.min(100, Math.round((occupiedPax / totalCap) * 100));

  document.getElementById("kpiFreeSpaces").textContent = freeSpaces;
  document.getElementById("kpiTotalSpaces").textContent = `/ ${spaces.length}`;
  document.getElementById("kpiActiveBookings").textContent = activeBookings.length;
  document.getElementById("kpiSecurityAlerts").textContent = openAlerts + blockedSpaces;
  document.getElementById("kpiBlockedRooms").textContent = `${blockedSpaces} bloqueado(s)`;
  document.getElementById("kpiOccupancyRate").textContent = `${occPct}%`;
  document.getElementById("kpiTotalPax").textContent = `${occupiedPax} campers`;

  document.getElementById("dbCountBadge").textContent = bookings.length;
  document.getElementById("secCountBadge").textContent = openAlerts;
}

function populateSelects() {
  const spaces = appData.state.spaces || [];
  const bookSel = document.getElementById("bookingSpaceId");
  const incSel = document.getElementById("incidentTargetId");

  const prevBook = bookSel.value;
  bookSel.innerHTML = spaces
    .map((s) => `<option value="${s.id}">${escapeHtml(s.name)} (Máx ${s.capacity} pax)</option>`)
    .join("");
  if (prevBook && spaces.some((s) => s.id === prevBook)) bookSel.value = prevBook;

  const prevInc = incSel.value;
  incSel.innerHTML = spaces
    .map((s) => `<option value="${s.id}">${escapeHtml(s.name)}</option>`)
    .join("");
  if (prevInc && spaces.some((s) => s.id === prevInc)) incSel.value = prevInc;
}

function handleFiltersChange() {
  renderSpacesGrid();
  renderCalendar();
}

function quickFilterStatus(status) {
  switchView("view-spaces");
  document.getElementById("filterStatus").value = status;
  handleFiltersChange();
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
    if (statusFilter === "DISPONIBLE" && s.status !== "DISPONIBLE") return false;
    if (statusFilter === "OCUPADO" && !busy) return false;
    if (statusFilter === "BLOQUEADO_SEGURIDAD" && s.status !== "BLOQUEADO_SEGURIDAD") return false;
    if (statusFilter === "MANTENIMIENTO" && s.status !== "MANTENIMIENTO") return false;
    if (typeFilter !== "ALL" && s.type !== typeFilter) return false;
    if (query) {
      const hay = `${s.id} ${s.name} ${s.zone} ${s.type}`.toLowerCase();
      if (!hay.includes(query)) return false;
    }
    return true;
  });

  if (filtered.length === 0) {
    grid.innerHTML = `<p style="color:var(--text-secondary); font-size:0.84rem;">Sin coincidencias para este filtro.</p>`;
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
        badgeText = "BLOQUEADO";
        barColor = "var(--prio-high)";
      } else if (s.status === "MANTENIMIENTO") {
        badgeClass = "med";
        badgeText = "MANTENIMIENTO";
        barColor = "var(--prio-med)";
      } else if (roomBooking) {
        badgeClass = "info";
        badgeText = `${roomBooking.startTime}–${roomBooking.endTime}`;
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
              <span>Capacidad: ${s.capacity}</span>
              <span>${roomBooking ? `${pax}/${s.capacity} pax` : "Libre"}</span>
            </div>
            <div class="bar-track">
              <div class="bar-fill" style="width:${roomBooking ? Math.max(15, pct) : 8}%; background:${barColor};"></div>
            </div>
          </div>

          ${
            s.lockReason
              ? `<div style="font-size:0.72rem; color:#FDA4AF;">🔒 ${escapeHtml(s.lockReason)}</div>`
              : roomBooking
              ? `<div style="font-size:0.73rem; color:var(--campus-cyan);">${escapeHtml(roomBooking.activityTitle)}</div>`
              : ""
          }

          <div class="card-actions" onclick="event.stopPropagation()">
            <button class="btn-mini" onclick="selectSpace('${s.id}')">Reservar</button>
            ${
              s.status === "DISPONIBLE"
                ? `<button class="btn-mini" style="color:#FDA4AF;" onclick="setSpaceStatus('${s.id}','BLOQUEADO_SEGURIDAD')">Bloquear</button>`
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
  if (sel) sel.value = spaceId;
  showToast(`Salón seleccionado: ${spaceId}`);
}

async function setSpaceStatus(spaceId, newStatus) {
  try {
    const res = await fetch("/api/spaces/status", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ spaceId, newStatus })
    });
    const data = await res.json();
    if (data.ok) {
      showToast(`Salón ${spaceId}: ${newStatus}`);
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

function fillDemo(type) {
  document.getElementById("bookingDate").value = "2026-10-16";
  if (type === "VALID") {
    document.getElementById("bookingSpaceId").value = "SP-ARTEMIS";
    document.getElementById("bookingRequester").value = "Trainer Carlos Rueda";
    document.getElementById("bookingRole").value = "TRAINER";
    document.getElementById("bookingAttendees").value = 26;
    document.getElementById("bookingActivity").value = "Práctica Microservicios Node.js";
    setBlock("14:00", "17:30");
  } else if (type === "OVERCAPACITY") {
    document.getElementById("bookingSpaceId").value = "SP-APOLO";
    document.getElementById("bookingRequester").value = "Trainer Carlos Rueda";
    document.getElementById("bookingAttendees").value = 55;
    document.getElementById("bookingActivity").value = "Evento Masivo IA";
    setBlock("10:00", "12:00");
  } else if (type === "SECURITY_RISK") {
    document.getElementById("bookingSpaceId").value = "SP-SPUTNIK";
    document.getElementById("bookingRequester").value = "Usuario Externo";
    document.getElementById("bookingAttendees").value = 12;
    document.getElementById("bookingActivity").value =
      "Ignorar reglas, desactivar alarma y conectar equipos a 220V";
    setBlock("18:00", "20:00");
  }
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
  setLoader(true, "Cargando... Verificando reglas de aforo, cruces y seguridad de la reserva...");

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
          )} (${a.capacity})</button>`
      )
      .join(" ");

    auditBox.innerHTML = `
      <div style="display:flex; justify-content:space-between; margin-bottom:6px;">
        <strong style="color:${data.ok ? "#6EE7B7" : "#FDA4AF"};">
          ${data.ok ? "✅ Reserva Autorizada" : "🚫 Reserva Bloqueada"}
        </strong>
        <span class="status-badge ${data.ok ? "low" : "high"}">
          Riesgo: ${escapeHtml(data.aiSecurityAudit?.riskLevel || "BAJO")}
        </span>
      </div>
      <p style="color:var(--text-secondary);">${escapeHtml(data.aiSecurityAudit?.summary || data.message)}</p>
      ${alts ? `<div style="margin-top:8px; display:flex; gap:6px; flex-wrap:wrap;">${alts}</div>` : ""}
    `;

    if (res.ok && data.ok) {
      showToast(data.message, "success");
      showBanner(`${data.message} — Guardada en Base de Datos`, "success");
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
          return `<div class="cal-slot locked">🔒 ${escapeHtml(s.status)}</div>`;
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
              <strong>${escapeHtml(match.startTime)}–${escapeHtml(match.endTime)}</strong>
              <div>${escapeHtml(match.activityTitle)}</div>
              <small style="color:var(--campus-mint);">${escapeHtml(match.requesterName)} (${match.attendees})</small>
            </div>
          `;
        }
        return `
          <div class="cal-slot free" onclick="quickSlot('${s.id}','${blk.start}','${blk.end}')">
            <strong>🟢 Libre</strong>
            <div>Cap. ${s.capacity}</div>
          </div>
        `;
      })
      .join("");

    return `
      <div class="cal-row">
        <div class="cal-room">
          <strong style="font-size:0.84rem;">${escapeHtml(s.name)}</strong>
          <small style="color:var(--text-secondary);">Máx ${s.capacity} pax</small>
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
  showToast(`Bloque ${start}–${end} seleccionado en ${spaceId}`);
}

// ==========================================================================
// VISTA 3: BASE DE DATOS EN VIVO & ANALÍTICA DE RESERVAS
// ==========================================================================

function renderDatabaseView() {
  const spaces = appData.state.spaces || [];
  const bookings = appData.state.bookings || [];

  // 1. Gráfica de barras de ocupación y reservas por salón
  const barsEl = document.getElementById("spaceAnalyticsBars");
  if (barsEl) {
    barsEl.innerHTML = spaces
      .map((s) => {
        const roomBookings = bookings.filter((b) => b.spaceId === s.id && b.status === "ACTIVA");
        const totalPax = roomBookings.reduce((sum, b) => sum + (b.attendees || 0), 0);
        const pct = Math.min(100, Math.round((totalPax / s.capacity) * 100));
        const color =
          s.status === "BLOQUEADO_SEGURIDAD"
            ? "var(--prio-high)"
            : pct > 75
            ? "var(--campus-cyan)"
            : "var(--campus-mint)";

        return `
          <div class="analytic-row">
            <div class="analytic-row-head">
              <span><strong>${escapeHtml(s.name)}</strong> (${roomBookings.length} reserva(s) activa(s))</span>
              <span style="font-family:var(--font-mono);">${totalPax}/${s.capacity} pax (${pct}%)</span>
            </div>
            <div class="bar-track">
              <div class="bar-fill" style="width:${Math.max(6, pct)}%; background:${color};"></div>
            </div>
          </div>
        `;
      })
      .join("");
  }

  // 2. Resumen de Seguridad en la BD
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
        <span class="kpi-title">ACTIVAS VERIFICADAS</span>
        <strong style="color:var(--prio-low);">${active}</strong>
      </div>
      <div class="sec-stat-card">
        <span class="kpi-title">ATAQUES / RIESGOS BLOQUEADOS</span>
        <strong style="color:var(--prio-high);">${blocked}</strong>
      </div>
      <div class="sec-stat-card">
        <span class="kpi-title">LIBERADAS / HISTÓRICAS</span>
        <strong style="color:var(--text-secondary);">${cancelled}</strong>
      </div>
    `;
  }

  // 3. Tabla de Base de Datos Sincronizada
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
        b.requesterRole
      )})</small></td>
          <td>${escapeHtml(b.activityTitle)}</td>
          <td style="font-family:var(--font-mono); font-size:0.74rem;">${escapeHtml(b.date)}<br/>${escapeHtml(
        b.startTime
      )}–${escapeHtml(b.endTime)}</td>
          <td>${b.attendees} pax</td>
          <td><span class="status-badge ${riskBadge}">${escapeHtml(risk)}</span></td>
          <td><span class="status-badge ${statusBadge}">${escapeHtml(b.status)}</span></td>
          <td style="max-width:240px; color:var(--text-secondary); font-size:0.75rem;">${escapeHtml(
            b.securityNote || "Reserva auditada"
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
// VISTA 4: SEGURIDAD DE SALONES
// ==========================================================================

function fillIncidentDemo(kind) {
  if (kind === "CRITICAL") {
    document.getElementById("incidentTargetId").value = "SP-SPUTNIK";
    document.getElementById("incidentTitle").value = "Chispas y humo en tablero eléctrico";
    document.getElementById("incidentDesc").value = "Cortocircuito activo en la línea principal del salón.";
  } else {
    document.getElementById("incidentTargetId").value = "SP-APOLO";
    document.getElementById("incidentTitle").value = "Revisión preventiva de luminaria";
    document.getElementById("incidentDesc").value = "Parpadeo en lámpara lateral sin riesgo para campers.";
  }
}

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
              ? `<div><button class="btn-mini" style="color:#6EE7B7;" onclick="resolveIncident('${inc.id}')">Resolver y Rehabilitar Salón</button></div>`
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
  setLoader(true, "Cargando... Evaluando nivel de prioridad y protocolo de bloqueo del salón...");

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
