# NutriLab · by Javier Carbonell

App web instalable (PWA) para nutricionistas, **by Javier Carbonell**.

## Qué hace

- **Clientes**: ficha completa (sexo, edad, altura, actividad, objetivo, peso objetivo, alergias e intolerancias,
  gustos, preferencias, contacto). Botones de WhatsApp, llamada y email. Próxima revisión y estado (activo, en pausa, alta).
- **Calorías y macros automáticos**: metabolismo basal (Mifflin-St Jeor) × actividad, ajustado al objetivo; proteína
  por kg de peso y grasa en % de las calorías. Se pueden fijar a mano.
- **Progreso**: peso, % de grasa y perímetros (cintura, cadera, pecho, brazo, muslo) con gráficas, línea de objetivo,
  historial y fotos «antes y ahora».
- **Dietas manuales**: por días y comidas, con una base de más de 150 alimentos (valores por 100 g) y los tuyos propios.
  Totales de kcal y macros frente al objetivo mientras editas.
- **Dietas con IA (Claude)**: genera un plan de 1 a 7 días con los datos del cliente, respetando alergias y gustos,
  o pide cambios sobre una dieta existente. Necesita una clave de API de Anthropic (Ajustes → Inteligencia artificial).
- **Entrega al cliente**: PDF con tu marca, o texto por WhatsApp.
- **App de pago para nutricionistas** (opcional): cuentas con email, 14 días de prueba y suscripción mensual con Stripe
  (tarjeta, Apple Pay, Google Pay o PayPal). Cada nutricionista guarda sus clientes, mediciones, fotos y dietas en la
  nube (Supabase, en la UE), separados del resto y en todos sus dispositivos. Puesta en marcha: [SETUP.md](SETUP.md).
- Sin configurar la nube funciona en un solo dispositivo, con sincronización opcional por gist de GitHub y copia por archivo.
- Funciona sin conexión (salvo la IA y la sincronización). Tema claro, oscuro o automático.
- Diseño: tipografía Plus Jakarta Sans (licencia OFL, en `vendor/fonts`), icono propio (matraz con hoja), modo claro y oscuro.

## Instalar

Publica la carpeta con GitHub Pages (Settings → Pages → Deploy from a branch → `main`, `/ (root)`) y abre el enlace en
el móvil: iPhone → Safari → Compartir → «Añadir a pantalla de inicio»; Android → Chrome → ⋮ → «Instalar aplicación».

## Desarrollo

Sin compilación: `python3 -m http.server` y abre `http://localhost:8000`.
`vendor/anthropic-sdk-0.131.0.mjs` es el SDK oficial `@anthropic-ai/sdk` 0.131.0 empaquetado para el navegador
(licencia en `vendor/anthropic-sdk-LICENSE`); solo se carga al usar la IA. `vendor/supabase-js-2.117.2.mjs` es
`@supabase/supabase-js` 2.117.2 (licencia en `vendor/supabase-js-LICENSE`); solo se carga si `config.js` tiene la nube.
