-- =====================================================================
-- LIFEQUEST · 0002
--   * Recompensas gratuitas (precio 0).
--   * Lista inicial obligatoria: mínimo 10 recompensas (lq_setup_rewards).
--   * Consecuencias acordadas por saldo bajo (tabla consequences).
-- Aditiva: se aplica sobre 0001. Reglas equivalentes a src/domain/engine.ts.
-- =====================================================================

-- ---------- recompensas gratuitas ----------
alter table public.families add column rewards_setup_done boolean not null default false;

alter table public.rewards drop constraint rewards_price_check;
alter table public.rewards add constraint rewards_price_check check (price between 0 and 100000);
alter table public.redemptions drop constraint redemptions_price_check;
alter table public.redemptions add constraint redemptions_price_check check (price >= 0);

-- ---------- consecuencias ----------
create table public.consequences (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.families (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 80),
  description text not null default '' check (char_length(description) <= 300),
  threshold_coins int not null check (threshold_coins between 1 and 100000),
  applies_to uuid[] not null,
  status text not null default 'active' check (status in ('active', 'archived')),
  created_by uuid not null,
  created_at timestamptz not null default now()
);
create index consequences_family_idx on public.consequences (family_id);

alter table public.consequences enable row level security;
create policy read_own on public.consequences for select to authenticated using (family_id in (select lq_private.my_families()));
revoke all on public.consequences from anon, authenticated;
grant select on public.consequences to authenticated;

-- Palabras de necesidades básicas (mismas raíces que touchesEssentialNeeds en TypeScript).
create function lq_private.touches_essentials(p_text text) returns boolean
language sql immutable as $$
  select exists (
    select 1
      from regexp_split_to_table(translate(lower(coalesce(p_text, '')), 'áéíóúüñ', 'aeiouun'), '[^a-z]+') t
     where t <> ''
       and (t in ('agua', 'come', 'comes')
            or t ~ '^(comer|comid|cena|desayun|almuerz|merienda|dorm|sueno|descans|colegio|escuela|medicin|medicament|higien|banar|abrazo|carino|afecto)')
  )
$$;

-- engine.createReward: ahora admite precio 0
create or replace function public.lq_create_reward(p_actor uuid, p_name text, p_description text, p_price int, p_conditions text) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare a public.members := lq_private.actor(p_actor); new_id uuid; st text := case when a.role = 'guardian' then 'approved' else 'proposed' end;
begin
  if p_price is null or p_price < 0 or p_price > 100000 then perform lq_private.fail('invalid_number', 'El precio debe ser un número entero entre 0 y 100000.'); end if;
  insert into public.rewards (family_id, name, description, price, conditions, status, created_by, reviewed_by)
  values (a.family_id, lq_private.txt(p_name, 1, 60, 'El nombre'), lq_private.txt(p_description, 0, 300, 'La descripción'), p_price,
    lq_private.txt(p_conditions, 0, 300, 'Las condiciones'), st, a.id, case when st = 'approved' then a.id end)
  returning id into new_id;
  perform lq_private.log(a.family_id, a.id, case when st = 'proposed' then 'reward.proposed' else 'reward.created' end, new_id::text, p_name);
  return new_id;
end $$;

-- engine.reviewReward: ahora admite precio 0
create or replace function public.lq_review_reward(p_actor uuid, p_reward uuid, p_decision text, p_name text, p_price int, p_conditions text) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare a public.members := lq_private.actor(p_actor); r public.rewards;
begin
  perform lq_private.require_guardian(a);
  select * into r from public.rewards where id = p_reward;
  if not found then perform lq_private.fail('not_found', 'Recompensa no encontrada.'); end if;
  perform lq_private.same_family(a, r.family_id);
  if r.status <> 'proposed' then perform lq_private.fail('not_proposal', 'Esta recompensa no está pendiente de revisión.'); end if;
  if p_decision not in ('approve', 'reject') then perform lq_private.fail('invalid_decision', 'Decisión no válida.'); end if;
  if p_price is not null and (p_price < 0 or p_price > 100000) then perform lq_private.fail('invalid_number', 'El precio debe ser un número entero entre 0 y 100000.'); end if;
  update public.rewards set
    name = case when p_name is null then name else lq_private.txt(p_name, 1, 60, 'El nombre') end,
    price = coalesce(p_price, price),
    conditions = case when p_conditions is null then conditions else lq_private.txt(p_conditions, 0, 300, 'Las condiciones') end,
    status = case when p_decision = 'approve' then 'approved' else 'rejected' end,
    reviewed_by = a.id
  where id = r.id;
  perform lq_private.log(r.family_id, a.id, 'reward.' || case when p_decision = 'approve' then 'approved' else 'rejected' end, r.id::text, r.name);
end $$;

