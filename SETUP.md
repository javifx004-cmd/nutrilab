# Poner NutriLab en marcha como app de pago

Con esto, otros nutricionistas pueden registrarse en NutriLab, probarla **14 días gratis** y después pagar una
**suscripción mensual** con tarjeta, Apple Pay, Google Pay o PayPal. Cada uno guarda sus clientes, mediciones,
fotos y dietas en su cuenta, separados del resto, y los tiene en todos sus dispositivos.

Todo se hace desde el navegador; no hace falta instalar nada. Calcula una hora la primera vez.
Hazlo primero en **modo de prueba de Stripe** (sin cobros reales) y, cuando todo funcione, pasa a real (paso 7).

---

## 1. Supabase: cuentas y base de datos

1. Crea una cuenta en <https://supabase.com> y pulsa **New project**.
   - Nombre: `nutrilab`. Región: **Frankfurt (eu-central-1)** o **Paris** (los datos de salud deben quedarse en la UE).
   - Guarda la contraseña de la base de datos en un sitio seguro.
2. Menú **SQL Editor** → **New query** → pega el contenido de
   [`supabase/migrations/20261017000000_nutrilab.sql`](supabase/migrations/20261017000000_nutrilab.sql) → **Run**.
   Crea las tablas, las reglas de seguridad, la prueba de 14 días y el almacén de fotos.
3. Menú **Authentication → URL Configuration**:
   - **Site URL**: `https://javifx004-cmd.github.io/nutrilab/`
   - **Redirect URLs**: añade la misma dirección.
4. Menú **Authentication → Sign In / Providers → Email**: deja activado **Confirm email**.
   (Opcional: en **Emails** puedes traducir al español los correos de confirmación y de recuperar contraseña.)
5. Menú **Project Settings → API Keys**: copia la **Project URL** y la clave **anon / publishable** y ponlas en
   [`config.js`](config.js) (`supabaseUrl` y `supabaseAnonKey`). Esa clave es pública: está pensada para ir en la web.
   **Nunca** pongas en la web la clave `service_role` / `secret`.

## 1 bis. Tu cuenta de administrador (gratis)

1. En **SQL Editor** ejecuta también, en este orden,
   [`supabase/migrations/20261018000000_admin.sql`](supabase/migrations/20261018000000_admin.sql) y
   [`supabase/migrations/20261019000000_portal.sql`](supabase/migrations/20261019000000_portal.sql)
   (este último activa los enlaces para que los clientes vean su dieta).
2. Cuando la app esté publicada (paso 5), **regístrate en ella con tu email** como cualquier usuario.
3. En **SQL Editor** ejecuta, con tu email:

   ```sql
   update public.profiles set is_admin = true where email = 'TU_EMAIL';
   ```

Tu cuenta queda **gratis para siempre** y en Ajustes te aparece el **Panel de administración**: nutricionistas
registrados, estado de cada suscripción, ingresos estimados al mes, y la opción de ver los datos de uno de ellos en
**solo lectura** (por ejemplo, para darle soporte). Cada vez que entras en los datos de alguien tienes que escribir el
motivo; queda registrado y esa persona lo ve en sus Ajustes. Desde la app nadie puede hacerse administrador.

## 2. Stripe: el cobro

1. Crea una cuenta en <https://dashboard.stripe.com/register> (deja activado **Modo de prueba**).
2. **Catálogo de productos → Añadir producto**: nombre `NutriLab`, precio **49,99 €**, **Recurrente · Mensual**
   (o el precio que quieras; cámbialo también en `config.js` → `price`). Guarda y copia el **ID del precio** (`price_…`).
3. **Configuración → Métodos de pago**: activa **Tarjetas**, **Apple Pay**, **Google Pay** y **PayPal**
   (PayPal aparece en el pago si tu cuenta lo admite para suscripciones; Stripe te guía para conectarlo).
4. **Configuración → Facturación → Portal de clientes**: actívalo y permite **cancelar la suscripción**,
   **actualizar la forma de pago** y **ver facturas**.
5. **Desarrolladores → Claves de API**: copia la **clave secreta** (`sk_test_…`).

## 3. Las funciones del servidor (en Supabase)

En Supabase, menú **Edge Functions → Deploy a new function → Via Editor**. Crea estas tres, pegando cada archivo:

| Nombre de la función | Archivo a pegar | «Verify JWT» |
|---|---|---|
| `create-checkout` | [`supabase/functions/create-checkout/index.ts`](supabase/functions/create-checkout/index.ts) | activado |
| `billing-portal` | [`supabase/functions/billing-portal/index.ts`](supabase/functions/billing-portal/index.ts) | activado |
| `stripe-webhook` | [`supabase/functions/stripe-webhook/index.ts`](supabase/functions/stripe-webhook/index.ts) | **desactivado** |

