-- =====================================================================
-- LIFEQUEST · esquema inicial
--
-- Principios:
--   * Los clientes SOLO PUEDEN LEER (RLS por familia). Ninguna tabla admite
--     insert/update/delete directo desde el navegador.
--   * Toda escritura pasa por funciones lq_* (security definer) que verifican
--     permisos con auth.uid() y reproducen las reglas de src/domain/engine.ts.
--   * XP y LIFECOINS no son columnas: son la suma de `ledger`, que es
--     idempotente (unique member_id, ref_type, ref_id).
--   * Las funciones auxiliares viven en el esquema lq_private, que no se
--     expone por la API.
-- Cada función indica la función del motor TypeScript que implementa.
-- =====================================================================

create schema if not exists lq_private;

-- ---------- tablas ----------

create table public.families (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('solo', 'family')),
  name text not null check (char_length(name) between 1 and 40),
  code text not null unique,
  invite_code text unique,
  invite_expires_at timestamptz,
  starting_coins int not null default 50 check (starting_coins between 0 and 1000),
  created_at timestamptz not null default now()
);

create table public.members (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.families (id) on delete cascade,
  account_id uuid references auth.users (id) on delete cascade,
  role text not null check (role in ('guardian', 'child')),
  name text not null check (char_length(name) between 1 and 24),
  age_band text not null check (age_band in ('kid', 'teen', 'adult')),
  plays_game boolean not null default true,
  avatar jsonb not null,
  interests text[] not null default '{}',
  goals text[] not null default '{}',
  has_pin boolean not null default false,
  created_at timestamptz not null default now(),
  -- Los perfiles infantiles nunca tienen cuenta ni correo (minimización de datos).
  check ((role = 'child') = (account_id is null))
);
create unique index members_one_family_per_account on public.members (account_id) where account_id is not null;
create index members_family_idx on public.members (family_id);

-- El hash del PIN no se expone: la tabla no tiene políticas de lectura.
create table public.member_secrets (
  member_id uuid primary key references public.members (id) on delete cascade,
  pin_hash text
);

create table public.missions (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.families (id) on delete cascade,
  title text not null check (char_length(title) between 1 and 80),
  description text not null default '' check (char_length(description) <= 500),
  category text not null check (category in ('health', 'education', 'productivity', 'creativity', 'social', 'discipline')),
  difficulty text not null check (difficulty in ('easy', 'medium', 'hard', 'special')),
  kind text not null check (kind in ('daily', 'weekly', 'special', 'custom')),
  xp int not null check (xp between 0 and 500),
  coins int not null check (coins between 0 and 1000),
  initiative_xp int not null default 0 check (initiative_xp between 0 and 500),
  initiative_coins int not null default 0 check (initiative_coins between 0 and 1000),
  estimated_minutes int not null default 10 check (estimated_minutes between 0 and 600),
  criteria text not null default '' check (char_length(criteria) <= 300),
  recurrence jsonb not null,
  -- Puede quedar vacío si se elimina al único jugador asignado (entonces se archiva); las altas lo validan en mission_fields.
  assignee_ids uuid[] not null,
  requires_approval boolean not null default true,
  status text not null check (status in ('proposed', 'active', 'suspended', 'archived', 'rejected')),
  created_by uuid not null,
  created_at timestamptz not null default now(),
  reviewed_by uuid,
  reviewed_at timestamptz,
  review_note text
);
create index missions_family_idx on public.missions (family_id);

create table public.completions (
  id uuid primary key default gen_random_uuid(),
  mission_id uuid not null references public.missions (id) on delete cascade,
  member_id uuid not null references public.members (id) on delete cascade,
  period_key text not null,
  status text not null check (status in ('pending', 'approved', 'rejected')),
  completed_by uuid not null,
  completed_at timestamptz not null default now(),
  reviewed_by uuid,
  reviewed_at timestamptz,
  note text,
  initiative boolean not null default false,
  -- Evita recompensas duplicadas para la misma ocurrencia.
  unique (mission_id, member_id, period_key)
);
create index completions_member_idx on public.completions (member_id);

create table public.ledger (
  id uuid primary key default gen_random_uuid(),
  member_id uuid not null references public.members (id) on delete cascade,
  xp int not null default 0,
  coins int not null default 0,
  reason text not null,
  ref_type text not null check (ref_type in ('welcome', 'completion', 'purchase', 'redemption', 'refund', 'correction')),
  ref_id text not null,
  actor_id uuid not null,
  created_at timestamptz not null default now(),
  unique (member_id, ref_type, ref_id)
);
create index ledger_member_idx on public.ledger (member_id);

create table public.catalog_items (
  id text primary key,
  slot text not null check (slot in ('accessory', 'background', 'frame', 'title')),
  name text not null,
  description text not null,
  price int not null check (price >= 0),
  value text not null,
  min_level int not null default 0
);

create table public.inventory (
  member_id uuid not null references public.members (id) on delete cascade,
  item_id text not null references public.catalog_items (id),
  equipped boolean not null default false,
  acquired_at timestamptz not null default now(),
  primary key (member_id, item_id)
);

create table public.rewards (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.families (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 60),
  description text not null default '' check (char_length(description) <= 300),
  price int not null check (price between 1 and 100000),
  conditions text not null default '' check (char_length(conditions) <= 300),
  status text not null check (status in ('proposed', 'approved', 'archived', 'rejected')),
  created_by uuid not null,
  created_at timestamptz not null default now(),
  reviewed_by uuid
);

create table public.redemptions (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.families (id) on delete cascade,
  reward_id uuid not null references public.rewards (id) on delete cascade,
  member_id uuid not null references public.members (id) on delete cascade,
  price int not null check (price > 0),
  status text not null check (status in ('pending', 'approved', 'rejected', 'rescheduled', 'refunded')),
  note text,
  scheduled_for date,
  requested_at timestamptz not null default now(),
  reviewed_by uuid,
  reviewed_at timestamptz
);

create table public.audit_log (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.families (id) on delete cascade,
  actor_id uuid not null,
  action text not null,
  ref_id text,
  detail text not null default '',
  at timestamptz not null default now()
);
create index audit_family_idx on public.audit_log (family_id, at desc);

