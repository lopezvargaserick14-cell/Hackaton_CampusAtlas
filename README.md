# 🛡️ CampusShield AI — Sistema Central de Gestión Operativa de Campuslands

Prototipo Funcional (MVP) inspirado en los sistemas de gestión y seguridad operativa de grandes universidades (**MIT Atlas** y **ServiceNow Higher-Ed**), donde la **Inteligencia Artificial (Google Gemini)** actúa como el **Modelo Central de Seguridad Operativa, Física y de Datos**.

---

## 🚀 Cómo Ejecutar el Proyecto

1. **Configurar la API Key de Gemini (En privado, jamás se sube a Git):**
   Abre el archivo `.env` en la raíz del proyecto y pega tu clave de Google AI Studio:
   ```env
   GEMINI_API_KEY=AIzaSyTuClaveRealAqui...
   GEMINI_MODEL=gemini-2.5-flash
   PORT=3000
   ```
   *(El sistema detecta los cambios en `.env` en caliente sin siquiera reiniciar el servidor).*

2. **Iniciar el servidor (Cero dependencias externas requeridas):**
   ```bash
   node server.js
   ```

3. **Abrir la Consola de Control en el navegador:**
   Ingresa a **[http://localhost:3000](http://localhost:3000)**

---

## 🧠 Rol de la IA como Modelo de Seguridad (`src/geminiSecurity.js`)

1. **Auditoría Cognitiva de Solicitudes:** Evalúa el propósito de cada reserva buscando riesgos físicos (ej. sobrecarga eléctrica, equipos peligrosos, mal uso de laboratorios) y bloquea preventivamente la asignación (`BLOQUEADO_POR_IA`) incluso si cumple horario y aforo.
2. **Motor de Continuidad y Reubicación Segura:** Cuando un espacio está bloqueado por una incidencia crítica o conflicto de aforo/horario, recomienda automáticamente el espacio alternativo ideal del inventario real con un botón de reubicación en 1 clic.
3. **Resiliencia Zero-Trust (Fallback Controlado):** Si la red falla o no hay API Key configurada, el sistema continúa operando de forma segura respaldado por el motor determinista (`src/rules.js`).

---

## ⚖️ Reglas de Negocio Implementadas (`src/rules.js`)

Para el **Reto de Modificación en Vivo (15 puntos en < 3 minutos)**, todas las constantes están centralizadas en el objeto `RULES_CONFIG` dentro de `src/rules.js`:

* **RN-01 (Seguridad Operativa y Cruce de Incidencias):** Prohibido asignar espacios en `MANTENIMIENTO`, `BLOQUEADO_SEGURIDAD` o con incidencias abiertas de severidad `CRITICA`.
* **RN-02 (Seguridad de Aforo y Uso Eficiente):** Prohibido superar el aforo máximo (`MAX_CAPACITY_PERCENTAGE = 100%`) o subutilizar aulas grandes con menos del `MIN_OCCUPANCY_PERCENTAGE = 20%`.
* **RN-03 (Integridad Horaria y Cero Solapamiento):** Validación matemática de colisión de rangos horarios $[inicio_A < fin_B \land fin_A > inicio_B]$, horario del campus (`06:00` a `22:00`) y duración permitida (`30` a `240` min).
* **Sanitización Automática de Casos Borde:** Filtra y aísla en cuarentena registros corruptos del dataset de origen sin interrumpir la aplicación.
