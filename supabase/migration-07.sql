-- migration-07: 보안 강화 + 허브 6시 롤오버 정합 (2026-07-19 감사 결과)
-- 실행: Supabase Dashboard → SQL Editor에 전체 붙여넣고 Run
--
-- 고치는 것
--  1. 허브 날짜 불일치 — 클라이언트는 KST 06시 롤오버인데 정책은 UTC 자정이라
--     매일 KST 06~09시 사이 게시가 거부되던 문제
--  2. 친구 요청 자기 수락 취약점 — 요청 보낸 쪽이 스스로 accepted로 바꿔
--     비공개 사진·DM에 접근할 수 있던 구멍
--  3. 차단 우회 — 차단당한 쪽이 friendships 행을 지우고 재요청할 수 있던 구멍
--  4. 비공개 계정의 지난 share_all 글이 아무에게나 보이던 문제
--     (전체 탭은 오늘 글만 share_all로 공개, 지난 글은 친구 또는 공개 계정만)
--  5. DM 본문 수정 가능 문제 (읽음 처리 정책이 body 수정까지 허용)
--  6. 밴 시스템 — banned 계정은 모든 쓰기 차단 (운영자가 대시보드에서 banned=true)
--  7. 도배 방지 — 댓글·DM·친구 요청·신고 빈도 제한

-- ---------------------------------------------------------------
-- 0. 허브 날짜 (KST 오전 6시 롤오버) — 클라이언트 hubDateToday()와 동일 규칙
-- ---------------------------------------------------------------
create or replace function public.hub_today()
returns date
language sql
stable
as $$
  select ((now() at time zone 'utc') + interval '3 hours')::date;
$$;

-- ---------------------------------------------------------------
-- 1. 밴 시스템
-- ---------------------------------------------------------------
alter table public.profiles
  add column if not exists banned boolean not null default false;

