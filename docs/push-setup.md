# 웹 푸시 알림 셋업 (migration-11 + notify Edge Function)

앱을 꺼놔도 **잠금화면에 알림**이 오게 하는 웹 푸시 설정 절차입니다.
코드는 이미 다 들어가 있고, 아래 3가지(마이그레이션·시크릿·함수 배포)만 하면 동작합니다.

> 알림이 발생하는 이벤트: **친구 요청 / 친구 수락 / 내 게시물 댓글 / 메시지(DM)**
> (문구는 서버가 생성 — 클라이언트가 임의 텍스트를 넣을 수 없음)

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
  VAPID_SUBJECT="mailto:202501630@inu.ac.kr"

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
