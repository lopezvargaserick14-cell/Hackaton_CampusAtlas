/**
 * ============================================================================
 * CAMPUSLANDS MISSION CONTROL - CLIENTE FRONTEND (VANILLA JAVASCRIPT PURO)
 * ============================================================================
 * Identidad oficial Campuslands (Sputnik, Apolo, Artemis, Corvus, Hunters, Ser)
 * + Bloques Horarios M1/M2/T1/T2 + Escudo de Seguridad Gemini IA.
 */

const appState = {
  spaces: [],
  bookings: [],
  resources: [],
  incidents: [],
  quarantinedRecords: [],
  rulesConfig: {},
  aiStatus: { configured: false, model: "gemini-2.5-flash" },
  currentFilter: "ALL",
  selectedSpaceId: "SP-ARTEMIS"
};

document.addEventListener("DOMContentLoaded", () => {
  initTabs();
  initFilters();
  initShiftButtons();
  initDemoPresets();
  initModalHandlers();
  initFormHandler();
  fetchSystemState();
});

async function fetchSystemState() {
  try {
    const res = await fetch("/api/state");
    const data = await res.json();
    if (!data.ok) throw new Error(data.message || "Error cargando estado");

    appState.spaces = data.state.spaces || [];
    appState.bookings = data.state.bookings || [];
    appState.resources = data.state.resources || [];
    appState.incidents = data.state.incidents || [];
    appState.quarantinedRecords = data.quarantinedRecords || [];
    appState.rulesConfig = data.rulesConfig || {};
    appState.aiStatus = data.aiStatus || { configured: false };

    renderTelemetryHeader();
    renderKPIs();
    renderSpaceSelect();
    renderSpacesGrid();
    renderBookingsList();
    renderConnectedPreviews();
    renderQuarantineModalContent();
  } catch (err) {
    console.error("Error al sincronizar con el servidor:", err);
  }
}

function renderTelemetryHeader() {
  const pill = document.getElementById("ai-status-pill");
  const text = document.getElementById("ai-status-text");
  const qCount = document.getElementById("quarantine-count");

  qCount.textContent = appState.quarantinedRecords.length;

  if (appState.aiStatus.configured) {
    pill.className = "telemetry-pill pill-online";
    text.textContent = `GEMINI SHIELD // ${appState.aiStatus.model.toUpperCase()}`;
  } else {
    pill.className = "telemetry-pill pill-warning";
    text.textContent = "MODO REGLAS (SIN API KEY)";
  }
}

function renderKPIs() {
  const available = appState.spaces.filter((s) => s.status === "DISPONIBLE").length;
  const locked = appState.spaces.filter((s) => s.status !== "DISPONIBLE").length;
  const activeBookings = appState.bookings.filter((b) => b.status === "ACTIVA").length;

  document.getElementById("kpi-available-spaces").textContent = available;
  document.getElementById("kpi-locked-spaces").textContent = locked;
  document.getElementById("kpi-active-bookings").textContent = activeBookings;
  document.getElementById("kpi-quarantined").textContent = appState.quarantinedRecords.length;
}

function renderSpaceSelect() {
  const select = document.getElementById("spaceId");
  const prevValue = select.value || appState.selectedSpaceId;
  select.innerHTML = "";

  appState.spaces.forEach((sp) => {
    const opt = document.createElement("option");
    opt.value = sp.id;
    const statusIcon =
      sp.status === "DISPONIBLE" ? "🟢" : sp.status === "BLOQUEADO_SEGURIDAD" ? "🔴" : "🟠";
    opt.textContent = `${statusIcon} ${sp.name} — Cap: ${sp.capacity}p [${sp.status}]`;
    select.appendChild(opt);
  });

  if (appState.spaces.some((s) => s.id === prevValue)) {
    select.value = prevValue;
  }
}

