# 웹 푸시 알림 셋업 (migration-11 + migration-14 + notify Edge Function)

앱을 꺼놔도 **잠금화면에 알림**이 오게 하는 웹 푸시 설정 절차입니다.

> 알림이 발생하는 이벤트: **친구 요청 / 친구 수락 / 내 게시물 댓글 / 메시지(DM)**
> (문구는 서버가 생성 — 클라이언트가 임의 텍스트를 넣을 수 없음)

## 누가 발송을 시작하는가 (2026-07-29 변경)

**DB 트리거입니다.** 예전에는 '행동한 사람의 앱'이 notify 함수를 직접 불렀는데,
댓글을 달자마자 앱이 죽거나 네트워크가 끊기면 알림이 조용히 유실됐습니다.
이제 `comments` / `messages` / `friendships` 행이 들어가는 순간 트리거가 발송합니다 —
**데이터가 남았으면 알림도 반드시 나갑니다.**

- 트리거·발송 함수: `supabase/migration-14.sql`
- 트리거는 **우리가 만든 무작위 공유 비밀**(`x-notify-secret` 헤더)로 자신을 증명합니다.
  supabase 키를 쓰지 않는 이유: 레거시 JWT(`eyJ...`)와 신형(`sb_secret_...`) 두 형식이
  공존해 어느 쪽이 함수 환경변수에 들어오는지 프로젝트마다 다르고, `Authorization`
  헤더는 공개된 anon 키로도 채워질 수 있어 인증 근거가 못 됩니다.
- 같은 비밀이 **두 곳**에 있어야 합니다: Supabase Vault `notify_service_key`(트리거가 읽음)
  와 함수 시크릿 `NOTIFY_SECRET`(함수가 대조함). 저장소에는 없습니다.
- `Authorization`에는 공개 anon 키를 넣습니다 — 플랫폼 `verify_jwt`를 통과시키는 용도일 뿐입니다.
- Edge Function은 **이 비밀이 맞는 호출만** 받습니다. 구버전 앱이 사용자 JWT로 불러도
  조용히 무시(200 skipped)하므로 이관 중 알림이 두 번 가지 않습니다.

### 이관/재배포 순서 (중요)

1. 무작위 비밀 생성 → Vault에 `notify_service_key`로 저장 → `migration-14.sql` 실행
2. `supabase secrets set NOTIFY_SECRET=<같은 비밀>` → `supabase functions deploy notify`
3. 앱 배포 — 앱에서 알림 호출 코드가 빠진 버전

1만 한 상태에선 트리거 호출이 구버전 함수에 막혀 무시되고 기존 앱 경로로 계속 알림이
갑니다. 즉 **중간에 끊기거나 두 번 가는 구간이 없습니다.**

---

## 1. 마이그레이션 실행

Supabase Dashboard → **SQL Editor** → New query → `supabase/migration-11.sql` 전체 붙여넣고 **Run**.
→ `push_subscriptions` 테이블(구독 저장, 본인만 접근)이 생깁니다.

## 2. VAPID 키

- **공개 키**는 이미 `config.js`의 `VAPID_PUBLIC_KEY`에 넣어 뒀습니다(공개용이라 커밋 OK).
- **개인 키**는 절대 저장소에 두지 말고, 아래 시크릿으로만 등록합니다.
  (키를 새로 만들려면: `npx web-push generate-vapid-keys --json` — 단, 공개 키를 바꾸면 `config.js`도 같이 바꿔야 함)

## 3. Edge Function 배포 + 시크릿

### 방법 A — Supabase CLI (권장)

```bash
# CLI 설치 (Mac)
brew install supabase/tap/supabase

# 로그인 & 프로젝트 연결
supabase login
supabase link --project-ref nzrfzxpqvhdkmogpsscz

# 시크릿 등록 (개인 키는 카톡/메모에서 복사)
supabase secrets set \
  VAPID_PUBLIC_KEY="BKRWzZhZd5lovi0RPu7dgWDt_d8HAkMu0q_maqEg9IEWVxAv8VdFQThJzxmEJ_AgONmjGF0FcPynPX9IHNOTsmk" \
  VAPID_PRIVATE_KEY="<여기에 개인 키>" \
  VAPID_SUBJECT="mailto:blurfrom@gmail.com"

# 함수 배포
supabase functions deploy notify
```

### 방법 B — 대시보드

1. Dashboard → **Edge Functions** → **Create function** → 이름 `notify` → `supabase/functions/notify/index.ts` 내용 붙여넣기 → Deploy.
2. Dashboard → **Edge Functions** → **Secrets**(또는 Settings → Edge Functions)에서
   `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` 3개 등록.

> `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`는 플랫폼이 자동 주입하므로 등록 불필요.
> 함수는 로그인 JWT를 검증하고, 두 사람 사이 `friendships` 행이 있을 때만 발송합니다(스팸 방지).

---

## 4. 켜기 / 테스트

- 앱 **설정 → 잠금화면 알림** 토글을 켜면 브라우저가 권한을 묻고, 허용하면 구독이 저장됩니다.
- 두 계정(A·B)이 친구인 상태에서, **B가 앱을 완전히 닫은 채** A가 B에게 DM·댓글·친구요청 →
  B의 폰에 잠금화면 알림이 오면 성공.

### ⚠️ iOS(아이폰) 주의

- iOS는 **Safari 탭에서는 웹 푸시가 안 됩니다.** 반드시 **공유 → "홈 화면에 추가"로 PWA를 설치**한 뒤,
  홈 화면 아이콘으로 앱을 열어 알림을 켜야 잠금화면 알림이 옵니다(iOS 16.4+).
- 안드로이드 크롬은 브라우저에서 바로 됩니다.
- 데스크톱 크롬/엣지도 됩니다.

## 문제 해결

- 함수 배포 시 `web-push` import 오류가 나면, `npm:web-push@3.6.7` 대신
  `jsr:@negrel/webpush`로 교체(발송 API는 유사). 대부분은 그대로 배포됩니다.
- 알림이 안 오면: (1) 설정 토글이 켜져 있는지 (2) 기기 OS 알림 권한이 허용인지
  (3) `push_subscriptions`에 행이 있는지 (4) Edge Function 로그(Dashboard → Edge Functions → notify → Logs) 확인.
- **트리거가 실제로 쐈는지**는 SQL Editor에서 pg_net 응답 로그를 봅니다:
  `select id, status_code, content from net._http_response order by id desc limit 5;`
  - 행이 아예 없다 → 트리거가 안 붙었거나 Vault 키가 없음(`push_notify`가 키 없으면 조용히 통과).
    `select name from vault.secrets where name = 'notify_service_key';` 로 확인.
  - `status_code` 200에 `{"skipped":"client-path-retired"}` → 함수가 구버전. 2단계(함수 재배포) 필요.
  - `{"skipped":"no-relation"}` → 두 사람이 친구가 아님(의도된 스팸 방지).
  - `{"sent":0}` → 받는 사람이 알림을 안 켰거나 구독이 없음.
