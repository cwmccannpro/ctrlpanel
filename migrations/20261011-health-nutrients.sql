-- Existing tables already have owner-only RLS. No new rows or reference data.
alter table nutrition_logs add column if not exists micros jsonb default '{}'::jsonb;
alter table user_goals add column if not exists micros jsonb not null default '{}'::jsonb;

-- Patch one nutrient atomically so edits from multiple panels preserve other targets.
create or replace function public.set_nutrition_target(nutrient text, target numeric)
returns setof public.user_goals
language plpgsql security invoker set search_path = public as $$
declare goal_id uuid;
begin
  if auth.uid() is null then raise exception 'Sign in to edit nutrition targets.'; end if;
  if target is null or target < 0 or target > 100000 or target::text in ('NaN', 'Infinity', '-Infinity') then
    raise exception 'Invalid nutrition target.';
  end if;
  if nutrient not in ('calories','protein','carbs','fat','fiber','vitamin_d','calcium','iron','potassium','magnesium','vitamin_c','vitamin_b12','zinc','sodium','vitamin_a','vitamin_e','vitamin_k','thiamin','riboflavin','niacin','pantothenic_acid','vitamin_b6','biotin','folate','choline','phosphorus','iodine','selenium','copper','manganese','chromium','molybdenum','chloride','saturated_fat','added_sugar','cholesterol') then
    raise exception 'Unknown nutrient.';
  end if;
  -- Also serialize the initial empty-account insert without a new unique index.
  perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text || ':nutrition-goals', 0));
  select id into goal_id from user_goals where user_id = auth.uid() order by updated_at desc, id desc limit 1 for update;
  if goal_id is null then insert into user_goals default values returning id into goal_id; end if;
  if nutrient in ('calories','protein','carbs','fat') then
    execute format('update public.user_goals set %I = $1, updated_at = now() where id = $2', nutrient) using target, goal_id;
  else
    update user_goals set micros = coalesce(micros, '{}'::jsonb) || jsonb_build_object(nutrient, target), updated_at = now() where id = goal_id;
  end if;
  return query select * from user_goals where id = goal_id;
end;
$$;
revoke all on function public.set_nutrition_target(text, numeric) from public;
grant execute on function public.set_nutrition_target(text, numeric) to authenticated;