function renderSpacesGrid() {
  const container = document.getElementById("spaces-grid");
  container.innerHTML = "";

  const filtered = appState.spaces.filter((sp) => {
    if (appState.currentFilter === "DISPONIBLE") return sp.status === "DISPONIBLE";
    if (appState.currentFilter === "BLOQUEADO") return sp.status !== "DISPONIBLE";
    return true;
  });

  filtered.forEach((sp) => {
    const roomBookings = appState.bookings.filter(
      (b) => b.spaceId === sp.id && b.status === "ACTIVA"
    );

    const card = document.createElement("article");
    const statusClass =
      sp.status === "BLOQUEADO_SEGURIDAD"
        ? "status-locked"
        : sp.status === "MANTENIMIENTO"
        ? "status-maint"
        : "";
    const selectedClass = sp.id === document.getElementById("spaceId").value ? "selected-space" : "";

    card.className = `space-card ${statusClass} ${selectedClass}`;

    const badgeClass =
      sp.status === "DISPONIBLE"
        ? "badge-disponible"
        : sp.status === "BLOQUEADO_SEGURIDAD"
        ? "badge-bloqueado"
        : "badge-mantenimiento";

    const equipHtml = (sp.equipmentIncluded || [])
      .map((eq) => `<span class="equip-tag">${escapeHtml(eq)}</span>`)
      .join("");

    const lockAlertHtml =
      sp.status !== "DISPONIBLE" && sp.lockReason
        ? `<div class="lock-alert-box">🔒 <strong>LOCKDOWN:</strong> ${escapeHtml(sp.lockReason)}</div>`
        : "";

    const activeSlotsHtml =
      roomBookings.length > 0
        ? `<div class="space-meta-row" style="color:#57bbff;"><span>⏱️ Bloques ocupados: ${roomBookings
            .map((b) => `${b.startTime}–${b.endTime}`)
            .join(", ")}</span></div>`
        : `<div class="space-meta-row" style="color:#54c6aa;"><span>✓ Disponible en todos los bloques</span></div>`;

    const nextStatus = sp.status === "DISPONIBLE" ? "BLOQUEADO_SEGURIDAD" : "DISPONIBLE";
    const toggleBtnLabel =
      sp.status === "DISPONIBLE" ? "🔒 Activar Lockdown" : "🔓 Liberar Salón";

    card.innerHTML = `
      <div>
        <div class="space-top">
          <div>
            <span class="space-id">${escapeHtml(sp.id)} // ${escapeHtml(sp.floor || "")}</span>
            <h3 class="space-title">${escapeHtml(sp.name)}</h3>
          </div>
          <span class="status-badge ${badgeClass}">${escapeHtml(sp.status)}</span>
        </div>
        <div class="space-meta-row" style="margin-top:8px;">
          <span>Misión: <strong>${escapeHtml(sp.type)}</strong></span>
          <span>Aforo Máx: <strong>${sp.capacity} campers</strong></span>
        </div>
      </div>

      <div class="space-equip-tags">${equipHtml}</div>
      ${lockAlertHtml}
      ${activeSlotsHtml}

      <div class="space-actions">
        <button type="button" class="btn-mini btn-select-space" data-id="${escapeHtml(sp.id)}">
          Cargar en Consola &gt;
        </button>
        <button type="button" class="btn-mini btn-toggle-lock" data-id="${escapeHtml(sp.id)}" data-next="${nextStatus}">
          ${toggleBtnLabel}
        </button>
      </div>
    `;

    card.addEventListener("click", (e) => {
      if (e.target.closest(".btn-toggle-lock")) return;
      selectSpaceInForm(sp.id);
    });

    const toggleBtn = card.querySelector(".btn-toggle-lock");
    toggleBtn.addEventListener("click", async (e) => {
      e.stopPropagation();
      await toggleSpaceSecurityStatus(sp.id, nextStatus);
    });

    container.appendChild(card);
  });
}

function selectSpaceInForm(spaceId) {
  appState.selectedSpaceId = spaceId;
  const select = document.getElementById("spaceId");
  select.value = spaceId;
  renderSpacesGrid();
}

