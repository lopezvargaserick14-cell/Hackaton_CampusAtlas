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
  validateSpaceBookingRequest
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
  const { cleanData } = sanitizeCampusDataset(rawJson);
  return { rawJson, cleanData };
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
      const { cleanData } = getSanitizedState();
      const apiKey = (process.env.GEMINI_API_KEY || "").trim();
      const hasApiKey = Boolean(apiKey && apiKey !== "TU_API_KEY_DE_GEMINI_AQUI");

      return sendJson(res, 200, {
        ok: true,
        aiStatus: {
          configured: hasApiKey,
          securityMode: "ZERO_TRUST_ACTIVE"
        },
        rulesConfig: RULES_CONFIG,
        state: cleanData
      });
    }

    // POST /api/bookings (Reserva + Registro automático en Base de Datos)
    if (req.method === "POST" && pathname === "/api/bookings") {
      const payload = await parseBody(req);
      const { rawJson, cleanData } = getSanitizedState();

      const validationResult = validateSpaceBookingRequest(payload, cleanData);
      const aiSecurityAudit = await evaluateBookingSecurityWithGemini(
        payload,
        validationResult,
        cleanData
      );

      const spaceObj = validationResult.space || {
        id: payload.spaceId || "SP-UNK",
        name: payload.spaceId || "Espacio"
      };

      // Si es bloqueado por seguridad IA, guardamos el intento bloqueado en la BD para analítica
      if (aiSecurityAudit.verdict === "BLOQUEADO_POR_IA") {
        const blockedRecord = {
          id: `RES-${Math.floor(100 + Math.random() * 900)}`,
          spaceId: spaceObj.id,
          spaceName: spaceObj.name,
          requesterName: String(payload.requesterName || "Solicitante").trim(),
          requesterRole: payload.requesterRole || "TRAINER",
          activityTitle: String(payload.activityTitle || "").trim(),
          attendees: Math.max(1, Number(payload.attendees) || 1),
          date: payload.date || "2026-10-16",
          startTime: payload.startTime || "08:00",
          endTime: payload.endTime || "10:00",
          status: "BLOQUEADA_SEGURIDAD",
          riskLevel: aiSecurityAudit.riskLevel || "CRITICO",
          securityNote: aiSecurityAudit.summary,
          createdAt: new Date().toISOString()
        };
        rawJson.bookings = rawJson.bookings || [];
        rawJson.bookings.unshift(blockedRecord);
        saveRawDataset(rawJson);

        return sendJson(res, 403, {
          ok: false,
          blockedBy: "SECURITY_SHIELD",
          message: `Bloqueo de Seguridad: ${aiSecurityAudit.summary}`,
          errors: [aiSecurityAudit.summary, ...(aiSecurityAudit.securityFlags || [])],
          ruleChecks: [
            ...validationResult.ruleChecks,
            {
              ruleId: "SEC-01",
              ruleName: "Auditoría de Seguridad Operativa",
              passed: false,
              detail: aiSecurityAudit.summary
            }
          ],
          alternativeSpaces: validationResult.alternativeSpaces,
          aiSecurityAudit
        });
      }

      // Si falla por reglas de negocio (aforo, cruce, horario)
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

      const newBooking = {
        id: `RES-${Math.floor(100 + Math.random() * 900)}`,
        spaceId: spaceObj.id,
        spaceName: spaceObj.name,
        requesterName: String(payload.requesterName).trim(),
        requesterRole: payload.requesterRole || "TRAINER",
        activityTitle: String(payload.activityTitle).trim(),
        attendees: Number(payload.attendees),
        date: payload.date,
        startTime: payload.startTime,
        endTime: payload.endTime,
        status: "ACTIVA",
        riskLevel: aiSecurityAudit.riskLevel || "BAJO",
        securityNote: aiSecurityAudit.summary,
        createdAt: new Date().toISOString()
      };

      rawJson.bookings = rawJson.bookings || [];
      rawJson.bookings.unshift(newBooking);
      saveRawDataset(rawJson);

      return sendJson(res, 201, {
        ok: true,
        message: `Reserva confirmada en ${spaceObj.name} (${newBooking.startTime}–${newBooking.endTime}).`,
        booking: newBooking,
        ruleChecks: [
          ...validationResult.ruleChecks,
          {
            ruleId: "SEC-01",
            ruleName: "Auditoría de Seguridad Operativa",
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
      if (!target) return sendJson(res, 404, { ok: false, message: "Registro no encontrado." });
      target.status = "CANCELADA";
      saveRawDataset(rawJson);
      return sendJson(res, 200, { ok: true, message: `Reserva ${bookingId} liberada en base de datos.` });
    }

    // POST /api/bookings/delete
    if (req.method === "POST" && pathname === "/api/bookings/delete") {
      const { bookingId } = await parseBody(req);
      const { rawJson } = getSanitizedState();
      rawJson.bookings = (rawJson.bookings || []).filter((b) => b.id !== bookingId);
      saveRawDataset(rawJson);
      return sendJson(res, 200, { ok: true, message: `Registro ${bookingId} eliminado de la base de datos.` });
    }

    // POST /api/spaces/status
    if (req.method === "POST" && pathname === "/api/spaces/status") {
      const { spaceId, newStatus, lockReason } = await parseBody(req);
      const { rawJson } = getSanitizedState();
      const space = (rawJson.spaces || []).find((s) => s.id === spaceId);
      if (!space) return sendJson(res, 404, { ok: false, message: "Espacio no encontrado." });
      space.status = newStatus;
      space.lockReason =
        newStatus === "DISPONIBLE" ? null : lockReason || "Bloqueo preventivo de seguridad";
      saveRawDataset(rawJson);
      return sendJson(res, 200, { ok: true, space });
    }

    // POST /api/incidents (Seguridad de Instalaciones + Auto-Lockdown)
    if (req.method === "POST" && pathname === "/api/incidents") {
      const payload = await parseBody(req);
      const { rawJson, cleanData } = getSanitizedState();
      if (!payload.title || !payload.description || !payload.targetId) {
        return sendJson(res, 400, { ok: false, message: "Completa salón, título y detalle." });
      }

      const triage = await triageIncidentWithGemini(payload, cleanData);
      const newInc = {
        id: `INC-${Math.floor(100 + Math.random() * 900)}`,
        title: String(payload.title).trim(),
        description: String(payload.description).trim(),
        targetId: payload.targetId,
        severity: triage.severity,
        category: triage.category,
        status: "ABIERTA",
        aiRecommendation: triage.aiRecommendation,
        createdAt: new Date().toISOString()
      };

      rawJson.incidents = rawJson.incidents || [];
      rawJson.incidents.unshift(newInc);

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
        message: `Alerta registrada con prioridad ${newInc.severity}.`,
        incident: newInc
      });
    }

    // POST /api/incidents/resolve
    if (req.method === "POST" && pathname === "/api/incidents/resolve") {
      const { incidentId } = await parseBody(req);
      const { rawJson } = getSanitizedState();
      const inc = (rawJson.incidents || []).find((i) => i.id === incidentId);
      if (!inc) return sendJson(res, 404, { ok: false, message: "Alerta no encontrada." });
      inc.status = "RESUELTA";

      const affectedSpace = (rawJson.spaces || []).find((s) => s.id === inc.targetId);
      if (affectedSpace && affectedSpace.status === "BLOQUEADO_SEGURIDAD") {
        affectedSpace.status = "DISPONIBLE";
        affectedSpace.lockReason = null;
      }
      saveRawDataset(rawJson);
      return sendJson(res, 200, { ok: true, message: "Alerta resuelta y salón rehabilitado." });
    }

    // POST /api/chat (Asistente de Espacios y Seguridad)
    if (req.method === "POST" && pathname === "/api/chat") {
      const { question } = await parseBody(req);
      if (!question || !String(question).trim()) {
        return sendJson(res, 400, { ok: false, message: "Escribe una consulta." });
      }
      const { cleanData } = getSanitizedState();
      const chatRes = await askCampusCopilotWithGemini(String(question).trim(), cleanData);
      return sendJson(res, 200, {
        ok: true,
        reply: chatRes.answer || chatRes.reply,
        highlightedSpaceId: chatRes.highlightedSpaceId || null
      });
    }

    // GET /api/export/csv (Exportar Base de Datos de Reservas y Espacios a CSV)
    if (req.method === "GET" && pathname === "/api/export/csv") {
      const { cleanData } = getSanitizedState();
      const escapeCsv = (val) => `"${String(val == null ? "" : val).replace(/"/g, '""')}"`;
      const rows = [
        ["TABLA", "ID", "SALON", "SOLICITANTE_O_ZONA", "ACTIVIDAD_O_TIPO", "FECHA_HORARIO", "AFORO", "ESTADO", "RIESGO_SEGURIDAD", "DICTAMEN_SEGURIDAD"].map(escapeCsv).join(",")
      ];

      (cleanData.bookings || []).forEach((b) => {
        rows.push([
          "RESERVAS_DB",
          b.id,
          b.spaceName,
          `${b.requesterName} (${b.requesterRole || "TRAINER"})`,
          b.activityTitle,
          `${b.date} ${b.startTime}-${b.endTime}`,
          b.attendees,
          b.status,
          b.riskLevel || "BAJO",
          b.securityNote || "Verificado"
        ].map(escapeCsv).join(","));
      });

      (cleanData.spaces || []).forEach((s) => {
        rows.push([
          "ESPACIOS_DB",
          s.id,
          s.name,
          s.zone,
          s.type,
          "06:00-22:00",
          s.capacity,
          s.status,
          s.status === "BLOQUEADO_SEGURIDAD" ? "CRITICO" : "BAJO",
          s.lockReason || "Habilitado"
        ].map(escapeCsv).join(","));
      });

      const csvContent = "\uFEFF" + rows.join("\r\n");
      res.writeHead(200, {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="CampusAtlas_BaseDatos_${new Date().toISOString().slice(0, 10)}.csv"`,
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
        message: "Base de datos restaurada a su estado inicial."
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
    console.log(`\n🛡️  CampusAtlas corriendo en: http://localhost:${PORT}`);
  });
}

module.exports = (req, res) => {
  server.emit("request", req, res);
};
