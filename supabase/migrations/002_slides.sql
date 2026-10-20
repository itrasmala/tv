-- =====================================================================
-- 002: عرض شرائح (صفحات PDF أو صور) بدل الفيديو في القسمين الجانبيين
-- شغّله مرة واحدة من SQL Editor بعد 001_schema.sql. آمن لإعادة التشغيل.
-- =====================================================================

create or replace function public.valid_slide_urls(p text[])
returns boolean language sql immutable
as $$
  select coalesce(array_length(p, 1), 0) <= 40
     and not exists (select 1 from unnest(p) x where x !~ '^https://' or char_length(x) > 600)
$$;

alter table public.screen_videos
  add column if not exists mode text not null default 'video',
  add column if not exists slide_urls text[] not null default '{}',
  add column if not exists slide_seconds smallint not null default 8;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'screen_videos_mode_check') then
    alter table public.screen_videos add constraint screen_videos_mode_check check (mode in ('video','slides'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'screen_videos_slide_urls_check') then
    alter table public.screen_videos add constraint screen_videos_slide_urls_check check (public.valid_slide_urls(slide_urls));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'screen_videos_slide_seconds_check') then
    alter table public.screen_videos add constraint screen_videos_slide_seconds_check check (slide_seconds between 3 and 120);
  end if;
end $$;

-- لقطة الشاشة تشمل إعدادات الشرائح
create or replace function public.display_snapshot(p_date date default null)
returns jsonb language plpgsql stable security definer set search_path = public
as $$
declare
  today date := public.riyadh_today();
  d date := coalesce(p_date, today);
begin
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
                  'url', v.url, 'fit', v.fit, 'poster_url', v.poster_url, 'enabled', v.enabled,
                  'mode', v.mode, 'slide_urls', v.slide_urls, 'slide_seconds', v.slide_seconds))
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
grant execute on function public.display_snapshot(date) to anon, authenticated;

-- السماح برفع صور الشرائح في مجلد slides لمن يملك صلاحية الفيديو
drop policy if exists media_insert on storage.objects;
drop policy if exists media_update on storage.objects;
drop policy if exists media_delete on storage.objects;

create policy media_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'media' and (
       ((storage.foldername(name))[1] in ('videos','posters','slides') and public.can_manage_videos())
    or ((storage.foldername(name))[1] = 'logos' and public.is_admin())));

create policy media_update on storage.objects for update to authenticated
  using (bucket_id = 'media' and (
       ((storage.foldername(name))[1] in ('videos','posters','slides') and public.can_manage_videos())
    or ((storage.foldername(name))[1] = 'logos' and public.is_admin())));

create policy media_delete on storage.objects for delete to authenticated
  using (bucket_id = 'media' and (
       ((storage.foldername(name))[1] in ('videos','posters','slides') and public.can_manage_videos())
    or ((storage.foldername(name))[1] = 'logos' and public.is_admin())));
