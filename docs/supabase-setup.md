# Supabase 셋업 가이드

> **상태 (2026-07-07)**: 셋업 전체 완료 ✅ — schema.sql + migration-02.sql 적용, 키 연동, 실계정 E2E(13단계) + 탈퇴·아이디변경 검증 통과, 테스트 계정 정리 완료. 백엔드는 운영 상태입니다.

blur를 localStorage MVP에서 실제 다중 사용자 서비스로 전환하기 위한 백엔드 준비 절차입니다.
아래 1~4단계는 **계정 소유자만 할 수 있는 작업**이고, 5단계부터는 Claude Code가 이어받아 연동 코드를 붙입니다.

## 1. 프로젝트 생성 (약 3분)

1. https://supabase.com → **Start your project** → GitHub 계정(kdh96980919-star)으로 로그인
2. **New project** 클릭
   - Organization: 개인 org (자동 생성됨)
   - Name: `blur`
   - Database Password: 강력한 비밀번호 생성 후 **비밀번호 관리자에 저장** (다시 볼 수 없음)
   - Region: **Northeast Asia (Seoul)** — `ap-northeast-2`
   - Plan: Free
3. 프로비저닝이 끝날 때까지 1~2분 대기

## 2. 스키마 적용

1. 왼쪽 메뉴 **SQL Editor** → **New query**
2. 이 저장소의 `supabase/schema.sql` 내용 전체를 붙여넣고 **Run**
3. "Success. No rows returned"가 나오면 완료
   - 테이블 6개(hubs, profiles, posts, reveals, comments, friendships) + RLS 정책 + `photos` Storage 버킷이 생성됩니다

## 3. 인증 설정

1. **Authentication → Providers**에서 **Email** 활성 확인 (기본 활성)
2. (선택) **Confirm email**을 끄면 가입 즉시 로그인됩니다 — 초기 테스트에 편함
3. 카카오/구글 소셜 로그인은 스토어 출시 전 단계에서 추가 (각 개발자 콘솔의 client ID/secret 필요)

## 4. 키 전달

**Settings → API**에서 두 값을 복사해서 Claude Code 세션에 붙여넣어 주세요:

- `Project URL` (예: `https://abcdefgh.supabase.co`)
- `anon public` 키 (공개 가능한 클라이언트 키 — 코드에 포함해도 안전, RLS가 권한을 통제)

⚠️ `service_role` 키는 절대 공유하거나 클라이언트 코드에 넣지 마세요.

## 5. 이후 진행 (Claude Code 담당)

키를 받으면 다음을 진행합니다:

1. `config.js`에 URL/anon 키 설정, supabase-js 클라이언트 연결
2. `app.js`의 상태 변경 지점을 `docs/backend-plan.md`의 API 경계로 교체
   (인증 → 아이디 unique 검사 → 사진 Storage 업로드 → 피드/댓글/친구 순)
3. 실계정 2개로 친구 요청·피드 공개 범위·RLS 동작 검증
4. 재배포

## 운영 메모

- **오늘의 허브 자동 생성**: `hubs` 테이블에 매일 1행이 필요합니다. Dashboard → Database → Cron(pg_cron)으로 매일 00:00 KST에 insert하는 잡을 등록하거나, 주제 목록 테이블을 만들어 순환시키면 됩니다.
- **무료 티어 한도**: DB 500MB, Storage 1GB, 월 활성 사용자 5만 — 지인 테스트~초기 운영에 충분합니다. 1주일 비활성 시 프로젝트가 일시정지되니 주기적으로 접속하세요.
- **사진 프라이버시**: 현재 `photos` 버킷은 public URL 방식입니다(블러는 클라이언트에서 렌더링). 서비스가 커지면 private 버킷 + signed URL로 전환하세요.
