# Critical RLS Updates - Immediate Action Required

After implementing the RLS policies, these specific code changes are **REQUIRED** to prevent your application from breaking:

## 🚨 CRITICAL: Update createProject Function

**Location**: `crossie/src/frame/Crossie.tsx` around line 485

**Issue**: The current code doesn't handle errors when adding the creator as a project member, which will cause RLS failures.

**Current Code**:
```typescript
const createProject = async () => {
  if (!authState.user || !newProject.name) return;
  try {
    const userId = authState.user.id;
    const { data, error } = await supabase
      .from("projects")
      .insert({
        name: newProject.name,
        description: newProject.description,
        created_by: userId,
        is_team_project: newProject.isTeamProject,
      })
      .select()
      .single();
    if (error) throw error;
    if (authState.user) {
      await supabase.from("project_members").insert({
        project_id: data.id,
        user_id: authState.user.id,
        role: "owner",
      });
    }
    // ... rest of function
  } catch (error) {
    console.error("Error creating project:", error);
    alert("Failed to create project");
  }
};
```

**REQUIRED Update**:
```typescript
const createProject = async () => {
  if (!authState.user || !newProject.name) return;
  try {
    const userId = authState.user.id;
    
    // Create project
    const { data: projectData, error: projectError } = await supabase
      .from("projects")
      .insert({
        name: newProject.name,
        description: newProject.description,
        created_by: userId,
        is_team_project: newProject.isTeamProject,
      })
      .select()
      .single();
    
    if (projectError) throw projectError;

    // CRITICAL: Add creator as member - required for RLS to work
    const { error: memberError } = await supabase
      .from("project_members")
      .insert({
        project_id: projectData.id,
        user_id: userId,
        role: "owner",
      });
    
    if (memberError) {
      console.error("Error adding creator as member:", memberError);
      // Rollback project creation if member addition fails
      await supabase.from("projects").delete().eq("id", projectData.id);
      throw memberError;
    }

    // Add page relationship if current page exists
    if (currentPage) {
      const { error: pageError } = await supabase
        .from("project_pages")
        .insert({
          project_id: projectData.id,
          page_id: currentPage.id,
          added_by: userId,
        });
      
      if (pageError) {
        console.error("Error linking page to project:", pageError);
        // Don't fail the entire operation for page linking errors
      }
    }

    const newProjectObj: Project = {
      id: projectData.id,
      name: projectData.name,
      description: projectData.description,
      isTeamProject: projectData.is_team_project,
      createdBy: projectData.created_by,
      createdAt: new Date(projectData.created_at),
    };
    
    setProjects([newProjectObj, ...projects]);
    setSelectedProject(newProjectObj);
    setShowCreateProject(false);
    setNewProject({ name: "", description: "", isTeamProject: false });
    saveSelectedProject(newProjectObj, url);
    
    if (currentPage) setupRealtimeSubscription(projectData.id, currentPage.id);
    
  } catch (error) {
    console.error("Error creating project:", error);
    alert("Failed to create project. Please try again.");
  }
};
```

## 🚨 CRITICAL: Update loadAnnotations Function

**Location**: `crossie/src/frame/Crossie.tsx` around line 562

**Issue**: No error handling for RLS permission denials.

**Add this error handling**:
```typescript
const loadAnnotations = async (projectId: string, pageId: string) => {
  setLoadingAnnotations(true);
  try {
    // First verify user has access to the project
    const { data: projectAccess } = await supabase
      .from("projects")
      .select("id")
      .eq("id", projectId)
      .maybeSingle();
    
    if (!projectAccess) {
      console.error("User does not have access to this project");
      setAnnotations([]);
      return;
    }

    const { data: annotationsData, error: annotationsError } = await supabase
      .from("annotations")
      .select(
        "id, content, created_at, user_id, annotation_type, highlighted_text, image_data, coordinates, user:profiles ( id, username )"
      )
      .eq("project_id", projectId)
      .eq("page_id", pageId)
      .order("created_at", { ascending: false });

    if (annotationsError) {
      console.error("Error fetching annotations:", annotationsError);
      // Handle RLS permission errors gracefully
      if (annotationsError.code === 'PGRST116') {
        console.error("Permission denied - user may not have access to this project");
        setAnnotations([]);
        return;
      }
      throw annotationsError;
    }
    
    // Process annotations...
    const mapped = annotationsData.map((a: any) => ({
      // ... existing mapping logic
    }));
    setAnnotations(mapped);
    
  } catch (error) {
    console.error("Error in loadAnnotations:", error);
    setAnnotations([]);
  } finally {
    setLoadingAnnotations(false);
  }
};
```

