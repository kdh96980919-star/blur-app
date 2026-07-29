-- blur migration-14: 푸시 알림을 DB 트리거로 이관 (2026-07-29)
-- 실행 위치: Supabase Dashboard → SQL Editor → New query → 붙여넣기 → Run
--
-- 왜: 지금까지 푸시는 '행동한 사람의 폰'이 notify Edge Function을 직접 불러서 나갔다.
--   그래서 댓글을 달자마자 앱이 죽거나, 네트워크가 끊기거나, 함수 호출이 실패하면
--   알림이 조용히 유실됐다. 이제 행(comment/message/friendship)이 실제로 DB에
--   들어간 순간 트리거가 발송한다 — 데이터가 남았으면 알림도 반드시 나간다.
--
-- 구성:
--   push_notify(type, from, to)  = pg_net으로 notify Edge Function을 호출하는 공용 함수
--   comments  INSERT → 게시물 작성자 (+ 본문이 @아이디로 시작하면 그 사람에게도)
--   messages  INSERT → 받는 사람
--   friendships INSERT(pending) → 요청받은 사람 / UPDATE(accepted) → 요청한 사람
--
-- ⚠️ 실행 전에 아래 '선행 1단계'를 먼저 하세요. 서비스 키는 저장소에 커밋하지 않고
--    Supabase Vault에 넣습니다.
--
-- ── 선행 1단계: 서비스 키를 Vault에 저장 (이 파일이 아니라 SQL Editor에 직접) ──
--   select vault.create_secret(
--     '여기에_service_role_key_붙여넣기',
--     'notify_service_key',
--     'notify 트리거가 Edge Function을 호출할 때 쓰는 키'
--   );
--   -- 키는 Dashboard → Project Settings → API → service_role (secret)
--   -- 이미 넣어둔 뒤 바꾸려면:
--   --   select vault.update_secret(
--   --     (select id from vault.secrets where name = 'notify_service_key'), '새키');
--
-- ── 실행 순서 (중요) ──
--   ① 이 파일 실행  ② notify Edge Function 재배포  ③ 앱 배포
--   ①만 한 상태에선 트리거 호출이 (구버전 함수라) 무시되고 기존 클라이언트 경로로
--   계속 알림이 간다 — 즉 중간에 알림이 끊기거나 두 번 가는 구간이 없다.

-- pg_net: Postgres에서 HTTP를 쏘는 확장. Dashboard에서 이미 켰다면 no-op.
create extension if not exists pg_net;

-- ---------------------------------------------------------------
-- 공용 발송 함수
-- ---------------------------------------------------------------
-- security definer인 이유: vault.decrypted_secrets는 소유자(postgres)만 읽을 수 있는데,
-- 트리거는 댓글을 쓴 사용자 권한으로 돈다.
create or replace function public.push_notify(p_type text, p_from uuid, p_to uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_key text;
begin
  -- 자기 자신에게는 보내지 않는다 (Edge Function에도 같은 방어가 있다)
  if p_from is null or p_to is null or p_from = p_to then
    return;
  end if;

  select decrypted_secret into v_key
    from vault.decrypted_secrets
   where name = 'notify_service_key';

  -- 키가 아직 없으면 조용히 넘어간다 — 알림이 안 갈 뿐, 댓글/메시지 저장은 정상이어야 한다
  if v_key is null then
    return;
  end if;

  perform net.http_post(
    url := 'https://nzrfzxpqvhdkmogpsscz.supabase.co/functions/v1/notify',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || v_key
    ),
    body := jsonb_build_object('type', p_type, 'fromUid', p_from, 'toUid', p_to)
  );
end;
$$;

-- ⚠️ 알림 실패가 본래 동작(댓글 달기 등)을 되돌리면 안 된다.
-- 아래 트리거 함수들은 예외를 삼키고 항상 성공으로 끝난다.

-- ---------------------------------------------------------------
-- 댓글
-- ---------------------------------------------------------------
create or replace function public.tg_notify_comment()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_author uuid;
  v_handle text;
  v_mention uuid;
begin
  begin
    select author_id into v_author from public.posts where id = new.post_id;
    if v_author is not null and v_author <> new.author_id then
      perform public.push_notify('comment', new.author_id, v_author);
    end if;

    -- @아이디로 시작하는 답글이면 지목당한 사람에게도 (내 사진에 달린 답글은
    -- 작성자에게만 가서, 정작 답글을 받은 사람이 모른 채 지나가기 때문)
    -- 옛 아이디에 있던 _도 알아봐야 하므로 예전 형식을 그대로 받는다.
    v_handle := lower(substring(new.body from '^@([A-Za-z0-9_]{3,16})'));
    if v_handle is not null and v_handle <> '' then
      select user_id into v_mention from public.profiles where lower(handle) = v_handle;
      if v_mention is not null
         and v_mention <> new.author_id
         and v_mention is distinct from v_author then
        perform public.push_notify('comment', new.author_id, v_mention);
      end if;
    end if;
  exception when others then
    null; -- 알림 실패로 댓글 저장을 되돌리지 않는다
  end;
  return null;
end;
$$;

drop trigger if exists notify_on_comment on public.comments;
create trigger notify_on_comment
  after insert on public.comments
  for each row execute function public.tg_notify_comment();

-- ---------------------------------------------------------------
-- 메시지
-- ---------------------------------------------------------------
create or replace function public.tg_notify_message()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  begin
    perform public.push_notify('message', new.sender_id, new.recipient_id);
  exception when others then
    null;
  end;
  return null;
end;
$$;

drop trigger if exists notify_on_message on public.messages;
create trigger notify_on_message
  after insert on public.messages
  for each row execute function public.tg_notify_message();

-- ---------------------------------------------------------------
-- 친구 요청 / 수락
-- ---------------------------------------------------------------
-- friendships는 (user_a < user_b)로 정규화된 단일 행이라, '상대'는 requested_by의 반대편이다.
create or replace function public.tg_notify_friendship()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_other uuid;
begin
  begin
    v_other := case when new.requested_by = new.user_a then new.user_b else new.user_a end;
    if tg_op = 'INSERT' and new.status = 'pending' then
      perform public.push_notify('request', new.requested_by, v_other);
    elsif tg_op = 'UPDATE' and new.status = 'accepted' and old.status is distinct from 'accepted' then
      -- 수락한 사람 = 요청자의 반대편 → 요청자에게 알린다
      perform public.push_notify('accept', v_other, new.requested_by);
    end if;
  exception when others then
    null;
  end;
  return null;
end;
$$;

drop trigger if exists notify_on_friendship on public.friendships;
create trigger notify_on_friendship
  after insert or update on public.friendships
  for each row execute function public.tg_notify_friendship();

-- ---------------------------------------------------------------
-- 확인
-- ---------------------------------------------------------------
-- 1) 트리거 3개가 붙었는지
--   select tgname, tgrelid::regclass from pg_trigger
--    where tgname in ('notify_on_comment','notify_on_message','notify_on_friendship');
-- 2) 키가 들어갔는지 (값은 안 보고 존재만)
--   select name from vault.secrets where name = 'notify_service_key';
-- 3) 실제로 나갔는지 — pg_net 응답 로그 (Edge Function이 200이면 성공)
--   select id, status_code, content from net._http_response order by id desc limit 5;
