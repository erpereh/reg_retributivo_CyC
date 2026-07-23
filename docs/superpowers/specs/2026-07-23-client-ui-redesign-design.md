# Rediseño profesional orientado al cliente

Fecha: 23 de julio de 2026  
Rama: `ui/retributivo-modern-redesign`

## Objetivo

Rediseñar toda la interfaz de Registro Retributivo para acercarla a la referencia aprobada: una aplicación empresarial limpia, moderna, fluida y fácil de usar por el cliente final.

El trabajo conservará la lógica de negocio, parsers, cálculos, almacenamiento local, exportación, privacidad y comportamiento del asistente. La aplicación no mostrará cuentas, perfiles, organizaciones, roles, empresas ficticias ni métricas de demostración. Todo elemento visible deberá responder a datos o acciones reales.

## Decisiones aprobadas

- Enfoque híbrido: mantener la lógica actual y reorganizar únicamente la experiencia de uso.
- Dashboard sin datos ficticios; cuando no haya análisis se mostrará un onboarding real.
- Tema automático según el sistema, con opciones manuales claro y oscuro.
- Búsqueda global real de personas, matrículas, conceptos, documentos e historial.
- Las diferencias no tendrán pantalla propia: serán filtros dentro de Personas y Conceptos.
- Documentos y fuentes estarán integrados en Inicio y en el detalle de Historial.
- Cuadre del registro incluirá las pestañas Cuadre, Normalizados y Variables.
- El Asistente conservará tres paneles.
- Sistema visual centralizado, no un simple cambio de CSS superficial.
- Acentos configurables: violeta predeterminado, azul, esmeralda, naranja y rosa.

## Principios de producto

1. **Datos reales antes que decoración.** No se mostrarán cifras, personas, actividad o gráficas de ejemplo.
2. **Una acción principal por contexto.** El cliente debe entender el siguiente paso sin leer documentación técnica.
3. **Navegación contenida.** Las funciones relacionadas se agruparán mediante pestañas internas.
4. **Lenguaje orientado al cliente.** Los términos técnicos se mantendrán solo cuando sean necesarios para la operativa.
5. **Privacidad verificable.** Se comunicarán garantías reales sin promesas genéricas.
6. **Movimiento funcional.** Las animaciones explicarán cambios de vista, progreso y apertura de paneles.
7. **Accesibilidad de base.** Contraste AA, teclado, foco visible, semántica y `prefers-reduced-motion`.
8. **No alterar el dominio.** Cambiar tema, filtros o navegación nunca recalculará el análisis.

## Alcance

### Incluido

- Nuevo sistema de tokens visuales.
- Modo sistema, claro y oscuro con persistencia local.
- Cinco colores de acento con persistencia local.
- Sidebar responsive y contraíble.
- Topbar con búsqueda global y acciones reales.
- Renovación de Inicio, Personas, Conceptos, Cuadre, Agrupaciones, Asistente, Historial y Ajustes.
- Estados vacíos, carga, progreso y error.
- Paneles laterales de detalle y modales compartidos.
- Pruebas unitarias, integración y Playwright.
- Capturas de todas las pantallas en claro y oscuro.
- Intento de despliegue mediante la configuración ya existente.

### Fuera de alcance

- Autenticación, cuentas o gestión de usuarios.
- Selector de empresa u organización.
- Datos demo dentro del producto.
- Nuevos cálculos salariales.
- Backend remoto o sincronización multiusuario.
- Cambios en las restricciones de privacidad de la IA.
- Conversión completa a rutas independientes.

## Arquitectura

Se mantendrán `AppStateProvider`, `AssistantProvider`, los servicios, parsers y repositorios existentes. La navegación seguirá usando `AppView` para conservar el análisis activo y reducir el riesgo de regresiones.

La nueva capa visual se dividirá en:

1. **Tema y tokens:** colores, superficies, tipografía, radios, sombras, foco, estados y movimiento.
2. **Shell:** sidebar, topbar, buscador global, navegación móvil y área principal.
3. **Primitivas compartidas:** botones, tarjetas, inputs, filtros, pestañas, tablas, drawers, modales, badges y estados.
4. **Vistas de dominio:** componentes que consumen modelos existentes mediante selectores puros y memorizados.

Los componentes visuales no accederán directamente a parsers ni a IndexedDB. Las reglas del dominio permanecerán fuera de las primitivas de UI.

## Sistema de tema

### Modos

