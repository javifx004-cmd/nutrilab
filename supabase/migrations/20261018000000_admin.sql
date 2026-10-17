-- NutriLab: cuenta de administrador (gratis) y panel para ver a los nutricionistas.
-- El acceso del administrador a los datos de un nutricionista es de solo lectura y queda registrado;
-- el nutricionista ve esos accesos en su app.

alter table public.profiles add column if not exists is_admin boolean not null default false;
-- is_admin no se puede cambiar desde la app (la columna no tiene permiso de escritura para los usuarios).

create or replace function public.is_admin(uid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select is_admin from public.profiles where id = uid), false);
$$;

-- El administrador tiene acceso siempre, sin pagar.
create or replace function public.has_access(uid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.profiles p
    where p.id = uid and (
      p.is_admin
      or p.subscription_status in ('active', 'trialing')
      or (p.subscription_status = 'past_due' and coalesce(p.current_period_end, now()) > now() - interval '7 days')
      or p.trial_ends_at > now()
    )
  );
$$;

-- ------------------------------------------------------------------ registro de accesos
create table if not exists public.admin_access_log (
  id bigint generated always as identity primary key,
  admin_id uuid not null references auth.users (id) on delete cascade,
  target_id uuid not null references auth.users (id) on delete cascade,
  reason text not null,
  at timestamptz not null default now()
);
alter table public.admin_access_log enable row level security;
-- Cada nutricionista ve quién ha entrado en su cuenta; el administrador ve todo el registro.
create policy "ver accesos a mi cuenta" on public.admin_access_log for select
  using (target_id = auth.uid() or public.is_admin(auth.uid()));
-- Solo se escribe desde admin_view_workspace (security definer): nadie puede insertar ni borrar desde la app.
revoke insert, update, delete on public.admin_access_log from anon, authenticated;

-- ------------------------------------------------------------------ panel
-- Lista de nutricionistas con su suscripción y un resumen (sin datos de sus clientes).
create or replace function public.admin_list() returns table (
  id uuid, email text, full_name text, created_at timestamptz, subscription_status text, trial_ends_at timestamptz,
  current_period_end timestamptz, cancel_at_period_end boolean, is_admin boolean,
  clients int, plans int, data_updated_at timestamptz
)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_admin(auth.uid()) then raise exception 'Solo para administradores' using errcode = '42501'; end if;
  return query
    select p.id, p.email, p.full_name, p.created_at, p.subscription_status, p.trial_ends_at,
           p.current_period_end, p.cancel_at_period_end, p.is_admin,
           coalesce(jsonb_array_length(w.data -> 'clients'), 0), coalesce(jsonb_array_length(w.data -> 'plans'), 0), w.updated_at
    from public.profiles p left join public.workspaces w on w.owner = p.id
    order by p.created_at desc;
end $$;

-- Ver los datos de un nutricionista (solo lectura). Obliga a dar un motivo y lo registra.
create or replace function public.admin_view_workspace(target uuid, reason text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare d jsonb;
begin
  if not public.is_admin(auth.uid()) then raise exception 'Solo para administradores' using errcode = '42501'; end if;
  if coalesce(length(trim(reason)), 0) < 5 then raise exception 'Indica el motivo del acceso' using errcode = '22023'; end if;
  insert into public.admin_access_log (admin_id, target_id, reason) values (auth.uid(), target, trim(reason));
  select data into d from public.workspaces where owner = target;
  return coalesce(d, '{}'::jsonb);
end $$;

revoke execute on function public.admin_list() from anon;
revoke execute on function public.admin_view_workspace(uuid, text) from anon;

-- Fotos: el administrador puede leerlas (para el modo solo lectura), no subirlas ni borrarlas.
create policy "admin ve fotos" on storage.objects for select
  using (bucket_id = 'photos' and public.is_admin(auth.uid()));
