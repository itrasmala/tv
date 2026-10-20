-- =====================================================================
-- Rasmala Smart Display — مخطط قاعدة البيانات وسياسات الأمان (Supabase)
-- شغّل هذا الملف مرة واحدة من: Supabase Dashboard ← SQL Editor
-- الملف قابل لإعادة التشغيل (idempotent) قدر الإمكان.
-- =====================================================================

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------
-- أدوات مساعدة عامة
-- ---------------------------------------------------------------------

-- تاريخ اليوم حسب توقيت الرياض (الخادم هو المرجع وليس ساعة التلفزيون)
create or replace function public.riyadh_today()
returns date language sql stable
as $$ select (now() at time zone 'Asia/Riyadh')::date $$;

-- ---------------------------------------------------------------------
-- 1) المستخدمون والأدوار
-- ---------------------------------------------------------------------
create table if not exists public.profiles (
  id                uuid primary key references auth.users(id) on delete cascade,
  email             text not null,
  full_name         text not null default '' check (char_length(full_name) <= 100),
  role              text not null default 'viewer' check (role in ('admin','editor','viewer')),
  can_manage_videos boolean not null default false,
  is_active         boolean not null default true,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

-- الدور الفعّال للمستخدم الحالي (null إن لم يكن مسجلًا أو كان معطّلًا)
create or replace function public.app_role()
returns text language sql stable security definer set search_path = public
as $$ select role from public.profiles where id = auth.uid() and is_active $$;

create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = public
as $$ select coalesce(public.app_role() = 'admin', false) $$;

create or replace function public.can_edit()
returns boolean language sql stable security definer set search_path = public
as $$ select coalesce(public.app_role() in ('admin','editor'), false) $$;

create or replace function public.can_read()
returns boolean language sql stable security definer set search_path = public
as $$ select public.app_role() is not null $$;

create or replace function public.can_manage_videos()
returns boolean language sql stable security definer set search_path = public
as $$
  select coalesce((
    select p.role = 'admin' or (p.role = 'editor' and p.can_manage_videos)
    from public.profiles p where p.id = auth.uid() and p.is_active
  ), false)
$$;

-- إنشاء ملف المستخدم تلقائيًا عند إنشاء حساب في Supabase Auth.
-- أول مستخدم في النظام يصبح «مديرًا عامًا»، وأي مستخدم بعده يبدأ «مشاهدًا».
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public
as $$
begin
  insert into public.profiles (id, email, full_name, role)
  values (
    new.id,
    coalesce(new.email, ''),
    left(coalesce(new.raw_user_meta_data->>'full_name', ''), 100),
    case when exists (select 1 from public.profiles where role = 'admin') then 'viewer' else 'admin' end
  )
  on conflict (id) do nothing;
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- حماية: لا يغيّر المستخدم دوره بنفسه، ولا يُحذف/يُعطّل آخر مدير عام.
create or replace function public.protect_profiles()
returns trigger language plpgsql security definer set search_path = public
as $$
declare remaining int;
begin
  if tg_op = 'UPDATE' then
    -- auth.uid() يكون null عند التنفيذ بمفتاح الخدمة (Edge Function) أو من SQL Editor
    if auth.uid() is not null and not public.is_admin() and (
         new.role is distinct from old.role
      or new.is_active is distinct from old.is_active
      or new.can_manage_videos is distinct from old.can_manage_videos
      or new.email is distinct from old.email
      or new.id is distinct from old.id) then
      raise exception 'لا تملك صلاحية تعديل الأدوار أو حالة الحساب' using errcode = '42501';
    end if;
    new.updated_at := now();
    if old.role = 'admin' and old.is_active and (new.role <> 'admin' or not new.is_active) then
      select count(*) into remaining from public.profiles
       where role = 'admin' and is_active and id <> old.id;
      if remaining = 0 then
        raise exception 'لا يمكن إزالة صلاحية آخر مدير عام نشط' using errcode = 'P0001';
      end if;
    end if;
    return new;
  elsif tg_op = 'DELETE' then
    if old.role = 'admin' and old.is_active then
      select count(*) into remaining from public.profiles
       where role = 'admin' and is_active and id <> old.id;
      if remaining = 0 then
        raise exception 'لا يمكن حذف آخر مدير عام نشط' using errcode = 'P0001';
      end if;
    end if;
    return old;
  end if;
  return null;
end $$;

drop trigger if exists profiles_protect on public.profiles;
create trigger profiles_protect
  before update or delete on public.profiles
  for each row execute function public.protect_profiles();

-- ---------------------------------------------------------------------
-- 2) المهام اليومية
-- ---------------------------------------------------------------------
create table if not exists public.tasks (
  id          uuid primary key default gen_random_uuid(),
  task_date   date not null,
  title       text not null check (char_length(btrim(title)) between 1 and 200),
  start_time  time,
  end_time    time,
  assignee    text check (assignee is null or char_length(assignee) <= 100),
  notes       text check (notes is null or char_length(notes) <= 1000),
  status      text not null default 'not_started'
              check (status in ('not_started','in_progress','done','postponed')),
  kind        text not null default 'task'
              check (kind in ('task','meeting','prayer','break')),
  sort_order  integer not null default 0,
  is_visible  boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  updated_by  uuid references auth.users(id) on delete set null,
  constraint tasks_time_order check (start_time is null or end_time is null or end_time > start_time)
);
create index if not exists tasks_date_order_idx on public.tasks (task_date, sort_order);

