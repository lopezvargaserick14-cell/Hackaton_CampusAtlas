/**
 * ============================================================================
 * CAMPUSSHIELD AI - MOTOR DE SEGURIDAD OPERATIVA CON GOOGLE GEMINI API
 * ============================================================================
 * 1. Audita reservas de espacios (Módulo 1).
 * 2. Realiza Triaje Inteligente de Incidencias (Módulo 3) con Auto-Lockdown.
 * 3. Responde consultas en tiempo real en el Chat Copiloto del Campus.
 * ============================================================================
 */

async function evaluateBookingSecurityWithGemini(bookingPayload, validationResult, currentState) {
  const apiKey = (process.env.GEMINI_API_KEY || "").trim();
  const model = (process.env.GEMINI_MODEL || "gemini-2.5-flash").trim();

  if (!apiKey || apiKey === "TU_API_KEY_DE_GEMINI_AQUI") {
    return {
      aiConnected: false,
      verdict: validationResult.valid ? "PENDIENTE_API_KEY" : "RECHAZADO_REGLAS",
      riskLevel: validationResult.valid ? "NO_EVALUADO" : "ALTO",
      score: validationResult.valid ? 80 : 20,
      summary: "Validado por Motor de Reglas Local. Configura GEMINI_API_KEY para auditoría cognitiva.",
      securityFlags: [],
      recommendedSpaceId: validationResult.alternativeSpaces?.[0]?.id || null,
      recommendationReason: validationResult.alternativeSpaces?.[0]
        ? `Alternativa sugerida: ${validationResult.alternativeSpaces[0].name}`
        : ""
    };
  }

  const spacesContext = currentState.spaces.map((s) => ({
    id: s.id,
    name: s.name,
    type: s.type,
    capacity: s.capacity,
    status: s.status
  }));

  const prompt = `
Eres CampusShield AI, el Modelo Central de Seguridad Operativa de Campuslands.
Audita esta solicitud de espacio:
SOLICITUD: ${JSON.stringify(bookingPayload)}
RESULTADO REGLAS DETERMINISTAS: valid=${validationResult.valid}, errores=${JSON.stringify(validationResult.errors)}
ESPACIOS ALTERNATIVOS DISPONIBLES: ${JSON.stringify(validationResult.alternativeSpaces)}
INVENTARIO DE SALONES: ${JSON.stringify(spacesContext)}

Responde SOLO en JSON válido con esta estructura:
{
  "verdict": "APROBADO" | "OBSERVACION_SEGURIDAD" | "BLOQUEADO_POR_IA",
  "riskLevel": "BAJO" | "MEDIO" | "ALTO" | "CRITICO",
  "score": número entero 0-100,
  "summary": "Explicación concisa (máx 2 oraciones)",
  "securityFlags": ["alertas detectadas"],
  "recommendedSpaceId": "ID del salón alternativo si aplica o null",
  "recommendationReason": "Justificación de la recomendación"
}

Si "activityTitle" describe riesgo eléctrico, fuego, soldadura sin ventilación, sabotaje o uso peligroso, devuelve "verdict": "BLOQUEADO_POR_IA" y "riskLevel": "CRITICO".
`;

  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
    model
  )}:generateContent?key=${encodeURIComponent(apiKey)}`;

  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.2, responseMimeType: "application/json" }
      })
    });

    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    const parsed = JSON.parse(data?.candidates?.[0]?.content?.parts?.[0]?.text || "{}");

    return {
      aiConnected: true,
      modelUsed: model,
      verdict: parsed.verdict || (validationResult.valid ? "APROBADO" : "BLOQUEADO_POR_IA"),
      riskLevel: parsed.riskLevel || (validationResult.valid ? "BAJO" : "ALTO"),
      score: typeof parsed.score === "number" ? parsed.score : 85,
      summary: parsed.summary || "Auditoría completada por Gemini.",
      securityFlags: Array.isArray(parsed.securityFlags) ? parsed.securityFlags : [],
      recommendedSpaceId: parsed.recommendedSpaceId || validationResult.alternativeSpaces?.[0]?.id || null,
      recommendationReason: parsed.recommendationReason || ""
    };
  } catch (error) {
    return {
      aiConnected: false,
      verdict: validationResult.valid ? "APROBADO_CON_FALLBACK" : "RECHAZADO_REGLAS",
      riskLevel: validationResult.valid ? "BAJO" : "ALTO",
      score: validationResult.valid ? 85 : 15,
      summary: `Respaldo determinista activo (${error.message}).`,
      securityFlags: [],
      recommendedSpaceId: validationResult.alternativeSpaces?.[0]?.id || null,
      recommendationReason: ""
    };
  }
}

async function triageIncidentWithGemini(incidentPayload, currentState) {
  const apiKey = (process.env.GEMINI_API_KEY || "").trim();
  const model = (process.env.GEMINI_MODEL || "gemini-2.5-flash").trim();

  const spacesContext = currentState.spaces.map((s) => ({
    id: s.id,
    name: s.name,
    capacity: s.capacity,
    status: s.status
  }));

  if (!apiKey || apiKey === "TU_API_KEY_DE_GEMINI_AQUI") {
    return {
      severity: "ALTA",
      category: "Infraestructura General",
      autoLockTarget: true,
      aiRecommendation: "Bloquear preventivamente la entidad afectada y reubicar a un salón disponible."
    };
  }

  const prompt = `
