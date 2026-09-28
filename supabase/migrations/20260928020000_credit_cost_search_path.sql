-- Pin search_path on the one function that lacked it (Supabase security
-- advisor: function_search_path_mutable). It only uses built-ins.
alter function public.project_credit_cost(jsonb, integer) set search_path = '';
