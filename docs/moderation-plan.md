# blur — 콘텐츠 모더레이션 계획

> 작성 2026-07-20 · 목적: ① 내부 운영 런북 ② App Store 심사노트(Guideline 1.2 UGC) 첨부용
> App Review Guideline 1.2는 사용자 생성 콘텐츠(UGC) 앱에 **금지 콘텐츠 정의 + 신고 + 차단 + 24시간 내 조치 + 개발자 연락처**를 요구함. 아래가 그 대응.

---

## 1. 금지 콘텐츠 (Prohibited Content)
이용약관(`legal/terms.html`)에 명시. 다음을 금지:
- 불법 콘텐츠, 미성년자 대상 유해물, 성착취물(CSAE)
- 노골적 성적 콘텐츠·음란물
- 폭력·자해·타인 위협·괴롭힘
- 혐오 발언(인종·성별·종교·성적지향 등 차별·비하)
- 타인 사칭, 개인정보 무단 게시(전화번호·주소·타인 사진 등)
- 스팸·광고·반복 도배
- 저작권·초상권 침해

가입 시 이용약관 동의 절차를 거치며, 위반 시 콘텐츠 삭제·계정 정지될 수 있음을 고지.

## 2. 신고 (Report) — ✅ 구현됨 (migration-06)
- **진입점 3종**: 게시물(사진 뷰어 상단 flag), 댓글(남의 댓글 flag), 사용자(프로필 상단·친구 액션시트)
- **신고 사유 4종**: 스팸·광고 / 불쾌하거나 부적절한 콘텐츠 / 사칭·개인정보 침해 / 기타
- 신고는 `reports` 테이블에 저장(신고자·대상·유형·사유·시각). **unique 제약**으로 같은 대상 중복 신고는 1건 유지.
- 신고 사실은 상대에게 알리지 않음(보복 방지). 앱 내 안내: "신고는 운영자가 검토하고 필요하면 조치해요."
- 신고 도배 방지: 계정당 **하루 30건** 제한(트리거).

## 3. 차단 (Block) — ✅ 구현됨
- 친구/프로필 액션에서 사용자 차단 가능. 차단 시 상호 노출·상호작용 차단.
- 차단 해제는 **차단한 본인만** 가능(RLS `requested_by` 기준, migration-07).

## 4. 계정 정지 (Ban) — ✅ 구현됨 (migration-07)
- `profiles.banned` 플래그. banned 계정은 **모든 쓰기(게시·댓글·DM·친구요청·신고) 차단**(전 insert 정책이 `not is_banned` 검사).
- **본인은 밴을 못 풂** — 운영자(Supabase 대시보드/service_role, `auth.uid()`가 null)만 변경 가능(guard 트리거).

## 5. 스팸·도배 방지 — ✅ 구현됨 (migration-07 트리거)
- 댓글 60건/시간 · DM 300건/시간 · 친구요청 50건/일 · 신고 30건/일 초과 시 차단.
- 서버(RLS·트리거)에서 강제 — 클라이언트 우회 불가.

## 6. 운영자 검토·조치 프로세스 (24시간 SLA)

> 현재 별도 관리자 UI 없음 → **Supabase 대시보드**로 운영(초기 규모엔 충분).

**일일 루틴 (신고 확인):**
1. Supabase 대시보드 → Table Editor → `reports` 테이블 확인 (또는 SQL: `select * from reports order by created_at desc`)
2. 신고 대상 콘텐츠/계정 조회 (`posts`·`comments`·`profiles`에서 대상 id로)
3. 판단 후 조치:
   - **경미/오신고**: 조치 없음, 신고 확인 처리
   - **콘텐츠 위반**: 해당 `posts`/`comments` 행 삭제 (Storage 사진도 함께 정리)
   - **반복·심각 위반 계정**: `update profiles set banned = true where user_id = '...'` → 즉시 전 기능 차단
4. **접수~조치 24시간 이내** 원칙. (심각 신고 = 성착취물·자해·급박한 위협은 즉시)

**긴급(CSAE 등) 발견 시**: 콘텐츠 즉시 삭제 + 계정 밴 + 필요 시 관계기관 신고.

## 7. 연락처
- 신고·문의: **202501630@inu.ac.kr** (약관·개인정보처리방침에 명시)

---

## 📋 App Review Notes 붙여넣기용 (제출 시)

**한국어:**
```
blur는 지인 기반 사진 공유 앱으로, 사용자 생성 콘텐츠 안전장치를 갖추고 있습니다.
· 이용약관에 금지 콘텐츠를 정의하고 가입 시 동의를 받습니다.
· 모든 게시물·댓글·사용자를 신고할 수 있습니다(사유 4종).
· 사용자 차단 기능을 제공합니다.
· 운영자가 신고를 검토하고 위반 콘텐츠 삭제 및 계정 정지를 24시간 이내에 조치합니다.
· 스팸·도배는 서버단 속도 제한으로 차단합니다.
· 문의: 202501630@inu.ac.kr
심사용 로그인 계정: (별도 제공 — App Review 정보란 참고)
```

**English:**
```
blur is a friends-only photo sharing app with user-generated content safeguards:
· A EULA defines objectionable content; users agree on sign-up.
· Users can report any post, comment, or user (4 reasons).
· Users can block other users.
· The operator reviews reports and removes violating content / suspends accounts within 24 hours.
· Spam is prevented by server-side rate limits.
· Contact: 202501630@inu.ac.kr
Demo account for review: see App Review Information (login is OAuth-only; test credentials provided there).
```

---

## ⏳ 제출 전 보완 검토
- [x] 약관(terms.html) 금지 콘텐츠 보강 ✅ (2026-07-20) — CSAE·괴롭힘·자해조장·혐오 명시 + 무관용 원칙 + 24시간 조치 명문화. ⏳ 라이브 반영은 배포 필요
- [ ] (선택) 앱 내 "신고하기"가 심사자 눈에 잘 띄는지 — 심사노트에 신고 진입 경로 스크린샷 첨부 권장
- [ ] Expo 네이티브 전환 시 신고·차단 UI 동일 이식 확인
- [ ] (규모 커지면) 신고 대응용 간단 관리자 뷰 or Supabase 저장 프로시저 마련
