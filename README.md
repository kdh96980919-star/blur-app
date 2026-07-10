# blur service MVP

`blur` 디자인 핸드오프를 바탕으로 만든 모바일 우선 PWA입니다. 별도 빌드 도구 없이 정적 파일만으로 실행되며, 모바일 브라우저에서 설치형 앱처럼 사용할 수 있습니다.

## 라이브 배포 (2026-07-07)

- **URL**: https://kdh96980919-star.github.io/blur-app/
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

- 온보딩(탭해서 시작 + 블러 배경), 가입, 로그인, 소셜 로그인 연결 오버레이
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
