-- migration-04: 비공개 계정 글 숨김 + 주제 승인제
-- 실행: Supabase Dashboard → SQL Editor → New query → 붙여넣고 Run

-- ---------------------------------------------------------------
-- 1. 주제 승인제: 클라이언트가 오늘의 허브(주제)를 자동 생성하던 정책 제거.
--    이제 주제는 운영자가 topics-weekly.sql로 미리 승인(insert)한 것만 게시됨.
--    오늘 주제가 없으면 앱은 "주제 준비 중"으로 표시되고 사진 게시가 잠김.
-- ---------------------------------------------------------------
drop policy if exists hubs_insert_today on public.hubs;

-- ---------------------------------------------------------------
-- 2. 비공개 계정 글 숨김: '모두 공개(share_all)' 글이어도 계정이 비공개면
--    친구가 아닌 사람에게는 보이지 않음. 공개 → 비공개 전환 시 기존 글도 즉시 숨겨짐.
-- ---------------------------------------------------------------
drop policy if exists posts_select on public.posts;
create policy posts_select on public.posts
  for select to authenticated
  using (
    author_id = auth.uid()
    or public.are_friends(author_id, auth.uid())
    or (
      share_all
      and exists (
        select 1 from public.profiles pr
        where pr.user_id = posts.author_id and pr.is_public
      )
    )
  );

-- 댓글/열람(reveal) 권한 게이트도 같은 규칙으로 갱신
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
        or public.are_friends(p.author_id, auth.uid())
        or (
          p.share_all
          and exists (
            select 1 from public.profiles pr
            where pr.user_id = p.author_id and pr.is_public
          )
        )
      )
  );
$$;
