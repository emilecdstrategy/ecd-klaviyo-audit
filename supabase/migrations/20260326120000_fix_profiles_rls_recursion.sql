/*
  Fix infinite recursion in RLS policies for public.profiles.

  Problem:
    Policies like "Admins can read all profiles" query public.profiles inside
    the policy expression, causing recursion.

  Fix:
    Use a SECURITY DEFINER helper (runs as table owner, bypassing RLS) and
    reference it in policies.
*/

-- Helper function: check if current user is admin
CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.profiles p
    WHERE p.id = auth.uid()
      AND p.role = 'admin'
  );
$$;

REVOKE ALL ON FUNCTION public.is_admin() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_admin() TO authenticated;

-- Drop recursive policies if they exist
DROP POLICY IF EXISTS "Admins can read all profiles" ON public.profiles;
DROP POLICY IF EXISTS "Admins can update any profile" ON public.profiles;
DROP POLICY IF EXISTS "Admins can insert profiles" ON public.profiles;

-- Recreate admin policies using the helper
DO $$ BEGIN
  CREATE POLICY "Admins can read all profiles"
    ON public.profiles FOR SELECT
    TO authenticated
    USING (public.is_admin());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "Admins can update any profile"
    ON public.profiles FOR UPDATE
    TO authenticated
    USING (public.is_admin())
    WITH CHECK (public.is_admin());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "Admins can insert profiles"
    ON public.profiles FOR INSERT
    TO authenticated
    WITH CHECK (public.is_admin() OR auth.uid() = id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

