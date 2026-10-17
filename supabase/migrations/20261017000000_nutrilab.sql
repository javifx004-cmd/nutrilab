-- NutriLab: cuentas de nutricionistas, suscripción y datos en la nube.
-- Cada nutricionista solo puede leer y escribir lo suyo (Row Level Security).

-- ------------------------------------------------------------------ perfiles y suscripción
create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text,
  full_name text,
  created_at timestamptz not null default now(),
  trial_ends_at timestamptz not null default (now() + interval '14 days'),
  -- Estado de Stripe: trialing | active | past_due | canceled | unpaid | incomplete | … ; 'trial' = prueba de la app sin pagar
  subscription_status text not null default 'trial',
  stripe_customer_id text unique,
  stripe_subscription_id text,
  current_period_end timestamptz,
  cancel_at_period_end boolean not null default false
);

alter table public.profiles enable row level security;

-- El nutricionista ve su perfil, pero solo puede cambiar su nombre: la suscripción la escribe el webhook de Stripe.
create policy "ver mi perfil" on public.profiles for select using (auth.uid() = id);
create policy "cambiar mi nombre" on public.profiles for update using (auth.uid() = id) with check (auth.uid() = id);
revoke update on public.profiles from authenticated;
grant update (full_name) on public.profiles to authenticated;

create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, email, full_name)
  values (new.id, new.email, coalesce(new.raw_user_meta_data ->> 'full_name', ''))
  on conflict (id) do nothing;
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- ¿Puede trabajar? Suscripción activa (o en periodo de prueba de Stripe) o dentro de los días de prueba de la app.
-- Con un pago fallido (past_due) se dan unos días mientras Stripe reintenta el cobro.
create or replace function public.has_access(uid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.profiles p
    where p.id = uid and (
      p.subscription_status in ('active', 'trialing')
      or (p.subscription_status = 'past_due' and coalesce(p.current_period_end, now()) > now() - interval '7 days')
      or p.trial_ends_at > now()
    )
  );
$$;

-- ------------------------------------------------------------------ datos de la app
-- Un documento por nutricionista con sus clientes, mediciones, dietas y alimentos.
-- La app combina los cambios de cada dispositivo (cada elemento lleva su fecha de modificación).
create table if not exists public.workspaces (
  owner uuid primary key references auth.users (id) on delete cascade default auth.uid(),
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.workspaces enable row level security;

-- Leer sus datos siempre (para poder exportarlos aunque no pague); escribir solo con acceso.
create policy "leer mis datos" on public.workspaces for select using (auth.uid() = owner);
create policy "crear mis datos" on public.workspaces for insert with check (auth.uid() = owner and public.has_access(auth.uid()));
create policy "guardar mis datos" on public.workspaces for update using (auth.uid() = owner) with check (auth.uid() = owner and public.has_access(auth.uid()));

create or replace function public.touch_updated_at() returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end $$;
drop trigger if exists workspaces_touch on public.workspaces;
create trigger workspaces_touch before update on public.workspaces for each row execute function public.touch_updated_at();

-- ------------------------------------------------------------------ fotos de progreso
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('photos', 'photos', false, 10485760, array['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif', 'image/gif'])
on conflict (id) do nothing;

-- Ruta: photos/<id del nutricionista>/<id de la foto>
create policy "ver mis fotos" on storage.objects for select
  using (bucket_id = 'photos' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "subir mis fotos" on storage.objects for insert
  with check (bucket_id = 'photos' and (storage.foldername(name))[1] = auth.uid()::text and public.has_access(auth.uid()));
create policy "borrar mis fotos" on storage.objects for delete
  using (bucket_id = 'photos' and (storage.foldername(name))[1] = auth.uid()::text);
