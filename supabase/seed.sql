-- =====================================================================
-- بيانات تجريبية: جدول عمل يومي نموذجي لتاريخ اليوم (توقيت الرياض)
-- شغّله بعد 001_schema.sql من SQL Editor. يمكن حذف هذه البيانات لاحقًا من لوحة الإدارة.
-- =====================================================================

do $$
declare d date := public.riyadh_today();
begin
  if exists (select 1 from public.tasks where task_date = d) then
    raise notice 'توجد مهام لتاريخ اليوم بالفعل — لم تُضف بيانات تجريبية.';
    return;
  end if;

  insert into public.tasks (task_date, title, start_time, end_time, assignee, status, kind, sort_order) values
    (d, 'مراجعة البريد وتحديد مهام اليوم',            '08:00', '08:30', 'الجميع',          'done',        'task',    10),
    (d, 'الاجتماع الصباحي للفريق',                    '08:30', '09:00', 'مدير الإدارة',    'done',        'meeting', 20),
    (d, 'إعداد تقرير الأداء الشهري',                  '09:00', '10:30', 'قسم التخطيط',     'in_progress', 'task',    30),
    (d, 'متابعة طلبات العملاء والردود المعلقة',        '10:30', '11:45', 'خدمة العملاء',    'not_started', 'task',    40),
    (d, 'صلاة الظهر',                                 '11:50', '12:15', null,              'not_started', 'prayer',  50),
    (d, 'استراحة الغداء',                             '12:15', '13:00', null,              'not_started', 'break',   60),
    (d, 'اجتماع مراجعة خطة التسويق',                  '13:00', '14:00', 'فريق التسويق',    'not_started', 'meeting', 70),
    (d, 'مراجعة عقود الموردين',                       '14:00', '15:10', 'الشؤون القانونية', 'postponed',   'task',    80),
    (d, 'صلاة العصر',                                 '15:15', '15:35', null,              'not_started', 'prayer',  90),
    (d, 'تحديث حالة المهام وتسليم المنجز',             '15:35', '16:30', 'الجميع',          'not_started', 'task',   100),
    (d, 'التخطيط لمهام الغد',                          '16:30', '17:00', 'مدير الإدارة',    'not_started', 'task',   110);

  insert into public.day_content (day, priorities, notes) values (
    d,
    array['إنهاء تقرير الأداء الشهري وتسليمه للإدارة',
          'اعتماد خطة التسويق للربع القادم',
          'الرد على جميع طلبات العملاء المعلقة'],
    'يرجى تحديث حالة المهام في لوحة الإدارة أولًا بأول، والالتزام بمواعيد الاجتماعات.'
  ) on conflict (day) do nothing;
end $$;

-- قالب «يوم عمل اعتيادي» من نفس الجدول
insert into public.templates (name, items, priorities, notes)
select 'يوم عمل اعتيادي',
       (select jsonb_agg(jsonb_build_object(
                 'title', t.title,
                 'start_time', to_char(t.start_time, 'HH24:MI'),
                 'end_time', to_char(t.end_time, 'HH24:MI'),
                 'assignee', t.assignee, 'notes', t.notes,
                 'kind', t.kind, 'is_visible', t.is_visible)
               order by t.sort_order)
          from public.tasks t where t.task_date = public.riyadh_today()),
       coalesce((select priorities from public.day_content where day = public.riyadh_today()), '{}'),
       coalesce((select notes from public.day_content where day = public.riyadh_today()), '')
where not exists (select 1 from public.templates where name = 'يوم عمل اعتيادي')
  and exists (select 1 from public.tasks where task_date = public.riyadh_today());
