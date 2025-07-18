# Code Adjustments for RLS Implementation

After implementing the RLS policies, you'll need to make some adjustments to your code to ensure it works correctly with Row Level Security.

## 1. Authentication Context

### Current Issue
Your current code may not always have the proper authentication context when making database queries.

### Solution
Ensure all database queries include the proper authentication context:

```typescript
// In supabaseClient.ts, ensure auth token is set before any queries
export const makeAuthenticatedQuery = async (query: () => Promise<any>) => {
  // Ensure we have a valid session
  const { data: { session } } = await supabaseAuthClient.getSession();
  if (!session) {
    throw new Error('No authenticated session');
  }
  
  // Set the auth token for this query
  await supabase.auth.setAuth(session.access_token);
  return await query();
};
```

## 2. Project Access Validation

### Current Code (in Crossie.tsx)
```typescript
// This might fail with RLS if user doesn't have project access
const { data: annotationsData, error: annotationsError } = await supabase
  .from("annotations")
  .select("...")
  .eq("project_id", projectId)
  .eq("page_id", pageId);
```

### Updated Code
```typescript
// Add error handling for RLS failures
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
      .select(`
        id, content, created_at, user_id, annotation_type, 
        highlighted_text, image_data, coordinates,
        user:profiles ( id, username )
      `)
      .eq("project_id", projectId)
      .eq("page_id", pageId)
      .order("created_at", { ascending: false });

    if (annotationsError) {
      console.error("Error fetching annotations:", annotationsError);
      // Handle RLS permission errors gracefully
      if (annotationsError.code === 'PGRST116') {
        console.error("Permission denied - user may not have access to this project");
      }
    } else if (annotationsData) {
      // Process annotations...
    }
  } catch (error) {
    console.error("Error in loadAnnotations:", error);
  } finally {
    setLoadingAnnotations(false);
  }
};
```

## 3. Project Creation with Members

### Current Code Issue
When creating projects, you need to ensure the creator is automatically added as a member.

### Updated Code
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

    // Add creator as owner member - this is now REQUIRED for RLS to work
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

    // Rest of the project creation logic...
  } catch (error) {
    console.error("Error creating project:", error);
    alert("Failed to create project");
  }
};
```

## 4. Error Handling for RLS

### Add RLS-specific Error Handling
```typescript
// Create a utility function for handling RLS errors
export const handleRLSError = (error: any, context: string) => {
  if (error?.code === 'PGRST116') {
    console.error(`RLS Permission denied in ${context}:`, error);
    return "You don't have permission to access this resource";
  } else if (error?.code === 'PGRST301') {
    console.error(`RLS Row not found in ${context}:`, error);
    return "Resource not found or access denied";
  }
  return `Error in ${context}: ${error?.message || 'Unknown error'}`;
};

// Use in your components
try {
  const result = await supabase.from("projects").select("*");
} catch (error) {
  const errorMessage = handleRLSError(error, "fetching projects");
  setError(errorMessage);
}
```

## 5. Realtime Subscriptions with RLS

### Current Code May Need Updates
```typescript
// The realtime subscription should work with RLS, but add error handling
const setupRealtimeSubscription = useCallback(
  (projectId: string, pageId: string) => {
    if (realtimeChannelRef.current)
      supabase.removeChannel(realtimeChannelRef.current);

    const channel = supabase
      .channel(`annotations-project-${projectId}-page-${pageId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "annotations",
          filter: `project_id=eq.${projectId}`,
        },
        async (payload) => {
          // RLS will automatically filter this, but add validation
          const annotation = payload.new;
          if (!annotation || annotation.page_id !== pageId) return;
          
          // Verify user has access to this annotation's project
          try {
            const { data: hasAccess } = await supabase
              .from("projects")
              .select("id")
              .eq("id", annotation.project_id)
              .maybeSingle();
            
            if (!hasAccess) {
              console.warn("Received annotation for inaccessible project");
              return;
            }
            
            // Process the annotation...
          } catch (error) {
            console.error("Error validating realtime annotation access:", error);
          }
        }
      )
      .subscribe((status) => {
        if (status === 'SUBSCRIPTION_ERROR') {
          console.error('Realtime subscription error - may be RLS related');
        }
      });

    realtimeChannelRef.current = channel;
    return channel;
  },
  []
);
```

## 6. Page Creation and Access

### Update Page Handling
```typescript
// When creating a page, ensure it's properly linked to a project
const ensurePageExists = async (url: string, projectId: string) => {
  const urlHash = btoa(url).replace(/[^a-zA-Z0-9]/g, "");
  
  // Try to find existing page
  let { data: existingPage } = await supabase
    .from("pages")
    .select("id, url, url_hash, title, created_at")
    .eq("url_hash", urlHash)
    .maybeSingle();
  
  // If page doesn't exist, create it
  if (!existingPage) {
    const { data: newPage, error: insertError } = await supabase
      .from("pages")
      .insert({ url, url_hash: urlHash, title: document.title })
      .select()
      .single();
    
    if (insertError) throw insertError;
    existingPage = newPage;
  }
  
  // Ensure project_pages relationship exists
  const { data: existingProjectPage } = await supabase
    .from("project_pages")
    .select("id")
    .eq("project_id", projectId)
    .eq("page_id", existingPage.id)
    .maybeSingle();
  
  if (!existingProjectPage) {
    const { error: linkError } = await supabase
      .from("project_pages")
      .insert({
        project_id: projectId,
        page_id: existingPage.id,
        added_by: authState.user!.id,
      });
    
    if (linkError) throw linkError;
  }
  
  return existingPage;
};
```

## 7. Testing Your RLS Implementation

### Add RLS Testing Functions
```typescript
// Add these functions to test RLS in development
export const testRLSPolicies = async () => {
  try {
    console.log("Testing RLS policies...");
    
    // Test 1: Can only see own profile
    const { data: profiles } = await supabase.from("profiles").select("*");
    console.log("Profiles visible:", profiles?.length); // Should be 1 (own profile)
    
    // Test 2: Can only see accessible projects
    const { data: projects } = await supabase.from("projects").select("*");
    console.log("Projects visible:", projects?.length);
    
    // Test 3: Can only see annotations from accessible projects
    const { data: annotations } = await supabase.from("annotations").select("*");
    console.log("Annotations visible:", annotations?.length);
    
  } catch (error) {
    console.error("RLS test error:", error);
  }
};

// Call this in development to verify RLS is working
if (process.env.NODE_ENV === 'development') {
  // testRLSPolicies();
}
```

## 8. Migration Steps

1. **Deploy RLS Policies**: Run the SQL file in Supabase SQL Editor
2. **Update Code**: Apply the code changes above
3. **Test Thoroughly**: Verify all functionality works with RLS enabled
4. **Monitor Logs**: Watch for RLS permission errors in production
5. **Update Error Handling**: Ensure graceful degradation when RLS blocks access

## Common RLS Issues to Watch For

1. **Missing Auth Context**: Queries fail because user isn't authenticated
2. **Cascade Deletions**: RLS may prevent cascade deletes - handle manually
3. **Bulk Operations**: May fail if some rows are inaccessible
4. **Admin Functions**: May need special handling for administrative features
5. **Realtime Filtering**: Ensure realtime subscriptions respect RLS boundaries

Remember to test with multiple users and different project access levels to ensure your RLS policies work correctly in all scenarios. 