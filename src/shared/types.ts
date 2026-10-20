export type TaskStatus = 'not_started' | 'in_progress' | 'done' | 'postponed';
export type TaskKind = 'task' | 'meeting' | 'prayer' | 'break';
export type Role = 'admin' | 'editor' | 'viewer';
export type Side = 'right' | 'left';
export type VideoFit = 'cover' | 'contain';

export interface Task {
  id: string;
  task_date: string;
  title: string;
  start_time: string | null;
  end_time: string | null;
  assignee: string | null;
  notes: string | null;
  status: TaskStatus;
  kind: TaskKind;
  sort_order: number;
  is_visible: boolean;
  updated_at?: string;
}

/** نسخة المهمة كما تصل لشاشة العرض */
export interface DisplayTask {
  id: string;
  title: string;
  start_time: string | null;
  end_time: string | null;
  assignee: string | null;
  status: TaskStatus;
  kind: TaskKind;
}

export interface DayContent {
  day: string;
  priorities: string[];
  notes: string;
  updated_at?: string;
}

export interface ScreenSettings {
  org_name: string;
  screen_title: string;
  logo_url: string | null;
  split_right: number;
  split_center: number;
  split_left: number;
  color_primary: string;
  color_accent: string;
  color_bg: string;
  color_prayer: string;
  color_break: string;
  page_seconds: number;
  reload_hour: number | null;
  time_format: '12' | '24';
  numerals: 'latn' | 'arab';
  show_hijri: boolean;
  show_assignee: boolean;
  updated_at?: string;
}

export type SideMode = 'video' | 'slides';

export interface VideoConfig {
  url: string | null;
  fit: VideoFit;
  poster_url: string | null;
  enabled: boolean;
  /** فيديو أو عرض شرائح (صفحات PDF محولة لصور) — يتطلب migration 002 */
  mode?: SideMode;
  slide_urls?: string[];
  slide_seconds?: number;
}

export interface ScreenVideoRow extends VideoConfig {
  side: Side;
  updated_at?: string;
}

export interface Snapshot {
  today: string;
  date: string;
  server_time: string;
  version: number;
  settings: ScreenSettings | null;
  videos: Partial<Record<Side, VideoConfig>>;
  day: { priorities: string[]; notes: string } | null;
  tasks: DisplayTask[];
}

export interface Profile {
  id: string;
  email: string;
  full_name: string;
  role: Role;
  can_manage_videos: boolean;
  is_active: boolean;
  created_at?: string;
  last_sign_in_at?: string | null;
}

export interface TemplateItem {
  title: string;
  start_time: string | null;
  end_time: string | null;
  assignee: string | null;
  notes: string | null;
  kind: TaskKind;
  is_visible: boolean;
}

export interface Template {
  id: string;
  name: string;
  items: TemplateItem[];
  priorities: string[];
  notes: string;
  updated_at: string;
}

export interface AuditEntry {
  id: number;
  at: string;
  actor_id: string | null;
  actor_email: string | null;
  actor_name: string | null;
  action: 'insert' | 'update' | 'delete';
  entity: string;
  record_id: string | null;
  summary: string | null;
  old_data: Record<string, unknown> | null;
  new_data: Record<string, unknown> | null;
}

/** رسالة المعاينة التي ترسلها لوحة الإدارة إلى إطار شاشة العرض */
export interface PreviewMessage {
  type: 'rasmala:preview';
  token?: string;
  date?: string;
  settings?: Partial<ScreenSettings>;
  videos?: Partial<Record<Side, VideoConfig>>;
}
