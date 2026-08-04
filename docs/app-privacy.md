# blur — App Privacy (데이터 수집 신고) 설문 답안

> 작성 2026-07-31 · App Store Connect → 앱 → **App Privacy**에서 그대로 입력하면 되는 답.
> 근거는 코드에서 실측했다(파일·줄 표기). **`legal/privacy.html`과 반드시 일치해야 한다** — 불일치는 흔한 리젝 사유.
> ⚠️ 이 문서는 공개 폴더(`docs/`)에 있다. 실제 키·비밀은 절대 적지 말 것.

---

## 0. 먼저 답하는 큰 질문 2개

| 질문 | 답 | 근거 |
|---|---|---|
| 이 앱에서 데이터를 수집합니까? | **예** | 계정·콘텐츠 전부 Supabase에 저장 |
| 데이터를 **추적(Tracking)** 에 사용합니까? | **아니오** | 광고 SDK·서드파티 분석 없음. ATT 팝업 불필요 |

> "추적"은 *다른 회사의 앱/웹 데이터와 연결해 광고·데이터브로커에 쓰는 것*을 말한다. blur는 해당 없음.
> 전 항목의 목적은 **App Functionality** 하나뿐이고, 전부 **Linked to You**(계정에 연결됨)다.

---

## 1. 신고할 데이터 유형 (7개)

| App Store Connect 항목 | 실제로 뭐가 저장되나 | 저장 위치 | 근거 |
|---|---|---|---|
| **Contact Info → Email Address** | 카카오·구글이 준 이메일 | `auth.users` | 소셜 로그인 |
| **Contact Info → Name** | 프로필 이름(별명, 12자 이내) | `profiles.name` | `supabase/schema.sql:25` |
| **Contact Info → Phone Number** | ⚠️ **원본 아님 — SHA-256 해시만.** 선택 기능(연락처로 지인 찾기)에서 김이 직접 입력할 때만 | `contact_hashes.phone_hash` | `app.js:1286` 해시, `migration-10.sql:14` 테이블 |
| **Contacts** | 기기 연락처의 번호 → **해시로 바꿔 서버에 조회만** 하고 저장 안 함 | 저장 없음(1회 조회) | `app.js:1324` 읽기, `migration-10.sql:46` RPC는 `stable` select |
| **User Content → Photos or Videos** | 게시한 사진·동영상, 프로필 사진 | Storage `photos` 버킷 | `backend.js:170,178` |
| **User Content → Other User Content** | 댓글, 메시지, 소개글, 신고 내역 | `comments` / `messages` / `reports` | `schema.sql:65` 등 |
| **Identifiers → User ID** | 계정 uuid, 아이디(@handle) | `profiles.user_id`, `.handle` | `schema.sql:23,24` |
| **Identifiers → Device ID** | 푸시 구독(현재 웹푸시 endpoint + 키 2개, 네이티브 전환 후엔 APNs 토큰) | `push_subscriptions` | `backend.js:333` |

전부 **Purpose = App Functionality**, **Linked to You = 예**, **Used for Tracking = 아니오**.

### Contacts 항목에 대한 판단
Apple은 *①기기 밖으로 나가도 저장되지 않고 ②1회 요청 처리에만 쓰이고 ③추적·광고에 안 쓰이면* "수집 안 함"으로 신고할 수 있게 해준다. blur의 연락처 해시는 세 조건을 다 만족한다(RPC가 `stable` select라 어디에도 안 쌓인다).
**그래도 신고하기를 권한다** — 심사자가 코드를 볼 수 없고, 앱에 "연락처로 친구 찾기" UI가 보이는데 신고가 비어 있으면 의심을 산다. 신고 쪽이 리젝 위험이 낮다.

