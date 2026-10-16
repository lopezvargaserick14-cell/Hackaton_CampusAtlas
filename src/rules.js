/**
 * ============================================================================
 * CAMPUSSHIELD AI - MOTOR CENTRAL DE REGLAS DE NEGOCIO Y SANITIZACIÓN
 * ============================================================================
 * 💡 NOTA PARA EL RETO EN VIVO DEL JURADO (15 PUNTOS - MENOS DE 3 MINUTOS):
 * Todas las constantes y condiciones de dominio están centralizadas aquí.
 * Si el jurado pide cambiar un límite (ej. porcentaje de aforo, mínimo de
 * ocupación, duración máxima o bloqueo por rol), edita RULES_CONFIG abajo.
 * ============================================================================
 */

const RULES_CONFIG = {
  // Regla 1: Control de Aforo y Capacidad Física
  MAX_CAPACITY_PERCENTAGE: 100, // 100% del aforo máximo permitido
  MIN_OCCUPANCY_PERCENTAGE: 20, // Mínimo 20% del aforo para evitar subutilización de aulas grandes
  ENFORCE_MIN_OCCUPANCY_ON_LARGE_ROOMS: true, // Aplica a espacios de más de 15 personas
  LARGE_ROOM_THRESHOLD: 15,

  // Regla 2: Horarios y No Solapamiento
  CAMPUS_OPEN_TIME: "06:00",
  CAMPUS_CLOSE_TIME: "22:00",
  MAX_BOOKING_DURATION_MINUTES: 240, // Máximo 4 horas seguidas por reserva
  MIN_BOOKING_DURATION_MINUTES: 30,  // Mínimo 30 minutos

  // Regla 3: Seguridad Operativa y Cruce con Incidencias / Mantenimiento
  ALLOWED_SPACE_STATUSES: ["DISPONIBLE"],
  VALID_SPACE_STATUSES_IN_DATASET: ["DISPONIBLE", "MANTENIMIENTO", "BLOQUEADO_SEGURIDAD"],
  BLOCK_IF_CRITICAL_INCIDENT_OPEN: true,

  // Regla 4 (Módulo 2 conectado): Límite de préstamos activos y bloqueo por mora
  MAX_ACTIVE_LOANS_PER_USER: 2
};

/**
 * Convierte una hora "HH:MM" a minutos desde las 00:00 para comparaciones exactas
 */
function timeToMinutes(timeStr) {
  if (!timeStr || typeof timeStr !== "string" || !/^\d{2}:\d{2}$/.test(timeStr)) {
    return NaN;
  }
  const [hours, minutes] = timeStr.split(":").map(Number);
  if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) return NaN;
  return hours * 60 + minutes;
}

/**
 * ============================================================================
 * ESCUDO DE INTEGRIDAD DE DATOS (SANITIZACIÓN DE CASOS BORDE DEL DATASET)
 * ============================================================================
 * Filtra registros inconsistentes en los datos de origen sin tumbar el servidor
 * y genera un reporte auditable para mostrar en la interfaz.
 */