Eres el Motor de Triaje e Incidentes de Seguridad de Campuslands.
Un usuario acaba de reportar este incidente:
${JSON.stringify(incidentPayload)}

Salones actuales del campus:
${JSON.stringify(spacesContext)}

Clasifica el incidente y determina si se debe bloquear preventivamente ("autoLockTarget": true) el salón o recurso afectado para proteger a los campers.
Responde ÚNICAMENTE en JSON válido:
{
  "severity": "CRITICA" | "ALTA" | "MEDIA" | "BAJA",
  "category": "Seguridad Eléctrica" | "Climatización / Confort" | "Red y Conectividad" | "Hardware / Audiovisual",
  "autoLockTarget": true | false,
  "aiRecommendation": "Acción inmediata recomendada incluyendo a qué salón libre reubicar si aplica"
}
`;

  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
    model
  )}:generateContent?key=${encodeURIComponent(apiKey)}`;

  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.2, responseMimeType: "application/json" }
      })
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    const parsed = JSON.parse(data?.candidates?.[0]?.content?.parts?.[0]?.text || "{}");
    return {
      severity: parsed.severity || "ALTA",
      category: parsed.category || "Infraestructura",
      autoLockTarget: Boolean(parsed.autoLockTarget),
      aiRecommendation: parsed.aiRecommendation || "Revisión técnica inmediata recomendada."
    };
  } catch (err) {
    return {
      severity: "CRITICA",
      category: "Seguridad Operativa (Fallback)",
      autoLockTarget: true,
      aiRecommendation: "Bloqueo preventivo activado por protocolo de seguridad local."
    };
  }
}

/**
 * Copiloto Conversacional de Asistencia con IA para consultar el estado en vivo del campus
 */
async function askCampusCopilotWithGemini(question, currentState, quarantinedRecords) {
  const apiKey = (process.env.GEMINI_API_KEY || "").trim();
  const model = (process.env.GEMINI_MODEL || "gemini-2.5-flash").trim();

  if (!apiKey || apiKey === "TU_API_KEY_DE_GEMINI_AQUI") {
    return {
      answer:
        "Modo local activo: Configura GEMINI_API_KEY en .env para respuestas conversacionales con IA.",
      suggestedAction: null
    };
  }

  const prompt = `
Eres CampusAtlas Copilot, el asistente inteligente de operaciones y seguridad de Campuslands (Sede Zona Franca Santander).
Responde la pregunta del usuario basándote ESTRICTAMENTE en estos datos reales en vivo del campus:

SALONES Y ESPACIOS:
${JSON.stringify(currentState.spaces)}

RESERVAS ACTIVAS HOY:
${JSON.stringify((currentState.bookings || []).filter((b) => b.status === "ACTIVA"))}

RECURSOS Y EQUIPOS TI (PRÉSTAMOS Y MORA):
${JSON.stringify(currentState.resources)}

INCIDENCIAS ABIERTAS:
${JSON.stringify((currentState.incidents || []).filter((i) => i.status === "ABIERTA"))}

REGISTROS CON ERROR AISLADOS (CASOS BORDE):
${JSON.stringify(quarantinedRecords)}

PREGUNTA DEL USUARIO:
"${question}"

Responde en JSON válido con esta estructura:
{
  "answer": "Respuesta clara, directa, amigable y precisa con datos exactos (horarios, capacidades, nombres de salones o equipos). Máximo 3-4 oraciones.",
  "highlightedSpaceId": "ID de un salón relevante mencionado (ej. SP-ARTEMIS) o null"
}
`;

  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
    model
  )}:generateContent?key=${encodeURIComponent(apiKey)}`;

  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.25, responseMimeType: "application/json" }
      })
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    const parsed = JSON.parse(data?.candidates?.[0]?.content?.parts?.[0]?.text || "{}");
    return {
      answer: parsed.answer || "Consulta procesada sobre el estado actual del campus.",
      highlightedSpaceId: parsed.highlightedSpaceId || null
    };
  } catch (err) {
    return {
      answer: `Estado rápido local: Hay ${
        currentState.spaces.filter((s) => s.status === "DISPONIBLE").length
      } salones libres hoy y ${
        (currentState.incidents || []).filter((i) => i.status === "ABIERTA").length
      } incidencias activas.`,
      highlightedSpaceId: null
    };
  }
}

module.exports = {
  evaluateBookingSecurityWithGemini,
  triageIncidentWithGemini,
  askCampusCopilotWithGemini
};