async function toggleSpaceSecurityStatus(spaceId, newStatus) {
  try {
    await fetch("/api/spaces/status", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        spaceId,
        newStatus,
        lockReason:
          newStatus === "BLOQUEADO_SEGURIDAD"
            ? "Lockdown preventivo activado desde Mission Control Campuslands"
            : null
      })
    });
    await fetchSystemState();
  } catch (err) {
    console.error("Error cambiando estado del espacio:", err);
  }
}

function renderBookingsList() {
  const container = document.getElementById("bookings-list");
  const active = appState.bookings.filter((b) => b.status === "ACTIVA");

  if (active.length === 0) {
    container.innerHTML = `<p style="color:var(--color-text-muted);font-size:0.84rem;">No hay bloques asignados actualmente.</p>`;
    return;
  }

  container.innerHTML = active
    .map((b) => {
      const score = b.aiSecurityAudit?.score ?? 95;
      const verdict = b.aiSecurityAudit?.verdict || "APROBADO";
      return `
        <div class="booking-item">
          <div class="booking-info">
            <h4>${escapeHtml(b.spaceName)} — <span style="color:#54c6aa;">${escapeHtml(b.startTime)} a ${escapeHtml(b.endTime)}</span> (${escapeHtml(b.date)})</h4>
            <p class="booking-sub">
              👨‍🚀 <strong>${escapeHtml(b.requesterName)}</strong> [${escapeHtml(b.requesterRole)}] • 👥 <strong>${b.attendees} campers</strong> • 🚀 ${escapeHtml(b.activityTitle)}
            </p>
            <p class="booking-sub" style="color:#57bbff;">
              🛡️ Gemini Security Shield [${escapeHtml(verdict)} // Score ${score}/100]: ${escapeHtml(b.aiSecurityAudit?.summary || "Verificado")}
            </p>
          </div>
          <button type="button" class="btn-mini" onclick="cancelBooking('${escapeHtml(b.id)}')">
            Liberar Bloque
          </button>
        </div>
      `;
    })
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

function initFormHandler() {
  const form = document.getElementById("booking-form");
  const submitBtn = document.getElementById("btn-submit-booking");

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    submitBtn.disabled = true;
    submitBtn.innerHTML = `<span>🔍 AUDITANDO REGLAS + ESCUDO GEMINI IA...</span>`;

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
    } catch (err) {
      console.error("Error procesando solicitud:", err);
    } finally {
      submitBtn.disabled = false;
      submitBtn.innerHTML = `<span>AUDITAR SEGURIDAD Y ASIGNAR ESPACIO &gt;</span>`;
    }
  });
}