function sanitizeCampusDataset(rawData) {
  const quarantinedRecords = [];
  const validSpaces = [];
  const validBookings = [];

  // 1. Sanitizar Espacios
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

  // 2. Sanitizar Reservas existentes
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
 * ============================================================================
 * VALIDACIÓN DE REGLAS DE NEGOCIO - MÓDULO 1: DISPONIBILIDAD Y ASIGNACIÓN DE ESPACIOS
 * ============================================================================
 * Evalúa las reglas de dominio reales y devuelve tanto el resultado como el
 * desglose de cada regla evaluada para mostrar en la UI.
 */
function validateSpaceBookingRequest(payload, currentState) {
  const {
    spaceId,
    requesterName,
    requesterRole,
    activityTitle,
    attendees,
    date,
    startTime,
    endTime
  } = payload;

  const ruleChecks = [];
  const errors = [];

  // Validación básica de entrada
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
      errors: [`El espacio con ID '${spaceId}' no existe o fue aislado por inconsistencia de datos.`],
      ruleChecks: []
    };
  }

  // --------------------------------------------------------------------------
  // REGLA DE DOMINIO 1: SALUD OPERATIVA Y BLOQUEO DE SEGURIDAD CRUZADO
  // Prohibido asignar espacios en mantenimiento o con incidentes críticos activos
  // --------------------------------------------------------------------------
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
      ? `Bloqueo de Seguridad Activo por incidencia crítica [${activeCriticalIncident.id}]: "${activeCriticalIncident.title}".`
      : `El espacio '${space.name}' se encuentra en estado '${space.status}' (${space.lockReason || "No habilitado para asignación"}).`;

    errors.push(reason);
    ruleChecks.push({
      ruleId: "RN-01",
      ruleName: "Seguridad Operativa y Cruce de Incidencias",
      passed: false,
      detail: reason
    });
  } else {
    ruleChecks.push({
      ruleId: "RN-01",
      ruleName: "Seguridad Operativa y Cruce de Incidencias",
      passed: true,
      detail: `Espacio '${space.name}' operativo y sin incidentes críticos abiertos.`
    });
  }

  // --------------------------------------------------------------------------
  // REGLA DE DOMINIO 2: CONTROL ESTRICTO DE AFORO Y OPTIMIZACIÓN DE CAPACIDAD
  // Evita sobrecupo físico (riesgo de seguridad) y subutilización extrema
  // --------------------------------------------------------------------------
  const numAttendees = Number(attendees);
  const maxAllowedAttendees = Math.floor((space.capacity * RULES_CONFIG.MAX_CAPACITY_PERCENTAGE) / 100);
  const minRequiredAttendees =
    RULES_CONFIG.ENFORCE_MIN_OCCUPANCY_ON_LARGE_ROOMS && space.capacity >= RULES_CONFIG.LARGE_ROOM_THRESHOLD
      ? Math.ceil((space.capacity * RULES_CONFIG.MIN_OCCUPANCY_PERCENTAGE) / 100)
      : 1;

  if (isNaN(numAttendees) || numAttendees <= 0) {
    errors.push("El número de asistentes debe ser mayor a 0.");
    ruleChecks.push({
      ruleId: "RN-02",
      ruleName: "Seguridad de Aforo y Capacidad del Espacio",
      passed: false,
      detail: "Cantidad de asistentes inválida."
    });
  } else if (numAttendees > maxAllowedAttendees) {
    const msg = `Conflicto de Aforo (Riesgo de Sobrecupo): Solicitas espacio para ${numAttendees} personas, pero '${space.name}' tiene un límite seguro de ${maxAllowedAttendees} personas.`;
    errors.push(msg);
    ruleChecks.push({
      ruleId: "RN-02",
      ruleName: "Seguridad de Aforo y Capacidad del Espacio",
      passed: false,
      detail: msg
    });
  } else if (numAttendees < minRequiredAttendees) {
    const msg = `Subutilización de Espacio: '${space.name}' tiene capacidad para ${space.capacity} personas y exige mínimo ${minRequiredAttendees} asistentes (${RULES_CONFIG.MIN_OCCUPANCY_PERCENTAGE}%). Usa un Cubículo para grupos pequeños.`;
    errors.push(msg);
    ruleChecks.push({
      ruleId: "RN-02",
      ruleName: "Seguridad de Aforo y Capacidad del Espacio",
      passed: false,
      detail: msg
    });
  } else {
    const occupancyPct = Math.round((numAttendees / space.capacity) * 100);
    ruleChecks.push({
      ruleId: "RN-02",
      ruleName: "Seguridad de Aforo y Capacidad del Espacio",
      passed: true,
      detail: `Aforo verificado: ${numAttendees}/${space.capacity} asistentes (${occupancyPct}% de ocupación segura).`
    });
  }

  // --------------------------------------------------------------------------
  // REGLA DE DOMINIO 3: NO SOLAPAMIENTO HORARIO Y VENTANA OPERATIVA DEL CAMPUS
  // Verifica colisiones de horario [inicioA < finB && finA > inicioB]
  // --------------------------------------------------------------------------
  const reqStart = timeToMinutes(startTime);
  const reqEnd = timeToMinutes(endTime);
  const openMin = timeToMinutes(RULES_CONFIG.CAMPUS_OPEN_TIME);
  const closeMin = timeToMinutes(RULES_CONFIG.CAMPUS_CLOSE_TIME);

  if (isNaN(reqStart) || isNaN(reqEnd) || reqEnd <= reqStart) {
    const msg = `Rango de horas inválido (${startTime} a ${endTime}). La hora de fin debe ser posterior a la de inicio.`;
    errors.push(msg);
    ruleChecks.push({
      ruleId: "RN-03",
      ruleName: "Integridad Horaria y Cero Solapamiento",
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
      const msg = `Fuera de horario del campus: Campuslands opera entre ${RULES_CONFIG.CAMPUS_OPEN_TIME} y ${RULES_CONFIG.CAMPUS_CLOSE_TIME}.`;
      errors.push(msg);
      ruleChecks.push({
        ruleId: "RN-03",
        ruleName: "Integridad Horaria y Cero Solapamiento",
        passed: false,
        detail: msg
      });
    } else if (duration > RULES_CONFIG.MAX_BOOKING_DURATION_MINUTES || duration < RULES_CONFIG.MIN_BOOKING_DURATION_MINUTES) {
      const msg = `Duración no permitida (${duration} min): Las reservas deben durar entre ${RULES_CONFIG.MIN_BOOKING_DURATION_MINUTES} y ${RULES_CONFIG.MAX_BOOKING_DURATION_MINUTES} minutos.`;
      errors.push(msg);
      ruleChecks.push({
        ruleId: "RN-03",
        ruleName: "Integridad Horaria y Cero Solapamiento",
        passed: false,
        detail: msg
      });
    } else if (overlappingBooking) {
      const msg = `Conflicto de Horario (Solapamiento): '${space.name}' ya está reservada de ${overlappingBooking.startTime} a ${overlappingBooking.endTime} por ${overlappingBooking.requesterName} ("${overlappingBooking.activityTitle}").`;
      errors.push(msg);
      ruleChecks.push({
        ruleId: "RN-03",
        ruleName: "Integridad Horaria y Cero Solapamiento",
        passed: false,
        detail: msg
      });
    } else {
      ruleChecks.push({
        ruleId: "RN-03",
        ruleName: "Integridad Horaria y Cero Solapamiento",
        passed: true,
        detail: `Franja ${startTime} - ${endTime} (${duration} min) libre de colisiones en ${date}.`
      });
    }
  }

  // Si hubo algún bloqueo o conflicto, calculamos sugerencias automáticas de espacios alternativos
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

/**
 * Busca espacios alternativos válidos cuando una reserva falla por aforo, bloqueo o solapamiento
 */
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

module.exports = {
  RULES_CONFIG,
  sanitizeCampusDataset,
  validateSpaceBookingRequest,
  findAlternativeSpaces
};
