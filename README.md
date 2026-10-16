# 🛰️ CampusAtlas — Sistema Central de Gestión Operativa de Campuslands

**Hackatón Campuslands: "El campus bajo presión"**  
Inspirado en **MIT Atlas** y **ServiceNow Higher-Ed**, diseñado con la identidad visual espacial oficial de **Campuslands (`campuslands.com`)** y blindado por **Google Gemini 2.5 Flash** como motor de seguridad preventiva Zero-Trust, triaje de incidencias y copiloto conversacional.

---

## ✨ Características Implementadas (100% Rúbrica + Todos los Bonus)

### 🛡️ 1. Módulos Principales & Reglas de Negocio (`src/rules.js`)
- **Asignación de Espacios con Auditoría IA**: Validación determinista + cognitiva de horarios (`06:00` a `22:00`), límite de duración (`240 min`), **cero solapamiento horario**, **respeto estricto del aforo** (`35` en Apolo/Artemis/Sputnik, `80` en Corvus, `6` en Cabinas Review) y sugerencia automática de salones alternativos.
- **Préstamo de Equipos TI & Notificaciones de Mora**: Control de inventario de hardware (MacBooks, Kits Arduino, Cámaras, Microfonía) con **alerta visual de préstamo vencido** y bloqueo preventivo para usuarios en mora.
- **Triaje de Incidencias con Prioridad por Colores y Auto-Lockdown**: Clasificación automática con Gemini IA en prioridades codificadas por color (**Rojo = Crítica/Alta**, **Ámbar = Media**, **Verde = Baja**) y bloqueo instantáneo del salón afectado en el **Plano Operativo 2D**.

### 🔍 2. Usabilidad, Resiliencia y Experiencia Visual
- **Sinergia Oficial `campuslands.com` + `@keyframes` Interactivos**: Paleta espacial profunda (`#030712`, `#0076B7`, `#56B4FF`, `#3BC4A5`), logos oficiales, tipografías `Poppins` + `Roboto Mono`, efectos radar al pasar el ratón (`hoverScannerSweep`), pulso de alerta e indicador orbital **"Cargando..."** mientras la IA responde.
- **100% Responsivo**: Adaptado a pantallas de escritorio, laptops, tablets y teléfonos móviles.
- **Panel de Contadores en Tiempo Real**: Espacios libres, equipos prestados, incidencias abiertas y registros con error.
- **Búsqueda y Filtros Dinámicos**: Por texto libre, estado/prioridad, tipo de espacio y fecha.
- **Manejo Explícito de Datos Inconsistentes ("Registro con error")**: Los registros corruptos del dataset (aforo negativo `-15`, estados desconocidos, horas invertidas `14:00 -> 10:00`) son interceptados por `sanitizeCampusDataset` y mostrados claramente como **`⚠️ REGISTRO CON ERROR`** sin romper jamás la aplicación.

### 🟢 3. Todos los Bonus Incluidos
1. **📅 Calendario Visual de Reservas**: Matriz horaria interactiva por bloques oficiales de Campuslands (`M1`, `M2`, `T1`, `T2`).
2. **📥 Exportación de Reportes a CSV**: Descarga instantánea en `/api/export/csv` compatible con Excel.
3. **🔔 Notificaciones de Equipos con Préstamo Vencido**: Banner superior animado en tiempo real.
4. **✨ Chat de Asistencia con IA (Copiloto Campuslands)**: Consulta en lenguaje natural el estado del campus (*"¿Qué aulas están libres a las 3?"*).

---

## ⚡ Guía para la Defensa en Vivo (Modificar Regla en < 3 Minutos)

Todas las reglas de negocio están centralizadas y documentadas al inicio de **`src/rules.js`** dentro del objeto `RULES_CONFIG`:

```javascript
// Archivo: src/rules.js (Líneas 11–36)
const RULES_CONFIG = {
  CAMPUS_OPEN_TIME: "06:00",
  CAMPUS_CLOSE_TIME: "22:00",
  MAX_BOOKING_DURATION_MINUTES: 240, // <-- Cambiar ej. a 120 para limitar reservas a 2 horas
  MIN_BOOKING_DURATION_MINUTES: 15,
  MAX_CAPACITY_OVERFLOW_RATIO: 1.0,  // <-- Cambiar ej. a 0.8 para permitir solo 80% de aforo
  BLOCK_USER_WITH_OVERDUE_EQUIPMENT: true,
  MAX_ACTIVE_BOOKINGS_PER_USER_PER_DAY: 2
};
```

---

## 🚀 Instalación y Ejecución Local

1. Clonar el repositorio:
   ```bash
   git clone https://github.com/lopezvargaserick14-cell/Hackaton_CampusAtlas.git
   cd Hackaton_CampusAtlas
   ```
2. Crear el archivo `.env` en la raíz (usando `.env.example` como plantilla):
   ```env
   GEMINI_API_KEY=tu_clave_de_google_gemini_aqui
   GEMINI_MODEL=gemini-2.5-flash
   PORT=3000
   ```
   > 🔒 **Seguridad**: `.env` está incluido en `.gitignore` y nunca se expone en el frontend ni en el historial de Git.
3. Iniciar el servidor (cero dependencias externas, Node.js nativo):
   ```bash
   npm start
   ```
4. Abrir en el navegador: **`http://localhost:3000`**