function renderAuditResult(result) {
  const box = document.getElementById("audit-result-container");
  box.classList.remove("hidden");

  const statusColor = result.ok ? "#54c6aa" : "#f87171";
  const headerBadge = result.ok
    ? `<span class="status-badge badge-disponible">✓ MISIÓN AUTORIZADA</span>`
    : `<span class="status-badge badge-bloqueado">✕ BLOQUEADO (${escapeHtml(result.blockedBy || "REGLAS")})</span>`;

  const rulesHtml = (result.ruleChecks || [])
    .map(
      (rc) => `
      <div class="rule-check-item ${rc.passed ? "passed" : "failed"}">
        <span class="rule-code">${rc.passed ? "✓" : "✕"} ${escapeHtml(rc.ruleId)}</span>
        <div>
          <strong>${escapeHtml(rc.ruleName)}:</strong>
          <div style="color:var(--color-text-secondary);margin-top:2px;">${escapeHtml(rc.detail)}</div>
        </div>
      </div>
    `
    )
    .join("");

  const ai = result.aiSecurityAudit || {};
  const recommendedId = ai.recommendedSpaceId || result.alternativeSpaces?.[0]?.id;
  const recommendedSpace = appState.spaces.find((s) => s.id === recommendedId);

  const relocateBtnHtml =
    !result.ok && recommendedSpace
      ? `<button type="button" class="btn-relocate" id="btn-apply-relocation" data-space="${escapeHtml(recommendedSpace.id)}">
           🚀 REUBICACIÓN SEGURA IA: Asignar en ${escapeHtml(recommendedSpace.name)} (Cap: ${recommendedSpace.capacity} campers) &gt;
         </button>`
      : "";

  box.innerHTML = `
    <div class="audit-banner">
      <span class="audit-banner-title" style="color:${statusColor};">${escapeHtml(result.message)}</span>
      ${headerBadge}
    </div>

    <div class="rule-checks-list">
      ${rulesHtml}
    </div>

    <div class="ai-verdict-box">
      <div class="ai-verdict-header">
        <span>🛡️ VEREDICTO GEMINI SECURITY SHIELD</span>
        <span>RIESGO: ${escapeHtml(ai.riskLevel || "EVALUADO")} // SCORE: ${ai.score ?? "--"}/100</span>
      </div>
      <p style="color:#ffffff;">${escapeHtml(ai.summary || "")}</p>
      ${
        ai.recommendationReason
          ? `<p style="color:#54c6aa;margin-top:6px;font-size:0.76rem;">💡 <strong>Recomendación Operativa:</strong> ${escapeHtml(ai.recommendationReason)}</p>`
          : ""
      }
      ${relocateBtnHtml}
    </div>
  `;

  const relocateBtn = document.getElementById("btn-apply-relocation");
  if (relocateBtn) {
    relocateBtn.addEventListener("click", () => {
      const targetSpaceId = relocateBtn.getAttribute("data-space");
      selectSpaceInForm(targetSpaceId);
      document.getElementById("booking-form").requestSubmit();
    });
  }
}

function initDemoPresets() {
  const presets = {
    valid: {
      spaceId: "SP-ARTEMIS",
      requesterName: "Trainer Diego Rojas",
      requesterRole: "TRAINER",
      activityTitle: "Bloque M2: Desarrollo de Microservicios & Review Técnico Cohorte Artemis",
      attendees: 28,
      date: "2026-10-16",
      startTime: "10:00",
      endTime: "14:00"
    },
    locked_incident: {
      spaceId: "SP-SPUTNIK",
      requesterName: "Trainer Camilo Pardo",
      requesterRole: "TRAINER",
      activityTitle: "Bloque M2: Entrenamiento de Modelos LLM Locales — Ruta IA",
      attendees: 25,
      date: "2026-10-16",
      startTime: "10:00",
      endTime: "14:00"
    },
    over_capacity: {
      spaceId: "SP-APOLO",
      requesterName: "Líder Empleabilidad Hunters",
      requesterRole: "STAFF",
      activityTitle: "Masterclass Unificada Preparación de Entrevistas Técnicas",
      attendees: 48,
      date: "2026-10-16",
      startTime: "14:00",
      endTime: "18:00"
    },
    under_capacity: {
      spaceId: "SP-APOLO",
      requesterName: "Camper Mateo Silva",
      requesterRole: "CAMPER",
      activityTitle: "Práctica individual de algoritmos en Salón Apolo",
      attendees: 2,
      date: "2026-10-16",
      startTime: "14:00",
      endTime: "16:00"
    },
    time_overlap: {
      spaceId: "SP-APOLO",
      requesterName: "Trainer Laura Méndez",
      requesterRole: "TRAINER",
      activityTitle: "Sesión Extraordinaria Bases de Datos SQL en Bloque M1",
      attendees: 26,
      date: "2026-10-16",
      startTime: "07:00",
      endTime: "09:30"
    },
    ai_security_threat: {
      spaceId: "SP-ARTEMIS",
      requesterName: "Usuario Externo No Verificado",
      requesterRole: "CAMPER",
      activityTitle: "Pruebas de sobrecarga eléctrica con soldadura industrial y puenteo de tableros sin ventilación",
      attendees: 22,
      date: "2026-10-16",
      startTime: "18:00",
      endTime: "20:00"
    }
  };

  document.querySelectorAll(".preset-chip").forEach((btn) => {
    btn.addEventListener("click", () => {
      const key = btn.getAttribute("data-preset");
      const data = presets[key];
      if (!data) return;

      document.getElementById("spaceId").value = data.spaceId;
      document.getElementById("requesterName").value = data.requesterName;
      document.getElementById("requesterRole").value = data.requesterRole;
      document.getElementById("activityTitle").value = data.activityTitle;
      document.getElementById("attendees").value = data.attendees;
      document.getElementById("date").value = data.date;
      document.getElementById("startTime").value = data.startTime;
      document.getElementById("endTime").value = data.endTime;
      renderSpacesGrid();
    });
  });
}

