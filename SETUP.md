# Poner NutriLab en marcha como app de pago

Con esto, otros nutricionistas pueden registrarse en NutriLab, probarla **14 días gratis** y después pagar una
**cuota mensual** con **PayPal** (suscripción automática; PayPal también acepta tarjeta) o con **Bizum** (mes a mes).
Cada uno guarda sus clientes, mediciones,
fotos y dietas en su cuenta, separados del resto, y los tiene en todos sus dispositivos.

Todo se hace desde el navegador; no hace falta instalar nada. Calcula una hora la primera vez.
Hazlo primero en el **modo de pruebas (sandbox) de PayPal** (sin cobros reales) y, cuando todo funcione, pasa a real (paso 8).

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
   [`supabase/migrations/20261019000000_portal.sql`](supabase/migrations/20261019000000_portal.sql) y
   [`supabase/migrations/20261020000000_pagos.sql`](supabase/migrations/20261020000000_pagos.sql)
   (enlaces para que los clientes vean su dieta, y pagos con PayPal y Bizum).
2. Cuando la app esté publicada (paso 6), **regístrate en ella con tu email** como cualquier usuario.
3. En **SQL Editor** ejecuta, con tu email:

   ```sql
   update public.profiles set is_admin = true where email = 'TU_EMAIL';
   ```

Tu cuenta queda **gratis para siempre** y en Ajustes te aparece el **Panel de administración**: nutricionistas
registrados, estado de cada suscripción, ingresos estimados al mes, y la opción de ver los datos de uno de ellos en
**solo lectura** (por ejemplo, para darle soporte). Cada vez que entras en los datos de alguien tienes que escribir el
motivo; queda registrado y esa persona lo ve en sus Ajustes. Desde la app nadie puede hacerse administrador.

## 2. PayPal: la suscripción mensual

