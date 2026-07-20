-- migration-11: 웹 푸시 알림 구독 저장 (2026-07-19)
-- 실행: Supabase Dashboard → SQL Editor → New query → 전체 붙여넣고 Run
--
-- 브라우저 PushManager 구독(endpoint + 암호화 키 2종)을 사용자별로 저장한다.
-- notify Edge Function이 service_role로 이 표를 읽어 대상자에게 웹 푸시를 발송한다.
-- 구독 정보 자체는 본인만 접근 가능(RLS). 발송은 서버(Edge Function)만.

create table if not exists public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (user_id) on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  created_at timestamptz not null default now()
);

create index if not exists push_subscriptions_user_idx on public.push_subscriptions (user_id);

alter table public.push_subscriptions enable row level security;

-- 본인 구독만 조회/등록/삭제 (endpoint 충돌 시 갱신은 insert-or-update로 처리)
drop policy if exists push_sub_select_own on public.push_subscriptions;
create policy push_sub_select_own on public.push_subscriptions
  for select to authenticated using (user_id = auth.uid());

drop policy if exists push_sub_insert_own on public.push_subscriptions;
create policy push_sub_insert_own on public.push_subscriptions
  for insert to authenticated with check (user_id = auth.uid());

drop policy if exists push_sub_update_own on public.push_subscriptions;
create policy push_sub_update_own on public.push_subscriptions
  for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists push_sub_delete_own on public.push_subscriptions;
create policy push_sub_delete_own on public.push_subscriptions
  for delete to authenticated using (user_id = auth.uid());