function initTabs() {
  document.querySelectorAll(".module-tab").forEach((tab) => {
    tab.addEventListener("click", () => {
      document.querySelectorAll(".module-tab").forEach((t) => t.classList.remove("active"));
      document.querySelectorAll(".tab-panel").forEach((p) => p.classList.remove("active"));
      tab.classList.add("active");
      const targetId = tab.getAttribute("data-tab");
      document.getElementById(targetId)?.classList.add("active");
    });
  });
}

function initFilters() {
  document.querySelectorAll(".filter-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".filter-btn").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      appState.currentFilter = btn.getAttribute("data-filter");
      renderSpacesGrid();
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

function renderQuarantineModalContent() {
  const list = document.getElementById("quarantine-list");
  list.innerHTML = appState.quarantinedRecords
    .map(
      (q) => `
      <div class="booking-item" style="border-color:rgba(251,191,36,0.45);">
        <div class="booking-info">
          <h4 style="color:#fbbf24;">⚠️ [${escapeHtml(q.entityType)}] ID: ${escapeHtml(q.recordId)}</h4>
          <p class="booking-sub">${escapeHtml(q.rawSummary)}</p>
          <p class="booking-sub" style="color:#fca5a5;">Anomalía aislada: ${escapeHtml(q.reasons.join(" | "))}</p>
        </div>
      </div>
    `
    )
    .join("");
}

function renderConnectedPreviews() {
  const resGrid = document.getElementById("resources-preview-grid");
  resGrid.innerHTML = appState.resources
    .map(
      (r) => `
      <div class="space-card">
        <div class="space-top">
          <div>
            <span class="space-id">${escapeHtml(r.id)} // ${escapeHtml(r.category)}</span>
            <h3 class="space-title">${escapeHtml(r.name)}</h3>
          </div>
          <span class="status-badge ${
            r.status === "DISPONIBLE" ? "badge-disponible" : "badge-bloqueado"
          }">${escapeHtml(r.status)}</span>
        </div>
        <p class="booking-sub">Salón vinculado: <strong>${escapeHtml(r.assignedSpaceId || "Almacén TI Central")}</strong></p>
        <p class="booking-sub">Estado préstamo: <strong>${escapeHtml(r.borrowedBy || "Disponible para Camper/Trainer")}</strong></p>
      </div>
    `
    )
    .join("");

  const incList = document.getElementById("incidents-preview-list");
  incList.innerHTML = appState.incidents
    .map(
      (inc) => `
      <div class="booking-item" style="border-color:rgba(239,68,68,0.45);">
        <div class="booking-info">
          <h4 style="color:#f87171;">🚨 [${escapeHtml(inc.id)}] ${escapeHtml(inc.title)} — Severidad: ${escapeHtml(inc.severity)}</h4>
          <p class="booking-sub">${escapeHtml(inc.description)}</p>
          <p class="booking-sub" style="color:#54c6aa;">🛡️ Protocolo Gemini IA: ${escapeHtml(inc.aiRecommendation)}</p>
        </div>
      </div>
    `
    )
    .join("");

  document.getElementById("rules-config-json").textContent = JSON.stringify(
    appState.rulesConfig,
    null,
    2
  );
}

function escapeHtml(str) {
  return String(str ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