- `system`, predeterminado: sigue `prefers-color-scheme` y reacciona a cambios del sistema.
- `light`: fuerza modo claro.
- `dark`: fuerza modo oscuro.

La preferencia se aplicará antes del primer render visible para evitar parpadeos. El modo oscuro tendrá superficies, bordes y estados diseñados expresamente; no será una inversión automática.

### Acentos

- Violeta, predeterminado.
- Azul.
- Esmeralda.
- Naranja.
- Rosa.

Cada acento definirá `primary`, `primary-hover`, `primary-soft`, `primary-contrast` y foco. Los colores semánticos de éxito, aviso y error conservarán su significado.

### Persistencia

Se guardarán localmente:

- modo elegido;
- acento;
- estado contraído del sidebar;
- preferencias visuales futuras que no afecten al análisis.

## Navegación general

### Sidebar

Secciones:

1. Inicio.
2. Personas.
3. Conceptos.
4. Cuadre del registro.
5. Agrupaciones.
6. Asistente.
7. Historial.
8. Ajustes.

El bloque que en la referencia corresponde al usuario o empresa se sustituirá por contexto real del análisis activo: fecha, archivos y estado. Cuando no haya análisis, mostrará un mensaje breve de entorno preparado.

En escritorio el sidebar podrá contraerse a iconos. En móvil se abrirá como drawer con backdrop. Mantendrá navegación con flechas, Home y End, roles accesibles y foco correcto.

### Topbar

Contendrá:

- botón de menú;
- buscador global;
- acceso rápido al tema;
- acceso al Asistente;
- exportación, solo cuando exista resultado;
- Nuevo análisis.

En móvil las acciones secundarias se compactarán sin ocultar la acción principal.

### Área principal

El contenido será fluido y aprovechará pantallas grandes, especialmente en tablas. Cada vista tendrá título, descripción breve, acciones relacionadas y estados claramente diferenciados.

## Búsqueda global

El buscador indexará en memoria únicamente información ya disponible:

- personas y matrículas;
- conceptos y códigos;
- documentos del análisis activo;
- análisis del historial.

Comportamiento:

- apertura mediante clic y `Ctrl/Cmd + K`;
- resultados agrupados por tipo;
- prioridad para coincidencias exactas de matrícula, nombre o código;
- navegación completa por teclado;
- al seleccionar, apertura de la vista y detalle correspondiente;
- estado vacío cuando no haya coincidencias;
- ninguna petición a servicios externos.

El índice se construirá con selectores memorizados para evitar bloqueos con conjuntos grandes.

## Inicio

### Sin análisis

Se mostrará un onboarding profesional de tres pasos:

1. Cargar recibos PDF.
2. Cargar el Registro Retributivo.
3. Validar y ejecutar el análisis.

La carga incluirá arrastrar y soltar, selección manual, lista de archivos, eliminación previa, validación de formato y errores accionables. No aparecerán métricas ni gráficas ficticias. Cuando haya históricos, se ofrecerá un acceso discreto.

### Procesando

Se mostrará la fase real de procesamiento. Solo habrá porcentaje cuando sea fiable; en caso contrario se usará progreso indeterminado. Los archivos válidos seguirán visibles si uno falla y se indicará cómo corregirlo.

### Con análisis activo

Se mostrarán datos calculados:

- personas procesadas;
- documentos importados;
- diferencia detectada;
- estado global;
- exclusiones aplicadas, cuando existan.

Los paneles visuales podrán mostrar distribución por estado, diferencias por bloque y principales incidencias. La evolución temporal solo aparecerá cuando existan análisis comparables suficientes.

También se incluirán archivos y fuentes, avisos, accesos a Personas, Conceptos y Cuadre, y un banner contextual para abrir el Asistente.

## Personas

La pantalla tendrá una tabla principal con búsqueda, ordenación y filtros rápidos:

- todas;
- cuadradas;
- revisar;
- diferencia;
- sin PDF;
- sin registro.

Las columnas esenciales serán persona o matrícula, contexto laboral relevante, total del registro, total del PDF, diferencia y estado.

Al seleccionar una fila se abrirá un drawer con:

- desglose de salario, complemento salarial y extrasalarial;
- importes brutos, justificados y ajustados;
- conceptos asociados;
- periodos y archivos fuente;
- explicación del estado;
- acciones para abrir Conceptos o consultar al Asistente.

En escritorio podrán fijarse columnas esenciales. En móvil se usará una representación compacta que evite una tabla horizontal inabarcable.

## Conceptos