insert into public.catalog_items (id, slot, name, description, price, value, min_level) values
  ('bg-nebula', 'background', 'Nebulosa', 'Fondo violeta con polvo de estrellas.', 0, 'nebula', 0),
  ('bg-grid', 'background', 'Cuadrícula neón', 'Rejilla holográfica azul.', 40, 'grid', 0),
  ('bg-aurora', 'background', 'Aurora', 'Cortinas de luz verde y azul.', 90, 'aurora', 3),
  ('bg-city', 'background', 'Ciudad nocturna', 'Skyline futurista.', 160, 'city', 5),
  ('fr-basic', 'frame', 'Marco cian', 'Borde luminoso cian.', 0, 'cyan', 0),
  ('fr-violet', 'frame', 'Marco violeta', 'Borde luminoso violeta.', 50, 'violet', 0),
  ('fr-gold', 'frame', 'Marco dorado', 'Para quienes van lejos.', 200, 'gold', 6),
  ('ac-visor', 'accessory', 'Visor táctico', 'Visor azul translúcido.', 30, '🥽', 0),
  ('ac-headset', 'accessory', 'Auriculares', 'Para concentrarse.', 45, '🎧', 0),
  ('ac-crown', 'accessory', 'Corona de datos', 'Una corona digital.', 250, '👑', 8),
  ('ac-star', 'accessory', 'Estrella guía', 'Brilla a tu lado.', 120, '🌟', 4),
  ('ti-novice', 'title', 'Aprendiz', 'Título de inicio.', 0, 'Aprendiz', 0),
  ('ti-explorer', 'title', 'Explorador', 'Título de quien prueba de todo.', 60, 'Explorador', 0),
  ('ti-guardian', 'title', 'Guardián del hogar', 'Título familiar.', 100, 'Guardián del hogar', 3),
  ('ti-legend', 'title', 'Leyenda', 'Título de gran constancia.', 400, 'Leyenda', 10);

-- ---------- ayudantes privados ----------

create function lq_private.fail(p_code text, p_msg text) returns void
language plpgsql as $$
begin
  -- El cliente separa "codigo|mensaje" para reconstruir un DomainError.
  raise exception '%|%', p_code, p_msg using errcode = 'P0001';
end $$;

create function lq_private.txt(p_val text, p_min int, p_max int, p_field text) returns text
language plpgsql immutable as $$
declare s text := btrim(coalesce(p_val, ''));
begin
  if char_length(s) < p_min or char_length(s) > p_max then
    perform lq_private.fail('invalid_text', case when p_min > 0
      then p_field || ' es obligatorio (máx. ' || p_max || ' caracteres).'
      else p_field || ' admite hasta ' || p_max || ' caracteres.' end);
  end if;
  return s;
end $$;

