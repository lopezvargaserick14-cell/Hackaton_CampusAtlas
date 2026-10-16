/**
 * ============================================================================
 * CAMPUSLANDS OPS - FRONTEND INTERACTIVO (PLANO 2D + 3 MÓDULOS + GEMINI IA)
 * ============================================================================
 */

const appState = {
  spaces: [],
  bookings: [],
  resources: [],
  incidents: [],
  quarantinedRecords: [],
  rulesConfig: {},
  aiStatus: { configured: false, model: "gemini-2.5-flash" },
  selectedSpaceId: "SP-ARTEMIS"
};

document.addEventListener("DOMContentLoaded", () => {
  initNavigation();
  initShiftButtons();
  initDemoPresets();
  initModalHandlers();
  initBookingForm();
  initLoanForm();
  initIncidentForm();
  fetchSystemState();
});

async function fetchSystemState() {
  try {
    const res = await fetch("/api/state");
    const data = await res.json();
    if (!data.ok) return;

    appState.spaces = data.state.spaces || [];
    appState.bookings = data.state.bookings || [];
    appState.resources = data.state.resources || [];
    appState.incidents = data.state.incidents || [];
    appState.quarantinedRecords = data.quarantinedRecords || [];
    appState.rulesConfig = data.rulesConfig || {};
    appState.aiStatus = data.aiStatus || { configured: false };

    renderHeaderAndSidebar();
    renderSpaceSelectors();
    renderFloorplan2D();
    renderBookingsList();
    renderResourcesModule();
    renderIncidentsModule();
    renderQuarantineModal();
    document.getElementById("rules-config-json").textContent = JSON.stringify(
      appState.rulesConfig,
      null,
      2
    );
  } catch (err) {
    console.error("Error cargando estado:", err);
  }
}

function renderHeaderAndSidebar() {
  const available = appState.spaces.filter((s) => s.status === "DISPONIBLE").length;
  const locked = appState.spaces.filter((s) => s.status !== "DISPONIBLE").length;
  const activeBookings = appState.bookings.filter((b) => b.status === "ACTIVA").length;
  const openIncidents = appState.incidents.filter((i) => i.status === "ABIERTA").length;

  document.getElementById("kpi-available-spaces").textContent = available;
  document.getElementById("kpi-locked-spaces").textContent = locked;
  document.getElementById("kpi-active-bookings").textContent = activeBookings;
  document.getElementById("kpi-quarantined").textContent = appState.quarantinedRecords.length;
  document.getElementById("quarantine-count").textContent = appState.quarantinedRecords.length;

  document.getElementById("badge-spaces-count").textContent = appState.spaces.length;
  document.getElementById("badge-resources-count").textContent = appState.resources.length;
  document.getElementById("badge-incidents-count").textContent = openIncidents;

  const aiText = document.getElementById("ai-status-text");
  aiText.textContent = appState.aiStatus.configured
    ? `Gemini (${appState.aiStatus.model})`
    : "Modo Reglas Locales";
}

function renderSpaceSelectors() {
  const spaceSelect = document.getElementById("spaceId");
  const incSelect = document.getElementById("incidentTargetId");
  const prevSpace = spaceSelect.value || appState.selectedSpaceId;

  spaceSelect.innerHTML = "";
  incSelect.innerHTML = "";

  appState.spaces.forEach((sp) => {
    const icon = sp.status === "DISPONIBLE" ? "🟢" : sp.status === "BLOQUEADO_SEGURIDAD" ? "🔴" : "🟠";
    const opt1 = document.createElement("option");
    opt1.value = sp.id;
    opt1.textContent = `${icon} ${sp.name} (Cap: ${sp.capacity}p)`;
    spaceSelect.appendChild(opt1);

    const opt2 = document.createElement("option");
    opt2.value = sp.id;
    opt2.textContent = `${sp.name} [${sp.status}]`;
    incSelect.appendChild(opt2);
  });

  if (appState.spaces.some((s) => s.id === prevSpace)) {
    spaceSelect.value = prevSpace;
  }
}

/**
 * Renderiza el Plano Arquitectónico 2D Interactivo del Campus
 */
