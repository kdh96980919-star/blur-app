-- blur migration-13: 운영 통계용 daily_stats RPC
-- 실행 위치: Supabase Dashboard → SQL Editor → New query → 붙여넣기 → Run
--
-- 목적: 이용자 분석 클라우드 에이전트가 매일 호출하는 집계 함수.
--   집계 숫자만 반환하고 개인정보(누구인지)는 노출하지 않으므로 anon으로 호출 가능.
-- 한계: blur는 로그인/세션 기록을 저장하지 않는다. 따라서 '접속(앱만 열고 활동 X)'은
--   측정 불가. active_users는 글·댓글·블러열람 중 하나라도 한 '활동 기준 DAU'다.
--   순수 접속까지 세려면 profiles.last_seen 도입이 필요(별도 작업).
-- 날짜 기준: 한국시간(KST, UTC+9) 달력일. d를 안 주면 오늘(KST).

create or replace function public.daily_stats(
  d date default (now() at time zone 'Asia/Seoul')::date
)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  with posters as (
    select distinct author_id as uid from public.posts
    where (created_at at time zone 'Asia/Seoul')::date = d
  ),
  commenters as (
    select distinct author_id as uid from public.comments
    where (created_at at time zone 'Asia/Seoul')::date = d
  ),
  revealers as (
    select distinct user_id as uid from public.reveals
    where (revealed_at at time zone 'Asia/Seoul')::date = d
  ),
  actives as (
    select uid from posters
    union
    select uid from commenters
    union
    select uid from revealers
  )
  select jsonb_build_object(
    'date',         d,
    'total_users',  (select count(*) from public.profiles),
    'new_signups',  (select count(*) from public.profiles
                     where (created_at at time zone 'Asia/Seoul')::date = d),
    'active_users', (select count(*) from actives),
    'posters',      (select count(*) from posters),
    'commenters',   (select count(*) from commenters),
    'revealers',    (select count(*) from revealers),
    'posts',        (select count(*) from public.posts
                     where (created_at at time zone 'Asia/Seoul')::date = d),
    'comments',     (select count(*) from public.comments
                     where (created_at at time zone 'Asia/Seoul')::date = d)
  );
$$;

-- 집계 숫자만 반환하므로 익명 호출 허용 (RLS 우회는 security definer로 의도된 것)
grant execute on function public.daily_stats(date) to anon, authenticated;

-- 실행 직후 확인용 (어제 통계):
--   select public.daily_stats((now() at time zone 'Asia/Seoul')::date - 1);
