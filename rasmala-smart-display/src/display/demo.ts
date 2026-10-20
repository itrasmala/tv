// بيانات عرض تجريبية تُستخدم فقط إذا لم تُضبط مفاتيح Supabase بعد (أو مع ?demo=1)
// حتى تتمكن من رؤية التصميم قبل ربط قاعدة البيانات. تظهر معها شارة «وضع تجريبي».
import type { Snapshot } from '../shared/types';
import { DEFAULT_SETTINGS } from '../shared/labels';

export function demoSnapshot(today: string): Snapshot {
  const t = (id: number, title: string, s: string, e: string, status: string, kind: string, assignee: string | null = null) =>
    ({ id: String(id), title, start_time: s, end_time: e, status, kind, assignee }) as Snapshot['tasks'][number];
  return {
    today,
    date: today,
    server_time: new Date().toISOString(),
    version: 0,
    settings: { ...DEFAULT_SETTINGS },
    videos: {},
    day: {
      priorities: [
        'إنهاء تقرير الأداء الشهري وتسليمه للإدارة',
        'اعتماد خطة التسويق للربع القادم',
        'الرد على جميع طلبات العملاء المعلقة',
      ],
      notes: 'يرجى تحديث حالة المهام في لوحة الإدارة أولًا بأول، والالتزام بمواعيد الاجتماعات.',
    },
    tasks: [
      t(1, 'مراجعة البريد وتحديد مهام اليوم', '08:00', '08:30', 'done', 'task', 'الجميع'),
      t(2, 'الاجتماع الصباحي للفريق', '08:30', '09:00', 'done', 'meeting', 'مدير الإدارة'),
      t(3, 'إعداد تقرير الأداء الشهري', '09:00', '10:30', 'in_progress', 'task', 'قسم التخطيط'),
      t(4, 'متابعة طلبات العملاء والردود المعلقة', '10:30', '11:45', 'not_started', 'task', 'خدمة العملاء'),
      t(5, 'صلاة الظهر', '11:50', '12:15', 'not_started', 'prayer'),
      t(6, 'استراحة الغداء', '12:15', '13:00', 'not_started', 'break'),
      t(7, 'اجتماع مراجعة خطة التسويق', '13:00', '14:00', 'not_started', 'meeting', 'فريق التسويق'),
      t(8, 'مراجعة عقود الموردين', '14:00', '15:10', 'postponed', 'task', 'الشؤون القانونية'),
      t(9, 'صلاة العصر', '15:15', '15:35', 'not_started', 'prayer'),
      t(10, 'تحديث حالة المهام وتسليم المنجز', '15:35', '16:30', 'not_started', 'task', 'الجميع'),
      t(11, 'التخطيط لمهام الغد', '16:30', '17:00', 'not_started', 'task', 'مدير الإدارة'),
    ],
  };
}