function renderFloorplan2D() {
  const container = document.getElementById("floorplan-grid");
  container.innerHTML = "";

  appState.spaces.forEach((sp) => {
    const activeRoomBookings = appState.bookings.filter(
      (b) => b.spaceId === sp.id && b.status === "ACTIVA"
    );
    const maxBookedAttendees = activeRoomBookings.reduce(
      (max, b) => Math.max(max, Number(b.attendees) || 0),
      0
    );
    const occupancyPct = Math.min(100, Math.round((maxBookedAttendees / sp.capacity) * 100));

    const statusClass =
      sp.status === "BLOQUEADO_SEGURIDAD"
        ? "room-locked"
        : sp.status === "MANTENIMIENTO"
        ? "room-maint"
        : "";
    const selectedClass = sp.id === document.getElementById("spaceId").value ? "selected-room" : "";

    const pillClass =
      sp.status === "DISPONIBLE"
        ? "pill-disp"
        : sp.status === "BLOQUEADO_SEGURIDAD"
        ? "pill-lock"
        : "pill-maint";

    const nextStatus = sp.status === "DISPONIBLE" ? "BLOQUEADO_SEGURIDAD" : "DISPONIBLE";
    const toggleText = sp.status === "DISPONIBLE" ? "🔒 Lockdown" : "🔓 Habilitar";

    const node = document.createElement("div");
    node.className = `room-node ${statusClass} ${selectedClass}`;
    node.setAttribute("data-id", sp.id);

    const slotsText =
      activeRoomBookings.length > 0
        ? `📅 Ocupado: ${activeRoomBookings.map((b) => `${b.startTime}–${b.endTime}`).join(", ")}`
        : sp.status === "DISPONIBLE"
        ? "✓ Libre todos los bloques"
        : `⚠️ ${sp.lockReason || "Inhabilitado"}`;

    node.innerHTML = `
      <div>
        <div class="room-top">
          <div>
            <span class="room-code">${escapeHtml(sp.id)} • ${escapeHtml(sp.type)}</span>
            <h3 class="room-name">${escapeHtml(sp.name)}</h3>
          </div>
          <span class="room-pill ${pillClass}">${escapeHtml(sp.status)}</span>
        </div>

        <div class="capacity-meter">
          <div class="capacity-labels">
            <span>Aforo máx: <strong>${sp.capacity} campers</strong></span>
            <span>Uso pico: ${maxBookedAttendees}/${sp.capacity} (${occupancyPct}%)</span>
          </div>
          <div class="capacity-bar-bg">
            <div class="capacity-bar-fill" style="width:${occupancyPct}%;"></div>
          </div>
        </div>
      </div>

      <div class="room-footer-row">
        <span style="color:var(--text-muted);">${escapeHtml(slotsText.slice(0, 48))}</span>
        <button type="button" class="btn-room-toggle" data-id="${escapeHtml(sp.id)}" data-next="${nextStatus}">
          ${toggleText}
        </button>
      </div>
    `;

    node.addEventListener("click", (e) => {
      if (e.target.closest(".btn-room-toggle")) return;
      appState.selectedSpaceId = sp.id;
      document.getElementById("spaceId").value = sp.id;
      renderFloorplan2D();
    });

    node.querySelector(".btn-room-toggle").addEventListener("click", async (e) => {
      e.stopPropagation();
      await fetch("/api/spaces/status", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ spaceId: sp.id, newStatus: nextStatus })
      });
      await fetchSystemState();
    });

    container.appendChild(node);
  });
}

function renderBookingsList() {
  const container = document.getElementById("bookings-list");
  const active = appState.bookings.filter((b) => b.status === "ACTIVA");
  if (!active.length) {
    container.innerHTML = `<p class="list-sub">No hay bloques asignados actualmente.</p>`;
    return;
  }

  container.innerHTML = active
    .map(
      (b) => `
      <div class="list-item">
        <div>
          <h4>${escapeHtml(b.spaceName)} — <span style="color:var(--campus-teal);">${escapeHtml(b.startTime)} a ${escapeHtml(b.endTime)}</span></h4>
          <p class="list-sub">👤 <strong>${escapeHtml(b.requesterName)}</strong> (${escapeHtml(b.requesterRole)}) • 👥 ${b.attendees} campers • ${escapeHtml(b.activityTitle)}</p>
          <p class="list-sub" style="color:var(--campus-cyan);">🛡️ Gemini IA [${escapeHtml(b.aiSecurityAudit?.verdict || "APROBADO")} - Score ${b.aiSecurityAudit?.score ?? 95}/100]: ${escapeHtml(b.aiSecurityAudit?.summary || "")}</p>
        </div>
        <button type="button" class="btn-room-toggle" onclick="cancelBooking('${escapeHtml(b.id)}')">Liberar Bloque</button>
      </div>
    `
    )
    .join("");
}

