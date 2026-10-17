// Configuración de NutriLab en la nube (Supabase + Stripe). Déjalo vacío para usar la app solo en este dispositivo.
// Ver SETUP.md para conseguir estos valores. La clave «anon / publishable» es pública: está pensada para ir en la web.
window.NUTRILAB_CONFIG = {
  supabaseUrl: '',              // p. ej. https://abcd1234.supabase.co
  supabaseAnonKey: '',          // Project Settings → API Keys → anon / publishable
  price: '19,99 € al mes',      // texto que se muestra en la app (el precio real se define en Stripe)
  trialDays: 14,                // días de prueba gratis (igual que en la base de datos)
  termsUrl: '',                 // enlace a tus condiciones del servicio
  privacyUrl: '',               // enlace a tu política de privacidad
};
