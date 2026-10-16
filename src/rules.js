/**
 * ============================================================================
 * REGLAS DE NEGOCIO Y SEGURIDAD DE ESPACIOS — CAMPUSLANDS (src/rules.js)
 * ============================================================================
 * GUÍA PARA EL RETO EN VIVO DEL JURADO (< 3 MINUTOS):
 * Modifica cualquiera de las constantes en `RULES_CONFIG` para alterar
 * el comportamiento de reservas, horarios o límites de aforo en tiempo real.
 * ============================================================================
 */

const RULES_CONFIG = {
  // 1. Horario operativo oficial de Campuslands
  CAMPUS_OPEN_TIME: "06:00",
  CAMPUS_CLOSE_TIME: "22:00",

  // 2. Duración máxima y mínima permitida por reserva (en minutos)
  MAX_BOOKING_DURATION_MINUTES: 240, // 4 horas máximo
  MIN_BOOKING_DURATION_MINUTES: 15,  // 15 minutos mínimo

  // 3. Proporción máxima permitida del aforo del salón (1.0 = 100% estricto)
  MAX_CAPACITY_OVERFLOW_RATIO: 1.0,

  // 4. Máximo de reservas activas por solicitante en el mismo día (amplio para pruebas)
  MAX_ACTIVE_BOOKINGS_PER_USER_PER_DAY: 50
};

const VALID_SPACE_STATUSES = ["DISPONIBLE", "MANTENIMIENTO", "BLOQUEADO_SEGURIDAD"];

function timeToMinutes(hhmm) {
  if (typeof hhmm !== "string" || !/^\d{2}:\d{2}$/.test(hhmm)) return NaN;
  const [h, m] = hhmm.split(":").map(Number);
  if (h < 0 || h > 23 || m < 0 || m > 59) return NaN;
  return h * 60 + m;
}

/**
 * Sanitizador silencioso de base de datos para garantizar que ningún dato corrupto
 * rompa la aplicación en tiempo de ejecución.
 */
function sanitizeCampusDataset(rawData) {
  const safeData = rawData && typeof rawData === "object" ? rawData : {};

  const cleanSpaces = [];
  for (const s of Array.isArray(safeData.spaces) ? safeData.spaces : []) {
    if (!s || !s.id || !s.name) continue;
    if (!VALID_SPACE_STATUSES.includes(s.status)) continue;
    cleanSpaces.push(s);
  }

  const cleanBookings = [];
  for (const b of Array.isArray(safeData.bookings) ? safeData.bookings : []) {
    const startMin = timeToMinutes(b?.startTime);
    const endMin = timeToMinutes(b?.endTime);
    if (!b || !b.id || !b.spaceId || isNaN(startMin) || isNaN(endMin) || endMin <= startMin) continue;
    cleanBookings.push(b);
  }

  const cleanIncidents = Array.isArray(safeData.incidents) ? safeData.incidents : [];

  return {
    cleanData: {
      metadata: safeData.metadata || {},
      spaces: cleanSpaces,
      bookings: cleanBookings,
      incidents: cleanIncidents
    }
  };
}

/**
 * Busca espacios alternativos libres cuando una reserva es rechazada por cruce de horario.
 */
function findAlternativeSpaces(payload, currentState) {
  const reqStart = timeToMinutes(payload.startTime);
  const reqEnd = timeToMinutes(payload.endTime);
  const date = payload.date;

  return (currentState.spaces || []).filter((sp) => {
    if (sp.status !== "DISPONIBLE") return false;

    const hasOverlap = (currentState.bookings || []).some((bk) => {
      if (bk.status !== "ACTIVA" || bk.spaceId !== sp.id || bk.date !== date) return false;
      const bStart = timeToMinutes(bk.startTime);
      const bEnd = timeToMinutes(bk.endTime);
      return reqStart < bEnd && reqEnd > bStart;
    });

    return !hasOverlap;
  });
}

/**
 * Valida las reglas de negocio para reservar un salón/espacio en Campuslands.
 */
