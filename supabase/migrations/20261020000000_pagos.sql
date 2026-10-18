-- NutriLab: pagos con PayPal (suscripción mensual automática) y Bizum (mes a mes, confirmado por el administrador).

alter table public.profiles add column if not exists paid_until timestamptz;            -- meses pagados con Bizum
alter table public.profiles add column if not exists paypal_subscription_id text;
-- Ninguna de las dos se puede cambiar desde la app (los usuarios solo pueden actualizar full_name).

-- ------------------------------------------------------------------ avisos de Bizum
-- El nutricionista avisa de que ha enviado el Bizum; el administrador lo confirma al verlo en su banco.
create table if not exists public.payment_requests (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users (id) on delete cascade default auth.uid(),
  method text not null default 'bizum' check (method = 'bizum'),
  amount_cents integer not null default 4999,
  status text not null default 'pending' check (status in ('pending', 'confirmed', 'rejected')),
  created_at timestamptz not null default now(),
  resolved_at timestamptz
);
-- Un solo aviso pendiente por persona
create unique index if not exists payment_requests_one_pending on public.payment_requests (user_id) where status = 'pending';
alter table public.payment_requests enable row level security;
create policy "ver mis avisos" on public.payment_requests for select using (user_id = auth.uid() or public.is_admin(auth.uid()));
create policy "avisar de un bizum" on public.payment_requests for insert
  with check (user_id = auth.uid() and status = 'pending' and amount_cents = 4999 and resolved_at is null);
revoke update, delete on public.payment_requests from anon, authenticated;

-- ------------------------------------------------------------------ pagos registrados
create table if not exists public.payments (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  method text not null,
  amount_cents integer not null,
  months integer not null default 1,
  paid_until timestamptz not null,
  request_id bigint references public.payment_requests (id),
  confirmed_by uuid references auth.users (id),
  created_at timestamptz not null default now()
);
alter table public.payments enable row level security;
create policy "ver mis pagos" on public.payments for select using (user_id = auth.uid() or public.is_admin(auth.uid()));
revoke insert, update, delete on public.payments from anon, authenticated;

-- ------------------------------------------------------------------ acceso
create or replace function public.has_access(uid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.profiles p
    where p.id = uid and (
      p.is_admin
      or p.subscription_status in ('active', 'trialing')
      or (p.subscription_status = 'past_due' and coalesce(p.current_period_end, now()) > now() - interval '7 days')
      or p.trial_ends_at > now()
      or p.paid_until > now()
    )
  );
$$;

-- ------------------------------------------------------------------ administración
-- Confirmar un Bizum recibido: suma los meses desde hoy o desde el final de lo ya pagado.
create or replace function public.admin_confirm_payment(p_user uuid, p_request bigint default null, p_months integer default 1)
returns timestamptz
language plpgsql security definer set search_path = public as $$
declare v_until timestamptz; v_amount integer := 4999;
begin
  if not public.is_admin(auth.uid()) then raise exception 'Solo para administradores' using errcode = '42501'; end if;
  if p_months not between 1 and 12 then raise exception 'Número de meses no válido' using errcode = '22023'; end if;
  if p_request is not null then
    update public.payment_requests set status = 'confirmed', resolved_at = now()
      where id = p_request and user_id = p_user and status = 'pending' returning amount_cents into v_amount;
    if not found then raise exception 'Ese aviso ya estaba resuelto' using errcode = 'P0001'; end if;
  else
    -- Bizum recibido sin aviso: cierra el aviso pendiente si lo hubiera
    update public.payment_requests set status = 'confirmed', resolved_at = now() where user_id = p_user and status = 'pending';
  end if;
  select greatest(coalesce(paid_until, now()), now()) + make_interval(months => p_months) into v_until
    from public.profiles where id = p_user for update;
  if v_until is null then raise exception 'No existe la cuenta' using errcode = 'P0002'; end if;
  update public.profiles set paid_until = v_until where id = p_user;
  insert into public.payments (user_id, method, amount_cents, months, paid_until, request_id, confirmed_by)
    values (p_user, 'bizum', coalesce(v_amount, 4999) * p_months, p_months, v_until, p_request, auth.uid());
  return v_until;
end $$;

create or replace function public.admin_reject_payment(p_request bigint) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin(auth.uid()) then raise exception 'Solo para administradores' using errcode = '42501'; end if;
  update public.payment_requests set status = 'rejected', resolved_at = now() where id = p_request and status = 'pending';
end $$;
revoke execute on function public.admin_confirm_payment(uuid, bigint, integer) from anon;
revoke execute on function public.admin_reject_payment(bigint) from anon;

-- El panel muestra también hasta cuándo ha pagado con Bizum.
drop function if exists public.admin_list();
create function public.admin_list() returns table (
  id uuid, email text, full_name text, created_at timestamptz, subscription_status text, trial_ends_at timestamptz,
  current_period_end timestamptz, cancel_at_period_end boolean, is_admin boolean,
  clients int, plans int, data_updated_at timestamptz, paid_until timestamptz
)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_admin(auth.uid()) then raise exception 'Solo para administradores' using errcode = '42501'; end if;
  return query
    select p.id, p.email, p.full_name, p.created_at, p.subscription_status, p.trial_ends_at,
           p.current_period_end, p.cancel_at_period_end, p.is_admin,
           coalesce(jsonb_array_length(w.data -> 'clients'), 0), coalesce(jsonb_array_length(w.data -> 'plans'), 0), w.updated_at, p.paid_until
    from public.profiles p left join public.workspaces w on w.owner = p.id
    order by p.created_at desc;
end $$;
revoke execute on function public.admin_list() from anon;
