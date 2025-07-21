-- Crossie Annotation Tool - Row Level Security Policies
-- This file contains all RLS policies for the Supabase database
-- Run these commands in Supabase SQL Editor

-- First, enable RLS on all tables
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.project_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.project_pages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.annotations ENABLE ROW LEVEL SECURITY;

-- User blacklisted sites table
CREATE TABLE public.user_blacklisted_sites (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  domain text NOT NULL,
  pattern text, -- Optional: for more complex matching patterns
  created_at timestamp with time zone DEFAULT now(),
  CONSTRAINT user_blacklisted_sites_pkey PRIMARY KEY (id),
  CONSTRAINT fk_blacklisted_site_user FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE CASCADE,
  CONSTRAINT unique_user_domain UNIQUE (user_id, domain)
);

-- RLS policies for user_blacklisted_sites
ALTER TABLE public.user_blacklisted_sites ENABLE ROW LEVEL SECURITY;

-- Users can only see and manage their own blacklisted sites
CREATE POLICY "Users can manage their own blacklisted sites" ON public.user_blacklisted_sites
FOR ALL USING (SELECT auth.uid() = user_id);

-- ================================
-- PROFILES TABLE POLICIES
-- ================================

-- Users can view their own profile
CREATE POLICY "Users can view own profile" ON public.profiles
  FOR SELECT USING (auth.uid() = id);

-- Users can insert their own profile (for initial profile creation)
CREATE POLICY "Users can insert own profile" ON public.profiles
  FOR INSERT WITH CHECK (auth.uid() = id);

-- Users can update their own profile
CREATE POLICY "Users can update own profile" ON public.profiles
  FOR UPDATE USING (auth.uid() = id);

-- Note: No DELETE policy for profiles to prevent accidental deletion

-- ================================
-- PROJECTS TABLE POLICIES
-- ================================

-- Users can view projects they own or are members of
CREATE POLICY "Users can view accessible projects" ON public.projects
  FOR SELECT USING (
    created_by = auth.uid() OR
    EXISTS (
      SELECT 1 FROM public.project_members pm
      WHERE pm.project_id = id AND pm.user_id = auth.uid()
    )
  );

-- Users can create new projects
CREATE POLICY "Users can create projects" ON public.projects
  FOR INSERT WITH CHECK (created_by = auth.uid());

-- Users can update projects they own
CREATE POLICY "Project owners can update projects" ON public.projects
  FOR UPDATE USING (created_by = auth.uid());

-- Users can delete projects they own
CREATE POLICY "Project owners can delete projects" ON public.projects
  FOR DELETE USING (created_by = auth.uid());

-- ================================
-- PROJECT_MEMBERS TABLE POLICIES
-- ================================

-- Users can view memberships for projects they have access to
CREATE POLICY "Users can view project memberships" ON public.project_members
  FOR SELECT USING (
    user_id = auth.uid() OR
    EXISTS (
      SELECT 1 FROM public.projects p
      WHERE p.id = project_id AND p.created_by = auth.uid()
    ) OR
    EXISTS (
      SELECT 1 FROM public.project_members pm
      WHERE pm.project_id = project_id AND pm.user_id = auth.uid()
    )
  );

-- Project owners can add members to their projects
CREATE POLICY "Project owners can add members" ON public.project_members
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.projects p
      WHERE p.id = project_id AND p.created_by = auth.uid()
    )
  );

-- Project owners can update member roles
CREATE POLICY "Project owners can update members" ON public.project_members
  FOR UPDATE USING (
    EXISTS (
      SELECT 1 FROM public.projects p
      WHERE p.id = project_id AND p.created_by = auth.uid()
    )
  );

-- Project owners can remove members, and users can remove themselves
CREATE POLICY "Members can be removed by owner or self" ON public.project_members
  FOR DELETE USING (
    user_id = auth.uid() OR
    EXISTS (
      SELECT 1 FROM public.projects p
      WHERE p.id = project_id AND p.created_by = auth.uid()
    )
  );

-- ================================
-- PAGES TABLE POLICIES
-- ================================

-- Users can view pages that are used in projects they have access to
CREATE POLICY "Users can view accessible pages" ON public.pages
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.project_pages pp
      JOIN public.projects p ON p.id = pp.project_id
      WHERE pp.page_id = id AND (
        p.created_by = auth.uid() OR
        EXISTS (
          SELECT 1 FROM public.project_members pm
          WHERE pm.project_id = p.id AND pm.user_id = auth.uid()
        )
      )
    )
  );

-- Users can create new pages (automatically done when annotating new URLs)
CREATE POLICY "Users can create pages" ON public.pages
  FOR INSERT WITH CHECK (true);

