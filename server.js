const http = require("http");
const fs = require("fs");
const path = require("path");

// 1. Carga segura de variables de entorno desde .env (Cero dependencias externas)
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
const { evaluateBookingSecurityWithGemini } = require("./src/geminiSecurity");

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

// Lee y sanitiza el dataset oficial en cada operación
function getSanitizedState() {
  loadEnvFile(); // Permite recargar la API Key en caliente si el usuario edita .env sin reiniciar
  ensureRuntimeDataFile();
  const rawContent = fs.readFileSync(RUNTIME_DATA_PATH, "utf8");
  const rawJson = JSON.parse(rawContent);
  const { cleanData, quarantinedRecords } = sanitizeCampusDataset(rawJson);
  return { rawJson, cleanData, quarantinedRecords };
}

// Persiste cambios manteniendo también los registros originales para evidencia
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
        reject(new Error("JSON inválido en el cuerpo de la petición"));
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

    // ========================================================================
    // ENDPOINT 1: GET /api/state -> Estado unificado + Reporte de Sanitización
    // ========================================================================
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

    // ========================================================================
    // ENDPOINT 2: POST /api/bookings -> Módulo 1: Crear Reserva con Doble Escudo
    // (Reglas de Dominio Deterministas + Modelo de Seguridad Gemini IA)
    // ========================================================================
    if (req.method === "POST" && pathname === "/api/bookings") {
      const payload = await parseBody(req);
      const { rawJson, cleanData } = getSanitizedState();

      // Paso 1: Ejecutar las 3 Reglas de Negocio de Dominio
      const validationResult = validateSpaceBookingRequest(payload, cleanData);

      // Paso 2: Ejecutar Auditoría del Modelo de Seguridad Gemini IA
      const aiSecurityAudit = await evaluateBookingSecurityWithGemini(
        payload,
        validationResult,
        cleanData
      );

      // Si las reglas deterministas fallaron, rechazar con informe completo y alternativa sugerida
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

      // Si las reglas pasaron pero el Modelo de Seguridad Gemini detectó una amenaza crítica
      if (aiSecurityAudit.verdict === "BLOQUEADO_POR_IA") {
        return sendJson(res, 403, {
          ok: false,
          blockedBy: "GEMINI_SECURITY_SHIELD",
          message: `Escudo Gemini IA bloqueó la solicitud por riesgo de seguridad: ${aiSecurityAudit.summary}`,
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

      // Paso 3: Persistir reserva aprobada en el dataset oficial
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
        message: `Asignación confirmada en '${validationResult.space.name}' (${newBooking.startTime} - ${newBooking.endTime}).`,
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

    // ========================================================================
    // ENDPOINT 3: POST /api/bookings/cancel -> Liberar una reserva activa
    // ========================================================================
    if (req.method === "POST" && pathname === "/api/bookings/cancel") {
      const { bookingId } = await parseBody(req);
      const { rawJson } = getSanitizedState();
      const target = (rawJson.bookings || []).find((b) => b.id === bookingId);
      if (!target) {
        return sendJson(res, 404, { ok: false, message: "Reserva no encontrada." });
      }
      target.status = "CANCELADA";
      saveRawDataset(rawJson);
      return sendJson(res, 200, {
        ok: true,
        message: `Reserva ${bookingId} liberada correctamente.`
      });
    }

    // ========================================================================
    // ENDPOINT 4: POST /api/spaces/status -> Cambiar estado operativo de un aula
    // ========================================================================
    if (req.method === "POST" && pathname === "/api/spaces/status") {
      const { spaceId, newStatus, lockReason } = await parseBody(req);
      const { rawJson } = getSanitizedState();
      const space = (rawJson.spaces || []).find((s) => s.id === spaceId);
      if (!space) {
        return sendJson(res, 404, { ok: false, message: "Espacio no encontrado." });
      }
      space.status = newStatus;
      space.lockReason =
        newStatus === "DISPONIBLE"
          ? null
          : lockReason || `Cambio manual de estado a ${newStatus} desde Consola de Seguridad`;
      saveRawDataset(rawJson);
      return sendJson(res, 200, {
        ok: true,
        message: `Estado de '${space.name}' actualizado a ${newStatus}.`,
        space
      });
    }

    // ========================================================================
    // ENDPOINT 5: POST /api/reset -> Restaurar datos de fábrica para la Demo
    // ========================================================================
    if (req.method === "POST" && pathname === "/api/reset") {
      const seedContent = fs.readFileSync(SEED_PATH, "utf8");
      fs.writeFileSync(RUNTIME_DATA_PATH, seedContent, "utf8");
      return sendJson(res, 200, {
        ok: true,
        message: "Dataset oficial restaurado a su estado inicial de demostración."
      });
    }

    // ========================================================================
    // SERVIDOR DE ARCHIVOS ESTÁTICOS (HTML + CSS + JS PURO)
    // ========================================================================
    let filePath = pathname === "/" ? path.join(PUBLIC_DIR, "index.html") : path.join(PUBLIC_DIR, pathname);
    // Prevenir Path Traversal
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
    console.error("Error controlado en servidor:", err);
    sendJson(res, 500, {
      ok: false,
      message: "Excepción controlada en el servidor: " + err.message
    });
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

