-- NutriLab: acceso de los clientes a su dieta mediante un enlace privado (sin cuenta).
-- El nutricionista crea o anula el enlace de cada cliente. Quien tenga el enlace solo puede ver la dieta,
-- el progreso de peso y la próxima cita de ese cliente; nunca las notas privadas ni datos de otros clientes.

create table if not exists public.portal_links (
  token text primary key,
  owner uuid not null references auth.users (id) on delete cascade default auth.uid(),
  client_id text not null,
  created_at timestamptz not null default now(),
  last_viewed_at timestamptz,
  unique (owner, client_id)
);

alter table public.portal_links enable row level security;
create policy "ver mis enlaces" on public.portal_links for select using (owner = auth.uid());
create policy "crear mis enlaces" on public.portal_links for insert
  with check (owner = auth.uid() and public.has_access(auth.uid()) and length(token) >= 32);
create policy "anular mis enlaces" on public.portal_links for delete using (owner = auth.uid());
revoke update on public.portal_links from anon, authenticated;

-- Lo que ve el cliente al abrir su enlace.
create or replace function public.portal_view(p_token text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_owner uuid; v_client text; d jsonb; c jsonb; pl jsonb; ms jsonb; nut jsonb;
begin
  select owner, client_id into v_owner, v_client from public.portal_links where token = p_token;
  if not found then raise exception 'Este enlace no es válido o ha sido anulado' using errcode = 'P0002'; end if;
  if not public.has_access(v_owner) then raise exception 'Este enlace no está disponible ahora mismo. Consulta con tu nutricionista.' using errcode = 'P0001'; end if;

  select data into d from public.workspaces where owner = v_owner;
  select x into c from jsonb_array_elements(coalesce(d -> 'clients', '[]')) x where x ->> 'id' = v_client limit 1;
  if c is null then raise exception 'Este enlace no es válido o ha sido anulado' using errcode = 'P0002'; end if;

  -- Dieta activa (o la más reciente)
  select x into pl from jsonb_array_elements(coalesce(d -> 'plans', '[]')) x
    where x ->> 'clientId' = v_client
    order by coalesce((x ->> 'active')::boolean, false) desc, coalesce((x ->> 'createdAt')::numeric, 0) desc
    limit 1;

  -- Progreso: solo fecha y medidas, sin notas ni fotos
  select coalesce(jsonb_agg(jsonb_build_object('date', x ->> 'date', 'weight', x ->> 'weight', 'waist', x ->> 'waist', 'fat', x ->> 'fat') order by x ->> 'date'), '[]')
    into ms from jsonb_array_elements(coalesce(d -> 'measures', '[]')) x where x ->> 'clientId' = v_client;

  select jsonb_build_object('name', full_name, 'email', email) into nut from public.profiles where id = v_owner;

  update public.portal_links set last_viewed_at = now() where token = p_token;

  return jsonb_build_object(
    'client', jsonb_build_object('name', c ->> 'name', 'goal', c ->> 'goal', 'targetWeight', c ->> 'targetWeight',
                                 'nextReview', c ->> 'nextReview', 'reviewTime', c ->> 'reviewTime', 'reviewMins', c ->> 'reviewMins',
                                 'reviewPlace', c ->> 'reviewPlace', 'allergies', c ->> 'allergies'),
    'plan', case when pl is null then null else jsonb_build_object('name', pl ->> 'name', 'notes', pl -> 'notes', 'days', pl -> 'days') end,
    'measures', ms,
    'nutritionist', nut
  );
end $$;

revoke execute on function public.portal_view(text) from public;
grant execute on function public.portal_view(text) to anon, authenticated;