-- ---------------------------------------------------------------------
-- 3) الأولويات والملاحظات اليومية
-- ---------------------------------------------------------------------
create or replace function public.valid_priorities(p text[])
returns boolean language sql immutable
as $$
  select coalesce(array_length(p, 1), 0) <= 3
     and not exists (select 1 from unnest(p) x where char_length(x) > 160)
$$;

create table if not exists public.day_content (
  day         date primary key,
  priorities  text[] not null default '{}' check (public.valid_priorities(priorities)),
  notes       text not null default '' check (char_length(notes) <= 2000),
  updated_at  timestamptz not null default now(),
  updated_by  uuid references auth.users(id) on delete set null
);

-- ---------------------------------------------------------------------
-- 4) قوالب الجداول المتكررة
-- ---------------------------------------------------------------------
create table if not exists public.templates (
  id          uuid primary key default gen_random_uuid(),
  name        text not null unique check (char_length(btrim(name)) between 1 and 80),
  items       jsonb not null default '[]'::jsonb check (jsonb_typeof(items) = 'array'),
  priorities  text[] not null default '{}' check (public.valid_priorities(priorities)),
  notes       text not null default '' check (char_length(notes) <= 2000),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  updated_by  uuid references auth.users(id) on delete set null
);

-- ---------------------------------------------------------------------
-- 5) إعدادات الشاشة (صف واحد) — يعدّلها المدير العام فقط
-- ---------------------------------------------------------------------
create table if not exists public.screen_settings (
  id             smallint primary key default 1 check (id = 1),
  org_name       text not null default 'رسملة' check (char_length(org_name) <= 80),
  screen_title   text not null default 'جدول العمل اليومي' check (char_length(screen_title) <= 80),
  logo_url       text check (logo_url is null or logo_url ~ '^https://'),
  split_right    smallint not null default 25 check (split_right between 0 and 40),
  split_center   smallint not null default 50 check (split_center between 30 and 100),
  split_left     smallint not null default 25 check (split_left between 0 and 40),
  color_primary  text not null default '#1B2A4A' check (color_primary ~ '^#[0-9A-Fa-f]{6}$'),
  color_accent   text not null default '#B8924A' check (color_accent  ~ '^#[0-9A-Fa-f]{6}$'),
  color_bg       text not null default '#FAF6EE' check (color_bg      ~ '^#[0-9A-Fa-f]{6}$'),
  color_prayer   text not null default '#E9F2EC' check (color_prayer  ~ '^#[0-9A-Fa-f]{6}$'),
  color_break    text not null default '#FBF1DE' check (color_break   ~ '^#[0-9A-Fa-f]{6}$'),
  page_seconds   smallint not null default 12 check (page_seconds between 5 and 120),
  reload_hour    smallint default 4 check (reload_hour is null or reload_hour between 0 and 23),
  time_format    text not null default '12' check (time_format in ('12','24')),
  numerals       text not null default 'latn' check (numerals in ('latn','arab')),
  show_hijri     boolean not null default true,
  show_assignee  boolean not null default true,
  updated_at     timestamptz not null default now(),
  updated_by     uuid references auth.users(id) on delete set null,
  constraint split_sum_100 check (split_right + split_center + split_left = 100)
);

