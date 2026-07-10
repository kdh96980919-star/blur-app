-- migration-03: 프로필 한 줄 소개(bio) 추가
-- 룸 탭 리디자인(피그마 2026-07)에서 프로필에 한 줄 소개가 생김.
-- Supabase 대시보드 > SQL Editor에서 실행.

alter table public.profiles
  add column if not exists bio text not null default ''
  check (char_length(bio) <= 80);
