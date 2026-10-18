/*
 * Nube de NutriLab (Supabase): cuentas de nutricionistas, suscripción, datos y fotos.
 * Solo se usa si config.js tiene la URL y la clave pública del proyecto.
 */
import { createClient } from './vendor/supabase-js-2.117.2.mjs';

let sb = null;

export function init(cfg) {
  sb = createClient(cfg.supabaseUrl, cfg.supabaseAnonKey, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, storageKey: 'nutrilab-auth' },
  });
}

const AUTH_ERRORS = [
  [/invalid login credentials/i, 'Email o contraseña incorrectos'],
  [/email not confirmed/i, 'Confirma tu email: te hemos enviado un enlace'],
  [/already registered|already been registered/i, 'Ya existe una cuenta con ese email'],
  [/password should be at least/i, 'La contraseña debe tener al menos 8 caracteres'],
  [/rate limit|too many/i, 'Demasiados intentos. Espera un momento'],
  [/fetch|network/i, 'Sin conexión. Revisa tu internet'],
];
const authMsg = (e) => AUTH_ERRORS.find(([re]) => re.test(e?.message || ''))?.[1] || e?.message || 'Error de acceso';

export async function currentUser() {
  const { data } = await sb.auth.getSession();
  return data.session?.user || null;
}
export const onAuthChange = (cb) => sb.auth.onAuthStateChange((event, session) => cb(event, session?.user || null));

export async function signIn(email, password) {
  const { data, error } = await sb.auth.signInWithPassword({ email, password });
  if (error) throw new Error(authMsg(error));
  return data.user;
}
export async function signUp(name, email, password) {
  const { data, error } = await sb.auth.signUp({
    email, password,
    options: { data: { full_name: name }, emailRedirectTo: location.origin + location.pathname },
  });
  if (error) throw new Error(authMsg(error));
  return { user: data.user, needsConfirm: !data.session };
}
export async function resetPassword(email) {
  const { error } = await sb.auth.resetPasswordForEmail(email, { redirectTo: location.origin + location.pathname });
  if (error) throw new Error(authMsg(error));
}
export async function updatePassword(password) {
  const { error } = await sb.auth.updateUser({ password });
  if (error) throw new Error(authMsg(error));
}
export const signOut = () => sb.auth.signOut();

export async function profile(uid) {
  const { data, error } = await sb.from('profiles').select('*').eq('id', uid).single();
  if (error) throw new Error('No se pudo leer tu cuenta');
  return data;
}

// Acceso: suscripción activa, unos días de margen si falla un cobro, meses pagados con Bizum o prueba gratuita vigente (igual que en la base de datos).
export function hasAccess(p) {
  if (!p) return false;
  if (p.is_admin) return true; // la cuenta del administrador es gratuita
  const now = Date.now();
  if (['active', 'trialing'].includes(p.subscription_status)) return true;
  if (p.subscription_status === 'past_due' && (!p.current_period_end || Date.parse(p.current_period_end) > now - 7 * 864e5)) return true;
  if (p.paid_until && Date.parse(p.paid_until) > now) return true;
  return !!p.trial_ends_at && Date.parse(p.trial_ends_at) > now;
}

// Solo la fecha de la última modificación: así no se descarga todo si nada ha cambiado.
export async function stamp(uid) {
  const { data, error } = await sb.from('workspaces').select('updated_at').eq('owner', uid).maybeSingle();
  if (error) throw new Error('No se pudo conectar con tu cuenta');
  return data?.updated_at || null;
}
export async function pull(uid) {
  const { data, error } = await sb.from('workspaces').select('data, updated_at').eq('owner', uid).maybeSingle();
  if (error) throw new Error('No se pudieron descargar tus datos');
  return data;
}
export async function push(uid, doc) {
  const { data, error } = await sb.from('workspaces').upsert({ owner: uid, data: doc }).select('updated_at').single();
  if (error) throw new Error(error.code === '42501' ? 'Tu suscripción no está activa: los cambios solo se guardan en este dispositivo' : 'No se pudieron guardar tus datos en la nube');
  return data.updated_at;
}

export async function uploadPhoto(uid, id, blob, type) {
  const { error } = await sb.storage.from('photos').upload(`${uid}/${id}`, blob, { contentType: type, upsert: true });
  if (error) throw new Error('No se pudo subir una foto');
}
export async function downloadPhoto(uid, id) {
  const { data, error } = await sb.storage.from('photos').download(`${uid}/${id}`);
  if (error) throw new Error('La foto aún no está en la nube');
  return data;
}
export async function removePhotos(uid, ids) {
  if (ids.length) await sb.storage.from('photos').remove(ids.map((id) => `${uid}/${id}`));
}

