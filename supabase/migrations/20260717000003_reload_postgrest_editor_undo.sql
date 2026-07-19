-- Make the newly introduced undo RPC available to PostgREST immediately.
notify pgrst, 'reload schema';
