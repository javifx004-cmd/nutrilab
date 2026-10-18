// Configuración de NutriLab en la nube (Supabase + PayPal + Bizum). Déjalo vacío para usar la app solo en este dispositivo.
// Ver SETUP.md para conseguir estos valores. Todos son públicos: están pensados para ir en la web.
window.NUTRILAB_CONFIG = {
  supabaseUrl: '',              // p. ej. https://abcd1234.supabase.co
  supabaseAnonKey: '',          // Project Settings → API Keys → anon / publishable
  price: '49,99 € al mes',      // texto que se muestra en la app (el precio real de PayPal se define en el plan)
  priceAmount: 49.99,           // para calcular los ingresos en el panel de administración
  trialDays: 14,                // días de prueba gratis (igual que en la base de datos)
  paypalClientId: '',           // PayPal Developer → Apps & Credentials → Client ID (vacío = sin PayPal)
  paypalPlanId: '',             // ID del plan de suscripción mensual (P-…)
  paypalMe: 'jcfx1',            // tu usuario de PayPal.me: pago mes a mes que confirmas tú (se usa si no hay paypalClientId)
  bizumPhone: '685 426 211',  // tu número de Bizum, p. ej. '600 123 456' (vacío = sin Bizum)
  bizumName: '',                // nombre que verá al enviar el Bizum, p. ej. 'Javier C.'
  bizumWhatsApp: true,          // al avisar del Bizum, abrir WhatsApp para avisarte a ese mismo número
  termsUrl: '',                 // enlace a tus condiciones del servicio
  privacyUrl: '',               // enlace a tu política de privacidad
};