window.cancelBooking = async function (bookingId) {
  await fetch("/api/bookings/cancel", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ bookingId })
  });
  await fetchSystemState();
};

function initBookingForm() {
  const form = document.getElementById("booking-form");
  const btn = document.getElementById("btn-submit-booking");

  document.getElementById("spaceId").addEventListener("change", (e) => {
    appState.selectedSpaceId = e.target.value;
    renderFloorplan2D();
  });

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    btn.disabled = true;
    btn.textContent = "Auditando Reglas + Escudo Gemini IA...";

    const payload = {
      spaceId: document.getElementById("spaceId").value,
      requesterName: document.getElementById("requesterName").value,
      requesterRole: document.getElementById("requesterRole").value,
      activityTitle: document.getElementById("activityTitle").value,
      attendees: Number(document.getElementById("attendees").value),
      date: document.getElementById("date").value,
      startTime: document.getElementById("startTime").value,
      endTime: document.getElementById("endTime").value
    };

    try {
      const res = await fetch("/api/bookings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      const result = await res.json();
      renderAuditResult(result);
      await fetchSystemState();
    } finally {
      btn.disabled = false;
      btn.textContent = "Auditar Seguridad y Confirmar Espacio";
    }
  });
}

function renderAuditResult(result) {
  const box = document.getElementById("audit-result-container");
  box.classList.remove("hidden");

  const color = result.ok ? "#34d399" : "#f87171";
  const checksHtml = (result.ruleChecks || [])
    .map(
      (c) => `
      <div class="rule-check-item ${c.passed ? "passed" : "failed"}">
        <strong>${c.passed ? "✓" : "✕"} ${escapeHtml(c.ruleId)}:</strong>
        <span>${escapeHtml(c.detail)}</span>
      </div>
    `
    )
    .join("");

  const ai = result.aiSecurityAudit || {};
  const recId = ai.recommendedSpaceId || result.alternativeSpaces?.[0]?.id;
  const recSpace = appState.spaces.find((s) => s.id === recId);

  const relocateBtn =
    !result.ok && recSpace
      ? `<button type="button" class="btn-relocate" id="btn-apply-reloc" data-id="${escapeHtml(recSpace.id)}">
           ⚡ Reubicar Automáticamente a ${escapeHtml(recSpace.name)} (Cap: ${recSpace.capacity}p)
         </button>`
      : "";

  box.innerHTML = `
    <div style="font-weight:600;color:${color};margin-bottom:8px;">${escapeHtml(result.message)}</div>
    ${checksHtml}
    <div style="margin-top:8px;font-size:0.76rem;color:var(--campus-cyan);">
      🛡️ <strong>Gemini IA (${escapeHtml(ai.verdict || "")} • Score ${ai.score ?? "--"}/100):</strong> ${escapeHtml(ai.summary || "")}
    </div>
    ${relocateBtn}
  `;

  const relocEl = document.getElementById("btn-apply-reloc");
  if (relocEl) {
    relocEl.addEventListener("click", () => {
      const targetId = relocEl.getAttribute("data-id");
      document.getElementById("spaceId").value = targetId;
      appState.selectedSpaceId = targetId;
      document.getElementById("booking-form").requestSubmit();
    });
  }
}

/* MÓDULO 2: PRÉSTAMO Y DEVOLUCIÓN DE EQUIPOS */
function renderResourcesModule() {
  const grid = document.getElementById("resources-preview-grid");
  const select = document.getElementById("loanResourceId");
  select.innerHTML = "";

  appState.resources.forEach((r) => {
    const opt = document.createElement("option");
    opt.value = r.id;
    opt.textContent = `${r.name} [${r.status}]`;
    select.appendChild(opt);
  });

  grid.innerHTML = appState.resources
    .map(
      (r) => `
      <div class="card" style="padding:14px;">
        <div class="room-top">
          <div>
            <span class="room-code">${escapeHtml(r.id)} • ${escapeHtml(r.category)}</span>
            <h3 class="room-name">${escapeHtml(r.name)}</h3>
          </div>
          <span class="room-pill ${r.status === "DISPONIBLE" ? "pill-disp" : "pill-lock"}">${escapeHtml(r.status)}</span>
        </div>
        <p class="list-sub" style="margin-top:8px;">Salón vinculado: <strong>${escapeHtml(r.assignedSpaceId || "Almacén Central")}</strong></p>
        <p class="list-sub">Poseedor actual: <strong>${escapeHtml(r.borrowedBy || "En almacén")}</strong></p>
        ${
          r.status === "PRESTADO"
            ? `<button type="button" class="btn-room-toggle" style="margin-top:10px;width:100%;" onclick="returnResource('${escapeHtml(r.id)}')">Registrar Devolución (Check-in)</button>`
            : ""
        }
      </div>
    `
    )
    .join("");
}