`stripe-webhook` debe tener **Verify JWT desactivado** (en los ajustes de la función): quien la llama es Stripe,
y la seguridad la da la firma de Stripe.

## 4. Conectar Stripe con Supabase

1. En Stripe, **Desarrolladores → Webhooks → Añadir destino**:
   - URL: `https://<tu-proyecto>.supabase.co/functions/v1/stripe-webhook`
   - Eventos: `checkout.session.completed`, `customer.subscription.created`, `customer.subscription.updated`,
     `customer.subscription.deleted`, `customer.subscription.paused`, `customer.subscription.resumed`.
   - Guarda y copia el **secreto de firma** (`whsec_…`).
2. En Supabase, **Edge Functions → Secrets**, añade:

| Nombre | Valor |
|---|---|
| `STRIPE_SECRET_KEY` | `sk_test_…` (paso 2.5) |
| `STRIPE_PRICE_ID` | `price_…` (paso 2.2) |
| `STRIPE_WEBHOOK_SECRET` | `whsec_…` (paso 4.1) |
| `APP_URL` | `https://javifx004-cmd.github.io/nutrilab/` |

## 5. Publicar la app

Sube los cambios de `config.js` y activa GitHub Pages en el repositorio `nutrilab`
(Settings → Pages → Deploy from a branch → `main`, `/ (root)`).

## 6. Probar todo

1. Abre la app, crea una cuenta con tu email y confírmala desde el correo.
2. Ajustes → **Suscribirme** → paga con la tarjeta de prueba `4242 4242 4242 4242`, cualquier fecha futura y CVC.
3. Al volver, Ajustes debe mostrar **Suscripción activa**. En Stripe verás la suscripción y en Supabase
   (**Table Editor → profiles**) el estado `active`.
4. **Gestionar suscripción** → cancela: al final del periodo la cuenta pasará a la pantalla de pago.

## 7. Pasar a cobros reales

1. En Stripe, completa **Activar cuenta** (datos tuyos o de tu empresa y la cuenta bancaria donde cobrarás).
2. Desactiva el modo de prueba y repite en modo real: producto y precio (paso 2.2), portal (2.4), webhook (4.1).
3. Cambia en Supabase los secretos `STRIPE_SECRET_KEY`, `STRIPE_PRICE_ID` y `STRIPE_WEBHOOK_SECRET` por los reales.

## Antes de vender: temas legales

NutriLab guarda **datos de salud** de los clientes de cada nutricionista (categoría especial del RGPD).
Antes de abrirla al público, consulta con un asesor o abogado y prepara al menos:

- **Condiciones del servicio** y **política de privacidad** (pon los enlaces en `config.js`: `termsUrl`, `privacyUrl`).
- Un **contrato de encargado del tratamiento** con cada nutricionista: ellos son responsables de los datos de sus
  clientes y tú los alojas. Indica en él y en las condiciones que el **soporte puede acceder en solo lectura**
  a sus datos cuando haga falta, que cada acceso queda registrado y que ellos pueden verlo. Supabase y Stripe ofrecen sus propios contratos (DPA) para firmar desde sus paneles.
- **Facturación e IVA**: Stripe puede emitir facturas automáticamente (Facturación → Facturas) y calcular el IVA
  con Stripe Tax; confirma con tu gestor cómo declararlo.
- **Borrar una cuenta** cuando alguien lo pida: Supabase → Authentication → Users → eliminar usuario
  (se borran también su perfil, sus datos y, desde Storage, sus fotos en `photos/<id>`).

## Cómo funciona

- **Acceso desde cualquier dispositivo**: tú y cada nutricionista entráis con email y contraseña en el móvil, la
  tablet o el PC (navegador o app instalada) y veis los mismos datos.
- **Enlace del cliente**: en la ficha de cada cliente, «Crear enlace» genera una dirección privada (imposible de
  adivinar) que se envía por WhatsApp. El cliente ve su dieta activa, su progreso de peso y su próxima revisión,
  sin registrarse y sin poder modificar nada; nunca ve notas privadas, fotos ni otros clientes. El nutricionista
  ve cuándo lo abrió por última vez y puede anularlo cuando quiera. Si el nutricionista no tiene la suscripción al
  día, el enlace se pausa.

- **Prueba gratis**: al registrarse, la base de datos da 14 días de acceso (`trial_ends_at`).
- **Acceso**: suscripción activa, o 7 días de margen si falla un cobro mientras Stripe reintenta, o prueba vigente.
  Lo comprueba la propia base de datos: sin acceso no se puede guardar nada nuevo, aunque alguien manipule la app.
  Los datos se pueden seguir viendo y exportando.
- **Datos separados**: cada nutricionista solo puede leer y escribir su propia fila y su carpeta de fotos.
- **Sin conexión**: la app trabaja con la copia del dispositivo y sincroniza al volver la red.
- **IA**: cada nutricionista usa su propia clave de Claude (Ajustes → Inteligencia artificial).