1. Necesitas una **cuenta PayPal Business** (<https://www.paypal.com/es/business>), gratuita.
2. Entra en <https://developer.paypal.com> con esa cuenta → **Apps & Credentials** → pestaña **Sandbox** →
   **Create App** (nombre `NutriLab`). Copia el **Client ID** y el **Secret**.
3. Crea el **plan de suscripción**: entra en <https://www.sandbox.paypal.com> con tu cuenta de pruebas *business*
   (Developer → Sandbox → Accounts) → **Pagar y cobrar → Suscripciones → Crear plan**:
   producto `NutriLab`, precio **49,99 EUR**, **cada mes**, sin cuota de alta y sin fin. Copia el **ID del plan** (`P-…`).
4. En tu app de Developer → **Add Webhook**:
   - URL: `https://<tu-proyecto>.supabase.co/functions/v1/paypal`
   - Eventos: `BILLING.SUBSCRIPTION.ACTIVATED`, `BILLING.SUBSCRIPTION.UPDATED`, `BILLING.SUBSCRIPTION.CANCELLED`,
     `BILLING.SUBSCRIPTION.SUSPENDED`, `BILLING.SUBSCRIPTION.EXPIRED`, `BILLING.SUBSCRIPTION.PAYMENT.FAILED` y
     `PAYMENT.SALE.COMPLETED`.
   - Copia el **Webhook ID**.

## 3. La función del servidor (en Supabase)

En Supabase, menú **Edge Functions → Deploy a new function → Via Editor**: nombre `paypal`, pega
[`supabase/functions/paypal/index.ts`](supabase/functions/paypal/index.ts) y, en sus ajustes, **desactiva «Verify JWT»**
(quien la llama también es PayPal; la función comprueba la firma de PayPal y la sesión de cada usuario).

En **Edge Functions → Secrets**, añade:

| Nombre | Valor |
|---|---|
| `PAYPAL_CLIENT_ID` | Client ID (paso 2.2) |
| `PAYPAL_SECRET` | Secret (paso 2.2) |
| `PAYPAL_PLAN_ID` | `P-…` (paso 2.3) |
| `PAYPAL_WEBHOOK_ID` | Webhook ID (paso 2.4) |
| `PAYPAL_ENV` | `sandbox` (en el paso 8 lo cambiarás a `live`) |
| `APP_URL` | `https://javifx004-cmd.github.io/nutrilab/` |

## 4. Bizum (mes a mes)

Bizum no permite cobros automáticos cada mes sin un TPV virtual del banco, así que funciona así:

1. El nutricionista pulsa **Bizum**, ve tu número, el importe (49,99 €) y el concepto (`NutriLab` + su email),
   envía el Bizum desde su banco y pulsa **«Ya lo he enviado»** (si quiere, te avisa también por WhatsApp).
2. Tú lo ves en **Ajustes → Panel de administración → Bizum por confirmar**. Comprueba en tu banco que ha llegado y
   pulsa **+1 mes**. Su acceso se alarga un mes desde hoy (o desde el final de lo que ya tuviera pagado).
3. Si alguien te envía un Bizum sin avisar, abre su ficha en el panel → **«He recibido su Bizum: +1 mes»**.

El importe de los avisos (49,99 €) está en `20261020000000_pagos.sql` (`4999` céntimos); si cambias el precio, cámbialo allí.

## 5. Datos en la app

En [`config.js`](config.js) rellena: `paypalClientId` (Client ID), `paypalPlanId` (`P-…`), `bizumPhone` (tu número de
Bizum) y `bizumName` (tu nombre como lo verán al enviar el Bizum). Si dejas vacío PayPal o Bizum, esa opción no aparece.

## 6. Publicar la app

Sube los cambios de `config.js` y activa GitHub Pages en el repositorio `nutrilab`
(Settings → Pages → Deploy from a branch → `main`, `/ (root)`).

## 7. Probar todo

1. Abre la app, crea una cuenta con tu email y confírmala desde el correo.
2. Ajustes → **PayPal o tarjeta** → entra con tu cuenta *personal* de pruebas (Developer → Sandbox → Accounts).
3. Al volver, Ajustes debe mostrar **Suscripción activa**. En Supabase (**Table Editor → profiles**) verás `active`.
4. **Cancelar suscripción**: mantiene el acceso hasta el final del mes pagado y después pasa a la pantalla de pago.
5. Con otra cuenta: **Bizum → Ya lo he enviado**. En tu panel aparece en «Bizum por confirmar» → **+1 mes**.

## 8. Pasar a cobros reales

1. En <https://developer.paypal.com>, pestaña **Live**: crea la app, el plan (en <https://www.paypal.com>) y el webhook
   igual que en el paso 2.
2. Cambia en Supabase los secretos `PAYPAL_CLIENT_ID`, `PAYPAL_SECRET`, `PAYPAL_PLAN_ID`, `PAYPAL_WEBHOOK_ID` y pon
   `PAYPAL_ENV` = `live`.
3. En `config.js` cambia `paypalClientId` y `paypalPlanId` por los reales y súbelo.

## Antes de vender: temas legales

NutriLab guarda **datos de salud** de los clientes de cada nutricionista (categoría especial del RGPD).
Antes de abrirla al público, consulta con un asesor o abogado y prepara al menos:

- **Condiciones del servicio** y **política de privacidad** (pon los enlaces en `config.js`: `termsUrl`, `privacyUrl`).
- Un **contrato de encargado del tratamiento** con cada nutricionista: ellos son responsables de los datos de sus
  clientes y tú los alojas. Indica en él y en las condiciones que el **soporte puede acceder en solo lectura**
  a sus datos cuando haga falta, que cada acceso queda registrado y que ellos pueden verlo. Supabase y PayPal ofrecen sus propios contratos (DPA).
- **Facturación e IVA**: ni PayPal ni Bizum emiten facturas por ti. Emite una factura por cada cuota (PayPal o Bizum)
  con tu programa de facturación y confirma con tu gestor cómo declararlo.
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
- **Acceso**: suscripción de PayPal activa (con 7 días de margen si falla un cobro), meses pagados con Bizum o prueba vigente.
  Lo comprueba la propia base de datos: sin acceso no se puede guardar nada nuevo, aunque alguien manipule la app.
  Los datos se pueden seguir viendo y exportando.
- **Datos separados**: cada nutricionista solo puede leer y escribir su propia fila y su carpeta de fotos.
- **Sin conexión**: la app trabaja con la copia del dispositivo y sincroniza al volver la red.
- **IA**: cada nutricionista usa su propia clave de Claude (Ajustes → Inteligencia artificial).