create function lq_private.jint(p jsonb, p_key text, p_def int, p_min int, p_max int, p_field text) returns int
language plpgsql immutable as $$
declare v jsonb := p -> p_key; n numeric;
begin
  if v is null or jsonb_typeof(v) = 'null' then
    if p_def is null then perform lq_private.fail('invalid_number', p_field || ' es obligatorio.'); end if;
    return p_def;
  end if;
  if jsonb_typeof(v) <> 'number' then
    perform lq_private.fail('invalid_number', p_field || ' debe ser un número.');
  end if;
  n := (v #>> '{}')::numeric;
  if n <> trunc(n) or n < p_min or n > p_max then
    perform lq_private.fail('invalid_number', p_field || ' debe ser un número entero entre ' || p_min || ' y ' || p_max || '.');
  end if;
  return n::int;
end $$;

-- Misma fórmula que src/domain/progression.ts (BASE=60, EXPONENT=1.5).
create function lq_private.xp_for_level(l int) returns int
language sql immutable as $$
  select case when l <= 1 then 0 else round(60 * power((l - 1)::double precision, 1.5))::int end
$$;

create function lq_private.level_for_xp(p_xp int) returns int
language plpgsql immutable as $$
declare lvl int := 1;
begin
  while lvl < 100 and p_xp >= lq_private.xp_for_level(lvl + 1) loop lvl := lvl + 1; end loop;
  return lvl;
end $$;

create function lq_private.xp_total(p_member uuid) returns int
language sql stable as $$ select coalesce(sum(xp), 0)::int from public.ledger where member_id = p_member $$;

create function lq_private.coins_total(p_member uuid) returns int
language sql stable as $$ select coalesce(sum(coins), 0)::int from public.ledger where member_id = p_member $$;

create function lq_private.held(p_member uuid) returns int
language sql stable as $$
  select coalesce(sum(price), 0)::int from public.redemptions
  where member_id = p_member and status in ('pending', 'rescheduled')
$$;

-- Serializa operaciones sobre las monedas de un mismo jugador (§264).
create function lq_private.lock_member(p_member uuid) returns void
language sql as $$ select 1 from public.members where id = p_member for update $$;

-- engine.resolveActor
create function lq_private.actor(p_actor uuid) returns public.members
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare m public.members;
begin
  select * into m from public.members where id = p_actor;
  if not found then perform lq_private.fail('not_found', 'Miembro no encontrado.'); end if;
  if auth.uid() is null or not exists (
    select 1 from public.members g
    where g.family_id = m.family_id and g.account_id = auth.uid() and g.role = 'guardian'
  ) then
    perform lq_private.fail('forbidden', 'Esta cuenta no tiene acceso a ese perfil.');
  end if;
  return m;
end $$;

create function lq_private.require_guardian(a public.members) returns void
language plpgsql as $$
begin
  if a.role <> 'guardian' then perform lq_private.fail('forbidden', 'Sólo un adulto administrador puede hacer esto.'); end if;
end $$;

create function lq_private.require_player(a public.members) returns void
language plpgsql as $$
begin
  if not a.plays_game then perform lq_private.fail('not_player', 'Este perfil sólo administra; no participa como jugador.'); end if;
end $$;

create function lq_private.same_family(a public.members, p_family uuid) returns void
language plpgsql as $$
begin
  if a.family_id <> p_family then perform lq_private.fail('forbidden', 'Ese elemento pertenece a otra familia.'); end if;
end $$;

create function lq_private.log(p_family uuid, p_actor uuid, p_action text, p_ref text, p_detail text) returns void
language sql as $$
  insert into public.audit_log (family_id, actor_id, action, ref_id, detail) values (p_family, p_actor, p_action, p_ref, coalesce(p_detail, ''))
$$;

-- engine.grant: devuelve false si ya existía (idempotente).
create function lq_private.grant_ledger(p_member uuid, p_xp int, p_coins int, p_reason text, p_ref_type text, p_ref_id text, p_actor uuid) returns boolean
language plpgsql as $$
begin
  insert into public.ledger (member_id, xp, coins, reason, ref_type, ref_id, actor_id)
  values (p_member, p_xp, p_coins, p_reason, p_ref_type, p_ref_id, p_actor)
  on conflict (member_id, ref_type, ref_id) do nothing;
  return found;
end $$;

create function lq_private.new_family_code() returns text
language plpgsql as $$
declare
  alphabet constant text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  v_code text;
begin
  loop
    v_code := '';
    for i in 1..8 loop
      v_code := v_code || substr(alphabet, 1 + floor(random() * length(alphabet))::int, 1);
    end loop;
    v_code := substr(v_code, 1, 4) || '-' || substr(v_code, 5);
    exit when not exists (select 1 from public.families where code = v_code)
      and not exists (select 1 from public.families where invite_code = v_code);
  end loop;
  return v_code;
end $$;

-- engine.newMember
create function lq_private.new_member(f public.families, p_account uuid, p_role text, p_name text, p_age text, p_plays boolean) returns public.members
language plpgsql as $$
declare m public.members;
begin
  insert into public.members (family_id, account_id, role, name, age_band, plays_game, avatar)
  values (f.id, p_account, p_role, lq_private.txt(p_name, 1, 24, 'El nombre'), p_age, p_plays,
    '{"style":"runner","color":"#22d3ee","hair":"short","outfit":"suit","accessory":null,"background":"nebula","frame":"cyan","title":"Aprendiz"}'::jsonb)
  returning * into m;
  insert into public.inventory (member_id, item_id) select m.id, id from public.catalog_items where price = 0;
  if p_plays and f.starting_coins > 0 then
    perform lq_private.grant_ledger(m.id, 0, f.starting_coins, 'Bienvenida a LIFEQUEST', 'welcome', 'welcome', m.id);
  end if;
  return m;
end $$;

-- engine.periodKey / recurrence.ts
create function lq_private.period_key(p_rec jsonb, p_date date) returns text
language plpgsql immutable as $$
begin
  case p_rec ->> 'type'
    when 'once' then return 'once';
    when 'daily' then return p_date::text;
    when 'days' then
      if exists (select 1 from jsonb_array_elements_text(p_rec -> 'days') d where d::int = extract(dow from p_date)::int)
      then return p_date::text; else return null; end if;
    when 'weekly' then return date_trunc('week', p_date)::date::text;
    else return null;
  end case;
end $$;

-- engine.missionFields: valida y normaliza (entrada con claves snake_case).
create function lq_private.mission_fields(p_family uuid, p_in jsonb) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  fam public.families;
  diff text := p_in ->> 'difficulty';
  cat text := p_in ->> 'category';
  cap_xp int; cap_coins int; def_xp int; def_coins int;
  assignees uuid[];
  a uuid; mem public.members;
  rec jsonb := coalesce(p_in -> 'recurrence', '{"type":"once"}'::jsonb);
  rec_days jsonb;
begin
  select * into fam from public.families where id = p_family;
  if diff is null or diff not in ('easy', 'medium', 'hard', 'special') then perform lq_private.fail('invalid_difficulty', 'Dificultad no válida.'); end if;
  if cat is null or cat not in ('health', 'education', 'productivity', 'creativity', 'social', 'discipline') then perform lq_private.fail('invalid_category', 'Categoría no válida.'); end if;
  cap_xp := case when diff = 'special' then 500 else 150 end;
  cap_coins := case when diff = 'special' then 1000 else 300 end;
  def_xp := case diff when 'easy' then 10 when 'medium' then 25 when 'hard' then 50 else 100 end;
  def_coins := case diff when 'easy' then 5 when 'medium' then 12 when 'hard' then 25 else 60 end;

  select array_agg(distinct x::uuid) into assignees from jsonb_array_elements_text(coalesce(p_in -> 'assignee_ids', '[]'::jsonb)) x;
  if assignees is null or cardinality(assignees) = 0 then perform lq_private.fail('no_assignee', 'Asigna la misión al menos a un jugador.'); end if;
  foreach a in array assignees loop
    select * into mem from public.members where id = a;
    if not found or mem.family_id <> p_family then perform lq_private.fail('forbidden', 'Ese elemento pertenece a otra familia.'); end if;
    if not mem.plays_game then perform lq_private.fail('not_player', mem.name || ' no participa como jugador.'); end if;
  end loop;

  if rec ->> 'type' = 'days' then
    select coalesce(jsonb_agg(d order by d), '[]'::jsonb) into rec_days
      from (select distinct d::int as d from jsonb_array_elements_text(rec -> 'days') d where d::int between 0 and 6) s;
    if jsonb_array_length(rec_days) = 0 then perform lq_private.fail('invalid_recurrence', 'Elige al menos un día de la semana.'); end if;
    rec := jsonb_build_object('type', 'days', 'days', rec_days);
  elsif rec ->> 'type' in ('once', 'daily', 'weekly') then
    rec := jsonb_build_object('type', rec ->> 'type');
  else
    perform lq_private.fail('invalid_recurrence', 'Recurrencia no válida.');
  end if;

  return jsonb_build_object(
    'title', lq_private.txt(p_in ->> 'title', 1, 80, 'El nombre de la misión'),
    'description', lq_private.txt(p_in ->> 'description', 0, 500, 'La descripción'),
    'category', cat,
    'difficulty', diff,
    'kind', coalesce(p_in ->> 'kind', 'custom'),
    'xp', lq_private.jint(p_in, 'xp', def_xp, 0, cap_xp, 'Los XP'),
    'coins', lq_private.jint(p_in, 'coins', def_coins, 0, cap_coins, 'Los LIFECOINS'),
    'initiative_xp', lq_private.jint(p_in, 'initiative_xp', 0, 0, cap_xp, 'El bono de XP'),
    'initiative_coins', lq_private.jint(p_in, 'initiative_coins', 0, 0, cap_coins, 'El bono de LIFECOINS'),
    'estimated_minutes', lq_private.jint(p_in, 'estimated_minutes', 10, 0, 600, 'El tiempo estimado'),
    'criteria', lq_private.txt(p_in ->> 'criteria', 0, 300, 'Las condiciones'),
    'recurrence', rec,
    'assignee_ids', to_jsonb(assignees),
    'requires_approval', case when fam.kind = 'solo' then false else coalesce((p_in ->> 'requires_approval')::boolean, true) end
  );
end $$;

-- engine.approveCompletion
create function lq_private.approve_completion(c public.completions, m public.missions, reviewer public.members, p_initiative boolean, p_note text) returns void
language plpgsql as $$
begin
  update public.completions
     set status = 'approved', reviewed_by = reviewer.id, reviewed_at = now(), initiative = p_initiative, note = p_note
   where id = c.id;
  perform lq_private.grant_ledger(
    c.member_id,
    m.xp + case when p_initiative then m.initiative_xp else 0 end,
    m.coins + case when p_initiative then m.initiative_coins else 0 end,
    case when p_initiative then m.title || ' (con iniciativa)' else m.title end,
    'completion', c.id::text, reviewer.id);
end $$;

-- ---------- RLS: lectura por familia, escritura nula ----------

create function lq_private.my_families() returns setof uuid
language sql stable security definer set search_path = public, pg_temp as $$
  select family_id from public.members where account_id = auth.uid() and role = 'guardian'
$$;

create function lq_private.my_members() returns setof uuid
language sql stable security definer set search_path = public, pg_temp as $$
  select id from public.members where family_id in (select lq_private.my_families())
$$;

alter table public.families enable row level security;
alter table public.members enable row level security;
alter table public.member_secrets enable row level security;
alter table public.missions enable row level security;
alter table public.completions enable row level security;
alter table public.ledger enable row level security;
alter table public.catalog_items enable row level security;
alter table public.inventory enable row level security;
alter table public.rewards enable row level security;
alter table public.redemptions enable row level security;
alter table public.audit_log enable row level security;

create policy read_own on public.families for select to authenticated using (id in (select lq_private.my_families()));
create policy read_own on public.members for select to authenticated using (family_id in (select lq_private.my_families()));
create policy read_own on public.missions for select to authenticated using (family_id in (select lq_private.my_families()));
create policy read_own on public.completions for select to authenticated using (member_id in (select lq_private.my_members()));
create policy read_own on public.ledger for select to authenticated using (member_id in (select lq_private.my_members()));
create policy read_all on public.catalog_items for select to authenticated using (true);
create policy read_own on public.inventory for select to authenticated using (member_id in (select lq_private.my_members()));
create policy read_own on public.rewards for select to authenticated using (family_id in (select lq_private.my_families()));
create policy read_own on public.redemptions for select to authenticated using (family_id in (select lq_private.my_families()));
create policy read_own on public.audit_log for select to authenticated using (family_id in (select lq_private.my_families()));
-- member_secrets: sin políticas → nadie la lee desde la API.

revoke all on all tables in schema public from anon, authenticated;
grant select on public.families, public.members, public.missions, public.completions, public.ledger,
  public.catalog_items, public.inventory, public.rewards, public.redemptions, public.audit_log to authenticated;

-- ---------- API pública (RPC) ----------

-- engine.createSolo
create function public.lq_create_solo(p_name text) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare f public.families; m public.members; uid uuid := auth.uid();
begin
  if uid is null then perform lq_private.fail('no_session', 'Inicia sesión para continuar.'); end if;
  if exists (select 1 from public.members where account_id = uid) then perform lq_private.fail('already_set_up', 'Esta cuenta ya tiene una aventura.'); end if;
  insert into public.families (kind, name, code) values ('solo', lq_private.txt(p_name, 1, 24, 'El nombre'), lq_private.new_family_code()) returning * into f;
  m := lq_private.new_member(f, uid, 'guardian', p_name, 'adult', true);
  perform lq_private.log(f.id, m.id, 'family.created', f.id::text, 'Aventura individual');
  return m.id;
end $$;

-- engine.createFamily
create function public.lq_create_family(p_family_name text, p_guardian_name text, p_plays_game boolean) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare f public.families; m public.members; uid uuid := auth.uid();
begin
  if uid is null then perform lq_private.fail('no_session', 'Inicia sesión para continuar.'); end if;
  if exists (select 1 from public.members where account_id = uid) then perform lq_private.fail('already_set_up', 'Esta cuenta ya pertenece a una familia.'); end if;
  insert into public.families (kind, name, code) values ('family', lq_private.txt(p_family_name, 1, 40, 'El nombre de la familia'), lq_private.new_family_code()) returning * into f;
  m := lq_private.new_member(f, uid, 'guardian', p_guardian_name, 'adult', coalesce(p_plays_game, false));
  perform lq_private.log(f.id, m.id, 'family.created', f.id::text, f.name);
  return m.id;
end $$;

-- engine.createInvite
create function public.lq_create_invite(p_actor uuid) returns text
language plpgsql security definer set search_path = public, pg_temp as $$
declare a public.members := lq_private.actor(p_actor); f public.families; v_code text;
begin
  perform lq_private.require_guardian(a);
  select * into f from public.families where id = a.family_id;
  if f.kind = 'solo' then perform lq_private.fail('solo', 'Una aventura individual no admite invitados.'); end if;
  if (select count(*) from public.members where family_id = f.id and role = 'guardian') >= 2 then
    perform lq_private.fail('limit', 'Una familia admite como máximo dos adultos administradores.');
  end if;
  v_code := lq_private.new_family_code();
  update public.families set invite_code = v_code, invite_expires_at = now() + interval '48 hours' where id = f.id;
  perform lq_private.log(f.id, a.id, 'family.invite', null, 'Invitación para segundo adulto');
  return v_code;
end $$;

-- engine.joinFamily
create function public.lq_join_family(p_invite_code text, p_name text, p_plays_game boolean) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare f public.families; m public.members; uid uuid := auth.uid();
begin
  if uid is null then perform lq_private.fail('no_session', 'Inicia sesión para continuar.'); end if;
  if exists (select 1 from public.members where account_id = uid) then perform lq_private.fail('already_set_up', 'Esta cuenta ya pertenece a una familia.'); end if;
  select * into f from public.families where invite_code = upper(btrim(p_invite_code)) and invite_expires_at > now();
  if not found then perform lq_private.fail('invalid_invite', 'La invitación no es válida o expiró.'); end if;
  if (select count(*) from public.members where family_id = f.id and role = 'guardian') >= 2 then
    perform lq_private.fail('limit', 'Esa familia ya tiene dos adultos administradores.');
  end if;
  m := lq_private.new_member(f, uid, 'guardian', p_name, 'adult', coalesce(p_plays_game, false));
  update public.families set invite_code = null, invite_expires_at = null where id = f.id;
  perform lq_private.log(f.id, m.id, 'family.joined', m.id::text, 'Segundo adulto se unió');
  return m.id;
end $$;

-- engine.addChild
create function public.lq_add_child(p_actor uuid, p_name text, p_age_band text) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare a public.members := lq_private.actor(p_actor); f public.families; c public.members;
begin
  perform lq_private.require_guardian(a);
  select * into f from public.families where id = a.family_id;
  if f.kind = 'solo' then perform lq_private.fail('solo', 'Crea una familia para añadir niños.'); end if;
  if p_age_band not in ('kid', 'teen') then perform lq_private.fail('invalid_age', 'Rango de edad no válido.'); end if;
  c := lq_private.new_member(f, null, 'child', p_name, p_age_band, true);
  perform lq_private.log(f.id, a.id, 'child.added', c.id::text, c.name);
  return c.id;
end $$;

-- engine.removeChild
create function public.lq_remove_child(p_actor uuid, p_child uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare a public.members := lq_private.actor(p_actor); c public.members;
begin
  perform lq_private.require_guardian(a);
  select * into c from public.members where id = p_child;
  if not found then perform lq_private.fail('not_found', 'Miembro no encontrado.'); end if;
  perform lq_private.same_family(a, c.family_id);
  if c.role <> 'child' then perform lq_private.fail('forbidden', 'Sólo se pueden eliminar perfiles infantiles.'); end if;
  update public.missions set assignee_ids = array_remove(assignee_ids, c.id) where family_id = a.family_id;
  -- Una misión sin jugadores asignados deja de tener sentido: se archiva (el historial se conserva).
  update public.missions set status = 'archived'
   where family_id = a.family_id and cardinality(assignee_ids) = 0 and status in ('proposed', 'active', 'suspended');
  delete from public.members where id = c.id;
  perform lq_private.log(a.family_id, a.id, 'child.removed', null, c.name);
end $$;

-- engine.setPlaysGame
create function public.lq_set_plays_game(p_actor uuid, p_plays boolean) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare a public.members := lq_private.actor(p_actor); f public.families;
begin
  perform lq_private.require_guardian(a);
  select * into f from public.families where id = a.family_id;
  if f.kind = 'solo' and not p_plays then perform lq_private.fail('solo', 'En una aventura individual siempre juegas.'); end if;
  update public.members set plays_game = p_plays where id = a.id;
  if p_plays and f.starting_coins > 0 then
    perform lq_private.grant_ledger(a.id, 0, f.starting_coins, 'Bienvenida a LIFEQUEST', 'welcome', 'welcome', a.id);
  end if;
  perform lq_private.log(f.id, a.id, 'guardian.mode', a.id::text, case when p_plays then 'administra y juega' else 'sólo administra' end);
end $$;

-- engine.setStartingCoins
create function public.lq_set_starting_coins(p_actor uuid, p_coins int) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare a public.members := lq_private.actor(p_actor);
begin
  perform lq_private.require_guardian(a);
  if p_coins is null or p_coins < 0 or p_coins > 1000 then perform lq_private.fail('invalid_number', 'Las monedas iniciales debe ser un número entero entre 0 y 1000.'); end if;
  update public.families set starting_coins = p_coins where id = a.family_id;
  perform lq_private.log(a.family_id, a.id, 'family.settings', null, 'Monedas iniciales: ' || p_coins);
end $$;

-- PIN: el cliente envía un hash derivado (PBKDF2); el servidor nunca ve el PIN.
create function public.lq_set_pin(p_actor uuid, p_hash text) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare a public.members := lq_private.actor(p_actor);
begin
  perform lq_private.require_guardian(a);
  insert into public.member_secrets (member_id, pin_hash) values (a.id, p_hash)
  on conflict (member_id) do update set pin_hash = excluded.pin_hash;
  update public.members set has_pin = (p_hash is not null) where id = a.id;
end $$;

create function public.lq_verify_pin(p_actor uuid, p_hash text) returns boolean
language plpgsql security definer set search_path = public, pg_temp as $$
declare a public.members := lq_private.actor(p_actor); stored text;
begin
  select pin_hash into stored from public.member_secrets where member_id = a.id;
  return stored is null or stored = p_hash;
end $$;

-- engine.updateCharacter
create function public.lq_update_character(p_actor uuid, p_member uuid, p_patch jsonb) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare a public.members := lq_private.actor(p_actor); t public.members; av jsonb; v text;
begin
  select * into t from public.members where id = p_member;
  if not found then perform lq_private.fail('not_found', 'Miembro no encontrado.'); end if;
  perform lq_private.same_family(a, t.family_id);
  if a.id <> t.id and a.role <> 'guardian' then perform lq_private.fail('forbidden', 'Sólo puedes editar tu propio personaje.'); end if;
  av := t.avatar;
  if p_patch ? 'name' then update public.members set name = lq_private.txt(p_patch ->> 'name', 1, 24, 'El nombre') where id = t.id; end if;
  if p_patch -> 'avatar' ? 'style' and (p_patch -> 'avatar' ->> 'style') in ('runner', 'mage', 'engineer', 'scout') then
    av := jsonb_set(av, '{style}', to_jsonb(p_patch -> 'avatar' ->> 'style'));
  end if;
  v := p_patch -> 'avatar' ->> 'color';
  if v is not null and v ~ '^#[0-9a-fA-F]{6}$' then av := jsonb_set(av, '{color}', to_jsonb(v)); end if;
  v := p_patch -> 'avatar' ->> 'hair';
  if v is not null then av := jsonb_set(av, '{hair}', to_jsonb(lq_private.txt(v, 1, 20, 'El peinado'))); end if;
  v := p_patch -> 'avatar' ->> 'outfit';
  if v is not null then av := jsonb_set(av, '{outfit}', to_jsonb(lq_private.txt(v, 1, 20, 'La ropa'))); end if;
  update public.members set avatar = av where id = t.id;
  if p_patch ? 'interests' then
    update public.members set interests = (select coalesce(array_agg(lq_private.txt(x, 1, 40, 'Interés')), '{}') from (select x from jsonb_array_elements_text(p_patch -> 'interests') x limit 8) s) where id = t.id;
  end if;
  if p_patch ? 'goals' then
    update public.members set goals = (select coalesce(array_agg(lq_private.txt(x, 1, 60, 'Objetivo')), '{}') from (select x from jsonb_array_elements_text(p_patch -> 'goals') x limit 8) s) where id = t.id;
  end if;
end $$;

-- engine.createMission  (p_input con claves snake_case)
create function public.lq_create_mission(p_actor uuid, p_input jsonb) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare a public.members := lq_private.actor(p_actor); fields jsonb; new_id uuid; st text;
begin
  if a.role = 'child' then
    -- Los niños sólo proponen, y sólo para sí mismos.
    if jsonb_array_length(coalesce(p_input -> 'assignee_ids', '[]'::jsonb)) <> 1 or (p_input -> 'assignee_ids' ->> 0)::uuid <> a.id then
      perform lq_private.fail('forbidden', 'Sólo puedes proponer misiones para ti.');
    end if;
    st := 'proposed';
  else
    perform lq_private.require_guardian(a);
    st := 'active';
  end if;
  fields := lq_private.mission_fields(a.family_id, p_input);
  insert into public.missions (family_id, title, description, category, difficulty, kind, xp, coins, initiative_xp, initiative_coins,
    estimated_minutes, criteria, recurrence, assignee_ids, requires_approval, status, created_by)
  values (a.family_id, fields ->> 'title', fields ->> 'description', fields ->> 'category', fields ->> 'difficulty', fields ->> 'kind',
    (fields ->> 'xp')::int, (fields ->> 'coins')::int, (fields ->> 'initiative_xp')::int, (fields ->> 'initiative_coins')::int,
    (fields ->> 'estimated_minutes')::int, fields ->> 'criteria', fields -> 'recurrence',
    (select array_agg(x::uuid) from jsonb_array_elements_text(fields -> 'assignee_ids') x),
    (fields ->> 'requires_approval')::boolean, st, a.id)
  returning id into new_id;
  perform lq_private.log(a.family_id, a.id, case when st = 'proposed' then 'mission.proposed' else 'mission.created' end, new_id::text, fields ->> 'title');
  return new_id;
end $$;

create function lq_private.apply_mission_fields(p_id uuid, fields jsonb) returns void
language sql as $$
  update public.missions set
    title = fields ->> 'title', description = fields ->> 'description', category = fields ->> 'category',
    difficulty = fields ->> 'difficulty', kind = fields ->> 'kind', xp = (fields ->> 'xp')::int, coins = (fields ->> 'coins')::int,
    initiative_xp = (fields ->> 'initiative_xp')::int, initiative_coins = (fields ->> 'initiative_coins')::int,
    estimated_minutes = (fields ->> 'estimated_minutes')::int, criteria = fields ->> 'criteria', recurrence = fields -> 'recurrence',
    assignee_ids = (select array_agg(x::uuid) from jsonb_array_elements_text(fields -> 'assignee_ids') x),
    requires_approval = (fields ->> 'requires_approval')::boolean
  where id = p_id
$$;

-- engine.reviewMissionProposal
create function public.lq_review_mission(p_actor uuid, p_mission uuid, p_decision text, p_note text, p_edits jsonb) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare a public.members := lq_private.actor(p_actor); m public.missions;
begin
  perform lq_private.require_guardian(a);
  select * into m from public.missions where id = p_mission;
  if not found then perform lq_private.fail('not_found', 'Misión no encontrada.'); end if;
  perform lq_private.same_family(a, m.family_id);
  if m.status <> 'proposed' then perform lq_private.fail('not_proposal', 'Esta misión no está pendiente de revisión.'); end if;
  if p_decision = 'approve' then
    if p_edits is not null and p_edits <> '{}'::jsonb then
      perform lq_private.apply_mission_fields(m.id, lq_private.mission_fields(m.family_id, to_jsonb(m) || p_edits));
    end if;
    update public.missions set status = 'active' where id = m.id;
  elsif p_decision = 'reject' then
    update public.missions set status = 'rejected' where id = m.id;
  else
    perform lq_private.fail('invalid_decision', 'Decisión no válida.');
  end if;
  update public.missions set reviewed_by = a.id, reviewed_at = now(), review_note = nullif(lq_private.txt(p_note, 0, 300, 'La nota'), '') where id = m.id;
  perform lq_private.log(m.family_id, a.id, case when p_decision = 'approve' then 'mission.approved' else 'mission.rejected' end, m.id::text, m.title);
end $$;

-- engine.updateMission
create function public.lq_update_mission(p_actor uuid, p_mission uuid, p_edits jsonb) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare a public.members := lq_private.actor(p_actor); m public.missions;
begin
  perform lq_private.require_guardian(a);
  select * into m from public.missions where id = p_mission;
  if not found then perform lq_private.fail('not_found', 'Misión no encontrada.'); end if;
  perform lq_private.same_family(a, m.family_id);
  perform lq_private.apply_mission_fields(m.id, lq_private.mission_fields(m.family_id, to_jsonb(m) || coalesce(p_edits, '{}'::jsonb)));
  perform lq_private.log(m.family_id, a.id, 'mission.updated', m.id::text, m.title);
end $$;

-- engine.setMissionStatus
create function public.lq_set_mission_status(p_actor uuid, p_mission uuid, p_status text) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare a public.members := lq_private.actor(p_actor); m public.missions;
begin
  perform lq_private.require_guardian(a);
  select * into m from public.missions where id = p_mission;
  if not found then perform lq_private.fail('not_found', 'Misión no encontrada.'); end if;
  perform lq_private.same_family(a, m.family_id);
  if p_status not in ('active', 'suspended', 'archived') then perform lq_private.fail('invalid_state', 'Estado no válido.'); end if;
  if m.status in ('proposed', 'rejected') then perform lq_private.fail('invalid_state', 'Primero revisa la propuesta.'); end if;
  update public.missions set status = p_status where id = m.id;
  perform lq_private.log(m.family_id, a.id, 'mission.' || p_status, m.id::text, m.title);
end $$;

-- engine.completeMission
create function public.lq_complete_mission(p_actor uuid, p_mission uuid, p_member uuid, p_date date) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  a public.members := lq_private.actor(p_actor); m public.missions; t public.members; c public.completions;
  utc_today date := (now() at time zone 'utc')::date;
  d date := coalesce(p_date, (now() at time zone 'utc')::date);
  k text; auto boolean;
begin
  select * into m from public.missions where id = p_mission;
  if not found then perform lq_private.fail('not_found', 'Misión no encontrada.'); end if;
  select * into t from public.members where id = p_member;
  if not found then perform lq_private.fail('not_found', 'Miembro no encontrado.'); end if;
  perform lq_private.same_family(a, m.family_id);
  perform lq_private.same_family(t, m.family_id);
  if a.id <> t.id and a.role <> 'guardian' then perform lq_private.fail('forbidden', 'Sólo puedes completar tus propias misiones.'); end if;
  perform lq_private.require_player(t);
  if m.status <> 'active' then perform lq_private.fail('inactive', 'Esta misión no está activa.'); end if;
  if not (t.id = any (m.assignee_ids)) then perform lq_private.fail('not_assigned', 'La misión no está asignada a este jugador.'); end if;
  -- El servidor no conoce la zona horaria del jugador: tolera ±1 día respecto a UTC.
  if d > utc_today + 1 then perform lq_private.fail('future', 'No se puede completar una misión en el futuro.'); end if;
  if a.role = 'child' and abs(d - utc_today) > 1 then perform lq_private.fail('forbidden', 'Sólo puedes completar misiones de hoy.'); end if;
  k := lq_private.period_key(m.recurrence, d);
  if k is null then perform lq_private.fail('not_due', 'Esta misión no toca ese día.'); end if;

  perform lq_private.lock_member(t.id);
  select * into c from public.completions where mission_id = m.id and member_id = t.id and period_key = k;
  if found and c.status <> 'rejected' then perform lq_private.fail('duplicate', 'Esta misión ya fue registrada para este periodo.'); end if;
  auto := a.role = 'guardian' or not m.requires_approval;
  if found then
    update public.completions set status = 'pending', completed_by = a.id, completed_at = now(), reviewed_by = null, reviewed_at = null, note = null where id = c.id returning * into c;
  else
    insert into public.completions (mission_id, member_id, period_key, status, completed_by) values (m.id, t.id, k, 'pending', a.id) returning * into c;
  end if;
  if auto then perform lq_private.approve_completion(c, m, a, false, null); end if;
  perform lq_private.log(m.family_id, a.id, case when auto then 'completion.approved' else 'completion.submitted' end, c.id::text, m.title);
  return c.id;
end $$;

-- engine.reviewCompletion
create function public.lq_review_completion(p_actor uuid, p_completion uuid, p_decision text, p_note text, p_initiative boolean) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare a public.members := lq_private.actor(p_actor); c public.completions; m public.missions; v_note text;
begin
  perform lq_private.require_guardian(a);
  select * into c from public.completions where id = p_completion for update;
  if not found then perform lq_private.fail('not_found', 'Registro no encontrado.'); end if;
  select * into m from public.missions where id = c.mission_id;
  perform lq_private.same_family(a, m.family_id);
  if c.status <> 'pending' then perform lq_private.fail('already_reviewed', 'Esta misión ya fue revisada.'); end if;
  v_note := nullif(lq_private.txt(p_note, 0, 300, 'La nota'), '');
  if p_decision = 'approve' then
    perform lq_private.approve_completion(c, m, a, coalesce(p_initiative, false), v_note);
  elsif p_decision = 'reject' then
    update public.completions set status = 'rejected', reviewed_by = a.id, reviewed_at = now(), note = v_note where id = c.id;
  else
    perform lq_private.fail('invalid_decision', 'Decisión no válida.');
  end if;
  perform lq_private.log(m.family_id, a.id, 'completion.' || case when p_decision = 'approve' then 'approved' else 'rejected' end, c.id::text, m.title);
end $$;

-- engine.correctLedger
create function public.lq_correct_ledger(p_actor uuid, p_member uuid, p_xp int, p_coins int, p_reason text) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare a public.members := lq_private.actor(p_actor); t public.members; why text;
begin
  perform lq_private.require_guardian(a);
  select * into t from public.members where id = p_member;
  if not found then perform lq_private.fail('not_found', 'Miembro no encontrado.'); end if;
  perform lq_private.same_family(a, t.family_id);
  why := lq_private.txt(p_reason, 3, 200, 'El motivo');
  if p_xp is null or p_coins is null or abs(p_xp) > 100000 or abs(p_coins) > 100000 then perform lq_private.fail('invalid_number', 'Cantidad no válida.'); end if;
  perform lq_private.lock_member(t.id);
  if lq_private.xp_total(t.id) + p_xp < 0 or lq_private.coins_total(t.id) - lq_private.held(t.id) + p_coins < 0 then
    perform lq_private.fail('negative_balance', 'La corrección dejaría un saldo negativo.');
  end if;
  perform lq_private.grant_ledger(t.id, p_xp, p_coins, 'Corrección: ' || why, 'correction', gen_random_uuid()::text, a.id);
  perform lq_private.log(t.family_id, a.id, 'ledger.correction', t.id::text, why);
end $$;

-- engine.buyCatalogItem
create function public.lq_buy_item(p_actor uuid, p_item text) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare a public.members := lq_private.actor(p_actor); i public.catalog_items;
begin
  perform lq_private.require_player(a);
  select * into i from public.catalog_items where id = p_item;
  if not found then perform lq_private.fail('not_found', 'Artículo no encontrado.'); end if;
  perform lq_private.lock_member(a.id);
  if exists (select 1 from public.inventory where member_id = a.id and item_id = i.id) then perform lq_private.fail('owned', 'Ya tienes este artículo.'); end if;
  if lq_private.level_for_xp(lq_private.xp_total(a.id)) < i.min_level then perform lq_private.fail('level_required', 'Necesitas nivel ' || i.min_level || '.'); end if;
  if lq_private.coins_total(a.id) - lq_private.held(a.id) < i.price then perform lq_private.fail('insufficient_funds', 'No tienes LIFECOINS suficientes.'); end if;
  perform lq_private.grant_ledger(a.id, 0, -i.price, 'Compra: ' || i.name, 'purchase', i.id, a.id);
  insert into public.inventory (member_id, item_id) values (a.id, i.id);
end $$;

-- engine.equipItem
create function public.lq_equip_item(p_actor uuid, p_member uuid, p_item text) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare a public.members := lq_private.actor(p_actor); t public.members; i public.catalog_items; inv public.inventory; was boolean;
begin
  select * into t from public.members where id = p_member;
  if not found then perform lq_private.fail('not_found', 'Miembro no encontrado.'); end if;
  perform lq_private.same_family(a, t.family_id);
  if a.id <> t.id and a.role <> 'guardian' then perform lq_private.fail('forbidden', 'Sólo puedes cambiar tu propio personaje.'); end if;
  select * into i from public.catalog_items where id = p_item;
  if not found then perform lq_private.fail('not_found', 'Artículo no encontrado.'); end if;
  select * into inv from public.inventory where member_id = t.id and item_id = i.id;
  if not found then perform lq_private.fail('not_owned', 'Aún no tienes este artículo.'); end if;
  was := inv.equipped;
  update public.inventory set equipped = false where member_id = t.id and item_id in (select id from public.catalog_items where slot = i.slot);
  update public.inventory set equipped = not was where member_id = t.id and item_id = i.id;
  update public.members set avatar = jsonb_set(avatar, array[i.slot], case when was then 'null'::jsonb else to_jsonb(i.value) end) where id = t.id;
end $$;

-- engine.createReward
create function public.lq_create_reward(p_actor uuid, p_name text, p_description text, p_price int, p_conditions text) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare a public.members := lq_private.actor(p_actor); new_id uuid; st text := case when a.role = 'guardian' then 'approved' else 'proposed' end;
begin
  if p_price is null or p_price < 1 or p_price > 100000 then perform lq_private.fail('invalid_number', 'El precio debe ser un número entero entre 1 y 100000.'); end if;
  insert into public.rewards (family_id, name, description, price, conditions, status, created_by, reviewed_by)
  values (a.family_id, lq_private.txt(p_name, 1, 60, 'El nombre'), lq_private.txt(p_description, 0, 300, 'La descripción'), p_price,
    lq_private.txt(p_conditions, 0, 300, 'Las condiciones'), st, a.id, case when st = 'approved' then a.id end)
  returning id into new_id;
  perform lq_private.log(a.family_id, a.id, case when st = 'proposed' then 'reward.proposed' else 'reward.created' end, new_id::text, p_name);
  return new_id;
end $$;

-- engine.reviewReward
create function public.lq_review_reward(p_actor uuid, p_reward uuid, p_decision text, p_name text, p_price int, p_conditions text) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare a public.members := lq_private.actor(p_actor); r public.rewards;
begin
  perform lq_private.require_guardian(a);
  select * into r from public.rewards where id = p_reward;
  if not found then perform lq_private.fail('not_found', 'Recompensa no encontrada.'); end if;
  perform lq_private.same_family(a, r.family_id);
  if r.status <> 'proposed' then perform lq_private.fail('not_proposal', 'Esta recompensa no está pendiente de revisión.'); end if;
  if p_decision not in ('approve', 'reject') then perform lq_private.fail('invalid_decision', 'Decisión no válida.'); end if;
  if p_price is not null and (p_price < 1 or p_price > 100000) then perform lq_private.fail('invalid_number', 'El precio debe ser un número entero entre 1 y 100000.'); end if;
  update public.rewards set
    name = case when p_name is null then name else lq_private.txt(p_name, 1, 60, 'El nombre') end,
    price = coalesce(p_price, price),
    conditions = case when p_conditions is null then conditions else lq_private.txt(p_conditions, 0, 300, 'Las condiciones') end,
    status = case when p_decision = 'approve' then 'approved' else 'rejected' end,
    reviewed_by = a.id
  where id = r.id;
  perform lq_private.log(r.family_id, a.id, 'reward.' || case when p_decision = 'approve' then 'approved' else 'rejected' end, r.id::text, r.name);
end $$;

-- engine.archiveReward
create function public.lq_archive_reward(p_actor uuid, p_reward uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare a public.members := lq_private.actor(p_actor); r public.rewards;
begin
  perform lq_private.require_guardian(a);
  select * into r from public.rewards where id = p_reward;
  if not found then perform lq_private.fail('not_found', 'Recompensa no encontrada.'); end if;
  perform lq_private.same_family(a, r.family_id);
  update public.rewards set status = 'archived' where id = r.id;
  perform lq_private.log(r.family_id, a.id, 'reward.archived', r.id::text, r.name);
end $$;

-- engine.requestRedemption
create function public.lq_request_redemption(p_actor uuid, p_reward uuid) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare a public.members := lq_private.actor(p_actor); r public.rewards; new_id uuid;
begin
  perform lq_private.require_player(a);
  select * into r from public.rewards where id = p_reward;
  if not found then perform lq_private.fail('not_found', 'Recompensa no encontrada.'); end if;
  perform lq_private.same_family(a, r.family_id);
  if r.status <> 'approved' then perform lq_private.fail('unavailable', 'Esta recompensa no está disponible.'); end if;
  perform lq_private.lock_member(a.id);
  if lq_private.coins_total(a.id) - lq_private.held(a.id) < r.price then perform lq_private.fail('insufficient_funds', 'No tienes LIFECOINS suficientes.'); end if;
  insert into public.redemptions (family_id, reward_id, member_id, price, status) values (r.family_id, r.id, a.id, r.price, 'pending') returning id into new_id;
  perform lq_private.log(r.family_id, a.id, 'redemption.requested', new_id::text, r.name);
  return new_id;
end $$;

-- engine.reviewRedemption
create function public.lq_review_redemption(p_actor uuid, p_redemption uuid, p_decision text, p_note text, p_scheduled_for date) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare a public.members := lq_private.actor(p_actor); r public.redemptions; rw public.rewards; v_note text;
begin
  perform lq_private.require_guardian(a);
  select * into r from public.redemptions where id = p_redemption for update;
  if not found then perform lq_private.fail('not_found', 'Canje no encontrado.'); end if;
  perform lq_private.same_family(a, r.family_id);
  perform lq_private.lock_member(r.member_id);
  v_note := nullif(lq_private.txt(p_note, 0, 300, 'La nota'), '');
  select * into rw from public.rewards where id = r.reward_id;

  if p_decision = 'reschedule' then
    if p_scheduled_for is null then perform lq_private.fail('invalid_date', 'Indica la nueva fecha.'); end if;
    if r.status not in ('pending', 'rescheduled', 'approved') then perform lq_private.fail('invalid_state', 'Este canje ya no se puede reprogramar.'); end if;
    update public.redemptions set status = case when r.status = 'approved' then 'approved' else 'rescheduled' end, scheduled_for = p_scheduled_for, note = v_note where id = r.id;
  elsif p_decision in ('approve', 'reject') then
    if r.status not in ('pending', 'rescheduled') then perform lq_private.fail('already_reviewed', 'Este canje ya fue resuelto.'); end if;
    if p_decision = 'reject' then
      if v_note is null then perform lq_private.fail('note_required', 'Explica el motivo del rechazo.'); end if;
      update public.redemptions set status = 'rejected', note = v_note, reviewed_by = a.id, reviewed_at = now() where id = r.id;
    else
      if lq_private.coins_total(r.member_id) < r.price then perform lq_private.fail('insufficient_funds', 'El jugador ya no tiene LIFECOINS suficientes.'); end if;
      perform lq_private.grant_ledger(r.member_id, 0, -r.price, 'Canje: ' || rw.name, 'redemption', r.id::text, a.id);
      update public.redemptions set status = 'approved', note = v_note, reviewed_by = a.id, reviewed_at = now() where id = r.id;
    end if;
  else
    perform lq_private.fail('invalid_decision', 'Decisión no válida.');
  end if;
  perform lq_private.log(r.family_id, a.id, 'redemption.' || p_decision, r.id::text, p_decision);
end $$;

-- engine.refundRedemption
create function public.lq_refund_redemption(p_actor uuid, p_redemption uuid, p_note text) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare a public.members := lq_private.actor(p_actor); r public.redemptions; rw public.rewards;
begin
  perform lq_private.require_guardian(a);
  select * into r from public.redemptions where id = p_redemption for update;
  if not found then perform lq_private.fail('not_found', 'Canje no encontrado.'); end if;
  perform lq_private.same_family(a, r.family_id);
  if r.status <> 'approved' then perform lq_private.fail('invalid_state', 'Sólo se devuelve un canje aprobado.'); end if;
  perform lq_private.lock_member(r.member_id);
  select * into rw from public.rewards where id = r.reward_id;
  perform lq_private.grant_ledger(r.member_id, 0, r.price, 'Devolución: ' || rw.name, 'refund', r.id::text, a.id);
  update public.redemptions set status = 'refunded', note = coalesce(nullif(lq_private.txt(p_note, 0, 300, 'La nota'), ''), note), reviewed_at = now() where id = r.id;
  perform lq_private.log(r.family_id, a.id, 'redemption.refunded', r.id::text, rw.name);
end $$;

-- engine.deleteAccount: borra la familia si era el único adulto; si no, sólo su perfil.
create function public.lq_delete_account() returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare uid uuid := auth.uid(); me public.members;
begin
  if uid is null then perform lq_private.fail('no_session', 'Inicia sesión para continuar.'); end if;
  select * into me from public.members where account_id = uid;
  if found then
    if exists (select 1 from public.members where family_id = me.family_id and role = 'guardian' and id <> me.id) then
      delete from public.members where id = me.id;
    else
      delete from public.families where id = me.family_id; -- cascada: miembros, misiones, ledger, etc.
    end if;
  end if;
  delete from auth.users where id = uid;
end $$;

-- ---------- permisos de ejecución ----------
revoke execute on all functions in schema public from public, anon;
grant execute on all functions in schema public to authenticated;

-- Las políticas RLS se evalúan con los privilegios de quien consulta, así que sólo estas dos
-- funciones del esquema privado son ejecutables por `authenticated`. El esquema no se expone por la API.
revoke all on schema lq_private from public, anon;
grant usage on schema lq_private to authenticated;
revoke execute on all functions in schema lq_private from public, anon, authenticated;
grant execute on function lq_private.my_families(), lq_private.my_members() to authenticated;