-- ---------------------------------------------------------------------
-- 6) فيديوهات الجانبين — للمدير العام أو المحرر الممنوح صلاحية الفيديو
-- ---------------------------------------------------------------------
create table if not exists public.screen_videos (
  side        text primary key check (side in ('right','left')),
  url         text check (url is null or url ~ '^https://'),
  fit         text not null default 'cover' check (fit in ('cover','contain')),
  poster_url  text check (poster_url is null or poster_url ~ '^https://'),
  enabled     boolean not null default true,
  updated_at  timestamptz not null default now(),
  updated_by  uuid references auth.users(id) on delete set null
);

-- ---------------------------------------------------------------------
-- 7) سجل التدقيق + إشارة التحديث للشاشة
-- ---------------------------------------------------------------------
create table if not exists public.audit_log (
  id           bigint generated always as identity primary key,
  at           timestamptz not null default now(),
  actor_id     uuid,
  actor_email  text,
  actor_name   text,
  action       text not null check (action in ('insert','update','delete')),
  entity       text not null,
  record_id    text,
  summary      text,
  old_data     jsonb,
  new_data     jsonb
);
create index if not exists audit_log_at_idx on public.audit_log (at desc);
create index if not exists audit_log_entity_idx on public.audit_log (entity, at desc);

-- صف واحد يتغير رقم نسخته مع أي تعديل يخص الشاشة.
-- الشاشة تشترك فيه عبر Realtime ثم تجلب لقطة البيانات كاملة (طلب واحد خفيف).
create table if not exists public.screen_signal (
  id          smallint primary key default 1 check (id = 1),
  version     bigint not null default 1,
  changed_at  timestamptz not null default now()
);

-- تعبئة updated_at و updated_by تلقائيًا
create or replace function public.set_updated_meta()
returns trigger language plpgsql
as $$
begin
  new.updated_at := now();
  if auth.uid() is not null then new.updated_by := auth.uid(); end if;
  return new;
end $$;

-- تسجيل كل إضافة/تعديل/حذف في سجل التدقيق
create or replace function public.audit_row()
returns trigger language plpgsql security definer set search_path = public
as $$
declare
  o jsonb := case when tg_op in ('UPDATE','DELETE') then to_jsonb(old) end;
  n jsonb := case when tg_op in ('INSERT','UPDATE') then to_jsonb(new) end;
  pk text := tg_argv[0];
  a_email text; a_name text;
begin
  -- عمليات المستخدمين عبر مفتاح الخدمة تُسجَّل صراحةً من Edge Function
  if tg_table_name = 'profiles' and auth.uid() is null then
    return null;
  end if;
  -- تجاهل التعديلات التي لم تغيّر شيئًا فعليًا
  if tg_op = 'UPDATE' and (o - 'updated_at' - 'updated_by') = (n - 'updated_at' - 'updated_by') then
    return null;
  end if;
  select p.email, p.full_name into a_email, a_name from public.profiles p where p.id = auth.uid();
  insert into public.audit_log (actor_id, actor_email, actor_name, action, entity, record_id, summary, old_data, new_data)
  values (
    auth.uid(), a_email, a_name, lower(tg_op), tg_table_name,
    coalesce(n->>pk, o->>pk),
    left(coalesce(n->>'title', o->>'title', n->>'name', o->>'name', n->>'email', o->>'email', n->>'day', o->>'day', n->>'side', o->>'side'), 200),
    o, n
  );
  return null;
end $$;

create or replace function public.bump_screen_signal()
returns trigger language plpgsql security definer set search_path = public
as $$
begin
  update public.screen_signal set version = version + 1, changed_at = now() where id = 1;
  return null;
