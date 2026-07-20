// notify — 웹 푸시 발송 Edge Function (migration-11)
// 배포: supabase functions deploy notify   (또는 Dashboard > Edge Functions)
// 시크릿: supabase secrets set VAPID_PUBLIC_KEY=... VAPID_PRIVATE_KEY=... VAPID_SUBJECT=mailto:you@example.com
// (SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY 는 플랫폼이 자동 주입)
//
// 동작: 로그인한 호출자가 { type, toUid } 를 보내면, 두 사람 사이 friendships 행이 있는지
// 확인(스팸 방지)하고, 알림 문구는 서버가 type 으로 생성해(클라 텍스트 불신) 대상자의
// 모든 구독에 발송한다. 만료된 구독(404/410)은 정리한다.
import webpush from "npm:web-push@3.6.7";
import { createClient } from "jsr:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const VAPID_PUBLIC = Deno.env.get("VAPID_PUBLIC_KEY")!;
const VAPID_PRIVATE = Deno.env.get("VAPID_PRIVATE_KEY")!;
const VAPID_SUBJECT = Deno.env.get("VAPID_SUBJECT") || "mailto:202501630@inu.ac.kr";

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
    case "comment": return `${name}님이 내 게시물에 댓글을 남겼어요`;
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
    const { type, toUid } = await req.json().catch(() => ({}));
    if (!type || !toUid || !UUID.test(String(toUid))) return json({ error: "bad-request" }, 400);

    const admin = createClient(SUPABASE_URL, SERVICE_ROLE);

    // 호출자 식별 (로그인 JWT)
    const token = (req.headers.get("Authorization") || "").replace("Bearer ", "");
    const { data: userData } = await admin.auth.getUser(token);
    const caller = userData?.user;
    if (!caller) return json({ error: "unauthorized" }, 401);
    if (caller.id === toUid) return json({ skipped: "self" }, 200);

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
    // 제목은 비워서 보낸다 — iOS는 상단에 앱이름("blur")을 이미 보여주고, 제목 줄엔 "from "을
    // 자동으로 붙이므로("from blur" 중복) 제목을 비우고 메시지는 본문에만 담는다.
    const payload = JSON.stringify({ title: "", body: bodyText(type, name), url: "./", tag: type });

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