La vista mostrará conceptos incluidos, justificados, ignorados, pendientes y sin mapear. Tendrá filtros por bloque, estado, origen, impacto económico y existencia de diferencia.

Cada fila mostrará nombre, bloque, código, personas afectadas, importe detectado, diferencia y estado.

La edición de mapeos se abrirá desde la propia vista en modal o drawer, reutilizando el editor y validaciones actuales. Se indicará claramente si el cambio afecta a futuros análisis o requiere recalcular el activo.

## Cuadre del registro

La pantalla tendrá tres pestañas internas:

### Cuadre

Validación del total del periodo frente al desglose del Excel, con resumen, filtros, tabla y detalle.

### Normalizados

Comparación entre normalizado más variables, normalizado, periodo completo y PDF real. Las posibles justificaciones se presentarán como datos existentes, sin inventar conclusiones.

### Variables

Revisión de importes variables y conceptos que explican diferencias entre valores normalizados y reales. No añadirá fórmulas nuevas.

Las tres pestañas compartirán patrones de tabla, filtros, exportación y drawer de detalle. Cambiar de pestaña no perderá el análisis activo.

## Agrupaciones

Mantendrá los tipos de agrupación reales y ofrecerá:

- selector de tipo;
- resumen de grupos correctos y con incidencias;
- filtros por bloque, métrica, segmento y estado;
- tabla con Excel, recálculo, PDF, diferencia y personas afectadas.

El detalle explicará el cálculo con los datos disponibles e incluirá personas, coincidencias y exclusiones relevantes.

## Historial

Mostrará los análisis almacenados localmente con fecha, estado, personas, documentos y métricas principales. El detalle incluirá archivos y avisos.

Las acciones de abrir, exportar o eliminar se mostrarán solo si ya están soportadas. La eliminación requerirá confirmación. Se distinguirá el análisis activo de los históricos de solo lectura.

## Asistente

Mantendrá tres paneles reales:

1. conversaciones;
2. chat;
3. contexto y fuentes.

En escritorio aparecerán simultáneamente. En tablet y móvil los paneles laterales serán drawers y devolverán el foco al disparador al cerrarse.

La interfaz incluirá:

- estados vacíos sin conversaciones ficticias;
- fuentes visibles y accionables;
- navegación a Personas, Conceptos o Ajustes;
- estado del análisis en la cabecera;
- entrada accesible y estable;
- tablas compactas dentro de respuestas;
- errores recuperables y reintento cuando proceda.

No se modificarán las restricciones actuales: la IA seguirá sin recibir documentos completos ni datos bancarios.

## Ajustes

Secciones:

1. General.
2. Apariencia.
3. Exclusiones.
4. Conceptos.
5. IA.
6. Privacidad.

En escritorio se usará navegación interna lateral; en móvil, un selector compacto.

Apariencia permitirá elegir sistema, claro u oscuro, seleccionar uno de los cinco acentos, ver el cambio inmediatamente y restablecer los valores predeterminados.

Los textos técnicos se reescribirán en lenguaje operativo sin cambiar validaciones ni comportamiento.

## Componentes compartidos

Se crearán o consolidarán unidades con una responsabilidad clara:

- `ThemeProvider` y `useTheme`;
- `GlobalSearch`;
- `AppSidebar`;
- `AppTopbar`;
- `PageHeader`;
- `MetricCard`;
- `DataTableShell`;
- `FilterBar`;
- `DetailDrawer`;
- `Dialog`;
- `EmptyState`;
- `ProcessingState`;
- `ErrorState`;
- `ThemeSelector`;
- `AccentSelector`.

Las primitivas serán reutilizables y no contendrán reglas salariales.

## Flujo de datos

1. `AppStateProvider` hidrata ajustes, historial y análisis activo.
2. `ThemeProvider` resuelve el tema efectivo.
3. Las vistas construyen modelos de presentación mediante selectores puros.
4. Tablas y buscadores aplican filtros y ordenación sobre esos modelos.
5. La búsqueda global combina índices del análisis activo y del historial.
6. Las acciones actualizan `AppView` y, cuando corresponda, una intención de detalle.
7. Drawers y modales consumen esa intención.
8. Procesamiento, exportación, almacenamiento y asistente siguen usando los servicios existentes.

El estado visual transitorio no se guardará dentro del resultado del análisis.

## Estados y errores

Cada módulo distinguirá:

- hidratando;
- sin datos;
- listo;
- procesando;
- error recuperable;
- error bloqueante.

