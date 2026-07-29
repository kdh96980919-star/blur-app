#!/bin/sh
# blur 하루 통계. 사용법: ./stats.sh [YYYY-MM-DD]  (기본=어제 KST)
# anon 키는 클라이언트에 이미 공개된 값. daily_stats는 집계 숫자만 반환.
D="${1:-$(TZ=Asia/Seoul date -v-1d +%F)}"
K='eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im56cmZ6eHBxdmhka21vZ3Bzc2N6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODM0Mjc3NjYsImV4cCI6MjA5OTAwMzc2Nn0.9QP6B46co4109frO-H_PYX_f4fvoPwEwz6HbIHGJuz8'

curl -s https://nzrfzxpqvhdkmogpsscz.supabase.co/rest/v1/rpc/daily_stats \
  -H "apikey: $K" -H "Authorization: Bearer $K" -H 'Content-Type: application/json' \
  -d "{\"d\":\"$D\"}" |
jq -r '
  if .date == null then "조회 실패: \(.)" else
  "blur \(.date)",
  "누적 \(.total_users)명 / 활동 \(.active_users)명 (\(if .total_users>0 then (.active_users*100/.total_users|round) else 0 end)%)",
  "신규가입 \(.new_signups)  사진 \(.posts)(\(.posters)명)  댓글 \(.comments)(\(.commenters)명)  블러열람 \(.revealers)명"
  end'