## 🚨 CRITICAL: Update fetchProjects Function

**Location**: `crossie/src/frame/Crossie.tsx` around line 415

**Issue**: The current query structure may not work optimally with RLS.

**Current problematic query**:
```typescript
const { data: memberProjects, error: memberError } = await supabase
  .from("project_members")
  .select(
    "project:projects ( id, name, description, is_team_project, created_by, created_at )"
  )
  .eq("user_id", userId);
```

**Updated approach**:
```typescript
const fetchProjects = async () => {
  try {
    const userId = authState.user!.id;
    
    // With RLS, this query will automatically only return accessible projects
    const { data: allProjects, error } = await supabase
      .from("projects")
      .select("id, name, description, is_team_project, created_by, created_at")
      .order("created_at", { ascending: false });
    
    if (error) {
      console.error("Error fetching projects:", error);
      if (error.code === 'PGRST116') {
        console.error("Permission denied when fetching projects");
        setProjects([]);
        return;
      }
      throw error;
    }
    
    const mappedProjects = (allProjects || []).map((p: any) => ({
      id: p.id,
      name: p.name,
      description: p.description,
      isTeamProject: p.is_team_project,
      createdBy: p.created_by,
      createdAt: new Date(p.created_at),
    }));
    
    setProjects(mappedProjects);
  } catch (error) {
    console.error("Error fetching projects:", error);
    setProjects([]);
  }
};
```

## ⚠️ Pre-Deployment Checklist

Before enabling RLS in production:

1. ✅ **Run the SQL file**: Execute `supabase_rls_policies.sql` in Supabase SQL Editor
2. ✅ **Update the three critical functions above**
3. ✅ **Test with multiple users**: Ensure collaboration still works
4. ✅ **Test error scenarios**: Try accessing projects user doesn't belong to
5. ✅ **Verify realtime**: Ensure real-time updates still work with RLS
6. ✅ **Check authentication**: Ensure auth tokens are properly set

## 🔧 Quick Test Script

Add this to your development environment to test RLS:

```typescript
// Add to Crossie.tsx for testing
const testRLS = async () => {
  try {
    console.log("=== RLS Test Results ===");
    
    const { data: profiles } = await supabase.from("profiles").select("*");
    console.log(`✅ Profiles visible: ${profiles?.length || 0} (should be 1)`);
    
    const { data: projects } = await supabase.from("projects").select("*");
    console.log(`✅ Projects visible: ${projects?.length || 0}`);
    
    const { data: annotations } = await supabase.from("annotations").select("*");
    console.log(`✅ Annotations visible: ${annotations?.length || 0}`);
    
    console.log("=== End RLS Test ===");
  } catch (error) {
    console.error("❌ RLS test failed:", error);
  }
};

// Call this in development
// testRLS();
```

## 🆘 Rollback Plan

If issues occur after RLS deployment:

1. **Disable RLS** (emergency only):
   ```sql
   ALTER TABLE public.profiles DISABLE ROW LEVEL SECURITY;
   ALTER TABLE public.projects DISABLE ROW LEVEL SECURITY;
   ALTER TABLE public.project_members DISABLE ROW LEVEL SECURITY;
   ALTER TABLE public.pages DISABLE ROW LEVEL SECURITY;
   ALTER TABLE public.project_pages DISABLE ROW LEVEL SECURITY;
   ALTER TABLE public.annotations DISABLE ROW LEVEL SECURITY;
   ```

2. **Check logs** for specific RLS errors
3. **Test policies** with specific user contexts
4. **Re-enable** table by table after fixes

---

**⚠️ WARNING**: Do not enable RLS in production without implementing these critical updates first. The application will break for users trying to create projects or access annotations. 