end $$;

-- ربط المشغلات بالجداول
do $$
declare t record;
begin
  for t in select * from (values
      ('tasks','id', true, true),
      ('day_content','day', true, true),
      ('templates','id', true, false),
      ('screen_settings','id', true, true),
      ('screen_videos','side', true, true),
      ('profiles','id', false, false)
    ) as v(tbl, pk, meta, signal)
  loop
    if t.meta then
      execute format('drop trigger if exists %1$s_meta on public.%1$s', t.tbl);
      execute format('create trigger %1$s_meta before insert or update on public.%1$s for each row execute function public.set_updated_meta()', t.tbl);
    end if;
    execute format('drop trigger if exists %1$s_audit on public.%1$s', t.tbl);
    execute format('create trigger %1$s_audit after insert or update or delete on public.%1$s for each row execute function public.audit_row(%2$L)', t.tbl, t.pk);
    if t.signal then
      execute format('drop trigger if exists %1$s_signal on public.%1$s', t.tbl);
      execute format('create trigger %1$s_signal after insert or update or delete on public.%1$s for each statement execute function public.bump_screen_signal()', t.tbl);
    end if;
  end loop;
end $$;

-- ---------------------------------------------------------------------
-- 8) Row Level Security
-- ---------------------------------------------------------------------
alter table public.profiles        enable row level security;
alter table public.tasks           enable row level security;
alter table public.day_content     enable row level security;
alter table public.templates       enable row level security;
alter table public.screen_settings enable row level security;
alter table public.screen_videos   enable row level security;
alter table public.audit_log       enable row level security;
alter table public.screen_signal   enable row level security;

-- إزالة السياسات القديمة لإعادة التشغيل الآمن
do $$
declare p record;
begin
  for p in select policyname, tablename from pg_policies
           where schemaname = 'public'
             and tablename in ('profiles','tasks','day_content','templates','screen_settings','screen_videos','audit_log','screen_signal')
  loop
    execute format('drop policy if exists %I on public.%I', p.policyname, p.tablename);
  end loop;
end $$;

-- profiles: كل مستخدم يرى نفسه، والمدير يرى الجميع ويعدّلهم
create policy profiles_select on public.profiles for select to authenticated
  using (id = auth.uid() or public.is_admin());
create policy profiles_update on public.profiles for update to authenticated
  using (id = auth.uid() or public.is_admin())
  with check (id = auth.uid() or public.is_admin());
-- لا إضافة/حذف من الواجهة؛ تتم عبر Edge Function بمفتاح الخدمة

-- tasks / day_content / templates: القراءة لأي مستخدم نشط، والكتابة للمدير والمحرر
create policy tasks_select on public.tasks for select to authenticated using (public.can_read());
create policy tasks_insert on public.tasks for insert to authenticated with check (public.can_edit());
create policy tasks_update on public.tasks for update to authenticated using (public.can_edit()) with check (public.can_edit());
create policy tasks_delete on public.tasks for delete to authenticated using (public.can_edit());

create policy day_select on public.day_content for select to authenticated using (public.can_read());
create policy day_insert on public.day_content for insert to authenticated with check (public.can_edit());
create policy day_update on public.day_content for update to authenticated using (public.can_edit()) with check (public.can_edit());
create policy day_delete on public.day_content for delete to authenticated using (public.can_edit());

create policy tpl_select on public.templates for select to authenticated using (public.can_read());
create policy tpl_insert on public.templates for insert to authenticated with check (public.can_edit());
create policy tpl_update on public.templates for update to authenticated using (public.can_edit()) with check (public.can_edit());
create policy tpl_delete on public.templates for delete to authenticated using (public.can_edit());

-- screen_settings: القراءة لأي مستخدم نشط، التعديل للمدير العام فقط
create policy settings_select on public.screen_settings for select to authenticated using (public.can_read());
create policy settings_update on public.screen_settings for update to authenticated using (public.is_admin()) with check (public.is_admin());

