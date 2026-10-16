const http = require("http");
const fs = require("fs");
const path = require("path");

function loadEnvFile() {
  const envPath = path.join(__dirname, ".env");
  if (!fs.existsSync(envPath)) return;
  const lines = fs.readFileSync(envPath, "utf8").split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIdx = trimmed.indexOf("=");
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    const val = trimmed.slice(eqIdx + 1).trim().replace(/^['"]|['"]$/g, "");
    process.env[key] = val;
  }
}
loadEnvFile();

const {
  RULES_CONFIG,
  sanitizeCampusDataset,
  validateSpaceBookingRequest,
  validateResourceLoanRequest
} = require("./src/rules");
const {
  evaluateBookingSecurityWithGemini,
  triageIncidentWithGemini,
  askCampusCopilotWithGemini
} = require("./src/geminiSecurity");

const PORT = Number(process.env.PORT) || 3000;
const IS_VERCEL = Boolean(process.env.VERCEL);
const SEED_PATH = path.join(__dirname, "data", "campus_data.seed.json");
const LOCAL_DATA_PATH = path.join(__dirname, "data", "campus_data.json");
const RUNTIME_DATA_PATH = IS_VERCEL ? "/tmp/campus_data.json" : LOCAL_DATA_PATH;
const PUBLIC_DIR = path.join(__dirname, "public");

function ensureRuntimeDataFile() {
  if (!fs.existsSync(RUNTIME_DATA_PATH)) {
    const sourcePath = fs.existsSync(LOCAL_DATA_PATH) ? LOCAL_DATA_PATH : SEED_PATH;
    fs.copyFileSync(sourcePath, RUNTIME_DATA_PATH);
  }
}

function getSanitizedState() {
  loadEnvFile();
  ensureRuntimeDataFile();
  const rawContent = fs.readFileSync(RUNTIME_DATA_PATH, "utf8");
  const rawJson = JSON.parse(rawContent);
  const { cleanData, quarantinedRecords } = sanitizeCampusDataset(rawJson);
  return { rawJson, cleanData, quarantinedRecords };
}

function saveRawDataset(updatedRawJson) {
  updatedRawJson.metadata = updatedRawJson.metadata || {};
  updatedRawJson.metadata.lastUpdated = new Date().toISOString();
  fs.writeFileSync(RUNTIME_DATA_PATH, JSON.stringify(updatedRawJson, null, 2), "utf8");
}

function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store"
  });
  res.end(JSON.stringify(payload));
}

function parseBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk.toString();
    });
    req.on("end", () => {
      if (!body) return resolve({});
      try {
        resolve(JSON.parse(body));
      } catch (err) {
        reject(new Error("JSON inválido en la petición"));
      }
    });
    req.on("error", reject);
  });
}

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".webp": "image/webp",
  ".ico": "image/x-icon"
};

