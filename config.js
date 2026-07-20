// Supabase 프로젝트 설정
// anon key는 공개용 클라이언트 키입니다 — 권한은 서버의 RLS 정책이 통제합니다.
export const SUPABASE_URL = "https://nzrfzxpqvhdkmogpsscz.supabase.co";
export const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im56cmZ6eHBxdmhka21vZ3Bzc2N6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODM0Mjc3NjYsImV4cCI6MjA5OTAwMzc2Nn0.9QP6B46co4109frO-H_PYX_f4fvoPwEwz6HbIHGJuz8";

// 웹 푸시 VAPID 공개 키 (공개용 — 브라우저 구독에 필요). 개인 키는 절대 여기 두지 말 것:
// Supabase Edge Function(notify)의 시크릿 VAPID_PRIVATE_KEY로만 보관한다.
export const VAPID_PUBLIC_KEY = "BKRWzZhZd5lovi0RPu7dgWDt_d8HAkMu0q_maqEg9IEWVxAv8VdFQThJzxmEJ_AgONmjGF0FcPynPX9IHNOTsmk";