-- Users can update pages (for title updates, etc.)
CREATE POLICY "Users can update accessible pages" ON public.pages
  FOR UPDATE USING (
    EXISTS (
      SELECT 1 FROM public.project_pages pp
      JOIN public.projects p ON p.id = pp.project_id
      WHERE pp.page_id = id AND (
        p.created_by = auth.uid() OR
        EXISTS (
          SELECT 1 FROM public.project_members pm
          WHERE pm.project_id = p.id AND pm.user_id = auth.uid()
        )
      )
    )
  );

-- ================================
-- PROJECT_PAGES TABLE POLICIES
-- ================================

-- Users can view project-page relationships for accessible projects
CREATE POLICY "Users can view accessible project pages" ON public.project_pages
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.projects p
      WHERE p.id = project_id AND (
        p.created_by = auth.uid() OR
        EXISTS (
          SELECT 1 FROM public.project_members pm
          WHERE pm.project_id = p.id AND pm.user_id = auth.uid()
        )
      )
    )
  );

-- Users can add pages to projects they have access to
CREATE POLICY "Users can add pages to accessible projects" ON public.project_pages
  FOR INSERT WITH CHECK (
    added_by = auth.uid() AND
    EXISTS (
      SELECT 1 FROM public.projects p
      WHERE p.id = project_id AND (
        p.created_by = auth.uid() OR
        EXISTS (
          SELECT 1 FROM public.project_members pm
          WHERE pm.project_id = p.id AND pm.user_id = auth.uid()
        )
      )
    )
  );

-- Users can remove pages from projects they own
CREATE POLICY "Project owners can remove pages" ON public.project_pages
  FOR DELETE USING (
    EXISTS (
      SELECT 1 FROM public.projects p
      WHERE p.id = project_id AND p.created_by = auth.uid()
    )
  );

-- ================================
-- ANNOTATIONS TABLE POLICIES
-- ================================

-- Users can view annotations in projects they have access to
CREATE POLICY "Users can view accessible annotations" ON public.annotations
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.projects p
      WHERE p.id = project_id AND (
        p.created_by = auth.uid() OR
        EXISTS (
          SELECT 1 FROM public.project_members pm
          WHERE pm.project_id = p.id AND pm.user_id = auth.uid()
        )
      )
    )
  );

-- Users can create annotations in projects they have access to
CREATE POLICY "Users can create annotations in accessible projects" ON public.annotations
  FOR INSERT WITH CHECK (
    user_id = auth.uid() AND
    EXISTS (
      SELECT 1 FROM public.projects p
      WHERE p.id = project_id AND (
        p.created_by = auth.uid() OR
        EXISTS (
          SELECT 1 FROM public.project_members pm
          WHERE pm.project_id = p.id AND pm.user_id = auth.uid()
        )
      )
    )
  );

-- Users can update their own annotations
CREATE POLICY "Users can update own annotations" ON public.annotations
  FOR UPDATE USING (user_id = auth.uid());

-- Users can delete their own annotations
CREATE POLICY "Users can delete own annotations" ON public.annotations
  FOR DELETE USING (user_id = auth.uid());

-- ================================
-- ADDITIONAL SECURITY POLICIES
-- ================================

-- Create a function to check if user has access to a project
CREATE OR REPLACE FUNCTION public.user_has_project_access(project_uuid uuid, user_uuid uuid)
RETURNS boolean AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM public.projects p
    WHERE p.id = project_uuid AND (
      p.created_by = user_uuid OR
      EXISTS (
        SELECT 1 FROM public.project_members pm
        WHERE pm.project_id = project_uuid AND pm.user_id = user_uuid
      )
    )
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Grant necessary permissions for the function
GRANT EXECUTE ON FUNCTION public.user_has_project_access(uuid, uuid) TO authenticated;

-- ================================
-- REALTIME SUBSCRIPTIONS SETUP
-- ================================

-- Enable realtime for collaborative features
ALTER PUBLICATION supabase_realtime ADD TABLE public.annotations;
ALTER PUBLICATION supabase_realtime ADD TABLE public.project_members;
ALTER PUBLICATION supabase_realtime ADD TABLE public.projects;

-- Note: Realtime will respect RLS policies automatically
-- Users will only receive real-time updates for data they have access to

-- ================================
-- TESTING THE POLICIES
-- ================================

-- To test these policies, you can run queries like:
-- SELECT * FROM public.projects; -- Should only show accessible projects
-- SELECT * FROM public.annotations; -- Should only show annotations from accessible projects
-- INSERT INTO public.annotations (...); -- Should only work for accessible projects

-- Remember to test with different user contexts to ensure security 