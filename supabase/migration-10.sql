-- migration-10: 연락처 기반 친구 찾기 (2026-07-19)
-- 실행: Supabase Dashboard → SQL Editor → New query → 전체 붙여넣고 Run
--
-- 설계 원칙 (개인정보)
--  · 전화번호 원본은 서버에 저장하지 않는다. 정규화한 번호의 SHA-256 해시만 저장.
--  · 해시는 profiles(전체 조회 가능)에 두면 무차별 대입 위험 → 별도 테이블 contact_hashes 에 두고
--    본인 행만 접근 가능하도록 RLS. 남의 해시는 누구도 select 할 수 없다.
--  · 매칭은 security definer RPC 로만. 호출자가 이미 연락처로 '가지고 있는' 번호 해시와의
--    교집합만 반환하므로, 임의 번호 가입 여부를 캐낼 수 없다(가진 번호만 확인 가능).

-- ---------------------------------------------------------------
-- 1. 내 번호 해시 저장 테이블
-- ---------------------------------------------------------------
create table if not exists public.contact_hashes (
  user_id uuid primary key references public.profiles (user_id) on delete cascade,
  phone_hash text not null,
  updated_at timestamptz not null default now()
);

create index if not exists contact_hashes_phone_idx on public.contact_hashes (phone_hash);

alter table public.contact_hashes enable row level security;

-- 본인 행만 조회/삽입/수정/삭제 (남의 해시는 절대 노출되지 않음)
drop policy if exists contact_hashes_select_own on public.contact_hashes;
create policy contact_hashes_select_own on public.contact_hashes
  for select to authenticated using (user_id = auth.uid());

drop policy if exists contact_hashes_insert_own on public.contact_hashes;
create policy contact_hashes_insert_own on public.contact_hashes
  for insert to authenticated with check (user_id = auth.uid());

drop policy if exists contact_hashes_update_own on public.contact_hashes;
create policy contact_hashes_update_own on public.contact_hashes
  for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists contact_hashes_delete_own on public.contact_hashes;
create policy contact_hashes_delete_own on public.contact_hashes
  for delete to authenticated using (user_id = auth.uid());

-- ---------------------------------------------------------------
-- 2. 연락처 매칭 RPC
--    내가 연락처에서 뽑은 번호 해시 목록을 넘기면, 그 번호로 가입한 사용자 중
--    나 자신·이미 친구·요청 중이 아닌 사람의 user_id 를 반환.
-- ---------------------------------------------------------------
create or replace function public.match_contacts(hashes text[])
returns table (user_id uuid)
language sql
stable
security definer
set search_path = public
as $$
  select ch.user_id
  from public.contact_hashes ch
  where ch.phone_hash = any(hashes)
    and ch.user_id <> auth.uid()
    and not exists (
      select 1 from public.friendships f
      where f.user_a = least(ch.user_id, auth.uid())
        and f.user_b = greatest(ch.user_id, auth.uid())
    );
$$;

grant execute on function public.match_contacts(text[]) to authenticated;
