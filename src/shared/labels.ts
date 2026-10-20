import type { Role, TaskKind, TaskStatus } from './types';

export const STATUS_LABEL: Record<TaskStatus, string> = {
  not_started: 'لم تبدأ',
  in_progress: 'قيد التنفيذ',
  done: 'مكتملة',
  postponed: 'مؤجلة',
};

export const KIND_LABEL: Record<TaskKind, string> = {
  task: 'مهمة',
  meeting: 'اجتماع',
  prayer: 'صلاة',
  break: 'استراحة',
};

export const ROLE_LABEL: Record<Role, string> = {
  admin: 'مدير عام',
  editor: 'محرر محتوى',
  viewer: 'مشاهد فقط',
};

export const ENTITY_LABEL: Record<string, string> = {
  tasks: 'مهمة',
  day_content: 'الأولويات والملاحظات',
  templates: 'قالب',
  screen_settings: 'إعدادات الشاشة',
  screen_videos: 'فيديو',
  profiles: 'مستخدم',
};

export const ACTION_LABEL: Record<string, string> = {
  insert: 'إضافة',
  update: 'تعديل',
  delete: 'حذف',
};

export const SIDE_LABEL = { right: 'القسم الأيمن', left: 'القسم الأيسر' } as const;

export const DEFAULT_SETTINGS = {
  org_name: 'رسملة',
  screen_title: 'جدول العمل اليومي',
  logo_url: null,
  split_right: 25,
  split_center: 50,
  split_left: 25,
  color_primary: '#1B2A4A',
  color_accent: '#B8924A',
  color_bg: '#FAF6EE',
  color_prayer: '#E9F2EC',
  color_break: '#FBF1DE',
  page_seconds: 12,
  reload_hour: 4,
  time_format: '12' as const,
  numerals: 'latn' as const,
  show_hijri: true,
  show_assignee: true,
};