### 신고하지 않는 것
- **위치정보** — 코드에 `geolocation` 호출 자체가 없음
- **결제·금융** — 결제 기능 없음
- **광고 식별자(IDFA)** — 광고 SDK 없음
- **Usage/Diagnostics** — 서드파티 분석 SDK 없음. Supabase가 서버 쪽에 남기는 접속 로그는 앱이 수집해 보내는 데이터가 아니라 신고 대상 아님(단, `privacy.html`에는 이미 "최소한의 로그"로 밝혀 둠 — 유지)

---

## 2. `legal/privacy.html`과의 불일치 — 2026-07-31 수정 완료

| # | 있던 문구 | 실제 | 조치 |
|---|---|---|---|
| 1 | "**전화번호**·위치정보는 수집하지 않고" | 선택 기능에서 **전화번호 해시를 저장**한다 | 문구 수정 + 수집표에 행 추가 ✅ |
| 2 | 수집표에 **푸시 구독 정보 없음** | `push_subscriptions`에 기기별 endpoint·키 저장 | 수집표에 행 추가 ✅ |
| 3 | "데이터 접근은 **행 수준 보안(RLS)** 으로 본인·친구 범위로 제한됩니다" | DB 행은 맞다. 그러나 **사진 파일은 public 버킷**이라 URL을 아는 사람은 친구가 아니어도 열 수 있다(`schema.sql:272`) | 문구를 실제에 맞게 분리 ✅ (구조 변경은 아래 참조) |

### ⏸️ 3번 관련 — 사진 버킷 비공개 전환은 **보류** (2026-07-31 김 결정: "나중에 하자")
> 재개 조건·작업 내용·주의점은 `PROGRESS.md`의 "보류: 사진 버킷 private 전환"에 정리해 뒀다.
> 요약: **차단 기능이 실제로 쓰이기 시작하면 그때 착수.** 지금은 심사에도 문제없다.
- **지금**: `photos` 버킷 `public = true`. 주소는 `{uuid}/post-{시각}-{랜덤6}.jpg`라 추측은 사실상 불가능하지만, **주소가 유출되면(공유·캐시·스크린샷) 로그인 없이 열린다.** 블러도 클라이언트에서만 걸리므로 원본 URL엔 블러가 없다.
- **바꾸면**: 버킷을 private으로 돌리고 signed URL(만료 있는 임시 주소)로 전환. 스키마 주석에도 이미 그 경로가 적혀 있다(`schema.sql:291`).
- **비용**: 사진을 띄우는 모든 지점이 URL을 발급받아야 해서 렌더·캐시 경로를 손대야 한다. 지금 문서 문구는 **실제(public 버킷)에 맞춰 놨으니 심사에는 문제없다.** 바꾸는 건 순수하게 보안 강화 판단.

---

## 3. 네이티브 전환 후 달라지는 것 (Capacitor·Expo 공통)

- **Identifiers → Device ID** 의 내용물이 웹푸시 endpoint → **APNs 디바이스 토큰**으로 바뀐다. 신고 항목 자체는 그대로.
- **Contacts** 는 iOS 네이티브 권한(`NSContactsUsageDescription`)이 붙는다. `Info.plist` 사용 목적 문구도 이 문서와 같은 말이어야 한다.
- **Sign in with Apple** 을 넣으면 Apple의 **이메일 가리기(Private Relay)** 주소가 들어올 수 있다. 이메일을 계정 식별에만 쓰므로 코드 변경은 불필요하지만, `privacy.html`의 "소셜 로그인(카카오·구글)"에 **Apple** 을 추가해야 한다.

## 4. 심사 제출 전 마지막 확인
- [ ] App Store Connect 설문 = 이 문서 1항과 글자 그대로 일치
- [ ] `legal/privacy.html` 라이브 반영(배포 후 실제 URL로 열어 확인)
- [ ] Sign in with Apple 추가 시 `privacy.html`에 Apple 추가
- [ ] `Info.plist` 권한 문구(카메라·앨범·연락처·알림)가 이 문서와 같은 목적을 말하는지
