-- Edge Functions call these security-definer RPCs through the service-role
-- client. They must retain EXECUTE after public/anonymous access is revoked.

grant execute on function public.reserve_coach_session_usage(
  uuid, text, uuid, text, numeric
) to service_role;

grant execute on function public.record_coach_usage(
  uuid, text, uuid, text, integer, integer, integer, integer, integer, integer, integer, numeric
) to service_role;
