// broadcast — 전체 이용자에게 웹 푸시 공지 발송 (운영자 전용)
//
// notify 함수는 '친구 사이'에만 발송하도록 관계 검증이 걸려 있다. 이 함수는 그와 별개로
// 운영자(김)가 모든 구독자에게 한 번에 공지(예: "새 허브 주제가 올라왔어요")를 보내기 위한 것.
// 아무나 전체 발송하면 스팸이 되므로, 반드시 운영자만 아는 BROADCAST_SECRET 으로 보호한다.
//
// 배포(인증은 우리 시크릿으로 하므로 플랫폼 JWT 검증은 끈다):
//   supabase functions deploy broadcast --no-verify-jwt --project-ref nzrfzxpqvhdkmogpsscz
// 시크릿(한 번만):
//   supabase secrets set BROADCAST_SECRET=<길고 무작위한 문자열> --project-ref nzrfzxpqvhdkmogpsscz
//   (VAPID_* 시크릿은 notify 배포 때 이미 등록돼 있어 그대로 공유된다)
//
// 호출(김이 터미널에서). 반드시 대상을 명시한다:
//   · 본인 미리보기 → "testUid":"<내 user_id>"  (그 사람에게만 발송)
//   · 전체 발송     → "all":true               (모든 구독자에게 발송)
//   둘 다 없으면 실수 방지를 위해 거부(400 target-required)한다.
//
//   curl -X POST 'https://nzrfzxpqvhdkmogpsscz.functions.supabase.co/broadcast' \
//     -H "Content-Type: application/json" \
//     -H "x-broadcast-secret: <BROADCAST_SECRET>" \
//     -d '{"title":"새 허브 주제가 올라왔어요 📷","body":"오늘의 주제로 사진 한 장 남겨보세요","all":true}'
//
// 문구 안에 큰따옴표(")를 넣지 말 것 — JSON 이 깨진다. 깨진 JSON 은 발송하지 않고 400 을 낸다.
// 응답: { total, sent, failed } — total 구독 수, 실제 발송 성공/실패 수.
import webpush from "npm:web-push@3.6.7";
import { createClient } from "jsr:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const VAPID_PUBLIC = Deno.env.get("VAPID_PUBLIC_KEY")!;
const VAPID_PRIVATE = Deno.env.get("VAPID_PRIVATE_KEY")!;
const VAPID_SUBJECT = Deno.env.get("VAPID_SUBJECT") || "mailto:202501630@inu.ac.kr";
const BROADCAST_SECRET = Deno.env.get("BROADCAST_SECRET") || "";

webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC, VAPID_PRIVATE);

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-broadcast-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS"
};

function json(obj: unknown, status = 200) {
  return new Response(JSON.stringify(obj), { status, headers: { ...cors, "Content-Type": "application/json" } });
}

// 길이가 같을 때 문자별로 전부 비교해 타이밍 차이로 시크릿을 추측당하지 않게 한다
function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "method" }, 405);
  try {
    if (!BROADCAST_SECRET) return json({ error: "secret-not-configured" }, 500);

    // ⚠️ JSON 오타가 있으면 조용히 기본값으로 발송하지 않는다 — 예전엔 body 오타 때문에
    // testUid 까지 무시돼 의도치 않게 전체 발송된 사고가 있었다. 깨진 JSON은 즉시 거부한다.
    const raw = await req.text();
    let bodyIn: Record<string, unknown>;
    try {
      bodyIn = raw ? JSON.parse(raw) : {};
    } catch {
      return json({ error: "bad-json", hint: "따옴표/쉼표를 확인하세요. 문구 안에 큰따옴표(\")를 넣지 마세요." }, 400);
    }

    // 시크릿은 헤더 우선, 없으면 body 에서도 허용
    const given = String(req.headers.get("x-broadcast-secret") || bodyIn.secret || "");
    if (!safeEqual(given, BROADCAST_SECRET)) return json({ error: "unauthorized" }, 401);

    const title = String(bodyIn.title || "새 허브 주제가 올라왔어요 📷").slice(0, 120);
    const body = String(bodyIn.body || "오늘의 주제로 사진 한 장 남겨보세요").slice(0, 200);
    const url = String(bodyIn.url || "./").slice(0, 300);
    const payload = JSON.stringify({ title, body, url, tag: "broadcast" });

    // testUid 를 주면 그 사용자에게만 보낸다(전체 발송 전 본인 기기 미리보기).
    // 전체 발송은 반드시 all:true 를 명시해야 한다 — testUid 오타로 실수 전체 발송되는 걸 막는다.
    const testUid = bodyIn.testUid ? String(bodyIn.testUid) : "";
    const all = bodyIn.all === true;
    if (!testUid && !all) {
      return json({ error: "target-required", hint: "본인 미리보기는 testUid 를, 전체 발송은 \"all\":true 를 넣으세요." }, 400);
    }

    const admin = createClient(SUPABASE_URL, SERVICE_ROLE);
    const q = admin.from("push_subscriptions").select("*");
    const { data: subs, error } = await (testUid ? q.eq("user_id", testUid) : q);
    if (error) return json({ error: "query", detail: error.message }, 500);
    if (!subs || !subs.length) return json({ total: 0, sent: 0, failed: 0 }, 200);

    let sent = 0;
    let failed = 0;
    await Promise.all(subs.map(async (s: any) => {
      const sub = { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } };
      try {
        await webpush.sendNotification(sub, payload);
        sent++;
      } catch (err: any) {
        failed++;
        // 만료·삭제된 구독은 정리한다 (notify 와 동일)
        if (err?.statusCode === 404 || err?.statusCode === 410) {
          await admin.from("push_subscriptions").delete().eq("endpoint", s.endpoint);
        }
      }
    }));
    return json({ total: subs.length, sent, failed }, 200);
  } catch (e) {
    return json({ error: String(e) }, 500);
  }
});