window.returnResource = async function (resourceId) {
  await fetch("/api/resources/return", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ resourceId })
  });
  await fetchSystemState();
};

function initLoanForm() {
  document.getElementById("preset-loan-ok")?.addEventListener("click", () => {
    document.getElementById("loanResourceId").value = "EQ-MAC-01";
    document.getElementById("borrowerName").value = "Camper Sofía Vargas";
  });
  document.getElementById("preset-loan-mora")?.addEventListener("click", () => {
    document.getElementById("loanResourceId").value = "EQ-MAC-01";
    document.getElementById("borrowerName").value = "Camper Andrés Mejía";
  });

  document.getElementById("loan-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const resourceId = document.getElementById("loanResourceId").value;
    const borrowerName = document.getElementById("borrowerName").value;

    const res = await fetch("/api/resources/loan", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ resourceId, borrowerName })
    });
    const data = await res.json();
    const box = document.getElementById("loan-result-box");
    box.classList.remove("hidden");
    box.innerHTML = `<div style="color:${data.ok ? "#34d399" : "#f87171"};font-size:0.8rem;font-weight:600;">${escapeHtml(data.message)}</div>`;
    await fetchSystemState();
  });
}

/* MÓDULO 3: TRIAJE DE INCIDENCIAS CON GEMINI IA */
function renderIncidentsModule() {
  const list = document.getElementById("incidents-preview-list");
  list.innerHTML = appState.incidents
    .map(
      (inc) => `
      <div class="list-item" style="border-left:3px solid ${inc.status === "ABIERTA" ? "#ef4444" : "#10b981"};">
        <div>
          <h4>🚨 [${escapeHtml(inc.id)}] ${escapeHtml(inc.title)} — <span style="color:#fca5a5;">${escapeHtml(inc.severity)}</span> (${escapeHtml(inc.status)})</h4>
          <p class="list-sub">Salón afectado: <strong>${escapeHtml(inc.targetId)}</strong> • Categoría IA: ${escapeHtml(inc.category)}</p>
          <p class="list-sub">${escapeHtml(inc.description)}</p>
          <p class="list-sub" style="color:var(--campus-teal);">🛡️ Protocolo Gemini IA: ${escapeHtml(inc.aiRecommendation)}</p>
        </div>
        ${
          inc.status === "ABIERTA"
            ? `<button type="button" class="btn-room-toggle" onclick="resolveIncident('${escapeHtml(inc.id)}')">Marcar Resuelta y Liberar Salón</button>`
            : ""
        }
      </div>
    `
    )
    .join("");
}

window.resolveIncident = async function (incidentId) {
  await fetch("/api/incidents/resolve", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ incidentId })
  });
  await fetchSystemState();
};

function initIncidentForm() {
  document.getElementById("preset-incident-critical")?.addEventListener("click", () => {
    document.getElementById("incidentTargetId").value = "SP-ARTEMIS";
    document.getElementById("incidentTitle").value = "Filtración de agua sobre regleta eléctrica principal";
    document.getElementById("incidentDesc").value =
      "Está cayendo agua del ducto del aire acondicionado directamente sobre las tomas eléctricas del Salón Artemis con 28 campers en clase.";
  });

  document.getElementById("incident-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const btn = document.getElementById("btn-submit-incident");
    btn.disabled = true;
    btn.textContent = "Clasificando con Gemini IA y aplicando Lockdown...";

    try {
      await fetch("/api/incidents", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          targetId: document.getElementById("incidentTargetId").value,
          title: document.getElementById("incidentTitle").value,
          description: document.getElementById("incidentDesc").value
        })
      });
      document.getElementById("incidentTitle").value = "";
      document.getElementById("incidentDesc").value = "";
      await fetchSystemState();
    } finally {
      btn.disabled = false;
      btn.textContent = "Analizar con Gemini IA y Ejecutar Protocolo";
    }
  });
}

function initShiftButtons() {
  document.querySelectorAll(".shift-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".shift-btn").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      document.getElementById("startTime").value = btn.getAttribute("data-start");
      document.getElementById("endTime").value = btn.getAttribute("data-end");
    });
  });
}

