# 소셜 로그인(카카오·구글) 콘솔 설정 가이드

migration-09 실행과 함께, 아래 대시보드 설정을 마쳐야 소셜 로그인이 동작한다.
코드는 이미 완료 — 이 문서의 작업은 전부 **외부 콘솔에서 김이 직접** 해야 한다.

공통으로 쓰이는 값:

| 항목 | 값 |
|---|---|
| Supabase 콜백 URL | `https://nzrfzxpqvhdkmogpsscz.supabase.co/auth/v1/callback` |
| 라이브 앱 주소 | `https://kdh96980919-star.github.io/blur-app/` |
| 로컬 테스트 주소 | `http://localhost:8642/` |

---

## 1. Supabase — Redirect URL 허용 목록 (5분)

1. [Supabase Dashboard](https://supabase.com/dashboard) → 프로젝트 → **Authentication → URL Configuration**
2. **Site URL**: `https://kdh96980919-star.github.io/blur-app/`
3. **Redirect URLs**에 추가:
   - `https://kdh96980919-star.github.io/blur-app/`
   - `http://localhost:8642/` (로컬 검증용)

## 2. 구글 (Google Cloud Console, 15분)

1. [Google Cloud Console](https://console.cloud.google.com/) → 새 프로젝트(예: `blur-app`) 생성
2. **API 및 서비스 → OAuth 동의 화면**: External, 앱 이름 `blur`, 이메일 입력 → 저장 (테스트 모드면 테스트 사용자에 본인+지인 이메일 추가, 또는 '앱 게시'로 프로덕션 전환)
3. **사용자 인증 정보 → 사용자 인증 정보 만들기 → OAuth 클라이언트 ID**
   - 유형: **웹 애플리케이션**
   - 승인된 리디렉션 URI: `https://nzrfzxpqvhdkmogpsscz.supabase.co/auth/v1/callback`
4. 발급된 **클라이언트 ID / 클라이언트 보안 비밀** 복사
5. Supabase → **Authentication → Providers → Google** → Enable, ID/Secret 붙여넣기 → Save

## 3. 카카오 (Kakao Developers, 15분)

1. [Kakao Developers](https://developers.kakao.com/) → 내 애플리케이션 → **애플리케이션 추가**(앱 이름 `blur`)
2. **앱 설정 → 플랫폼 → Web 플랫폼 등록**: 사이트 도메인에 `https://kdh96980919-star.github.io` 등록
3. **제품 설정 → 카카오 로그인** → 활성화 ON
   - ⚠️ Redirect URI는 여기가 아니라 **[앱] → [플랫폼 키] → REST API 키 상세 → 리다이렉트 URI 등록**에서 추가한다(2025-12 콘솔 개편 — 미등록 시 KOE006):
     `https://nzrfzxpqvhdkmogpsscz.supabase.co/auth/v1/callback`
4. **개인 개발자 비즈 앱 전환** (이메일 동의항목을 열기 위해 필수 — 일반 앱은 account_email이 '권한 없음'으로 잠겨 있음):
   1. 우측 상단 프로필 → **계정 설정 → 본인인증** 완료 (앱 소유자 계정)
   2. 내 애플리케이션 → blur 앱 → **앱 → 일반 → 비즈니스 정보 → 개인 개발자 비즈 앱** → 카카오비즈니스 통합 서비스 약관 동의
   3. 사업자등록번호 불필요. 단, 이메일 '필수 동의'는 못 쓰고 '선택 동의'까지만 가능
5. **제품 설정 → 카카오 로그인 → 동의항목** — ⚠️ 아래 3개 전부 설정해야 한다. Supabase가 셋을 항상 함께 요청하므로 하나라도 '사용 안 함'이면 KOE205(잘못된 요청)로 로그인 자체가 막힌다:
   - 닉네임(profile_nickname): 필수 동의
   - **프로필 사진(profile_image): 선택 동의**
   - **카카오계정(이메일, account_email): 선택 동의** — Supabase는 이메일이 없으면 계정 생성에 실패하므로, 로그인 화면에서 사용자가 이메일 제공 체크를 유지해야 한다. 베타 지인들에게 "이메일 동의 체크" 안내 필요. 정식 출시 때 사업자 등록 후 필수 동의로 전환 가능
6. **앱 → 플랫폼 키**에서 **REST API 키** 확인(없으면 추가) → 복사
7. 그 REST API 키 상세 안의 **클라이언트 시크릿** 값 복사
   (2025-12 콘솔 개편으로 이동 — 구 위치였던 '카카오 로그인 > 보안' 탭은 없어짐. **어드민 키 아님 주의**)
8. Supabase → **Authentication → Providers → Kakao** → Enable
   - Client ID = REST API 키, Client Secret = 클라이언트 시크릿 → Save

## 4. 검증 순서

1. migration-09.sql 실행 확인 (기존 계정 삭제 + setup_done + 트리거)
2. 로컬: `python3 -m http.server 8642` → 웰컴 → 카카오/구글 버튼 → 로그인 → 이름·아이디 설정 화면 → 온보딩 3장 → 앱 진입
3. 로그아웃 → 같은 소셜 계정으로 재로그인 → **설정 화면 없이 바로 앱**으로 들어오는지
4. 라이브에서 2·3 반복

## 문제 해결

- **"redirect_uri_mismatch"** (구글): 리디렉션 URI 오타 — Supabase 콜백 URL과 정확히 일치해야 함
- **"KOE101"** (카카오): 앱 키 종류 확인 — JavaScript 키가 아니라 **REST API 키**
- **로그인 후 흰 화면/웰컴으로 복귀**: Supabase Redirect URLs 허용 목록에 앱 주소가 없을 때 — 1번 다시 확인
- **카카오 로그인은 되는데 "서버 요청에 실패했어요"**: 이메일 동의를 건너뛴 경우 — 동의항목에서 이메일 활성화 확인
