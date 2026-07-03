# Comparativa Nominas vs Registro Retributivo

Aplicacion web interna para comparar nominas PDF contra un Registro Retributivo Excel y generar una comparativa visual exportable a Excel.

## Requisitos

- Node.js moderno.
- `pnpm` recomendado. En Windows, si PowerShell bloquea shims, usa `cmd /c pnpm ...`.

## Instalacion y ejecucion

```bash
pnpm install
pnpm dev
```

La aplicacion queda disponible normalmente en `http://localhost:3000`.

Los scripts estandar tambien funcionan:

```bash
npm run dev
npm run build
```

## Configuracion de Gemini

Copia `.env.example` a `.env.local` si quieres activar observaciones con Gemini:

```bash
GEMINI_API_KEY=
GEMINI_MODEL=gemini-3.1-flash-lite
GEMINI_REVIEW_MODEL=gemini-3.1-pro-preview
ENABLE_AI_REVIEW=true
```

El modelo por defecto es `gemini-3.1-flash-lite`. `gemini-3.1-pro-preview` queda como modelo opcional para revision avanzada y no es necesario para que la app funcione.

Si falta `GEMINI_API_KEY` o `ENABLE_AI_REVIEW=false`, las observaciones y acciones recomendadas se generan con reglas deterministas.

## Uso

1. Selecciona multiples PDFs de nomina o una carpeta de PDFs cuando el navegador lo permita.
2. Selecciona el Excel del Registro Retributivo.
3. Ajusta la tolerancia salarial, por defecto `1 EUR`.
4. Pulsa `Analizar`.
5. Revisa KPIs, graficos, filtros, `Campos mal`, `Diferencia salarial` y errores.
6. Pulsa `Exportar Excel` para descargar el informe final.

## Calculo salarial

El calculo es determinista. Gemini nunca recalcula importes.

- `Total deberia`: suma de `Salario + C. Salarial + Extrasalarial` dentro del bloque `TOTAL RETRIBUCIONES NORMALIZADAS + VARIABLES` de la hoja `Empleados`.
- `Total esta`: suma de `TOTAL DEVENGADO` de los PDFs aportados por persona.
- `Diferencia`: `Total esta - Total deberia`.
- Estado:
  - `OK`: diferencia absoluta menor o igual a la tolerancia.
  - `Revisar`: diferencia absoluta mayor que tolerancia y hasta `50 EUR`.
  - `Incidencia`: diferencia absoluta superior a `50 EUR`.

## Cruce y comparacion

El cruce intenta:

1. NIF, si existe en el Registro.
2. Matricula o `ID RH`.
3. Nombre normalizado + centro, como fallback de baja confianza.

Se normalizan mayusculas, tildes, espacios, fechas y variantes comunes como `1ª` frente a `Primera`.

## Privacidad

La aplicacion ignora datos bancarios:

- IBAN.
- Cuentas.
- Datos de banco.
- Cuenta beneficiaria.
- Texto bruto completo del PDF.

Gemini, si esta activo, solo recibe datos minimos de la incidencia: campo, valor esperado, valor encontrado, contexto de periodo, diferencia y severidad base.

## Adaptar el parser si cambia el PDF

El parser principal esta en `src/lib/parsers/payrollPdfParser.ts`.

Para un nuevo formato:

1. Guarda un PDF representativo en `fuentes/`.
2. Ejecuta tests o crea un fixture especifico.
3. Ajusta regex de cabecera, periodo, conceptos y totales.
4. Mantén la regla de no guardar datos bancarios.

## Adaptar el Registro

El parser esta en `src/lib/parsers/registroRetributivoParser.ts`.

El formato heredado actual usa:

- Hoja principal: `Empleados`.
- Cabeceras agrupadas visuales: fila 11.
- Subcabeceras visuales: fila 12.
- Datos desde fila 13.
- Salario esperado: columnas `F`, `G`, `H`.
- Grupo profesional/categoria: `AW`, `AX`.
- Grupo de cotizacion: `BV`, `BW`.
- Centro de trabajo: `CE`, `CF`.

Si cambian nombres de columnas, amplia las reglas de normalizacion del parser.

## Verificacion

```bash
pnpm test
pnpm build
```

Los tests usan los fixtures reales de `fuentes/` para validar importes espanoles, fechas, Registro, PDF, comparacion y exportacion Excel.