// Funciones del servidor: create-checkout (pagar) y billing-portal (gestionar suscripción).
export async function callFunction(name, body) {
  const { data, error } = await sb.functions.invoke(name, { method: 'POST', ...(body ? { body } : {}) });
  if (error) {
    let msg = 'No se pudo conectar con el servidor';
    try { msg = (await error.context.json()).error || msg; } catch { /* sin cuerpo */ }
    throw new Error(msg);
  }
  return data;
}

// ---------------------------------------------------------------- administración
// Solo funcionan para la cuenta de administrador (lo comprueba la base de datos).
export async function adminList() {
  const { data, error } = await sb.rpc('admin_list');
  if (error) throw new Error(error.code === '42501' ? 'Solo para administradores' : 'No se pudo cargar el panel');
  return data || [];
}
// Ver los datos de un nutricionista en solo lectura: exige un motivo y queda registrado.
export async function adminView(target, reason) {
  const { data, error } = await sb.rpc('admin_view_workspace', { target, reason });
  if (error) throw new Error(error.message || 'No se pudo abrir');
  return data || {};
}
// Accesos del soporte a la cuenta de un nutricionista (los ve él mismo).
export async function accessLog(uid) {
  const { data, error } = await sb.from('admin_access_log').select('reason, at').eq('target_id', uid).order('at', { ascending: false }).limit(20);
  return error ? [] : data || [];
}

// ---------------------------------------------------------------- pagos mes a mes con Bizum o PayPal.me (se confirman a mano)
// Aviso del nutricionista: «ya he pagado». Solo puede tener uno pendiente.
export async function pendingPayment(uid) {
  const { data } = await sb.from('payment_requests').select('id, method, created_at').eq('user_id', uid).eq('status', 'pending').order('created_at', { ascending: false }).limit(1);
  return data?.[0] || null;
}
export async function notifyPayment(uid, method) {
  const { error } = await sb.from('payment_requests').insert({ user_id: uid, method });
  if (error) throw new Error(error.code === '23505' ? 'Ya nos avisaste de un pago. Lo confirmaremos en breve.' : 'No se pudo enviar el aviso. Inténtalo de nuevo.');
}
export async function adminPendingPayments() {
  const { data, error } = await sb.from('payment_requests').select('id, user_id, method, amount_cents, created_at').eq('status', 'pending').order('created_at');
  return error ? [] : data || [];
}
// Suma 1 mes al nutricionista (y marca su aviso como confirmado si lo había). Devuelve la nueva fecha.
export async function adminConfirmPayment(user, requestId = null, method = 'bizum') {
  const { data, error } = await sb.rpc('admin_confirm_payment', { p_user: user, p_request: requestId, p_months: 1, p_method: method });
  if (error) throw new Error(error.message || 'No se pudo confirmar');
  return data;
}
export async function adminRejectPayment(requestId) {
  const { error } = await sb.rpc('admin_reject_payment', { p_request: requestId });
  if (error) throw new Error(error.message || 'No se pudo actualizar');
}

// ---------------------------------------------------------------- enlace del cliente (ver su dieta sin cuenta)
const randomToken = () => {
  const b = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...b)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};
export async function portalLink(uid, clientId) {
  const { data, error } = await sb.from('portal_links').select('token, last_viewed_at').eq('owner', uid).eq('client_id', clientId).maybeSingle();
  if (error) throw new Error('No se pudo consultar el enlace');
  return data;
}
export async function createPortalLink(uid, clientId) {
  const token = randomToken();
  const { error } = await sb.from('portal_links').insert({ token, owner: uid, client_id: clientId });
  if (error) throw new Error(error.code === '42501' ? 'Necesitas una suscripción activa para compartir enlaces' : 'No se pudo crear el enlace');
  return token;
}
export async function revokePortalLink(uid, clientId) {
  const { error } = await sb.from('portal_links').delete().eq('owner', uid).eq('client_id', clientId);
  if (error) throw new Error('No se pudo anular el enlace');
}
export async function portalView(token) {
  const { data, error } = await sb.rpc('portal_view', { p_token: token });
  if (error) throw new Error(/no es válido|no está disponible/.test(error.message) ? error.message : 'No se pudo cargar tu plan. Revisa tu conexión.');
  return data;
}