-- screen_videos: التعديل للمدير أو المحرر الممنوح صلاحية الفيديو
create policy videos_select on public.screen_videos for select to authenticated using (public.can_read());
create policy videos_update on public.screen_videos for update to authenticated using (public.can_manage_videos()) with check (public.can_manage_videos());

-- audit_log: المدير العام فقط، ولا يمكن لأحد تعديله أو حذفه من الواجهة
create policy audit_select on public.audit_log for select to authenticated using (public.is_admin());

-- screen_signal: رقم نسخة فقط، مقروء للجميع (لا يحتوي بيانات)
create policy signal_select on public.screen_signal for select to anon, authenticated using (true);

-- صلاحيات صريحة على مستوى الجداول (لا نعتمد على الصلاحيات الافتراضية للمشروع).
-- الزائر المجهول (شاشة التلفزيون) لا يقرأ أي جدول مباشرة؛ يستخدم الدالة display_snapshot فقط.
grant usage on schema public to anon, authenticated;
revoke all on public.profiles, public.tasks, public.day_content, public.templates,
              public.screen_settings, public.screen_videos, public.audit_log, public.screen_signal
       from anon, authenticated;
grant select, update                  on public.profiles        to authenticated;
grant select, insert, update, delete  on public.tasks           to authenticated;
grant select, insert, update, delete  on public.day_content     to authenticated;
grant select, insert, update, delete  on public.templates       to authenticated;
grant select, update                  on public.screen_settings to authenticated;
grant select, update                  on public.screen_videos   to authenticated;
grant select                          on public.audit_log       to authenticated;
grant select                          on public.screen_signal   to anon, authenticated;

-- ---------------------------------------------------------------------
-- 9) دوال API
-- ---------------------------------------------------------------------

-- لقطة واحدة خفيفة لكل ما تحتاجه شاشة العرض (طلب واحد بدل عدة طلبات)
create or replace function public.display_snapshot(p_date date default null)
returns jsonb language plpgsql stable security definer set search_path = public
as $$
declare
  today date := public.riyadh_today();
  d date := coalesce(p_date, today);
begin
  -- الزائر المجهول يرى جدول اليوم فقط؛ معاينة الأيام الأخرى تحتاج تسجيل دخول
  if d <> today and not public.can_read() then
    raise exception 'المعاينة لتواريخ أخرى تتطلب تسجيل الدخول' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'today', today,
    'date', d,
    'server_time', now(),
    'version', (select version from public.screen_signal where id = 1),
    'settings', (select to_jsonb(s) - 'updated_by' - 'id' from public.screen_settings s where id = 1),
    'videos', coalesce((select jsonb_object_agg(v.side, jsonb_build_object(
                  'url', v.url, 'fit', v.fit, 'poster_url', v.poster_url, 'enabled', v.enabled))
               from public.screen_videos v), '{}'::jsonb),
    'day', (select jsonb_build_object('priorities', c.priorities, 'notes', c.notes)
              from public.day_content c where c.day = d),
    'tasks', coalesce((select jsonb_agg(jsonb_build_object(
                  'id', t.id, 'title', t.title,
                  'start_time', to_char(t.start_time, 'HH24:MI'),
                  'end_time', to_char(t.end_time, 'HH24:MI'),
                  'assignee', t.assignee, 'status', t.status, 'kind', t.kind)
                order by t.sort_order, t.start_time nulls last, t.created_at)
               from public.tasks t where t.task_date = d and t.is_visible), '[]'::jsonb)
  );
end $$;

-- آخر تعديل (الوقت واسم المستخدم) — متاح لكل مستخدم نشط في لوحة الإدارة
create or replace function public.get_last_update()
returns table (at timestamptz, actor_name text, actor_email text, entity text, action text, summary text)
language plpgsql stable security definer set search_path = public
as $$
begin
  if not public.can_read() then
    raise exception 'غير مصرح' using errcode = '42501';
  end if;
  return query
    select a.at, a.actor_name, a.actor_email, a.entity, a.action, a.summary
      from public.audit_log a
     where a.entity <> 'profiles'
     order by a.at desc limit 1;
end $$;