-- engine.setupRewards: mínimo 10 recompensas (algunas pueden costar 0); sólo una vez por familia.
create function public.lq_setup_rewards(p_actor uuid, p_rewards jsonb) returns int
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  a public.members := lq_private.actor(p_actor); f public.families; it jsonb; nm text; seen text[] := '{}'; n int := 0;
begin
  perform lq_private.require_guardian(a);
  select * into f from public.families where id = a.family_id for update;
  if f.rewards_setup_done then perform lq_private.fail('already_done', 'La lista inicial de recompensas ya está configurada.'); end if;
  if p_rewards is null or jsonb_typeof(p_rewards) <> 'array' or jsonb_array_length(p_rewards) < 10 then
    perform lq_private.fail('too_few_rewards', 'Elige al menos 10 recompensas para empezar.');
  end if;
  for it in select * from jsonb_array_elements(p_rewards) loop
    nm := lq_private.txt(it ->> 'name', 1, 60, 'El nombre');
    if lower(nm) = any (seen) then perform lq_private.fail('duplicate_reward', 'La recompensa «' || nm || '» está repetida.'); end if;
    seen := seen || lower(nm);
    insert into public.rewards (family_id, name, description, price, conditions, status, created_by, reviewed_by)
    values (f.id, nm, lq_private.txt(it ->> 'description', 0, 300, 'La descripción'),
      lq_private.jint(it, 'price', null, 0, 100000, 'El precio'),
      lq_private.txt(it ->> 'conditions', 0, 300, 'Las condiciones'), 'approved', a.id, a.id);
    n := n + 1;
  end loop;
  update public.families set rewards_setup_done = true where id = f.id;
  perform lq_private.log(f.id, a.id, 'rewards.setup', null, n || ' recompensas iniciales');
  return n;
end $$;

-- engine.createConsequence
create function public.lq_create_consequence(p_actor uuid, p_name text, p_description text, p_threshold int, p_applies_to uuid[], p_confirm boolean) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare a public.members := lq_private.actor(p_actor); nm text; ds text; who uuid[]; w uuid; mem public.members; new_id uuid;
begin
  perform lq_private.require_guardian(a);
  nm := lq_private.txt(p_name, 1, 80, 'La consecuencia');
  ds := lq_private.txt(p_description, 0, 300, 'La descripción');
  if not coalesce(p_confirm, false) then perform lq_private.fail('confirm_required', 'Confirma que no afecta comida, sueño, descanso, educación ni afecto.'); end if;
  if lq_private.touches_essentials(nm || ' ' || ds) then
    perform lq_private.fail('essential_needs', 'Una consecuencia no puede afectar comida, sueño, descanso, educación, salud ni afecto.');
  end if;
  if p_threshold is null or p_threshold < 1 or p_threshold > 100000 then perform lq_private.fail('invalid_number', 'El umbral de monedas debe ser un número entero entre 1 y 100000.'); end if;
  select array_agg(distinct x) into who from unnest(coalesce(p_applies_to, '{}')) x;
  if who is null or cardinality(who) = 0 then perform lq_private.fail('no_assignee', 'Elige a quién se aplica.'); end if;
  foreach w in array who loop
    select * into mem from public.members where id = w;
    if not found or mem.family_id <> a.family_id then perform lq_private.fail('forbidden', 'Ese elemento pertenece a otra familia.'); end if;
    if not mem.plays_game then perform lq_private.fail('not_player', mem.name || ' no participa como jugador.'); end if;
  end loop;
  insert into public.consequences (family_id, name, description, threshold_coins, applies_to, created_by)
  values (a.family_id, nm, ds, p_threshold, who, a.id) returning id into new_id;
  perform lq_private.log(a.family_id, a.id, 'consequence.created', new_id::text, nm);
  return new_id;
end $$;

-- engine.archiveConsequence
create function public.lq_archive_consequence(p_actor uuid, p_rule uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare a public.members := lq_private.actor(p_actor); r public.consequences;
begin
  perform lq_private.require_guardian(a);
  select * into r from public.consequences where id = p_rule;
  if not found then perform lq_private.fail('not_found', 'Consecuencia no encontrada.'); end if;
  perform lq_private.same_family(a, r.family_id);
  update public.consequences set status = 'archived' where id = r.id;
  perform lq_private.log(r.family_id, a.id, 'consequence.archived', r.id::text, r.name);
end $$;

-- engine.removeChild: además quita al niño de las consecuencias y retira las que se quedan sin destinatarios.
create or replace function public.lq_remove_child(p_actor uuid, p_child uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare a public.members := lq_private.actor(p_actor); c public.members;
begin
  perform lq_private.require_guardian(a);
  select * into c from public.members where id = p_child;
  if not found then perform lq_private.fail('not_found', 'Miembro no encontrado.'); end if;
  perform lq_private.same_family(a, c.family_id);
  if c.role <> 'child' then perform lq_private.fail('forbidden', 'Sólo se pueden eliminar perfiles infantiles.'); end if;
  update public.missions set assignee_ids = array_remove(assignee_ids, c.id) where family_id = a.family_id;
  update public.missions set status = 'archived'
   where family_id = a.family_id and cardinality(assignee_ids) = 0 and status in ('proposed', 'active', 'suspended');
  update public.consequences set applies_to = array_remove(applies_to, c.id) where family_id = a.family_id;
  update public.consequences set status = 'archived' where family_id = a.family_id and cardinality(applies_to) = 0 and status = 'active';
  delete from public.members where id = c.id;
  perform lq_private.log(a.family_id, a.id, 'child.removed', null, c.name);
end $$;

-- ---------- permisos de ejecución (se repiten porque hay funciones nuevas) ----------
revoke execute on all functions in schema public from public, anon;
grant execute on all functions in schema public to authenticated;
revoke execute on all functions in schema lq_private from public, anon, authenticated;
grant execute on function lq_private.my_families(), lq_private.my_members() to authenticated;
