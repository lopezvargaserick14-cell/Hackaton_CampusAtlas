const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { spawn } = require("child_process");

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
const PYTHON_SCRIPT_PATH = path.join(__dirname, "src", "assistant_engine.py");

// Generación de IDs aleatorios no predecibles (security-best-practices)
function generateSecureId(prefix) {
  return `${prefix}-${crypto.randomUUID().slice(0, 6).toUpperCase()}`;
}

// Sanitización de texto de entrada contra XSS e inyecciones de control
function sanitizeInputString(val, maxLen = 220) {
  return String(val == null ? "" : val)
    .replace(/[\u0000-\u001F\u007F]/g, "")
    .trim()
    .slice(0, maxLen);
}

// Ejecuta el motor Python (src/assistant_engine.py) de forma segura sin shell
function runPythonEngine(inputPayload) {
  return new Promise((resolve) => {
    try {
      const py = spawn("python", [PYTHON_SCRIPT_PATH], {
        stdio: ["pipe", "pipe", "pipe"],
        windowsHide: true
      });
      let out = "";
      let errOut = "";
      const timer = setTimeout(() => {
        py.kill();
        resolve(null);
      }, 4000);

      py.stdout.on("data", (chunk) => {
        out += chunk.toString("utf8");
      });
      py.stderr.on("data", (chunk) => {
        errOut += chunk.toString("utf8");
      });
      py.on("error", () => {
        clearTimeout(timer);
        resolve(null);
      });
      py.on("close", (code) => {
        clearTimeout(timer);
        if (code !== 0 || !out.trim()) return resolve(null);
        try {
          resolve(JSON.parse(out.trim()));
        } catch (e) {
          resolve(null);
        }
      });

      py.stdin.write(JSON.stringify(inputPayload));
      py.stdin.end();
    } catch (e) {
      resolve(null);
    }
  });
}

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

// Cabeceras HTTP de Hiper-Seguridad (security-best-practices)
const SECURITY_HEADERS = {
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Permissions-Policy": "geolocation=(), microphone=(), camera=()",
  "Cache-Control": "no-store"
};

function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, {
    ...SECURITY_HEADERS,
    "Content-Type": "application/json; charset=utf-8"
  });
  res.end(JSON.stringify(payload));
}

function parseBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk.toString();
      if (body.length > 50000) {
        reject(new Error("Payload excede el límite seguro"));
      }
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
      return sendJson(res, 200, {
        ok: true,
        securityEngine: "PYTHON_SECURITY_CORE",
        rulesConfig: RULES_CONFIG,
        state: cleanData
      });
    }

    // POST /api/bookings (Reserva auditada por Python + Reglas de Dominio)
    if (req.method === "POST" && pathname === "/api/bookings") {
      const rawPayload = await parseBody(req);
      const payload = {
        spaceId: sanitizeInputString(rawPayload.spaceId, 40),
        requesterName: sanitizeInputString(rawPayload.requesterName, 80),
        requesterRole: ["TRAINER", "TEAM_EDUCACION", "COORDINACION"].includes(rawPayload.requesterRole)
          ? rawPayload.requesterRole
          : "TRAINER",
        activityTitle: sanitizeInputString(rawPayload.activityTitle, 140),
        attendees: Number(rawPayload.attendees),
        date: sanitizeInputString(rawPayload.date, 20),
        startTime: sanitizeInputString(rawPayload.startTime, 10),
        endTime: sanitizeInputString(rawPayload.endTime, 10),
        bookingTag: ["OCUPADO", "APARTADO", "RESERVADO"].includes(rawPayload.bookingTag)
          ? rawPayload.bookingTag
          : "RESERVADO"
      };

      const { rawJson, cleanData } = getSanitizedState();

      // 1. Firewall de Seguridad en Python
      const pyAuditRes = await runPythonEngine({
        action: "audit_booking",
        payload
      });

      const validationResult = validateSpaceBookingRequest(payload, cleanData);
      const aiSecurityAudit =
        pyAuditRes?.audit?.verdict === "BLOQUEADO_POR_IA"
          ? pyAuditRes.audit
          : await evaluateBookingSecurityWithGemini(payload, validationResult, cleanData);

      const spaceObj = validationResult.space || {
        id: payload.spaceId || "SP-UNK",
        name: payload.spaceId || "Espacio"
      };

      if (aiSecurityAudit.verdict === "BLOQUEADO_POR_IA") {
        const blockedRecord = {
          id: generateSecureId("RES"),
          spaceId: spaceObj.id,
          spaceName: spaceObj.name,
          requesterName: payload.requesterName || "Solicitante",
          requesterRole: payload.requesterRole,
          activityTitle: payload.activityTitle,
          attendees: Math.max(1, Number(payload.attendees) || 1),
          date: payload.date || "2026-10-16",
          startTime: payload.startTime || "08:00",
          endTime: payload.endTime || "10:00",
          status: "BLOQUEADA_SEGURIDAD",
          bookingTag: "BLOQUEADO",
          riskLevel: aiSecurityAudit.riskLevel || "CRITICO",
          securityNote: aiSecurityAudit.summary,
          createdAt: new Date().toISOString()
        };
        rawJson.bookings = rawJson.bookings || [];
        rawJson.bookings.unshift(blockedRecord);
        saveRawDataset(rawJson);

        return sendJson(res, 403, {
          ok: false,
          blockedBy: "PYTHON_SECURITY_SHIELD",
          message: `Bloqueo de Seguridad: ${aiSecurityAudit.summary}`,
          errors: [aiSecurityAudit.summary],
          alternativeSpaces: validationResult.alternativeSpaces,
          aiSecurityAudit
        });
      }

      if (!validationResult.valid) {
        return sendJson(res, 422, {
          ok: false,
          blockedBy: "DOMAIN_RULES",
          message: validationResult.errors[0],
          errors: validationResult.errors,
          alternativeSpaces: validationResult.alternativeSpaces,
          aiSecurityAudit
        });
      }

      const newBooking = {
        id: generateSecureId("RES"),
        spaceId: spaceObj.id,
        spaceName: spaceObj.name,
        requesterName: payload.requesterName,
        requesterRole: payload.requesterRole,
        activityTitle: payload.activityTitle,
        attendees: payload.attendees,
        date: payload.date,
        startTime: payload.startTime,
        endTime: payload.endTime,
        status: "ACTIVA",
        bookingTag: payload.bookingTag,
        riskLevel: "BAJO",
        securityNote: "Verificado por firewall Python y reglas de aforo.",
        createdAt: new Date().toISOString()
      };

      rawJson.bookings = rawJson.bookings || [];
      rawJson.bookings.unshift(newBooking);
      saveRawDataset(rawJson);

      return sendJson(res, 201, {
        ok: true,
        message: `Reserva confirmada en ${spaceObj.name} (${newBooking.date} • ${newBooking.startTime}–${newBooking.endTime}).`,
        booking: newBooking,
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
      return sendJson(res, 200, { ok: true, message: `Reserva ${bookingId} liberada del calendario.` });
    }

    // POST /api/bookings/delete
    if (req.method === "POST" && pathname === "/api/bookings/delete") {
      const { bookingId } = await parseBody(req);
      const { rawJson } = getSanitizedState();
      rawJson.bookings = (rawJson.bookings || []).filter((b) => b.id !== bookingId);
      saveRawDataset(rawJson);
      return sendJson(res, 200, { ok: true, message: `Registro ${bookingId} eliminado.` });
    }

    // POST /api/spaces/status
    if (req.method === "POST" && pathname === "/api/spaces/status") {
      const { spaceId, newStatus, lockReason } = await parseBody(req);
      const { rawJson } = getSanitizedState();
      const space = (rawJson.spaces || []).find((s) => s.id === spaceId);
      if (!space) return sendJson(res, 404, { ok: false, message: "Espacio no encontrado." });
      space.status = newStatus;
      space.lockReason =
        newStatus === "DISPONIBLE" ? null : sanitizeInputString(lockReason, 160) || "Problema técnico en instalación";
      saveRawDataset(rawJson);
      return sendJson(res, 200, { ok: true, space });
    }

    // POST /api/incidents
    if (req.method === "POST" && pathname === "/api/incidents") {
      const rawPayload = await parseBody(req);
      const payload = {
        targetId: sanitizeInputString(rawPayload.targetId, 40),
        title: sanitizeInputString(rawPayload.title, 120),
        description: sanitizeInputString(rawPayload.description, 260)
      };
      const { rawJson, cleanData } = getSanitizedState();
      if (!payload.title || !payload.description || !payload.targetId) {
        return sendJson(res, 400, { ok: false, message: "Completa salón, problema y descripción." });
      }

      const triage = await triageIncidentWithGemini(payload, cleanData);
      const newInc = {
        id: generateSecureId("INC"),
        title: payload.title,
        description: payload.description,
        targetId: payload.targetId,
        severity: triage.severity,
        category: triage.category,
        status: "ABIERTA",
        aiRecommendation: triage.aiRecommendation,
        createdAt: new Date().toISOString()
      };

      rawJson.incidents = rawJson.incidents || [];
      rawJson.incidents.unshift(newInc);

      const affectedSpace = (rawJson.spaces || []).find((s) => s.id === payload.targetId);
      if (affectedSpace) {
        affectedSpace.status =
          triage.severity === "CRITICA" ? "BLOQUEADO_SEGURIDAD" : "MANTENIMIENTO";
        affectedSpace.lockReason = `${newInc.title}: ${newInc.description}`;
      }

      saveRawDataset(rawJson);
      return sendJson(res, 201, {
        ok: true,
        message: `Alerta en instalación registrada (${newInc.severity}).`,
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
      if (affectedSpace) {
        affectedSpace.status = "DISPONIBLE";
        affectedSpace.lockReason = null;
      }
      saveRawDataset(rawJson);
      return sendJson(res, 200, { ok: true, message: "Problema resuelto y salón habilitado." });
    }

    // POST /api/chat (Motor Asistente en Python + Respaldo API)
    if (req.method === "POST" && pathname === "/api/chat") {
      const { question, date } = await parseBody(req);
      const cleanQuestion = sanitizeInputString(question, 240);
      if (!cleanQuestion) {
        return sendJson(res, 400, { ok: false, message: "Escribe una consulta." });
      }
      const { cleanData } = getSanitizedState();

      // 1. Ejecutamos primero el motor nativo en Python (src/assistant_engine.py)
      const pyRes = await runPythonEngine({
        action: "chat",
        question: cleanQuestion,
        date: sanitizeInputString(date || "2026-10-16", 20),
        state: cleanData
      });

      if (pyRes && pyRes.ok && pyRes.reply) {
        return sendJson(res, 200, {
          ok: true,
          reply: pyRes.reply,
          engine: "PYTHON_CORE"
        });
      }

      // 2. Fallback en caso de ejecución serverless sin binario Python
      const fallbackRes = await askCampusCopilotWithGemini(cleanQuestion, cleanData);
      return sendJson(res, 200, {
        ok: true,
        reply: fallbackRes.answer || fallbackRes.reply,
        engine: "FALLBACK_CORE"
      });
    }

    // GET /api/export/csv
    if (req.method === "GET" && pathname === "/api/export/csv") {
      const { cleanData } = getSanitizedState();
      const escapeCsv = (val) => `"${String(val == null ? "" : val).replace(/"/g, '""')}"`;
      const rows = [
        ["TABLA", "ID", "SALON", "RESPONSABLE", "ACTIVIDAD", "FECHA_HORARIO", "PERSONAS", "ESTADO", "RIESGO", "NOTA_SEGURIDAD"].map(escapeCsv).join(",")
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
          s.status !== "DISPONIBLE" ? "ALTO" : "BAJO",
          s.lockReason || "Instalación habilitada"
        ].map(escapeCsv).join(","));
      });

      const csvContent = "\uFEFF" + rows.join("\r\n");
      res.writeHead(200, {
        ...SECURITY_HEADERS,
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="CampusAtlas_BaseDatos_${new Date().toISOString().slice(0, 10)}.csv"`
      });
      return res.end(csvContent);
    }

    // POST /api/reset
    if (req.method === "POST" && pathname === "/api/reset") {
      const seedContent = fs.readFileSync(SEED_PATH, "utf8");
      fs.writeFileSync(RUNTIME_DATA_PATH, seedContent, "utf8");
      return sendJson(res, 200, {
        ok: true,
        message: "Base de datos restaurada."
      });
    }

    // Archivos estáticos
    let filePath = pathname === "/" ? path.join(PUBLIC_DIR, "index.html") : path.join(PUBLIC_DIR, pathname);
    if (!filePath.startsWith(PUBLIC_DIR)) {
      res.writeHead(403, SECURITY_HEADERS);
      return res.end("Forbidden");
    }

    if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
      const ext = path.extname(filePath).toLowerCase();
      const contentType = MIME_TYPES[ext] || "application/octet-stream";
      res.writeHead(200, { ...SECURITY_HEADERS, "Content-Type": contentType });
      return fs.createReadStream(filePath).pipe(res);
    }

    res.writeHead(404, { ...SECURITY_HEADERS, "Content-Type": "text/plain; charset=utf-8" });
    res.end("Ruta no encontrada");
  } catch (err) {
    console.error("Error controlado:", err);
    sendJson(res, 500, { ok: false, message: "Error controlado: " + err.message });
  }
});

if (!IS_VERCEL) {
  server.listen(PORT, () => {
    console.log(`\n🛡️  CampusAtlas (Node + Python Security Core) corriendo en: http://localhost:${PORT}`);
  });
}

module.exports = (req, res) => {
  server.emit("request", req, res);
};