-- تغيير ترتيب المهام: يستقبل المعرفات بالترتيب المطلوب
create or replace function public.reorder_tasks(p_ids uuid[])
returns void language plpgsql security invoker set search_path = public
as $$
begin
  if not public.can_edit() then
    raise exception 'لا تملك صلاحية تعديل المهام' using errcode = '42501';
  end if;
  update public.tasks t
     set sort_order = x.ord * 10
    from unnest(p_ids) with ordinality as x(id, ord)
   where t.id = x.id and t.sort_order is distinct from x.ord * 10;
end $$;

-- نسخ جدول يوم إلى يوم آخر. p_mode: 'replace' يستبدل مهام اليوم الهدف، 'append' يضيف إليها
create or replace function public.copy_day(p_from date, p_to date, p_mode text default 'append', p_include_day boolean default true)
returns integer language plpgsql security invoker set search_path = public
as $$
declare n integer; base integer;
begin
  if not public.can_edit() then
    raise exception 'لا تملك صلاحية تعديل المهام' using errcode = '42501';
  end if;
  if p_from = p_to then
    raise exception 'اختر تاريخين مختلفين' using errcode = '22023';
  end if;
  if p_mode not in ('append','replace') then
    raise exception 'وضع النسخ غير صالح' using errcode = '22023';
  end if;
  if p_mode = 'replace' then
    delete from public.tasks where task_date = p_to;
  end if;
  select coalesce(max(sort_order), 0) into base from public.tasks where task_date = p_to;
  insert into public.tasks (task_date, title, start_time, end_time, assignee, notes, status, kind, sort_order, is_visible)
  select p_to, title, start_time, end_time, assignee, notes, 'not_started', kind, base + sort_order + 10, is_visible
    from public.tasks where task_date = p_from;
  get diagnostics n = row_count;
  if p_include_day then
    insert into public.day_content (day, priorities, notes)
    select p_to, priorities, notes from public.day_content where day = p_from
    on conflict (day) do update set priorities = excluded.priorities, notes = excluded.notes;
  end if;
  return n;
end $$;

-- حفظ جدول يوم كقالب (يستبدل القالب إن كان بنفس الاسم)
create or replace function public.save_template(p_name text, p_date date)
returns uuid language plpgsql security invoker set search_path = public
as $$
declare tid uuid;
begin
  if not public.can_edit() then
    raise exception 'لا تملك صلاحية حفظ القوالب' using errcode = '42501';
  end if;
  insert into public.templates (name, items, priorities, notes)
  select btrim(p_name),
         coalesce((select jsonb_agg(jsonb_build_object(
                     'title', t.title,
                     'start_time', to_char(t.start_time, 'HH24:MI'),
                     'end_time', to_char(t.end_time, 'HH24:MI'),
                     'assignee', t.assignee, 'notes', t.notes,
                     'kind', t.kind, 'is_visible', t.is_visible)
                   order by t.sort_order, t.start_time nulls last)
                   from public.tasks t where t.task_date = p_date), '[]'::jsonb),
         coalesce((select priorities from public.day_content where day = p_date), '{}'),
         coalesce((select notes from public.day_content where day = p_date), '')
  on conflict (name) do update
     set items = excluded.items, priorities = excluded.priorities, notes = excluded.notes
  returning id into tid;
  return tid;
end $$;

