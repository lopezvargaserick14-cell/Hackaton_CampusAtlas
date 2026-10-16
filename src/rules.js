/**
 * ============================================================================
 * CAMPUSSHIELD AI - MOTOR CENTRAL DE REGLAS DE NEGOCIO Y SANITIZACIÓN
 * ============================================================================
 * 💡 NOTA PARA EL RETO EN VIVO DEL JURADO (15 PUNTOS - MENOS DE 3 MINUTOS):
 * Todas las constantes y condiciones de dominio están centralizadas aquí.
 * Si el jurado pide cambiar un límite (ej. porcentaje de aforo, mínimo de
 * ocupación, máximo de préstamos o bloqueo por rol), edita RULES_CONFIG abajo.
 * ============================================================================
 */

const RULES_CONFIG = {
  // Regla 1 (Módulo 1): Control de Aforo y Capacidad Física
  MAX_CAPACITY_PERCENTAGE: 100, // 100% del aforo máximo permitido
  MIN_OCCUPANCY_PERCENTAGE: 20, // Mínimo 20% del aforo para evitar subutilización de salones grandes
  ENFORCE_MIN_OCCUPANCY_ON_LARGE_ROOMS: true,
  LARGE_ROOM_THRESHOLD: 15,

  // Regla 2 (Módulo 1): Horarios y Cero Solapamiento
  CAMPUS_OPEN_TIME: "06:00",
  CAMPUS_CLOSE_TIME: "22:00",
  MAX_BOOKING_DURATION_MINUTES: 240, // Máximo 4 horas seguidas (1 Bloque Campuslands)
  MIN_BOOKING_DURATION_MINUTES: 30,  // Mínimo 30 minutos

  // Regla 3 (Cruzada Módulos 1, 2 y 3): Seguridad Operativa e Incidencias Críticas
  ALLOWED_SPACE_STATUSES: ["DISPONIBLE"],
  VALID_SPACE_STATUSES_IN_DATASET: ["DISPONIBLE", "MANTENIMIENTO", "BLOQUEADO_SEGURIDAD"],
  BLOCK_IF_CRITICAL_INCIDENT_OPEN: true,

  // Regla 4 (Módulo 2 - Préstamo de Recursos TI): Límite y Mora
  MAX_ACTIVE_LOANS_PER_USER: 2,
  BLOCK_LOAN_IF_USER_HAS_OVERDUE: true
};

function timeToMinutes(timeStr) {
  if (!timeStr || typeof timeStr !== "string" || !/^\d{2}:\d{2}$/.test(timeStr)) {
    return NaN;
  }
  const [hours, minutes] = timeStr.split(":").map(Number);
  if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) return NaN;
  return hours * 60 + minutes;
}

/**
 * Sanitiza el dataset oficial aislando casos borde sin interrumpir el sistema
 */
function sanitizeCampusDataset(rawData) {
  const quarantinedRecords = [];
  const validSpaces = [];
  const validBookings = [];

  for (const space of rawData.spaces || []) {
    const issues = [];
    if (!space.id || !space.name || String(space.name).trim() === "") {
      issues.push("Nombre o ID de espacio vacío");
    }
    if (typeof space.capacity !== "number" || space.capacity <= 0) {
      issues.push(`Capacidad de aforo inválida (${space.capacity})`);
    }
    if (!RULES_CONFIG.VALID_SPACE_STATUSES_IN_DATASET.includes(space.status)) {
      issues.push(`Estado operativo desconocido (${space.status})`);
    }

    if (issues.length > 0) {
      quarantinedRecords.push({
        entityType: "ESPACIO",
        recordId: space.id || "SIN-ID",
        rawSummary: `${space.name || "(Sin nombre)"} | Capacidad: ${space.capacity} | Estado: ${space.status}`,
        reasons: issues
      });
    } else {
      validSpaces.push(space);
    }
  }

  for (const booking of rawData.bookings || []) {
    const issues = [];
    const startMin = timeToMinutes(booking.startTime);
    const endMin = timeToMinutes(booking.endTime);

    if (isNaN(startMin) || isNaN(endMin)) {
      issues.push(`Formato de hora inválido (${booking.startTime} - ${booking.endTime})`);
    } else if (endMin <= startMin) {
      issues.push(`Rango horario invertido o nulo (${booking.startTime} a ${booking.endTime})`);
    }
    if (typeof booking.attendees !== "number" || booking.attendees <= 0) {
      issues.push(`Número de asistentes inválido (${booking.attendees})`);
    }

    if (issues.length > 0) {
      quarantinedRecords.push({
        entityType: "RESERVA",
        recordId: booking.id || "SIN-ID",
        rawSummary: `${booking.activityTitle || "Sin título"} (${booking.startTime} -> ${booking.endTime})`,
        reasons: issues
      });
    } else {
      validBookings.push(booking);
    }
  }

  return {
    cleanData: {
      metadata: rawData.metadata || {},
      spaces: validSpaces,
      bookings: validBookings,
      resources: rawData.resources || [],
      incidents: rawData.incidents || []
    },
    quarantinedRecords
  };
}

