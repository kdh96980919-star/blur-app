-- migration-06: 신고 기능 (스토어 심사 요건)
-- 실행: Supabase Dashboard → SQL Editor에 붙여넣고 Run

create table if not exists public.reports (
  id uuid primary key default gen_random_uuid(),
  reporter_id uuid not null references auth.users (id) on delete cascade,
  target_type text not null check (target_type in ('post', 'comment', 'user')),
  target_id text not null,
  reason text not null,
  created_at timestamptz not null default now()
);

alter table public.reports enable row level security;

-- 로그인 사용자는 본인 명의로만 신고 접수 가능. 조회는 관리자(대시보드/service_role)만.
drop policy if exists reports_insert_own on public.reports;
create policy reports_insert_own on public.reports
  for insert to authenticated
  with check (reporter_id = auth.uid());

-- 같은 사람이 같은 대상을 여러 번 신고해도 1건만 유지
create unique index if not exists reports_unique_target
  on public.reports (reporter_id, target_type, target_id);
