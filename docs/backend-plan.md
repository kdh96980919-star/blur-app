# blur backend plan

이 MVP는 정적 PWA라서 빠르게 배포할 수 있지만, 실서비스에는 서버 검증과 공유 저장소가 필요합니다. 가장 빠른 전환 경로는 Supabase 또는 Firebase입니다.

## 핵심 데이터 모델

| 테이블 | 주요 필드 |
| --- | --- |
| `profiles` | `user_id`, `handle` unique, `name`, `avatar_url`, `color`, `emoji`, `is_public`, `created_at` |
| `posts` | `id`, `author_id`, `hub_date`, `topic`, `image_url`, `caption`, `ratio`, `split`, `filter`, `share_all`, `save_room`, `created_at` |
| `reveals` | `user_id`, `post_id`, `revealed_at` |
| `comments` | `id`, `post_id`, `author_id`, `body`, `created_at` |
| `friendships` | `user_a`, `user_b`, `status` (`pending`, `accepted`, `blocked`), `requested_by`, `created_at` |
| `rooms` | `id`, `owner_id`, `name`, `visibility`, `created_at` |
| `room_posts` | `room_id`, `post_id`, `created_at` |

## 필수 서버 규칙

- `profiles.handle`은 전역 unique로 검증
- 친구 공개 글은 작성자와 accepted friend만 조회
- `share_all=true` 글은 모두 탭에서 조회 가능
- 비공개 계정은 친구가 아닌 사용자에게 프로필/지난 허브 미노출
- 댓글은 게시물을 볼 권한이 있는 사용자만 작성 가능
- 업로드 이미지는 Storage에 저장하고 public URL 또는 signed URL 사용

## API adapter 경계

현재 `app.js`의 상태 변경 지점은 아래 API로 바꾸면 됩니다.

```js
auth.signUp({ name, handle })
auth.signIn({ handle, password })
profiles.update(profile)
posts.listHome()
posts.listPublic()
posts.create(payload)
posts.reveal(postId)
comments.create(postId, body)
friends.request(userId)
friends.accept(userId)
friends.remove(userId)
settings.update({ notif, isPublic })
```

## 배포 순서

1. 정적 PWA를 먼저 배포해서 모바일 UX를 검증
2. 인증과 `profiles.handle` unique 검사를 서버로 이동
3. 사진 업로드를 Storage로 이동
4. 피드/댓글/친구 관계를 서버 조회로 이동
5. 로그, 신고, 차단, 개인정보 삭제 요청 플로우 추가