/**
 * Validación de Reglas de Dominio - Módulo 1 (Espacios)
 */
function validateSpaceBookingRequest(payload, currentState) {
  const {
    spaceId,
    requesterName,
    activityTitle,
    attendees,
    date,
    startTime,
    endTime
  } = payload;

  const ruleChecks = [];
  const errors = [];

  if (!spaceId || !requesterName || !activityTitle || !date || !startTime || !endTime) {
    return {
      valid: false,
      code: "CAMPOS_INCOMPLETOS",
      errors: ["Todos los campos de la solicitud son obligatorios."],
      ruleChecks: []
    };
  }

  const space = currentState.spaces.find((s) => s.id === spaceId);
  if (!space) {
    return {
      valid: false,
      code: "ESPACIO_NO_EXISTE",
      errors: [`El salón '${spaceId}' no existe o está en cuarentena.`],
      ruleChecks: []
    };
  }

  // RN-01: Salud Operativa y Cruce de Incidencias
  const activeCriticalIncident = (currentState.incidents || []).find(
    (inc) =>
      inc.targetType === "ESPACIO" &&
      inc.targetId === space.id &&
      inc.status === "ABIERTA" &&
      inc.severity === "CRITICA"
  );

  const isStatusAllowed = RULES_CONFIG.ALLOWED_SPACE_STATUSES.includes(space.status);
  const blockedByIncident = RULES_CONFIG.BLOCK_IF_CRITICAL_INCIDENT_OPEN && Boolean(activeCriticalIncident);

  if (!isStatusAllowed || blockedByIncident) {
    const reason = activeCriticalIncident
      ? `Lockdown de Seguridad por incidencia crítica [${activeCriticalIncident.id}]: "${activeCriticalIncident.title}".`
      : `El espacio '${space.name}' está en estado '${space.status}' (${space.lockReason || "No habilitado"}).`;

    errors.push(reason);
    ruleChecks.push({
      ruleId: "RN-01",
      ruleName: "Salud Operativa y Cruce de Incidencias",
      passed: false,
      detail: reason
    });
  } else {
    ruleChecks.push({
      ruleId: "RN-01",
      ruleName: "Salud Operativa y Cruce de Incidencias",
      passed: true,
      detail: `'${space.name}' operativo y sin incidentes críticos abiertos.`
    });
  }

  // RN-02: Control Estricto de Aforo
  const numAttendees = Number(attendees);
  const maxAllowedAttendees = Math.floor((space.capacity * RULES_CONFIG.MAX_CAPACITY_PERCENTAGE) / 100);
  const minRequiredAttendees =
    RULES_CONFIG.ENFORCE_MIN_OCCUPANCY_ON_LARGE_ROOMS && space.capacity >= RULES_CONFIG.LARGE_ROOM_THRESHOLD
      ? Math.ceil((space.capacity * RULES_CONFIG.MIN_OCCUPANCY_PERCENTAGE) / 100)
      : 1;

  if (isNaN(numAttendees) || numAttendees <= 0) {
    errors.push("El número de campers debe ser mayor a 0.");
    ruleChecks.push({
      ruleId: "RN-02",
      ruleName: "Seguridad de Aforo y Capacidad",
      passed: false,
      detail: "Cantidad de asistentes inválida."
    });
  } else if (numAttendees > maxAllowedAttendees) {
    const msg = `Sobrecupo de Aforo: Solicitas ${numAttendees} personas, pero '${space.name}' permite máximo ${maxAllowedAttendees}.`;
    errors.push(msg);
    ruleChecks.push({
      ruleId: "RN-02",
      ruleName: "Seguridad de Aforo y Capacidad",
      passed: false,
      detail: msg
    });
  } else if (numAttendees < minRequiredAttendees) {
    const msg = `Subutilización de Salón: '${space.name}' (Cap: ${space.capacity}) exige mínimo ${minRequiredAttendees} asistentes (${RULES_CONFIG.MIN_OCCUPANCY_PERCENTAGE}%). Usa una Cabina Hunters.`;
    errors.push(msg);
    ruleChecks.push({
      ruleId: "RN-02",
      ruleName: "Seguridad de Aforo y Capacidad",
      passed: false,
      detail: msg
    });
  } else {
    const occupancyPct = Math.round((numAttendees / space.capacity) * 100);
    ruleChecks.push({
      ruleId: "RN-02",
      ruleName: "Seguridad de Aforo y Capacidad",
      passed: true,
      detail: `Aforo seguro: ${numAttendees}/${space.capacity} campers (${occupancyPct}% ocupación).`
    });
  }

  // RN-03: No Solapamiento Horario
  const reqStart = timeToMinutes(startTime);
  const reqEnd = timeToMinutes(endTime);
  const openMin = timeToMinutes(RULES_CONFIG.CAMPUS_OPEN_TIME);
  const closeMin = timeToMinutes(RULES_CONFIG.CAMPUS_CLOSE_TIME);

  if (isNaN(reqStart) || isNaN(reqEnd) || reqEnd <= reqStart) {
    const msg = `Rango horario inválido (${startTime} a ${endTime}).`;
    errors.push(msg);
    ruleChecks.push({
      ruleId: "RN-03",
      ruleName: "Cero Solapamiento Horario",
      passed: false,
      detail: msg
    });
  } else {
    const duration = reqEnd - reqStart;
    const overlappingBooking = (currentState.bookings || []).find((b) => {
      if (b.spaceId !== space.id || b.date !== date || b.status !== "ACTIVA") return false;
      const bStart = timeToMinutes(b.startTime);
      const bEnd = timeToMinutes(b.endTime);
      return reqStart < bEnd && reqEnd > bStart;
    });

    if (reqStart < openMin || reqEnd > closeMin) {
      const msg = `Fuera de jornada Campuslands (${RULES_CONFIG.CAMPUS_OPEN_TIME} - ${RULES_CONFIG.CAMPUS_CLOSE_TIME}).`;
      errors.push(msg);
      ruleChecks.push({
        ruleId: "RN-03",
        ruleName: "Cero Solapamiento Horario",
        passed: false,
        detail: msg
      });
    } else if (duration > RULES_CONFIG.MAX_BOOKING_DURATION_MINUTES || duration < RULES_CONFIG.MIN_BOOKING_DURATION_MINUTES) {
      const msg = `Duración (${duration} min) fuera del rango permitido (${RULES_CONFIG.MIN_BOOKING_DURATION_MINUTES}-${RULES_CONFIG.MAX_BOOKING_DURATION_MINUTES} min).`;
      errors.push(msg);
      ruleChecks.push({
        ruleId: "RN-03",
        ruleName: "Cero Solapamiento Horario",
        passed: false,
        detail: msg
      });
    } else if (overlappingBooking) {
      const msg = `Choque de Horario: '${space.name}' ya está ocupado de ${overlappingBooking.startTime} a ${overlappingBooking.endTime} por ${overlappingBooking.requesterName}.`;
      errors.push(msg);
      ruleChecks.push({
        ruleId: "RN-03",
        ruleName: "Cero Solapamiento Horario",
        passed: false,
        detail: msg
      });
    } else {
      ruleChecks.push({
        ruleId: "RN-03",
        ruleName: "Cero Solapamiento Horario",
        passed: true,
        detail: `Bloque ${startTime}–${endTime} (${duration} min) libre de colisiones.`
      });
    }
  }

  const alternativeSpaces = !errors.length
    ? []
    : findAlternativeSpaces(currentState, numAttendees, date, reqStart, reqEnd, space.id);

  return {
    valid: errors.length === 0,
    code: errors.length === 0 ? "VALIDACION_EXITOSA" : "REGLA_NEGOCIO_VIOLADA",
    errors,
    ruleChecks,
    space,
    alternativeSpaces
  };
}

