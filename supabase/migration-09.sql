-- migration-09: 인증 개편 — 카카오·구글 소셜 로그인 전용 전환
-- 실행 위치: Supabase Dashboard → SQL Editor → New query → 전체 붙여넣기 → Run
--
-- 내용:
--   1. 기존 계정 전부 삭제 (합성 이메일 방식 계정 — 지인 초대 전이라 테스트 계정뿐)
--   2. profiles.setup_done 추가 — OAuth 첫 로그인 뒤 이름·아이디를 정했는지 표시
--   3. handle_new_user 트리거를 OAuth 메타데이터에 맞게 갱신
--   4. 복구 코드·합성 이메일 유물 제거 (테이블·함수)
--
-- ⚠️ 실행 후 Dashboard → Storage → photos 버킷에 남은 옛 계정 폴더는 수동 삭제
--    (계정 삭제 전 파일이 남아 있을 수 있음 — 용량 미미, 기능 영향 없음)
-- ⚠️ 함께 필요한 대시보드 설정은 docs/oauth-setup.md 참고
--    (카카오·구글 프로바이더 활성화 + Redirect URL 허용 목록)

-- ---------------------------------------------------------------
-- 1. 기존 계정 전부 삭제 — profiles·posts·comments·friendships·
--    messages·reveals·reports는 FK cascade로 함께 정리된다
-- ---------------------------------------------------------------
delete from auth.users;

-- ---------------------------------------------------------------
-- 2. setup_done — OAuth 가입 직후엔 false, 앱에서 이름·아이디를
--    정하면 클라이언트가 true로 올린다 (본인 행만, profiles_update_own)
-- ---------------------------------------------------------------
alter table public.profiles
  add column if not exists setup_done boolean not null default false;

-- ---------------------------------------------------------------
-- 3. 가입 트리거 갱신 — OAuth 프로바이더가 주는 메타데이터로 초기값 구성
--    · handle: 임시 자동 생성 (setup 화면에서 사용자가 새로 정함)
--    · name: 카카오/구글 프로필 이름. 12자 제한(check 제약)에 맞춰 자르고,
--      비어 있으면 '이름없음' (여기서 실패하면 로그인 자체가 막히므로 방어적으로)
-- ---------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (user_id, handle, name, setup_done)
  values (
    new.id,
    'user_' || left(replace(new.id::text, '-', ''), 10),
    coalesce(
      nullif(left(trim(coalesce(
        new.raw_user_meta_data ->> 'name',
        new.raw_user_meta_data ->> 'full_name',
        new.raw_user_meta_data ->> 'preferred_username',
        ''
      )), 12), ''),
      '이름없음'
    ),
    false
  );
  return new;
end;
$$;

-- ---------------------------------------------------------------
-- 4. 합성 이메일·복구 코드 유물 제거
-- ---------------------------------------------------------------
drop function if exists public.reset_password_with_code(text, text, text);
drop function if exists public.set_recovery_code(text);
drop function if exists public.email_for_handle(text);
drop table if exists public.recovery_attempts cascade;
drop table if exists public.account_recovery cascade;
drop function if exists public.cleanup_recovery_attempts() cascade;