const server = http.createServer(async (req, res) => {
  try {
    const parsedUrl = new URL(req.url, `http://${req.headers.host}`);
    const pathname = parsedUrl.pathname;

    // GET /api/state
    if (req.method === "GET" && pathname === "/api/state") {
      const { cleanData, quarantinedRecords } = getSanitizedState();
      const apiKey = (process.env.GEMINI_API_KEY || "").trim();
      const hasApiKey = Boolean(apiKey && apiKey !== "TU_API_KEY_DE_GEMINI_AQUI");

      return sendJson(res, 200, {
        ok: true,
        aiStatus: {
          configured: hasApiKey,
          model: process.env.GEMINI_MODEL || "gemini-2.5-flash",
          securityMode: "ZERO_TRUST_ACTIVE"
        },
        rulesConfig: RULES_CONFIG,
        quarantinedRecords,
        state: cleanData
      });
    }

    // POST /api/bookings (Módulo 1: Espacios)
    if (req.method === "POST" && pathname === "/api/bookings") {
      const payload = await parseBody(req);
      const { rawJson, cleanData } = getSanitizedState();

      const validationResult = validateSpaceBookingRequest(payload, cleanData);
      const aiSecurityAudit = await evaluateBookingSecurityWithGemini(
        payload,
        validationResult,
        cleanData
      );

      if (!validationResult.valid) {
        return sendJson(res, 422, {
          ok: false,
          blockedBy: "DOMAIN_RULES",
          message: validationResult.errors[0],
          errors: validationResult.errors,
          ruleChecks: validationResult.ruleChecks,
          alternativeSpaces: validationResult.alternativeSpaces,
          aiSecurityAudit
        });
      }

      if (aiSecurityAudit.verdict === "BLOQUEADO_POR_IA") {
        return sendJson(res, 403, {
          ok: false,
          blockedBy: "GEMINI_SECURITY_SHIELD",
          message: `Bloqueado por Gemini IA: ${aiSecurityAudit.summary}`,
          errors: [
            `Bloqueo Preventivo IA (Riesgo ${aiSecurityAudit.riskLevel}): ${aiSecurityAudit.summary}`,
            ...(aiSecurityAudit.securityFlags || [])
          ],
          ruleChecks: [
            ...validationResult.ruleChecks,
            {
              ruleId: "IA-SEC",
              ruleName: "Auditoría de Seguridad Cognitiva (Gemini)",
              passed: false,
              detail: aiSecurityAudit.summary
            }
          ],
          alternativeSpaces: validationResult.alternativeSpaces,
          aiSecurityAudit
        });
      }

      const newBooking = {
        id: `RES-${Math.floor(100 + Math.random() * 900)}`,
        spaceId: validationResult.space.id,
        spaceName: validationResult.space.name,
        requesterName: String(payload.requesterName).trim(),
        requesterRole: payload.requesterRole || "CAMPER",
        activityTitle: String(payload.activityTitle).trim(),
        attendees: Number(payload.attendees),
        date: payload.date,
        startTime: payload.startTime,
        endTime: payload.endTime,
        status: "ACTIVA",
        aiSecurityAudit,
        createdAt: new Date().toISOString()
      };

      rawJson.bookings = rawJson.bookings || [];
      rawJson.bookings.unshift(newBooking);
      saveRawDataset(rawJson);

      return sendJson(res, 201, {
        ok: true,
        message: `Asignación confirmada en '${validationResult.space.name}' (${newBooking.startTime}–${newBooking.endTime}).`,
        booking: newBooking,
        ruleChecks: [
          ...validationResult.ruleChecks,
          {
            ruleId: "IA-SEC",
            ruleName: "Auditoría de Seguridad Cognitiva (Gemini)",
            passed: true,
            detail: aiSecurityAudit.summary
          }
        ],
        aiSecurityAudit
      });
    }

    // POST /api/bookings/cancel
    if (req.method === "POST" && pathname === "/api/bookings/cancel") {
      const { bookingId } = await parseBody(req);
      const { rawJson } = getSanitizedState();
      const target = (rawJson.bookings || []).find((b) => b.id === bookingId);
      if (!target) return sendJson(res, 404, { ok: false, message: "Reserva no encontrada." });
      target.status = "CANCELADA";
      saveRawDataset(rawJson);
      return sendJson(res, 200, { ok: true, message: `Bloque ${bookingId} liberado.` });
    }

    // POST /api/spaces/status
    if (req.method === "POST" && pathname === "/api/spaces/status") {
      const { spaceId, newStatus, lockReason } = await parseBody(req);
      const { rawJson } = getSanitizedState();
      const space = (rawJson.spaces || []).find((s) => s.id === spaceId);
      if (!space) return sendJson(res, 404, { ok: false, message: "Espacio no encontrado." });
      space.status = newStatus;
      space.lockReason =
        newStatus === "DISPONIBLE"
          ? null
          : lockReason || `Lockdown manual activado desde Consola`;
      saveRawDataset(rawJson);
      return sendJson(res, 200, { ok: true, space });
    }

    // POST /api/resources/loan (Módulo 2: Préstamo de Equipos TI)
    if (req.method === "POST" && pathname === "/api/resources/loan") {
      const payload = await parseBody(req);
      const { rawJson, cleanData } = getSanitizedState();
      const validation = validateResourceLoanRequest(payload, cleanData);
      if (!validation.valid) {
        return sendJson(res, 422, {
          ok: false,
          message: validation.errors[0],
          errors: validation.errors
        });
      }
      const resItem = (rawJson.resources || []).find((r) => r.id === payload.resourceId);
      resItem.status = "PRESTADO";
      resItem.borrowedBy = String(payload.borrowerName).trim();
      resItem.dueTime = payload.dueTime || "2026-10-16T22:00:00-05:00";
      saveRawDataset(rawJson);
      return sendJson(res, 200, {
        ok: true,
        message: `Equipo '${resItem.name}' prestado a ${resItem.borrowedBy}.`
      });
    }

    // POST /api/resources/return
    if (req.method === "POST" && pathname === "/api/resources/return") {
      const { resourceId } = await parseBody(req);
      const { rawJson } = getSanitizedState();
      const resItem = (rawJson.resources || []).find((r) => r.id === resourceId);
      if (!resItem) return sendJson(res, 404, { ok: false, message: "Equipo no encontrado." });
      resItem.status = "DISPONIBLE";
      resItem.borrowedBy = null;
      resItem.dueTime = null;
      saveRawDataset(rawJson);
      return sendJson(res, 200, { ok: true, message: `Equipo '${resItem.name}' devuelto al almacén.` });
    }

    // POST /api/incidents (Módulo 3: Triaje IA + Auto-Lockdown en Mapa 2D)
    if (req.method === "POST" && pathname === "/api/incidents") {
      const payload = await parseBody(req);
      const { rawJson, cleanData } = getSanitizedState();
      if (!payload.title || !payload.description || !payload.targetId) {
        return sendJson(res, 400, { ok: false, message: "Completa título, descripción y salón afectado." });
      }

      const triage = await triageIncidentWithGemini(payload, cleanData);
      const newInc = {
        id: `INC-${Math.floor(100 + Math.random() * 900)}`,
        title: String(payload.title).trim(),
        description: String(payload.description).trim(),
        targetType: "ESPACIO",
        targetId: payload.targetId,
        severity: triage.severity,
        category: triage.category,
        status: "ABIERTA",
        aiRecommendation: triage.aiRecommendation,
        createdAt: new Date().toISOString()
      };

      rawJson.incidents = rawJson.incidents || [];
      rawJson.incidents.unshift(newInc);

      // Si Gemini determina bloqueo preventivo o severidad CRÍTICA, bloquea el salón en el Plano 2D
      if (triage.autoLockTarget || triage.severity === "CRITICA") {
        const affectedSpace = (rawJson.spaces || []).find((s) => s.id === payload.targetId);
        if (affectedSpace) {
          affectedSpace.status = "BLOQUEADO_SEGURIDAD";
          affectedSpace.lockReason = `${newInc.id}: ${newInc.title}`;
        }
      }

      saveRawDataset(rawJson);
      return sendJson(res, 201, {
        ok: true,
        message: `Incidencia clasificada por Gemini IA como ${newInc.severity} (${newInc.category}).`,
        incident: newInc
      });
    }

    // POST /api/incidents/resolve
    if (req.method === "POST" && pathname === "/api/incidents/resolve") {
      const { incidentId } = await parseBody(req);
      const { rawJson } = getSanitizedState();
      const inc = (rawJson.incidents || []).find((i) => i.id === incidentId);
      if (!inc) return sendJson(res, 404, { ok: false, message: "Incidencia no encontrada." });
      inc.status = "RESUELTA";

      const affectedSpace = (rawJson.spaces || []).find((s) => s.id === inc.targetId);
      if (affectedSpace && affectedSpace.status === "BLOQUEADO_SEGURIDAD") {
        affectedSpace.status = "DISPONIBLE";
        affectedSpace.lockReason = null;
      }
      saveRawDataset(rawJson);
      return sendJson(res, 200, { ok: true, message: "Incidencia resuelta y salón rehabilitado." });
    }

    // POST /api/chat (Copiloto Conversacional Gemini IA)
    if (req.method === "POST" && pathname === "/api/chat") {
      const { question } = await parseBody(req);
      if (!question || !String(question).trim()) {
        return sendJson(res, 400, { ok: false, message: "Escribe una consulta para el Copiloto IA." });
      }
      const { cleanData } = getSanitizedState();
      const chatRes = await askCampusCopilotWithGemini(String(question).trim(), cleanData);
      return sendJson(res, 200, {
        ok: true,
        reply: chatRes.reply,
        provider: chatRes.provider
      });
    }

    // GET /api/export/csv (Exportar reporte completo a CSV)
    if (req.method === "GET" && pathname === "/api/export/csv") {
      const { cleanData, quarantinedRecords } = getSanitizedState();
      const escapeCsv = (val) => `"${String(val == null ? "" : val).replace(/"/g, '""')}"`;
      const rows = [
        ["SECCION", "ID", "NOMBRE_O_TITULO", "ESTADO_O_SEVERIDAD", "RESPONSABLE_O_AFORO", "DETALLE_OPERATIVO", "TIMESTAMP"].map(escapeCsv).join(",")
      ];

      (cleanData.spaces || []).forEach((s) => {
        rows.push([
          "ESPACIO_CAMPUS",
          s.id,
          s.name,
          s.status,
          `Aforo Max: ${s.capacity}`,
          `${s.zone} | ${s.type}${s.lockReason ? " | Lock: " + s.lockReason : ""}`,
          new Date().toISOString()
        ].map(escapeCsv).join(","));
      });

      (cleanData.bookings || []).forEach((b) => {
        rows.push([
          "RESERVA_HORARIA",
          b.id,
          b.activityTitle,
          b.status,
          `${b.requesterName} (${b.attendees} pax)`,
          `${b.spaceName} | ${b.date} ${b.startTime}-${b.endTime}`,
          b.createdAt || new Date().toISOString()
        ].map(escapeCsv).join(","));
      });

      (cleanData.resources || []).forEach((r) => {
        rows.push([
          "EQUIPO_TI",
          r.id,
          r.name,
          r.status,
          r.borrowedBy || "Almacen Central",
          `Cat: ${r.category}${r.dueTime ? " | Vence: " + r.dueTime : ""}`,
          new Date().toISOString()
        ].map(escapeCsv).join(","));
      });

      (cleanData.incidents || []).forEach((i) => {
        rows.push([
          "INCIDENCIA_CAMPUS",
          i.id,
          i.title,
          `${i.severity} (${i.status})`,
          i.targetId,
          `${i.category} | ${i.aiRecommendation || i.description}`,
          i.createdAt || new Date().toISOString()
        ].map(escapeCsv).join(","));
      });

      (quarantinedRecords || []).forEach((q) => {
        rows.push([
          "REGISTRO_CON_ERROR",
          q.id,
          q.entityType,
          "DATO_INCONSISTENTE",
          "Sanitizador Automatico",
          q.reason,
          new Date().toISOString()
        ].map(escapeCsv).join(","));
      });

      const csvContent = "\uFEFF" + rows.join("\r\n");
      res.writeHead(200, {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="CampusAtlas_Reporte_Operativo_${new Date().toISOString().slice(0, 10)}.csv"`,
        "Cache-Control": "no-store"
      });
      return res.end(csvContent);
    }

    // POST /api/reset
    if (req.method === "POST" && pathname === "/api/reset") {
      const seedContent = fs.readFileSync(SEED_PATH, "utf8");
      fs.writeFileSync(RUNTIME_DATA_PATH, seedContent, "utf8");
      return sendJson(res, 200, {
        ok: true,
        message: "Dataset oficial restaurado a su estado inicial."
      });
    }

    // Archivos estáticos
    let filePath = pathname === "/" ? path.join(PUBLIC_DIR, "index.html") : path.join(PUBLIC_DIR, pathname);
    if (!filePath.startsWith(PUBLIC_DIR)) {
      res.writeHead(403);
      return res.end("Forbidden");
    }

    if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
      const ext = path.extname(filePath).toLowerCase();
      const contentType = MIME_TYPES[ext] || "application/octet-stream";
      res.writeHead(200, { "Content-Type": contentType, "Cache-Control": "no-store" });
      return fs.createReadStream(filePath).pipe(res);
    }

    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Ruta no encontrada");
  } catch (err) {
    console.error("Error controlado:", err);
    sendJson(res, 500, { ok: false, message: "Error controlado: " + err.message });
  }
});

if (!IS_VERCEL) {
  server.listen(PORT, () => {
    console.log(`\n🛡️  CampusShield AI corriendo en: http://localhost:${PORT}`);
  });
}

module.exports = (req, res) => {
  server.emit("request", req, res);
};
