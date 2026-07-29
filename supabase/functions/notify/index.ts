// notify — 웹 푸시 발송 Edge Function (migration-11)
// 배포: supabase functions deploy notify   (또는 Dashboard > Edge Functions)
// 시크릿: supabase secrets set VAPID_PUBLIC_KEY=... VAPID_PRIVATE_KEY=... VAPID_SUBJECT=mailto:you@example.com
//         supabase secrets set NOTIFY_SECRET=...   (Vault의 notify_service_key와 같은 값)
// (SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY 는 플랫폼이 자동 주입)
//
// 동작(migration-14부터): DB 트리거만 이 함수를 부른다. 트리거가 x-notify-secret 헤더와 함께
// { type, fromUid, toUid } 를 보내면, 두 사람 사이 friendships 행이 있는지 확인(스팸 방지)하고,
// 알림 문구는 서버가 type 으로 생성해 대상자의 모든 구독에 발송한다.
// 만료된 구독(404/410)은 정리한다.
//
// ⚠️ 예전에는 '행동한 사람의 앱'이 로그인 JWT로 직접 불렀다. 그 경로는 은퇴했다 —
// 앱이 호출 직후 죽거나 네트워크가 끊기면 알림이 조용히 유실됐기 때문이다.
// 구버전 앱이 캐시에 남아 계속 부를 수 있으므로, 사용자 JWT 호출은 에러가 아니라
// 조용히 무시한다(200 skipped). 이렇게 해야 이관 도중 알림이 두 번 가지 않는다.
import webpush from "npm:web-push@3.6.7";
import { createClient } from "jsr:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const VAPID_PUBLIC = Deno.env.get("VAPID_PUBLIC_KEY")!;
const VAPID_PRIVATE = Deno.env.get("VAPID_PRIVATE_KEY")!;
const VAPID_SUBJECT = Deno.env.get("VAPID_SUBJECT") || "mailto:202501630@inu.ac.kr";
// DB 트리거만 아는 공유 비밀 — Vault의 notify_service_key와 같은 값이어야 한다
// (supabase secrets set NOTIFY_SECRET=... --project-ref nzrfzxpqvhdkmogpsscz)
const NOTIFY_SECRET = Deno.env.get("NOTIFY_SECRET") || "";

webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC, VAPID_PRIVATE);

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS"
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function bodyText(type: string, name: string): string {
  switch (type) {
    case "request": return `${name}님이 친구 요청을 보냈어요`;
    case "accept": return `${name}님이 친구 요청을 수락했어요`;
    case "comment": return `${name}님이 댓글을 남겼어요`;
    case "message": return `${name}님이 메시지를 보냈어요`;
    default: return "새로운 알림이 있어요";
  }
}

function json(obj: unknown, status = 200) {
  return new Response(JSON.stringify(obj), { status, headers: { ...cors, "Content-Type": "application/json" } });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "method" }, 405);
  try {
    const { type, fromUid, toUid } = await req.json().catch(() => ({}));
    if (!type || !toUid || !UUID.test(String(toUid))) return json({ error: "bad-request" }, 400);

    // 호출자는 DB 트리거여야 한다 — 우리가 만든 공유 비밀(x-notify-secret)로 가른다.
    // ⚠️ supabase 키(service_role)로 판별하지 않는다: 레거시 JWT / 신형 sb_secret_ 두 형식이
    // 공존해 어느 쪽이 환경변수에 들어오는지 프로젝트마다 다르고, Authorization 헤더는
    // anon 키(공개)로도 채워질 수 있어 인증 근거가 못 된다.
    // 구버전 앱(사용자 JWT, 이 헤더 없음)의 호출은 조용히 무시한다: 에러로 만들면 앱 콘솔만
    // 시끄럽고, 발송하면 트리거와 겹쳐 알림이 두 번 간다.
    if (!NOTIFY_SECRET) return json({ error: "NOTIFY_SECRET 미설정" }, 500);
    if (req.headers.get("x-notify-secret") !== NOTIFY_SECRET) {
      return json({ skipped: "client-path-retired" }, 200);
    }
    if (!fromUid || !UUID.test(String(fromUid))) return json({ error: "bad-request" }, 400);
    if (fromUid === toUid) return json({ skipped: "self" }, 200);

    const admin = createClient(SUPABASE_URL, SERVICE_ROLE);
    const caller = { id: fromUid as string };

    // 관계 검증 — 두 사람 사이 friendships 행이 있어야 발송 (모르는 사람에게 스팸 금지)
    // friendships 기본키는 복합키(user_a, user_b) — id 컬럼이 없으므로 실재 컬럼(status)을 고른다.
    const { data: rel, error: relErr } = await admin
      .from("friendships")
      .select("status")
      .or(`and(user_a.eq.${caller.id},user_b.eq.${toUid}),and(user_a.eq.${toUid},user_b.eq.${caller.id})`)
      .limit(1);
    if (relErr) return json({ error: "relation-check", detail: relErr.message }, 500);
    if (!rel || !rel.length) return json({ skipped: "no-relation" }, 200);

    // 보낸 사람 이름 (문구는 서버가 생성)
    const { data: prof } = await admin.from("profiles").select("name").eq("user_id", caller.id).single();
    const name = prof?.name || "친구";
    // 메시지를 제목에 담는다 — 안드로이드/데스크톱은 제목이 굵게 강조되므로 비우면 허전하다.
    // iOS는 우리 제목과 무관하게 "from {앱이름}" 표기를 강제로 붙이므로(제거 불가) 여기선 안드로이드
    // 기준으로 최적화. body는 비운다(제목만으로 충분).
    const payload = JSON.stringify({ title: bodyText(type, name), body: "", url: "./", tag: type });

    // 대상자 구독 발송
    const { data: subs } = await admin.from("push_subscriptions").select("*").eq("user_id", toUid);
    if (!subs || !subs.length) return json({ sent: 0 }, 200);

    let sent = 0;
    await Promise.all(subs.map(async (s: any) => {
      const sub = { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } };
      try {
        await webpush.sendNotification(sub, payload);
        sent++;
      } catch (err: any) {
        if (err?.statusCode === 404 || err?.statusCode === 410) {
          await admin.from("push_subscriptions").delete().eq("endpoint", s.endpoint);
        }
      }
    }));
    return json({ sent }, 200);
  } catch (e) {
    return json({ error: String(e) }, 500);
  }
});
