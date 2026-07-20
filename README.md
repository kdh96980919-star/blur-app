# blur service MVP

`blur` 디자인 핸드오프를 바탕으로 만든 모바일 우선 PWA입니다. 별도 빌드 도구 없이 정적 파일만으로 실행되며, 모바일 브라우저에서 설치형 앱처럼 사용할 수 있습니다.

## 라이브 배포 (2026-07-07)

- **URL**: https://kdh96980919-star.github.io/blur-app/
- **베타 초대 랜딩**: https://kdh96980919-star.github.io/blur-app/invite/ — 지인에게 보낼 소개 페이지 (소스 `invite/index.html`, 2026-07-11 배포)
- **배포 저장소**: https://github.com/kdh96980919-star/blur-app (GitHub Pages, main 브랜치 루트)
- 재배포 방법: 이 폴더의 파일을 수정한 뒤 `blur-app` 저장소를 clone해서 파일을 덮어쓰고 push하면 1~2분 내 반영됩니다.

```bash
git clone https://github.com/kdh96980919-star/blur-app.git /tmp/blur-app
rsync -a --exclude .git --exclude .DS_Store /Users/kim/Desktop/anti/10-working/blur-service/ /tmp/blur-app/
cd /tmp/blur-app && git add -A && git commit -m "update" && git push
```

## 중요한 구분

- `/` : 배포 가능한 형태로 다시 구현한 PWA MVP
- `/prototype/` : 전달받은 `blur 앱 v5.dc.html` 원본 프로토타입을 그대로 복사한 비교 기준

원본 디자인과 픽셀 단위로 맞춰야 할 때는 `/prototype/`를 기준으로 보고, 실제 서비스 코드로 발전시킬 대상은 `/`입니다. 지금 MVP는 기능 구현을 우선해서 원본 HTML과 화면이 다르게 보일 수 있습니다.

## 지금 구현된 것

- 온보딩(탭해서 시작 + 블러 배경) + **카카오·구글 소셜 로그인 전용 인증** (2026-07-19 개편 — 자체 아이디/비밀번호·복구 코드 폐지, 첫 로그인 때 이름·아이디 설정. `supabase/migration-09.sql` + `docs/oauth-setup.md`의 콘솔 설정 필요)
- 오늘 / 전체 / 친구 / 룸 4탭 + 플로팅 파스텔 탭 도크
- 사진 카드 blur 해제, 댓글 시트(작성자 프로필·아이디 표시), 공개/비공개 프로필
- 친구 요청, 수락/거절(원형 기호 버튼), 친구 삭제/차단 액션 시트
- 3단계 업로드 플로우: 사진 선택, 수정, 마지막 확인, 게시
- 프로필 수정: 앨범 사진, 아이디 중복 검사, 한 줄 소개(bio)
- 룸 탭: 세로 중앙 프로필 + "N명이 내 오늘을 열어봤어요" 열람 통계
- 설정: 알림, 공개 계정, 로그아웃, 회원 탈퇴
- 로컬 저장, 서비스 워커 캐시, 앱 manifest

## 디자인 싱크 (2026-07-10)

Figma Make(`Figma-Design-Editing`)에서 수정한 UI를 이식했습니다.
타이포 토큰(`--font-*`, `--fs-*`)이 `styles.css` 상단에 있어 폰트/크기를 한 곳에서 조정할 수 있습니다.

⚠️ 배포 전 필수: 프로필 한 줄 소개(bio)가 추가되어 `supabase/migration-03.sql`을
Supabase Dashboard → SQL Editor에서 먼저 실행해야 프로필 저장이 동작합니다.

## 모바일 버그 수정 + 운영 정책 (2026-07-10)

**입력 안정화**: 텍스트 타이핑 중에는 전체 재렌더를 하지 않고 힌트/버튼만 부분 패치합니다.
(재렌더가 입력창을 교체하면서 한글 조합 끊김·키보드 리셋·화면 떨림을 일으켰음)
같은 화면을 다시 그릴 때는 진입 애니메이션을 끄고 스크롤 위치를 보존합니다(`.phone.no-anim`).

**사진 수정 단계**: 자르기 + 필터만 유지 (확대·축소, 화면 분할 제거).