function validateSpaceBookingRequest(payload, currentState) {
  const errors = [];
  const ruleChecks = [];

  const space = (currentState.spaces || []).find((s) => s.id === payload.spaceId);
  if (!space) {
    return {
      valid: false,
      errors: ["El espacio seleccionado no existe."],
      ruleChecks: [],
      alternativeSpaces: []
    };
  }

  // REGLA R1: Estado de Seguridad del Espacio
  const r1Pass = space.status === "DISPONIBLE";
  ruleChecks.push({
    ruleId: "R1-ESTADO",
    ruleName: "Disponibilidad y Seguridad del Salón",
    passed: r1Pass,
    detail: r1Pass
      ? `${space.name} habilitado.`
      : `${space.name} no disponible (${space.status}: ${space.lockReason || "Bloqueo preventivo"}).`
  });
  if (!r1Pass) {
    errors.push(`El salón '${space.name}' se encuentra bloqueado (${space.lockReason || space.status}).`);
  }

  // REGLA R2: Horario Operativo Campuslands
  const reqStart = timeToMinutes(payload.startTime);
  const reqEnd = timeToMinutes(payload.endTime);
  const openMin = timeToMinutes(RULES_CONFIG.CAMPUS_OPEN_TIME);
  const closeMin = timeToMinutes(RULES_CONFIG.CAMPUS_CLOSE_TIME);

  const validRange = !isNaN(reqStart) && !isNaN(reqEnd) && reqEnd > reqStart;
  const withinCampusHours = validRange && reqStart >= openMin && reqEnd <= closeMin;

  ruleChecks.push({
    ruleId: "R2-HORARIO",
    ruleName: `Horario Oficial (${RULES_CONFIG.CAMPUS_OPEN_TIME}–${RULES_CONFIG.CAMPUS_CLOSE_TIME})`,
    passed: withinCampusHours,
    detail: withinCampusHours
      ? `Franja ${payload.startTime}–${payload.endTime} válida.`
      : `Franja inválida o fuera del horario (${RULES_CONFIG.CAMPUS_OPEN_TIME} a ${RULES_CONFIG.CAMPUS_CLOSE_TIME}).`
  });
  if (!withinCampusHours) {
    errors.push(
      !validRange
        ? "La hora de fin debe ser posterior a la hora de inicio."
        : `Fuera del horario operativo de Campuslands (${RULES_CONFIG.CAMPUS_OPEN_TIME}–${RULES_CONFIG.CAMPUS_CLOSE_TIME}).`
    );
  }

  // REGLA R3: Duración Máxima y Mínima
  const duration = validRange ? reqEnd - reqStart : 0;
  const validDuration =
    validRange &&
    duration >= RULES_CONFIG.MIN_BOOKING_DURATION_MINUTES &&
    duration <= RULES_CONFIG.MAX_BOOKING_DURATION_MINUTES;

  ruleChecks.push({
    ruleId: "R3-DURACION",
    ruleName: `Duración (${RULES_CONFIG.MIN_BOOKING_DURATION_MINUTES}–${RULES_CONFIG.MAX_BOOKING_DURATION_MINUTES} min)`,
    passed: validDuration,
    detail: validDuration
      ? `${duration} min dentro del rango.`
      : `Duración de ${duration} min excede el límite (${RULES_CONFIG.MAX_BOOKING_DURATION_MINUTES} min).`
  });
  if (validRange && !validDuration) {
    errors.push(
      `La reserva debe durar entre ${RULES_CONFIG.MIN_BOOKING_DURATION_MINUTES} y ${RULES_CONFIG.MAX_BOOKING_DURATION_MINUTES} minutos.`
    );
  }

  // REGLA R4: Aforo (Desactivado según instrucción del usuario)
  ruleChecks.push({
    ruleId: "R4-AFORO",
    ruleName: "Aforo",
    passed: true,
    detail: "Gestión de espacio sin restricción de aforo."
  });

  // REGLA R5: Cero Solapamiento Horario
  const conflictingBooking = validRange
    ? (currentState.bookings || []).find((bk) => {
        if (bk.status !== "ACTIVA" || bk.spaceId !== space.id || bk.date !== payload.date) return false;
        const bStart = timeToMinutes(bk.startTime);
        const bEnd = timeToMinutes(bk.endTime);
        return reqStart < bEnd && reqEnd > bStart;
      })
    : null;

  const noOverlap = !conflictingBooking;
  ruleChecks.push({
    ruleId: "R5-CRUCE",
    ruleName: "Control de Solapamiento Horario",
    passed: noOverlap,
    detail: noOverlap
      ? "Sin cruces de horario en este salón."
      : `Conflicto con reserva ${conflictingBooking.id} (${conflictingBooking.startTime}–${conflictingBooking.endTime}).`
  });
  if (!noOverlap) {
    errors.push(
      `Cruce de horario en '${space.name}': ya está reservado de ${conflictingBooking.startTime} a ${conflictingBooking.endTime} (${conflictingBooking.activityTitle}).`
    );
  }

  // REGLA R6: Límite de Reservas por Usuario por Día
  const reqUser = String(payload.requesterName || "").trim().toLowerCase();
  const userBookingsToday = (currentState.bookings || []).filter(
    (bk) =>
      bk.status === "ACTIVA" &&
      bk.date === payload.date &&
      String(bk.requesterName || "").trim().toLowerCase() === reqUser
  ).length;

  const underQuota = userBookingsToday < RULES_CONFIG.MAX_ACTIVE_BOOKINGS_PER_USER_PER_DAY;
  ruleChecks.push({
    ruleId: "R6-CUOTA",
    ruleName: `Cuota Diaria (Máx ${RULES_CONFIG.MAX_ACTIVE_BOOKINGS_PER_USER_PER_DAY})`,
    passed: underQuota,
    detail: underQuota
      ? `${userBookingsToday}/${RULES_CONFIG.MAX_ACTIVE_BOOKINGS_PER_USER_PER_DAY} reservas activas hoy.`
      : `Límite diario alcanzado (${RULES_CONFIG.MAX_ACTIVE_BOOKINGS_PER_USER_PER_DAY} reservas activas).`
  });
  if (!underQuota) {
    errors.push(
      `${payload.requesterName} ya alcanzó el máximo de ${RULES_CONFIG.MAX_ACTIVE_BOOKINGS_PER_USER_PER_DAY} reservas activas para esta fecha.`
    );
  }

  const alternativeSpaces = errors.length > 0 ? findAlternativeSpaces(payload, currentState) : [];

  return {
    valid: errors.length === 0,
    space,
    errors,
    ruleChecks,
    alternativeSpaces
  };
}

module.exports = {
  RULES_CONFIG,
  sanitizeCampusDataset,
  validateSpaceBookingRequest,
  findAlternativeSpaces
};
