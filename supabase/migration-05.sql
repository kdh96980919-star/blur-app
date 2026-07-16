-- migration-05: 베타 피드백 반영 (2026-07-17)
-- 실행: Supabase Dashboard → SQL Editor → New query → 전체 붙여넣고 Run
--
-- 포함 내용
--  1. 게시물 보관(archived) — 룸에서 삭제하면 보관으로 이동, 보관에서 영구 삭제
--  2. 게시물 수정 정책 — 작성자가 캡션·보관 상태를 바꿀 수 있게 update 허용
--  3. 전체 탭 정책 완화 — '모두 공개(share_all)' 글은 비공개 계정이어도 전체 탭에 노출
--  4. 친구의 친구 추천 RPC
--  5. 1:1 메시지(DM) 테이블 + RLS
--  6. Realtime — 친구 수락·새 게시물·새 댓글·새 메시지 실시간 반영

-- ---------------------------------------------------------------
-- 1. 게시물 보관
-- ---------------------------------------------------------------
alter table public.posts
  add column if not exists archived boolean not null default false;

-- ---------------------------------------------------------------
-- 2. 게시물 수정: 작성자 본인만, 캡션/보관/공개 범위 변경용
-- ---------------------------------------------------------------
drop policy if exists posts_update_own on public.posts;
create policy posts_update_own on public.posts
  for update to authenticated
  using (author_id = auth.uid())
  with check (author_id = auth.uid());

-- ---------------------------------------------------------------
-- 3. 전체 탭: share_all 글은 계정 공개 여부와 무관하게 노출 (베타 피드백 12)
--    단, 보관된 글은 본인 외에는 보이지 않음
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
        or share_all
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
            or p.share_all
          )
        )
      )
  );
$$;

-- ---------------------------------------------------------------
-- 4. 친구의 친구 추천 (베타 피드백 15)
--    나와 accepted 친구인 사람들의 accepted 친구 중,
--    나 자신·이미 친구·요청 중인 사람을 제외하고 겹치는 친구 수 순으로 반환
-- ---------------------------------------------------------------
create or replace function public.friend_suggestions()
returns table (user_id uuid, mutual_count bigint)
language sql
stable
security definer
set search_path = public
as $$
  with my_friends as (
    select case when f.user_a = auth.uid() then f.user_b else f.user_a end as fid
    from public.friendships f
    where auth.uid() in (f.user_a, f.user_b) and f.status = 'accepted'
  ),
  fof as (
    select case when f.user_a = mf.fid then f.user_b else f.user_a end as candidate
    from public.friendships f
    join my_friends mf on mf.fid in (f.user_a, f.user_b)
    where f.status = 'accepted'
  )
  select candidate as user_id, count(*) as mutual_count
  from fof
  where candidate <> auth.uid()
    and candidate not in (select fid from my_friends)
    and not exists (
      select 1 from public.friendships f2
      where f2.user_a = least(candidate, auth.uid())
        and f2.user_b = greatest(candidate, auth.uid())
    )
  group by candidate
  order by mutual_count desc;
$$;

-- ---------------------------------------------------------------
-- 5. 1:1 메시지 (베타 피드백 14)
-- ---------------------------------------------------------------
create table if not exists public.messages (
  id uuid primary key default gen_random_uuid(),
  sender_id uuid not null references public.profiles (user_id) on delete cascade,
  recipient_id uuid not null references public.profiles (user_id) on delete cascade,
  body text not null check (char_length(body) between 1 and 500),
  created_at timestamptz not null default now(),
  read_at timestamptz,
  constraint no_self_message check (sender_id <> recipient_id)
);

create index if not exists messages_pair_idx
  on public.messages (least(sender_id, recipient_id), greatest(sender_id, recipient_id), created_at);

alter table public.messages enable row level security;

-- 당사자만 읽기
create policy messages_select on public.messages
  for select to authenticated
  using (auth.uid() in (sender_id, recipient_id));

-- 보내기: 본인이 sender이고, 친구 사이일 때만
create policy messages_insert on public.messages
  for insert to authenticated
  with check (
    sender_id = auth.uid()
    and public.are_friends(sender_id, recipient_id)
  );

-- 읽음 처리: 받은 사람만 read_at 갱신
create policy messages_update_read on public.messages
  for update to authenticated
  using (recipient_id = auth.uid())
  with check (recipient_id = auth.uid());

-- ---------------------------------------------------------------
-- 6. Realtime 발행 — 새 게시물/친구 변경/댓글/메시지 즉시 반영 (베타 피드백 8)
--    (이미 추가돼 있으면 무시)
-- ---------------------------------------------------------------
do $$
begin
  begin
    alter publication supabase_realtime add table public.posts;
  exception when duplicate_object then null;
  end;
  begin
    alter publication supabase_realtime add table public.friendships;
  exception when duplicate_object then null;
  end;
  begin
    alter publication supabase_realtime add table public.comments;
  exception when duplicate_object then null;
  end;
  begin
    alter publication supabase_realtime add table public.messages;
  exception when duplicate_object then null;
  end;
end $$;
