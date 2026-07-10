-- blur 서비스 Supabase 스키마 (v1)
-- 실행 위치: Supabase Dashboard → SQL Editor → New query → 전체 붙여넣기 → Run
-- 설계 근거: docs/backend-plan.md

-- ---------------------------------------------------------------
-- 0. 확장
-- ---------------------------------------------------------------
create extension if not exists pgcrypto;

-- ---------------------------------------------------------------
-- 1. 테이블
-- ---------------------------------------------------------------

-- 하루 하나의 주제(허브)
create table if not exists public.hubs (
  hub_date date primary key,
  topic text not null,
  created_at timestamptz not null default now()
);

-- 사용자 프로필 (auth.users 1:1)
create table if not exists public.profiles (
  user_id uuid primary key references auth.users (id) on delete cascade,
  handle text not null,
  name text not null check (char_length(name) between 1 and 12),
  color text not null default '#b06a92',
  emoji text not null default '',
  avatar_url text,
  is_public boolean not null default false,
  notif boolean not null default true,
  bio text not null default '' check (char_length(bio) <= 80),
  created_at timestamptz not null default now(),
  constraint handle_format check (handle ~ '^[a-z0-9_]{3,16}$')
);

-- 아이디(@handle) 전역 유일 — 대소문자 무시
create unique index if not exists profiles_handle_unique
  on public.profiles (lower(handle));

-- 게시물 (하루 허브당 1장)
create table if not exists public.posts (
  id uuid primary key default gen_random_uuid(),
  author_id uuid not null references public.profiles (user_id) on delete cascade,
  hub_date date not null references public.hubs (hub_date),
  image_url text not null,
  caption text not null default '' check (char_length(caption) <= 60),
  ratio text not null default '4 / 5',
  split smallint not null default 1 check (split in (1, 2, 4)),
  filter text not null default 'none',
  share_all boolean not null default true,
  save_room boolean not null default true,
  created_at timestamptz not null default now(),
  constraint one_post_per_hub unique (author_id, hub_date)
);

-- 블러 해제 기록 (당일 되돌릴 수 없음)
create table if not exists public.reveals (
  user_id uuid not null references public.profiles (user_id) on delete cascade,
  post_id uuid not null references public.posts (id) on delete cascade,
  revealed_at timestamptz not null default now(),
  primary key (user_id, post_id)
);

-- 댓글 (100자 제한)
create table if not exists public.comments (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.posts (id) on delete cascade,
  author_id uuid not null references public.profiles (user_id) on delete cascade,
  body text not null check (char_length(body) between 1 and 100),
  created_at timestamptz not null default now()
);

-- 친구 관계 (user_a < user_b 정규화, 단일 행)
create table if not exists public.friendships (
  user_a uuid not null references public.profiles (user_id) on delete cascade,
  user_b uuid not null references public.profiles (user_id) on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'accepted', 'blocked')),
  requested_by uuid not null references public.profiles (user_id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_a, user_b),
  constraint ordered_pair check (user_a < user_b),
  constraint requester_in_pair check (requested_by in (user_a, user_b))
);

-- ---------------------------------------------------------------
-- 2. 헬퍼 함수
-- ---------------------------------------------------------------

-- 두 사용자가 accepted 친구인지
create or replace function public.are_friends(a uuid, b uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.friendships f
    where f.user_a = least(a, b)
      and f.user_b = greatest(a, b)
      and f.status = 'accepted'
  );
$$;

-- 가입 화면의 아이디 중복 검사 (로그인 전에도 호출 가능)
create or replace function public.is_handle_available(candidate text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select candidate ~ '^[a-z0-9_]{3,16}$'
    and not exists (
      select 1 from public.profiles p
      where lower(p.handle) = lower(candidate)
    );
$$;

-- 게시물 열람 권한: 작성자 본인 / share_all 공개 글 / accepted 친구의 글
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
        or p.share_all
        or public.are_friends(p.author_id, auth.uid())
      )
  );
$$;

-- 가입 시 auth.users → profiles 자동 생성 (metadata의 name/handle 사용)
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (user_id, handle, name)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'handle', 'user_' || left(replace(new.id::text, '-', ''), 10)),
    coalesce(new.raw_user_meta_data ->> 'name', '이름없음')
  );
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------
-- 3. RLS (Row Level Security)
-- ---------------------------------------------------------------
alter table public.hubs enable row level security;
alter table public.profiles enable row level security;
alter table public.posts enable row level security;
alter table public.reveals enable row level security;
alter table public.comments enable row level security;
alter table public.friendships enable row level security;

