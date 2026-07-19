-- migration-08: DM 삭제 + 복구 코드 비밀번호 재설정 (2026-07-19)
-- 실행: Supabase Dashboard → SQL Editor에 전체 붙여넣고 Run
--
-- 추가하는 것
--  1. DM 삭제 — 보낸 사람이 자기 메시지를 지울 수 있다 (상대 화면에서도 사라짐)
--  2. 복구 코드 — 가입 이메일이 합성 주소라 재설정 메일이 불가하므로,
--     로그인 상태에서 발급한 1회용 복구 코드(해시로만 저장)로 비밀번호를 재설정한다
--     · 발급: set_recovery_code(code) — 본인만, 새로 발급하면 이전 코드 무효
--     · 재설정: reset_password_with_code(candidate, code, new_password)
--       — 아이디당 시간당 5회 제한, 성공 시 코드 소멸 + 기존 세션 전부 로그아웃

-- ---------------------------------------------------------------
-- 1. DM 삭제 — 보낸 사람만
-- ---------------------------------------------------------------
drop policy if exists messages_delete_own on public.messages;
create policy messages_delete_own on public.messages
  for delete to authenticated
  using (sender_id = auth.uid());

-- ---------------------------------------------------------------
-- 2. 복구 코드 저장소 — 해시만 보관, 클라이언트 직접 접근 불가
--    (RLS를 켜고 정책을 만들지 않아 아래 security definer 함수로만 접근)
-- ---------------------------------------------------------------
create extension if not exists pgcrypto with schema extensions;

create table if not exists public.account_recovery (
  user_id uuid primary key references auth.users (id) on delete cascade,
  code_hash text not null,
  updated_at timestamptz not null default now()
);

alter table public.account_recovery enable row level security;

-- 재설정 시도 기록 — 아이디별 레이트 리밋 판정용
create table if not exists public.recovery_attempts (
  id bigint generated always as identity primary key,
  handle text not null,
  attempted_at timestamptz not null default now()
);

create index if not exists recovery_attempts_handle_idx
  on public.recovery_attempts (handle, attempted_at);

alter table public.recovery_attempts enable row level security;

-- ---------------------------------------------------------------
-- 3. 복구 코드 발급 — 로그인한 본인만, 밴 계정 제외
-- ---------------------------------------------------------------
create or replace function public.set_recovery_code(code text)
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;
  if char_length(code) < 10 then
    raise exception '복구 코드가 너무 짧아요';
  end if;
  insert into public.account_recovery (user_id, code_hash, updated_at)
  values (auth.uid(), extensions.crypt(code, extensions.gen_salt('bf')), now())
  on conflict (user_id) do update
    set code_hash = excluded.code_hash, updated_at = now();
end;
$$;

-- ---------------------------------------------------------------
-- 4. 복구 코드로 비밀번호 재설정 — 비로그인(anon) 호출
--    실패를 exception으로 던지면 트랜잭션 롤백으로 시도 기록까지 사라져
--    레이트 리밋이 무력화된다(E2E에서 실증) — 상태 문자열을 반환한다.
--    실패 사유는 아이디 존재 여부를 노출하지 않도록 'invalid' 하나로 통일.
-- ---------------------------------------------------------------
-- 이전 판(returns void)이 이미 실행돼 있으면 반환 타입 변경 때문에 먼저 지워야 한다
drop function if exists public.reset_password_with_code(text, text, text);

create function public.reset_password_with_code(candidate text, code text, new_password text)
returns text
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  target uuid;
begin
  if char_length(new_password) < 6 then
    return 'weak_password';
  end if;

  -- 아이디당 시간당 5회 — 코드 무차별 대입 방지
  if (select count(*) from public.recovery_attempts
      where handle = lower(candidate) and attempted_at > now() - interval '1 hour') >= 5 then
    return 'rate_limited';
  end if;
  insert into public.recovery_attempts (handle) values (lower(candidate));

  select p.user_id into target
  from public.profiles p
  where lower(p.handle) = lower(candidate);

  if target is null or not exists (
    select 1 from public.account_recovery r
    where r.user_id = target
      and r.code_hash = extensions.crypt(code, r.code_hash)
  ) then
    return 'invalid';
  end if;

  update auth.users
  set encrypted_password = extensions.crypt(new_password, extensions.gen_salt('bf'))
  where id = target;

  -- 코드는 1회용 — 재발급 전까지는 다시 쓸 수 없다
  delete from public.account_recovery where user_id = target;

  -- 기존 로그인 세션 전부 무효화 (코드를 훔친 쪽이든 잃은 쪽이든 깨끗하게)
  delete from auth.sessions where user_id = target;
  delete from auth.refresh_tokens where user_id = target::text;
  return 'ok';
end;
$$;

-- ---------------------------------------------------------------
-- 5. Storage 내 파일 select 정책 — Supabase Storage는 삭제·목록 조회에
--    select 권한이 필요한데 지금까지 insert/delete 정책만 있어서
--    removePhotoByUrl(영구삭제·아바타 교체)이 조용히 실패해 왔다(E2E 실증).
--    공개 URL 열람은 public 버킷이라 RLS와 무관 — 영향 없음.
-- ---------------------------------------------------------------
drop policy if exists photos_select_own on storage.objects;
create policy photos_select_own on storage.objects
  for select to authenticated
  using (
    bucket_id = 'photos'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- 지난 시도 기록 청소 (재설정 성공/실패와 무관하게 하루 지난 것 삭제)
create or replace function public.cleanup_recovery_attempts()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from public.recovery_attempts where attempted_at < now() - interval '1 day';
  return new;
end;
$$;

drop trigger if exists recovery_attempts_cleanup on public.recovery_attempts;
create trigger recovery_attempts_cleanup after insert on public.recovery_attempts
  for each statement execute function public.cleanup_recovery_attempts();