function findAlternativeSpaces(currentState, attendees, date, reqStart, reqEnd, excludeSpaceId) {
  const numAttendees = Number(attendees) || 1;
  return (currentState.spaces || [])
    .filter((sp) => {
      if (sp.id === excludeSpaceId) return false;
      if (!RULES_CONFIG.ALLOWED_SPACE_STATUSES.includes(sp.status)) return false;
      if (sp.capacity < numAttendees) return false;

      const minReq =
        RULES_CONFIG.ENFORCE_MIN_OCCUPANCY_ON_LARGE_ROOMS && sp.capacity >= RULES_CONFIG.LARGE_ROOM_THRESHOLD
          ? Math.ceil((sp.capacity * RULES_CONFIG.MIN_OCCUPANCY_PERCENTAGE) / 100)
          : 1;
      if (numAttendees < minReq) return false;

      if (!isNaN(reqStart) && !isNaN(reqEnd) && reqEnd > reqStart) {
        const hasConflict = (currentState.bookings || []).some((b) => {
          if (b.spaceId !== sp.id || b.date !== date || b.status !== "ACTIVA") return false;
          const bStart = timeToMinutes(b.startTime);
          const bEnd = timeToMinutes(b.endTime);
          return reqStart < bEnd && reqEnd > bStart;
        });
        if (hasConflict) return false;
      }
      return true;
    })
    .map((sp) => ({
      id: sp.id,
      name: sp.name,
      capacity: sp.capacity,
      type: sp.type,
      floor: sp.floor
    }));
}