-- hubs: 로그인 사용자는 모두 읽기 (쓰기는 서버/관리자만 — service_role)
create policy hubs_select on public.hubs
  for select to authenticated using (true);

-- profiles: 검색·추천·프로필 헤더에 필요하므로 기본 정보는 모두 읽기.
-- (비공개 계정 보호는 posts RLS에서 처리 — 지난 허브 글이 친구 외에 안 보임)
create policy profiles_select on public.profiles
  for select to authenticated using (true);

create policy profiles_update_own on public.profiles
  for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- posts: 본인 / 모두 공개 / 친구 글만 조회.
-- 단, 비공개 계정의 지난 허브 열람 차단은 "오늘이 아닌 글은 공개 계정이거나 친구일 때만"으로 처리
create policy posts_select on public.posts
  for select to authenticated
  using (
    author_id = auth.uid()
    or (
      (share_all or public.are_friends(author_id, auth.uid()))
      and (
        hub_date = current_date
        or public.are_friends(author_id, auth.uid())
        or exists (
          select 1 from public.profiles pr
          where pr.user_id = posts.author_id and pr.is_public
        )
      )
    )
  );

create policy posts_insert_own on public.posts
  for insert to authenticated
  with check (author_id = auth.uid() and hub_date = current_date);

create policy posts_delete_own on public.posts
  for delete to authenticated
  using (author_id = auth.uid());

-- reveals: 내 해제 기록 관리 + 내 글의 방문자 수 집계용 조회
create policy reveals_select on public.reveals
  for select to authenticated
  using (
    user_id = auth.uid()
    or exists (
      select 1 from public.posts p
      where p.id = reveals.post_id and p.author_id = auth.uid()
    )
  );

create policy reveals_insert_own on public.reveals
  for insert to authenticated
  with check (user_id = auth.uid() and public.can_view_post(post_id));

-- comments: 게시물을 볼 수 있는 사용자만 읽기/쓰기
create policy comments_select on public.comments
  for select to authenticated
  using (public.can_view_post(post_id));

create policy comments_insert on public.comments
  for insert to authenticated
  with check (author_id = auth.uid() and public.can_view_post(post_id));

create policy comments_delete_own on public.comments
  for delete to authenticated
  using (author_id = auth.uid());

-- friendships: 당사자만 조회. 요청 생성은 pending + 본인이 requested_by일 때만.
create policy friendships_select on public.friendships
  for select to authenticated
  using (auth.uid() in (user_a, user_b));

create policy friendships_insert on public.friendships
  for insert to authenticated
  with check (
    requested_by = auth.uid()
    and auth.uid() in (user_a, user_b)
    and status = 'pending'
  );

-- 수락/차단: 요청받은 쪽(또는 차단은 당사자 누구나)이 상태 변경
create policy friendships_update on public.friendships
  for update to authenticated
  using (auth.uid() in (user_a, user_b))
  with check (auth.uid() in (user_a, user_b));

create policy friendships_delete on public.friendships
  for delete to authenticated
  using (auth.uid() in (user_a, user_b));

-- ---------------------------------------------------------------
-- 4. Storage (사진 버킷)
-- ---------------------------------------------------------------
-- 버킷은 SQL 대신 Dashboard → Storage → New bucket 으로 만들어도 됩니다.
insert into storage.buckets (id, name, public)
values ('photos', 'photos', true)
on conflict (id) do nothing;

-- 업로드는 본인 폴더({user_id}/...)에만
create policy photos_insert_own on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'photos'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy photos_delete_own on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'photos'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- 읽기: public 버킷이므로 URL로 접근 (블러는 클라이언트 렌더링 처리).
-- 추후 비공개 강화가 필요하면 bucket을 private으로 바꾸고 signed URL로 전환.

-- ---------------------------------------------------------------
-- 5. 시드: 오늘의 허브 (매일 1행 필요 — 운영 시 cron 또는 Edge Function으로 자동화)
-- ---------------------------------------------------------------
insert into public.hubs (hub_date, topic)
values (current_date, '오늘 내가 지나친 작은 장면')
on conflict (hub_date) do nothing;