create or replace function public.is_banned(u uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((select banned from public.profiles where user_id = u), false);
$$;

-- banned는 본인이 못 푼다 — 운영자(대시보드/service_role, auth.uid()가 null)만 변경 가능
create or replace function public.guard_profile_update()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is not null then
    if new.banned <> old.banned then
      raise exception '이 설정은 운영자만 바꿀 수 있어요';
    end if;
    if new.user_id <> old.user_id or new.created_at <> old.created_at then
      raise exception '계정 식별 정보는 바꿀 수 없어요';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists profiles_guard on public.profiles;
create trigger profiles_guard before update on public.profiles
  for each row execute function public.guard_profile_update();

-- ---------------------------------------------------------------
-- 2. 게시 정책 — 오늘(6시 기준) 허브에만 + 밴 계정 차단
-- ---------------------------------------------------------------
drop policy if exists posts_insert_own on public.posts;
create policy posts_insert_own on public.posts
  for insert to authenticated
  with check (
    author_id = auth.uid()
    and hub_date = public.hub_today()
    and not public.is_banned(auth.uid())
  );

-- ---------------------------------------------------------------
-- 3. 조회 정책 — 비공개 계정 지난 글 보호
--    본인 / 친구 / (share_all AND 오늘 글) / (share_all AND 공개 계정)
-- ---------------------------------------------------------------
drop policy if exists posts_select on public.posts;
create policy posts_select on public.posts
  for select to authenticated
  using (
    author_id = auth.uid()
    or (
      not archived
      and (
        public.are_friends(author_id, auth.uid())
        or (share_all and hub_date = public.hub_today())
        or (
          share_all
          and exists (
            select 1 from public.profiles pr
            where pr.user_id = posts.author_id and pr.is_public
          )
        )
      )
    )
  );

create or replace function public.can_view_post(p_post_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.posts p
    where p.id = p_post_id
      and (
        p.author_id = auth.uid()
        or (
          not p.archived
          and (
            public.are_friends(p.author_id, auth.uid())
            or (p.share_all and p.hub_date = public.hub_today())
            or (
              p.share_all
              and exists (
                select 1 from public.profiles pr
                where pr.user_id = p.author_id and pr.is_public
              )
            )
          )
        )
      )
  );
$$;

-- ---------------------------------------------------------------
-- 4. 게시물 불변 필드 보호 — 작성자·날짜·원본 URL은 수정 불가
-- ---------------------------------------------------------------
create or replace function public.guard_post_update()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.author_id <> old.author_id
    or new.hub_date <> old.hub_date
    or new.image_url <> old.image_url
    or new.created_at <> old.created_at then
    raise exception '게시물의 작성자·날짜·원본은 바꿀 수 없어요';
  end if;
  return new;
end;
$$;

drop trigger if exists posts_guard on public.posts;
create trigger posts_guard before update on public.posts
  for each row execute function public.guard_post_update();

-- ---------------------------------------------------------------
-- 5. 친구 관계 보호 — 자기 수락 금지, 차단자 기록, 차단 우회 방지
-- ---------------------------------------------------------------
create or replace function public.guard_friendship_update()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.user_a <> old.user_a or new.user_b <> old.user_b then
    raise exception '친구 관계의 당사자는 바꿀 수 없어요';
  end if;
  -- 차단 상태는 차단한 사람(requested_by에 기록)만 바꿀 수 있다
  if old.status = 'blocked' and auth.uid() <> old.requested_by then
    raise exception '차단 상태는 차단한 사람만 바꿀 수 있어요';
  end if;
  -- 요청 수락은 요청받은 쪽만
  if old.status = 'pending' and new.status = 'accepted' and auth.uid() = old.requested_by then
    raise exception '요청을 보낸 사람은 스스로 수락할 수 없어요';
  end if;
  -- 차단으로 바꾸는 순간 차단자를 기록 (해제 권한 판단용)
  if new.status = 'blocked' and old.status <> 'blocked' then
    new.requested_by := auth.uid();
  elsif new.requested_by <> old.requested_by then
    raise exception '요청자 정보는 바꿀 수 없어요';
  end if;
  return new;
end;
$$;

drop trigger if exists friendships_guard on public.friendships;
create trigger friendships_guard before update on public.friendships
  for each row execute function public.guard_friendship_update();

-- 차단 행은 차단한 사람만 삭제(해제) 가능 — 차단당한 쪽이 지우고 재요청하는 우회 차단
drop policy if exists friendships_delete on public.friendships;
create policy friendships_delete on public.friendships
  for delete to authenticated
  using (
    auth.uid() in (user_a, user_b)
    and (status <> 'blocked' or requested_by = auth.uid())
  );

-- 친구 요청에도 밴 차단
drop policy if exists friendships_insert on public.friendships;
create policy friendships_insert on public.friendships
  for insert to authenticated
  with check (
    requested_by = auth.uid()
    and auth.uid() in (user_a, user_b)
    and status = 'pending'
    and not public.is_banned(auth.uid())
  );

-- ---------------------------------------------------------------
-- 6. DM 보호 — 읽음 처리는 read_at만 바꿀 수 있다 (본문 수정 차단)
-- ---------------------------------------------------------------
create or replace function public.guard_message_update()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.sender_id <> old.sender_id
    or new.recipient_id <> old.recipient_id
    or new.body <> old.body
    or new.created_at <> old.created_at then
    raise exception '메시지 내용은 바꿀 수 없어요';
  end if;
  return new;
end;
$$;

drop trigger if exists messages_guard on public.messages;
create trigger messages_guard before update on public.messages
  for each row execute function public.guard_message_update();

-- ---------------------------------------------------------------
-- 7. 밴 계정의 쓰기 차단 (댓글·DM·해제·신고)
-- ---------------------------------------------------------------
drop policy if exists comments_insert on public.comments;
create policy comments_insert on public.comments
  for insert to authenticated
  with check (
    author_id = auth.uid()
    and public.can_view_post(post_id)
    and not public.is_banned(auth.uid())
  );

drop policy if exists messages_insert on public.messages;
create policy messages_insert on public.messages
  for insert to authenticated
  with check (
    sender_id = auth.uid()
    and public.are_friends(sender_id, recipient_id)
    and not public.is_banned(auth.uid())
  );

drop policy if exists reveals_insert_own on public.reveals;
create policy reveals_insert_own on public.reveals
  for insert to authenticated
  with check (
    user_id = auth.uid()
    and public.can_view_post(post_id)
    and not public.is_banned(auth.uid())
  );

drop policy if exists reports_insert_own on public.reports;
create policy reports_insert_own on public.reports
  for insert to authenticated
  with check (
    reporter_id = auth.uid()
    and not public.is_banned(auth.uid())
  );

-- ---------------------------------------------------------------
-- 8. 도배 방지 (레이트 리밋) — 초과 시 삽입 거부
-- ---------------------------------------------------------------
create or replace function public.rate_limit_comments()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if (select count(*) from public.comments
      where author_id = auth.uid() and created_at > now() - interval '1 hour') >= 60 then
    raise exception '댓글을 너무 자주 남기고 있어요. 잠시 후 다시 시도해 주세요';
  end if;
  return new;
end;
$$;

drop trigger if exists comments_rate_limit on public.comments;
create trigger comments_rate_limit before insert on public.comments
  for each row execute function public.rate_limit_comments();

create or replace function public.rate_limit_messages()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if (select count(*) from public.messages
      where sender_id = auth.uid() and created_at > now() - interval '1 hour') >= 300 then
    raise exception '메시지를 너무 자주 보내고 있어요. 잠시 후 다시 시도해 주세요';
  end if;
  return new;
end;
$$;

drop trigger if exists messages_rate_limit on public.messages;
create trigger messages_rate_limit before insert on public.messages
  for each row execute function public.rate_limit_messages();

create or replace function public.rate_limit_friend_requests()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if (select count(*) from public.friendships
      where requested_by = auth.uid() and created_at > now() - interval '1 day') >= 50 then
    raise exception '친구 요청이 너무 많아요. 내일 다시 시도해 주세요';
  end if;
  return new;
end;
$$;

drop trigger if exists friendships_rate_limit on public.friendships;
create trigger friendships_rate_limit before insert on public.friendships
  for each row execute function public.rate_limit_friend_requests();

create or replace function public.rate_limit_reports()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if (select count(*) from public.reports
      where reporter_id = auth.uid() and created_at > now() - interval '1 day') >= 30 then
    raise exception '신고가 너무 많아요. 내일 다시 시도해 주세요';
  end if;
  return new;
end;
$$;

drop trigger if exists reports_rate_limit on public.reports;
create trigger reports_rate_limit before insert on public.reports
  for each row execute function public.rate_limit_reports();

-- ---------------------------------------------------------------
-- 9. reports 입력 길이 제약 (없으면 추가)
-- ---------------------------------------------------------------
do $$
begin
  alter table public.reports add constraint reports_reason_len check (char_length(reason) between 1 and 100);
exception when duplicate_object then null;
end $$;

do $$
begin
  alter table public.reports add constraint reports_target_len check (char_length(target_id) between 1 and 64);
exception when duplicate_object then null;
end $$;