Los mensajes explicarán qué ha ocurrido, qué información sigue siendo válida y qué acción puede realizar el cliente. Los errores bloqueantes permanecerán en contexto; los toasts se reservarán para confirmaciones breves. Las operaciones destructivas exigirán confirmación.

## Animación y rendimiento

Se usarán transiciones cortas para navegación, indicador activo, drawers, modales, menús, tarjetas y progreso.

No se animarán individualmente cientos de filas. Se evitarán blur intensivo, sombras costosas y animaciones de layout en tablas grandes. `prefers-reduced-motion` eliminará desplazamientos y springs no esenciales.

El índice de búsqueda y los modelos derivados se memorizarán. Cambiar tema, filtro o vista no ejecutará de nuevo el motor del análisis.

## Responsive

- Móvil: sidebar y paneles como drawers, acciones compactas, tablas simplificadas.
- Tablet: una o dos columnas controladas.
- Portátil: sidebar contraíble y tablas completas.
- Escritorio ancho: uso eficiente de todo el espacio disponible.

Los modales podrán ocupar toda la pantalla en móvil. Las acciones táctiles tendrán un tamaño objetivo mínimo de 44 px.

## Accesibilidad

- Landmarks semánticos.
- Roles correctos para pestañas y paneles.
- Sidebar navegable con flechas, Home y End.
- Restauración de foco al cerrar overlays.
- Foco visible con contraste suficiente.
- Etiquetas para acciones de icono.
- Progreso anunciado mediante `aria-live` cuando corresponda.
- Contraste AA en claro y oscuro.
- Estados comunicados mediante texto o icono además de color.

## Pruebas

### Unitarias e integración

- resolución del tema y cambios del sistema;
- persistencia de modo, acento y sidebar;
- índice y prioridad de búsqueda;
- filtros de Personas y Conceptos;
- pestañas de Cuadre;
- navegación a detalles;
- estados vacíos y de error;
- compatibilidad con providers actuales.

### E2E

- navegación por todas las secciones;
- sidebar contraído y móvil;
- búsqueda global;
- sistema, claro y oscuro;
- los cinco acentos;
- flujo sin análisis;
- flujo con fixture real;
- filtros de diferencias;
- Cuadre, Normalizados y Variables;
- Asistente responsive y fuentes;
- exportación;
- nuevo análisis;
- persistencia tras recarga.

La suite existente deberá seguir verde. Solo se modificarán pruebas que dependan legítimamente de textos o estructura visual, conservando su intención funcional y accesible.

## Capturas y revisión visual

Playwright generará capturas de:

- Inicio vacío y con análisis;
- Personas;
- Conceptos;
- Cuadre;
- Normalizados;
- Variables;
- Agrupaciones;
- Asistente;
- Historial;
- Ajustes;
- navegación móvil.

Las pantallas principales se capturarán en claro y oscuro con violeta. Apariencia mostrará también los acentos disponibles. La revisión comprobará solapamientos, recortes, tablas, contraste, estados vacíos y coherencia.

## Entrega y despliegue

El trabajo continuará en `ui/retributivo-modern-redesign`, sincronizada con el estado actual de `main`. Los commits serán revisables y la rama quedará preparada para integración.

Antes de considerar finalizada la implementación se ejecutarán la suite completa, el build de producción, Playwright en Chromium y la revisión de capturas.

Después se inspeccionará el despliegue existente. Solo se comunicará una URL pública cuando haya sido verificada. Si no existe proveedor conectado o faltan credenciales, se dejará el proyecto listo y se documentará exactamente el bloqueo.

## Criterios de aceptación

1. Todas las secciones aprobadas usan datos reales.
2. No aparecen perfiles, organizaciones ni datos demo.
3. Sistema, claro y oscuro funcionan y persisten.
4. Los cinco acentos funcionan en ambos temas.
5. La búsqueda global abre resultados reales.
6. Personas y Conceptos integran las diferencias mediante filtros.
7. Cuadre contiene Cuadre, Normalizados y Variables.
8. El Asistente conserva tres paneles y funciona en móvil.
9. Inicio integra carga, documentos y estados del análisis.
10. La lógica, almacenamiento y privacidad permanecen intactos.
11. Navegación por teclado y contraste cumplen los requisitos.
12. Tests, build y E2E terminan correctamente.
13. Existen capturas revisadas de todas las pantallas requeridas.
14. El despliegue público está verificado o su bloqueo queda documentado con precisión.