-- تطبيق قالب على تاريخ
create or replace function public.apply_template(p_template uuid, p_date date, p_mode text default 'replace', p_include_day boolean default true)
returns integer language plpgsql security invoker set search_path = public
as $$
declare tpl public.templates; n integer; base integer;
begin
  if not public.can_edit() then
    raise exception 'لا تملك صلاحية تعديل المهام' using errcode = '42501';
  end if;
  if p_mode not in ('append','replace') then
    raise exception 'وضع التطبيق غير صالح' using errcode = '22023';
  end if;
  select * into tpl from public.templates where id = p_template;
  if not found then
    raise exception 'القالب غير موجود' using errcode = 'P0002';
  end if;
  if p_mode = 'replace' then
    delete from public.tasks where task_date = p_date;
  end if;
  select coalesce(max(sort_order), 0) into base from public.tasks where task_date = p_date;
  insert into public.tasks (task_date, title, start_time, end_time, assignee, notes, status, kind, sort_order, is_visible)
  select p_date,
         i->>'title',
         nullif(i->>'start_time','')::time,
         nullif(i->>'end_time','')::time,
         nullif(i->>'assignee',''),
         nullif(i->>'notes',''),
         'not_started',
         coalesce(i->>'kind','task'),
         base + (ord * 10)::int,
         coalesce((i->>'is_visible')::boolean, true)
    from jsonb_array_elements(tpl.items) with ordinality as x(i, ord);
  get diagnostics n = row_count;
  if p_include_day then
    insert into public.day_content (day, priorities, notes)
    values (p_date, tpl.priorities, tpl.notes)
    on conflict (day) do update set priorities = excluded.priorities, notes = excluded.notes;
  end if;
  return n;
end $$;

-- صلاحيات تنفيذ الدوال
revoke execute on function public.reorder_tasks(uuid[]) from public, anon;
revoke execute on function public.copy_day(date, date, text, boolean) from public, anon;
revoke execute on function public.save_template(text, date) from public, anon;
revoke execute on function public.apply_template(uuid, date, text, boolean) from public, anon;
revoke execute on function public.get_last_update() from public, anon;
grant execute on function public.reorder_tasks(uuid[]) to authenticated;
grant execute on function public.copy_day(date, date, text, boolean) to authenticated;
grant execute on function public.save_template(text, date) to authenticated;
grant execute on function public.apply_template(uuid, date, text, boolean) to authenticated;
grant execute on function public.get_last_update() to authenticated;
grant execute on function public.display_snapshot(date) to anon, authenticated;

-- ---------------------------------------------------------------------
-- 10) الصفوف الافتراضية
-- ---------------------------------------------------------------------
insert into public.screen_settings (id) values (1) on conflict (id) do nothing;
insert into public.screen_signal (id) values (1) on conflict (id) do nothing;
insert into public.screen_videos (side) values ('right'), ('left') on conflict (side) do nothing;

-- ---------------------------------------------------------------------
-- 11) التخزين (فيديوهات، شعار، صور احتياطية)
-- ---------------------------------------------------------------------
-- ملاحظة: الحد الأقصى لحجم الملف في الخطة المجانية لـ Supabase هو 50MB
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('media', 'media', true, 52428800,
        array['video/mp4','image/png','image/jpeg','image/webp'])
on conflict (id) do update
  set public = true,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists media_read on storage.objects;
drop policy if exists media_insert on storage.objects;
drop policy if exists media_update on storage.objects;
drop policy if exists media_delete on storage.objects;

-- الملفات عامة للعرض عبر الرابط المباشر، أما استعراض القائمة فلمستخدمي اللوحة فقط
create policy media_read on storage.objects for select to authenticated
  using (bucket_id = 'media' and public.can_read());

create policy media_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'media' and (
       ((storage.foldername(name))[1] in ('videos','posters') and public.can_manage_videos())
    or ((storage.foldername(name))[1] = 'logos' and public.is_admin())));

create policy media_update on storage.objects for update to authenticated
  using (bucket_id = 'media' and (
       ((storage.foldername(name))[1] in ('videos','posters') and public.can_manage_videos())
    or ((storage.foldername(name))[1] = 'logos' and public.is_admin())));

create policy media_delete on storage.objects for delete to authenticated
  using (bucket_id = 'media' and (
       ((storage.foldername(name))[1] in ('videos','posters') and public.can_manage_videos())
    or ((storage.foldername(name))[1] = 'logos' and public.is_admin())));

-- ---------------------------------------------------------------------
-- 12) Realtime: الشاشة تستمع لـ screen_signal، واللوحة تستمع للمهام
-- ---------------------------------------------------------------------
do $$
declare t text;
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    foreach t in array array['screen_signal','tasks','day_content'] loop
      if not exists (select 1 from pg_publication_tables
                      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t) then
        execute format('alter publication supabase_realtime add table public.%I', t);
      end if;
    end loop;
  end if;
end $$;