**비공개 계정 (migration-04)**: '모두 공개' 글이어도 계정이 비공개면 전체 탭·API에서 숨김.
공개 → 비공개 전환 시 기존 글도 즉시 숨겨집니다.

**주제 승인제 (migration-04)**: 클라이언트가 주제를 자동 생성하지 않습니다.
매주 `supabase/topics-weekly.sql`의 날짜·주제를 검토해 SQL Editor에서 실행해야 하며,
주제가 없는 날은 "오늘의 주제를 준비하고 있어요"가 표시되고 사진 게시가 잠깁니다.

**연락처 친구 찾기 (migration-10)**: 친구 탭의 "연락처로 친구 찾기" 카드에서 내 번호를
등록(암호화 해시만 저장, 원본 번호는 서버에 남지 않음)하면 지인이 나를 찾을 수 있고,
"연락처 불러오기"로 기기 연락처의 지인 중 blur 가입자를 추천 친구 맨 앞에 올립니다.
번호 해시는 본인만 접근 가능한 별도 테이블(`contact_hashes`)에 두고 매칭은 security definer
RPC(`match_contacts`)로만 하므로 남의 번호 가입 여부를 캐낼 수 없습니다.
⚠️ 배포 전 `supabase/migration-10.sql`을 SQL Editor에서 실행해야 동작합니다.
연락처 읽기(Contact Picker API)는 안드로이드 크롬만 지원 — iOS·데스크톱은 안내 문구가
표시되며, 아이폰은 추후 Expo 네이티브 앱에서 완전히 동작합니다(내 번호만은 iOS 정책상 직접 입력).

**웹 푸시 잠금화면 알림 (migration-11 + notify Edge Function)**: 앱을 꺼놔도 친구 요청·수락·
댓글·메시지가 폰 잠금화면 알림으로 옵니다. 설정 → "잠금화면 알림" 토글로 켬. 브라우저
PushManager 구독을 `push_subscriptions`(본인만 접근)에 저장하고, 액션 발생 시 `notify` Edge
Function이 VAPID 서명으로 발송(문구는 서버가 생성, 두 사람이 friendships 관계일 때만 — 스팸 방지).
⚠️ 셋업 절차(마이그레이션·VAPID 시크릿·함수 배포)는 `docs/push-setup.md` 참고. **iOS는
'홈 화면에 추가'로 PWA 설치 후에만 웹 푸시 동작(iOS 16.4+)**, 안드로이드·데스크톱은 브라우저에서 바로.

## 로컬 실행

```bash
cd /Users/kim/Desktop/anti/10-working/blur-service
python3 -m http.server 4173
```

브라우저에서 `http://127.0.0.1:4173`을 열면 됩니다. 같은 Wi-Fi의 휴대폰에서 테스트하려면 Mac의 로컬 IP로 `http://<Mac-IP>:4173`을 열어주세요.

원본 디자인 프로토타입은 `http://127.0.0.1:4173/prototype/`에서 확인할 수 있습니다.

## 배포

이 앱은 빌드 과정이 없는 정적 PWA입니다.

- Netlify: 이 폴더를 사이트로 연결하고 publish directory를 `.`로 지정
- Vercel: Framework Preset을 `Other`로 두고 root를 이 폴더로 지정
- GitHub Pages/Cloudflare Pages: 정적 파일 그대로 배포

배포 설정 파일은 `netlify.toml`, `vercel.json`에 포함되어 있습니다.

## 프로덕션 전환 메모

현재 MVP는 사용자 데이터와 업로드 이미지를 브라우저 로컬 저장소에 보관합니다. 실제 다중 사용자 서비스로 공개하려면 `docs/backend-plan.md`의 테이블과 API를 기준으로 Supabase를 연결하면 됩니다.

- `supabase/schema.sql` — 테이블 6종 + RLS + Storage 정책 완성본 (SQL Editor에 붙여넣어 실행)
- `docs/supabase-setup.md` — 프로젝트 생성부터 키 발급까지 단계별 가이드
- 앱 스토어 출시 경로: Supabase 연동 → React Native + Expo 재구현(권장) 또는 Capacitor 래핑 → 심사 제출