/**
 * Validación de Reglas de Dominio - Módulo 2 (Préstamo de Equipos TI)
 */
function validateResourceLoanRequest(payload, currentState) {
  const { resourceId, borrowerName } = payload;
  const errors = [];

  const resource = (currentState.resources || []).find((r) => r.id === resourceId);
  if (!resource) {
    return { valid: false, errors: ["Recurso tecnológico no encontrado."] };
  }

  // Regla 1: El equipo debe estar DISPONIBLE y su salón vinculado no puede estar en LOCKDOWN
  if (resource.status !== "DISPONIBLE") {
    errors.push(`El recurso '${resource.name}' no está disponible (Estado actual: ${resource.status}).`);
  }
  if (resource.assignedSpaceId) {
    const linkedSpace = (currentState.spaces || []).find((s) => s.id === resource.assignedSpaceId);
    if (linkedSpace && linkedSpace.status === "BLOQUEADO_SEGURIDAD") {
      errors.push(`Bloqueo Cruzado: '${resource.name}' pertenece a '${linkedSpace.name}', que está en Lockdown de Seguridad.`);
    }
  }

  // Regla 2: Bloqueo por mora o exceso de préstamos simultáneos
  const cleanBorrower = String(borrowerName || "").trim().toLowerCase();
  const userLoans = (currentState.resources || []).filter(
    (r) => r.status === "PRESTADO" && String(r.borrowedBy || "").toLowerCase().includes(cleanBorrower)
  );

  const hasOverdue = userLoans.some((r) => String(r.borrowedBy || "").toUpperCase().includes("MORA"));
  if (RULES_CONFIG.BLOCK_LOAN_IF_USER_HAS_OVERDUE && hasOverdue) {
    errors.push(`Bloqueo por Mora Activa: '${borrowerName}' tiene un equipo vencido sin devolver. Debe entregarlo antes de solicitar otro.`);
  } else if (userLoans.length >= RULES_CONFIG.MAX_ACTIVE_LOANS_PER_USER) {
    errors.push(`Límite de Préstamos Superado: '${borrowerName}' ya tiene ${userLoans.length} equipos activos (Máximo permitido: ${RULES_CONFIG.MAX_ACTIVE_LOANS_PER_USER}).`);
  }

  return {
    valid: errors.length === 0,
    errors,
    resource
  };
}

module.exports = {
  RULES_CONFIG,
  sanitizeCampusDataset,
  validateSpaceBookingRequest,
  validateResourceLoanRequest,
  findAlternativeSpaces
};