function initDemoPresets() {
  const presets = {
    valid: {
      spaceId: "SP-ARTEMIS",
      requesterName: "Trainer Diego Rojas",
      requesterRole: "TRAINER",
      activityTitle: "Bloque M2: Desarrollo de Microservicios & Review Técnico Cohorte Artemis",
      attendees: 28,
      startTime: "10:00",
      endTime: "14:00"
    },
    locked_incident: {
      spaceId: "SP-SPUTNIK",
      requesterName: "Trainer Camilo Pardo",
      requesterRole: "TRAINER",
      activityTitle: "Bloque M2: Entrenamiento de Modelos LLM Locales — Ruta IA",
      attendees: 25,
      startTime: "10:00",
      endTime: "14:00"
    },
    over_capacity: {
      spaceId: "SP-APOLO",
      requesterName: "Líder Empleabilidad Hunters",
      requesterRole: "STAFF",
      activityTitle: "Masterclass Unificada Preparación de Entrevistas Técnicas",
      attendees: 48,
      startTime: "14:00",
      endTime: "18:00"
    },
    under_capacity: {
      spaceId: "SP-APOLO",
      requesterName: "Camper Mateo Silva",
      requesterRole: "CAMPER",
      activityTitle: "Práctica individual de algoritmos en Salón Apolo",
      attendees: 2,
      startTime: "14:00",
      endTime: "16:00"
    },
    time_overlap: {
      spaceId: "SP-APOLO",
      requesterName: "Trainer Laura Méndez",
      requesterRole: "TRAINER",
      activityTitle: "Sesión Extraordinaria Bases de Datos SQL en Bloque M1",
      attendees: 26,
      startTime: "07:00",
      endTime: "09:30"
    },
    ai_security_threat: {
      spaceId: "SP-ARTEMIS",
      requesterName: "Usuario Externo No Verificado",
      requesterRole: "CAMPER",
      activityTitle: "Pruebas de sobrecarga eléctrica con soldadura industrial y puenteo de tableros sin ventilación",
      attendees: 22,
      startTime: "18:00",
      endTime: "20:00"
    }
  };

  document.querySelectorAll("[data-preset]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const p = presets[btn.getAttribute("data-preset")];
      if (!p) return;
      document.getElementById("spaceId").value = p.spaceId;
      appState.selectedSpaceId = p.spaceId;
      document.getElementById("requesterName").value = p.requesterName;
      document.getElementById("requesterRole").value = p.requesterRole;
      document.getElementById("activityTitle").value = p.activityTitle;
      document.getElementById("attendees").value = p.attendees;
      document.getElementById("startTime").value = p.startTime;
      document.getElementById("endTime").value = p.endTime;
      renderFloorplan2D();
    });
  });
}

function initNavigation() {
  document.querySelectorAll(".nav-item[data-tab]").forEach((btn) => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".nav-item[data-tab]").forEach((b) => b.classList.remove("active"));
      document.querySelectorAll(".tab-panel").forEach((p) => p.classList.remove("active"));
      btn.classList.add("active");
      document.getElementById(btn.getAttribute("data-tab"))?.classList.add("active");
    });
  });
}

function initModalHandlers() {
  const modal = document.getElementById("quarantine-modal");
  document.getElementById("btn-open-quarantine").addEventListener("click", () => {
    modal.classList.remove("hidden");
  });
  document.getElementById("btn-close-quarantine").addEventListener("click", () => {
    modal.classList.add("hidden");
  });
  document.getElementById("btn-reset-demo").addEventListener("click", async () => {
    await fetch("/api/reset", { method: "POST" });
    document.getElementById("audit-result-container").classList.add("hidden");
    await fetchSystemState();
  });
}

function renderQuarantineModal() {
  const list = document.getElementById("quarantine-list");
  list.innerHTML = appState.quarantinedRecords
    .map(
      (q) => `
      <div class="list-item" style="border-left:3px solid var(--status-amber);">
        <div>
          <h4 style="color:#fde68a;">⚠️ [${escapeHtml(q.entityType)}] ID: ${escapeHtml(q.recordId)}</h4>
          <p class="list-sub">${escapeHtml(q.rawSummary)}</p>
          <p class="list-sub" style="color:#fca5a5;">Motivo: ${escapeHtml(q.reasons.join(" | "))}</p>
        </div>
      </div>
    `
    )
    .join("");
}

function escapeHtml(str) {
  return String(str ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
