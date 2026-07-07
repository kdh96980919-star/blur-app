-- blur 마이그레이션 02 — 아이디 로그인 매핑 + 회원 탈퇴
-- 실행: Supabase Dashboard → SQL Editor → New query → 붙여넣고 Run

-- 로그인: @아이디 → 가입 시 사용한 인증 이메일 조회
-- (클라이언트는 이메일을 몰라도 아이디+비밀번호로 로그인 가능)
create or replace function public.email_for_handle(candidate text)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select u.email::text
  from auth.users u
  join public.profiles p on p.user_id = u.id
  where lower(p.handle) = lower(candidate)
  limit 1;
$$;

-- 회원 탈퇴: 본인 auth 계정 삭제 (profiles/posts/댓글 등은 FK cascade로 함께 삭제)
create or replace function public.delete_own_account()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;
  delete from auth.users where id = auth.uid();
end;
$$;

-- 오늘의 허브 자동 생성: pg_cron 없이도 동작하도록,
-- 로그인 사용자가 "오늘" 허브를 만들 수 있게 허용
-- (클라이언트가 주제 풀에서 날짜 기반으로 결정론적으로 골라 upsert — 모든 클라이언트가 같은 주제를 계산)
create policy hubs_insert_today on public.hubs
  for insert to authenticated
  with check (hub_date = current_date);

-- 탈퇴한 사용자가 올린 Storage 사진 정리는 추후 Edge Function으로 처리
