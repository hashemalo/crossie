import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { type AuthState, type Profile } from "../shared/authService";
import { supabase, supabaseAuthClient } from "../lib/supabaseClient";
import { canonicalise } from "../lib/canonicalise";

interface Annotation {
  id: string;
  content: string; // The annotation comment
  timestamp: Date;
  user: Profile;
  annotationType: 'text' | 'image' | 'area';
  highlightedText?: string; // For text annotations
  imageData?: string; // For image annotations
  coordinates?: { x: number; y: number; width: number; height: number }; // For area annotations
  isEditing?: boolean;
  isOptimistic?: boolean; // For optimistic updates
  error?: boolean; // For failed sends
}

interface Page {
  id: string;
  url: string;
  urlHash: string;
  title?: string;
  createdAt: Date;
}

interface Project {
  id: string;
  name: string;
  description?: string;
  isTeamProject: boolean;
  createdBy: string;
  createdAt: Date;
}

// Message protocol for parent window communication
interface ParentMessage {
  type:
    | "CROSSIE_RESIZE"
    | "CROSSIE_MINIMIZE"
    | "CROSSIE_SHOW"
    | "OPEN_AUTH_POPUP"
    | "REQUEST_AUTH_STATE"
    | "AUTH_STATE_UPDATE"
    | "ANNOTATION_REQUEST"
    | "TEXT_SELECTION"
    | "HIGHLIGHT_TEXT";
  payload?: any;
}

function sendToParent(message: ParentMessage) {
  window.parent.postMessage(message, "*");
}

// Memoized helper functions outside component
const getInitial = (str: string): string => {
  if (!str) return "?";
  return str.trim()[0].toUpperCase();
};

const stringToColor = (str: string): string => {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = str.charCodeAt(i) + ((hash << 5) - hash);
  }
  const hue = hash % 360;
  return `hsl(${hue}, 60%, 60%)`;
};

const getRelativeTime = (timestamp: Date): string => {
  const now = Date.now();
  const diff = now - timestamp.getTime();
  const seconds = Math.floor(diff / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (seconds < 60) return "just now";
  if (minutes < 60) return `${minutes}m`;
  if (hours < 24) return `${hours}h`;
  if (days < 30) return `${days}d`;

  return timestamp.toLocaleDateString();
};

export default function Crossie() {
  const [txt, setTxt] = useState("");
  const [annotations, setAnnotations] = useState<Annotation[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editText, setEditText] = useState("");
  const [authState, setAuthState] = useState<AuthState>({
    user: null,
    profile: null,
    authenticated: false,
    loading: true,
  });
  const [sending, setSending] = useState(false);
  const [isVisible, setIsVisible] = useState(false);
  const [isTabActive, setIsTabActive] = useState(!document.hidden);
  const [textAnnotationRequest, setTextAnnotationRequest] = useState<{
    selectedText: string;
    originalText: string;
  } | null>(null);

  // Project management state
  const [projects, setProjects] = useState<Project[]>([]);
  const [selectedProject, setSelectedProject] = useState<Project | null>(null);
  const [currentPage, setCurrentPage] = useState<Page | null>(null);
  const [showProjectSelector, setShowProjectSelector] = useState(false);
  const [showCreateProject, setShowCreateProject] = useState(false);
  const [newProject, setNewProject] = useState({
    name: '',
    description: '',
    isTeamProject: false
  });

  // Memoize URL parsing
  const url = useMemo(() => {
    const params = new URLSearchParams(window.location.search);
    const rawHost = params.get("host") || "";
    return canonicalise(decodeURIComponent(rawHost));
  }, []);

  const [projectId, setProjectId] = useState<string | null>(null);
  const [pageId, setPageId] = useState<string | null>(null);
  const [authInitialized, setAuthInitialized] = useState(false);

  const annotationsRef = useRef<HTMLDivElement>(null);
  const realtimeChannelRef = useRef<any>(null);
  const authCheckIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const optimisticCounterRef = useRef(0);
  const newProjectRef = useRef(false);

  // Initialize auth by requesting from parent
  useEffect(() => {
    sendToParent({ type: "REQUEST_AUTH_STATE" });

    const handleMessage = async (event: MessageEvent) => {
      if (event.data?.type === "AUTH_STATE_UPDATE") {
        const { authData, profile } = event.data.payload || {};

        if (authData?.access_token) {
          await supabaseAuthClient.setAuth(authData.access_token);
          setAuthState({
            user: authData.user,
            profile: profile,
            authenticated: true,
            loading: false,
          });
          setAuthInitialized(true);
        } else {
          await supabaseAuthClient.setAuth(null);
          setAuthState({
            user: null,
            profile: null,
            authenticated: false,
            loading: false,
          });
          setAuthInitialized(true);
        }
      }

      if (event.data?.type === "CROSSIE_SHOW") {
        setIsVisible(true);
        if (!document.hidden) {
          sendToParent({ type: "REQUEST_AUTH_STATE" });
        }
      }

      if (event.data?.type === "CROSSIE_MINIMIZE") {
        setIsVisible(false);
      }

      if (event.data?.type === "ANNOTATION_REQUEST") {
        const { selectedText, originalText } = event.data.payload || {};
        setTextAnnotationRequest({ selectedText, originalText });
        // Pre-fill the textarea with the selected text context
        setTxt(`Annotation for: "${selectedText}"\n\n`);
      }

      if (event.data?.type === "TEXT_SELECTION") {
        const { selectedText, originalText } = event.data.payload || {};
        setTextAnnotationRequest({ selectedText, originalText });
        // Pre-fill the textarea with the selected text context
        setTxt(`Annotation for: "${selectedText}"\n\n`);
      }
    };

    window.addEventListener("message", handleMessage);

    return () => {
      window.removeEventListener("message", handleMessage);
      if (authCheckIntervalRef.current) {
        clearInterval(authCheckIntervalRef.current);
      }
    };
  }, []);

  // Handle tab visibility changes
  useEffect(() => {
    const handleVisibilityChange = () => {
      const isActive = !document.hidden;
      setIsTabActive(isActive);

      if (isActive && isVisible) {
        sendToParent({ type: "REQUEST_AUTH_STATE" });
      }
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () =>
      document.removeEventListener("visibilitychange", handleVisibilityChange);
  }, [isVisible]);

  // Manage periodic auth check interval
  useEffect(() => {
    if (authCheckIntervalRef.current) {
      clearInterval(authCheckIntervalRef.current);
      authCheckIntervalRef.current = null;
    }

    if (isVisible && isTabActive) {
      authCheckIntervalRef.current = setInterval(() => {
        sendToParent({ type: "REQUEST_AUTH_STATE" });
      }, 600000); // Every 10 minutes
    }

    return () => {
      if (authCheckIntervalRef.current) {
        clearInterval(authCheckIntervalRef.current);
        authCheckIntervalRef.current = null;
      }
    };
  }, [isVisible, isTabActive]);

  // Load or create page when URL is available
  useEffect(() => {
    if (!url || !authInitialized) return;

    const loadOrCreatePage = async () => {
      const urlHash = btoa(url).replace(/[^a-zA-Z0-9]/g, '').substring(0, 20);
      
      // Try to find existing page
      const { data: existingPage, error: pageError } = await supabase
        .from("pages")
        .select("id, url, url_hash, title, created_at")
        .eq("url_hash", urlHash)
        .maybeSingle();

      if (pageError) {
        console.error("[Crossie] Error loading page:", pageError);
        return;
      }

      if (existingPage) {
        const page: Page = {
          id: existingPage.id,
          url: existingPage.url,
          urlHash: existingPage.url_hash,
          title: existingPage.title,
          createdAt: new Date(existingPage.created_at)
        };
        setCurrentPage(page);
        setPageId(existingPage.id);
      } else {
        // Create new page
        const { data: newPage, error: createError } = await supabase
          .from("pages")
          .insert({
            url: url,
            url_hash: urlHash,
            title: document.title || url
          })
          .select("id, url, url_hash, title, created_at")
          .single();

        if (createError) {
          console.error("[Crossie] Error creating page:", createError);
          return;
        }

        const page: Page = {
          id: newPage.id,
          url: newPage.url,
          urlHash: newPage.url_hash,
          title: newPage.title,
          createdAt: new Date(newPage.created_at)
        };
        setCurrentPage(page);
        setPageId(newPage.id);
      }
    };

    loadOrCreatePage();
  }, [url, authInitialized]);

  // Fetch user's projects when authenticated
  useEffect(() => {
    if (!authState.authenticated || !authState.user) return;

    const fetchProjects = async () => {
      try {
        const userId = authState.user!.id;
        // First, get projects created by the user
        const { data: ownedProjects, error: ownedError } = await supabase
          .from("projects")
          .select(`
            id,
            name,
            description,
            is_team_project,
            created_by,
            created_at
          `)
          .eq("created_by", userId);

        if (ownedError) throw ownedError;

        // Then, get projects where user is a member
        const { data: memberProjects, error: memberError } = await supabase
          .from("project_members")
          .select(`
            project:projects (
              id,
              name,
              description,
              is_team_project,
              created_by,
              created_at
            )
          `)
          .eq("user_id", userId);

        if (memberError) throw memberError;

        // Combine and deduplicate projects
        const allProjects = [
          ...(ownedProjects || []),
          ...(memberProjects || []).map((mp: any) => mp.project).filter(Boolean)
        ];

        // Remove duplicates based on project ID
        const uniqueProjects = allProjects.filter((project, index, self) => 
          index === self.findIndex(p => p.id === project.id)
        );

        // Sort by created_at descending
        const sortedProjects = uniqueProjects.sort((a, b) => 
          new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
        );

        const mappedProjects = sortedProjects.map((p: any) => ({
          id: p.id,
          name: p.name,
          description: p.description,
          isTeamProject: p.is_team_project,
          createdBy: p.created_by,
          createdAt: new Date(p.created_at)
        }));

        setProjects(mappedProjects);
      } catch (error) {
        console.error("Error fetching projects:", error);
      }
    };

    fetchProjects();
  }, [authState.authenticated, authState.user]);

  // Project management functions
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
          is_team_project: newProject.isTeamProject
        })
        .select()
        .single();

      if (error) throw error;

      // Add user as project member
      if (authState.user) {
        await supabase
          .from("project_members")
          .insert({
            project_id: data.id,
            user_id: authState.user.id,
            role: 'owner'
          });
      }

      // Add current page to the new project
      if (currentPage) {
        await supabase
          .from("project_pages")
          .insert({
            project_id: data.id,
            page_id: currentPage.id,
            added_by: userId
          });
      }

      const newProjectObj: Project = {
        id: data.id,
        name: data.name,
        description: data.description,
        isTeamProject: data.is_team_project,
        createdBy: data.created_by,
        createdAt: new Date(data.created_at)
      };

      setProjects([newProjectObj, ...projects]);
      setSelectedProject(newProjectObj);
      setProjectId(data.id);
      setShowCreateProject(false);
      setNewProject({ name: '', description: '', isTeamProject: false });
    } catch (error) {
      console.error("Error creating project:", error);
      alert("Failed to create project");
    }
  };

  const selectProject = (project: Project) => {
    setSelectedProject(project);
    setProjectId(project.id);
    setShowProjectSelector(false);
  };

  // Close dropdowns when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (showProjectSelector) {
        setShowProjectSelector(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [showProjectSelector]);

  // Set up realtime subscription for a specific project and page
  const setupRealtimeSubscription = useCallback((pid: string, pageId: string) => {
    // Clean up previous channel if exists
    if (realtimeChannelRef.current) {
      supabase.removeChannel(realtimeChannelRef.current);
    }

    const channel = supabase
      .channel(`annotations-project-${pid}-page-${pageId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "annotations",
          filter: `project_id=eq.${pid} AND page_id=eq.${pageId}`,
        },
        async ({ new: annotation }) => {
          if (!annotation) return;

          // Fetch the user profile for the new annotation
          const { data: profileData } = await supabase
            .from("profiles")
            .select("id, username")
            .eq("id", annotation.user_id)
            .single();

          const newAnnotation: Annotation = {
            id: annotation.id,
            content: annotation.content,
            timestamp: new Date(annotation.created_at),
            user: profileData || {
              id: annotation.user_id,
              username: "Anonymous",
            },
            annotationType: annotation.annotation_type,
            highlightedText: annotation.highlighted_text,
            imageData: annotation.image_data,
            coordinates: annotation.coordinates,
          };

          setAnnotations((cur) => {
            // Remove matching optimistic annotation and add real annotation
            const filtered = cur.filter((ann) => {
              if (!ann.isOptimistic) return true;

              return !(
                ann.content === annotation.content &&
                ann.user.id === annotation.user_id &&
                Math.abs(
                  ann.timestamp.getTime() -
                    new Date(annotation.created_at).getTime()
                ) < 30000
              );
            });

            // Add new annotation if not already exists
            if (!filtered.find((ann) => ann.id === annotation.id)) {
              return [newAnnotation, ...filtered];
            }
            return filtered;
          });
        }
      )
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "annotations",
          filter: `project_id=eq.${pid} AND page_id=eq.${pageId}`,
        },
        ({ new: annotation }) => {
          if (!annotation) return;
          setAnnotations((cur) =>
            cur.map((ann) =>
              ann.id === annotation.id ? { ...ann, content: annotation.content } : ann
            )
          );
        }
      )
      .on(
        "postgres_changes",
        {
          event: "DELETE",
          schema: "public",
          table: "annotations",
          filter: `project_id=eq.${pid} AND page_id=eq.${pageId}`,
        },
        (payload) => {
          const { old: annotation } = payload;
          if (!annotation) return;
          setAnnotations((cur) => cur.filter((ann) => ann.id !== annotation.id));
        }
      )
      .subscribe();

    realtimeChannelRef.current = channel;
    return channel;
  }, []);

  // Function to highlight text on the page
  const highlightTextOnPage = useCallback((text: string) => {
    sendToParent({
      type: "HIGHLIGHT_TEXT",
      payload: { text },
    });
  }, []);

  // Set up subscriptions and fetch existing annotations when project and page are available
  useEffect(() => {
    if (!projectId || !pageId || !authInitialized) {
      return;
    }

    // Only fetch existing annotations if this is NOT a new project
    if (!newProjectRef.current) {
      // This is an existing project, so fetch annotations and set up subscription
      supabase
        .from("annotations")
        .select(`
          id, content, created_at, user_id, annotation_type, highlighted_text, image_data, coordinates,
          user:profiles ( id, username )
        `
        )
        .eq("project_id", projectId)
        .eq("page_id", pageId)
        .order("created_at", { ascending: false })
        .then(({ data, error }) => {
          if (error) {
            console.error("Error fetching annotations:", error);
            return;
          }

          if (data) {
            const mapped = data.map((a: any) => ({
              id: a.id,
              content: a.content,
              timestamp: new Date(a.created_at),
              user: {
                id: a.user.id,
                username: a.user.username,
              },
              annotationType: a.annotation_type,
              highlightedText: a.highlighted_text,
              imageData: a.image_data,
              coordinates: a.coordinates,
            }));

            // Preserve optimistic annotations when setting fetched annotations
            setAnnotations((current) => {
              const optimisticAnnotations = current.filter(
                (ann) => ann.isOptimistic
              );
              return [...optimisticAnnotations, ...mapped];
            });
          }
        });

      // Set up realtime subscription for existing projects
      if (projectId && pageId) {
        setupRealtimeSubscription(projectId, pageId);
      }
    } else {
      // Reset the flag
      newProjectRef.current = false;
    }

    return () => {
      // Only clean up if this wasn't a new project (new projects already have subscription set up)
      if (realtimeChannelRef.current && !newProjectRef.current) {
        supabase.removeChannel(realtimeChannelRef.current);
        realtimeChannelRef.current = null;
      }
    };
  }, [projectId, pageId, authInitialized, setupRealtimeSubscription]);

  // Send annotation with optimistic updates
  const send = useCallback(async () => {
    if (!txt.trim() || !authState.profile || !authState.user || sending || !selectedProject || !currentPage) {
      return;
    }

    setSending(true);

    // Check if this is a text annotation
    const isTextAnnotation = !!textAnnotationRequest;
    const highlightedText = textAnnotationRequest?.selectedText;

    // Create optimistic annotation
    const optimisticId = `optimistic-${Date.now()}-${++optimisticCounterRef.current}`;
    const optimisticAnnotation: Annotation = {
      id: optimisticId,
      content: txt.trim(),
      timestamp: new Date(),
      user: authState.profile,
      annotationType: isTextAnnotation ? 'text' : 'text',
      isOptimistic: true,
      highlightedText: highlightedText,
    };

    // Add optimistic annotation to UI immediately
    setAnnotations((cur) => [optimisticAnnotation, ...cur]);

    // Clear input immediately for better UX
    const annotationText = txt.trim();
    setTxt("");
    
    // Clear text annotation request after sending
    if (isTextAnnotation) {
      setTextAnnotationRequest(null);
    }

    try {
      // Ensure page is added to project if not already
      const { data: existingProjectPage } = await supabase
        .from("project_pages")
        .select("id")
        .eq("project_id", selectedProject.id)
        .eq("page_id", currentPage.id)
        .maybeSingle();

      if (!existingProjectPage) {
        await supabase
          .from("project_pages")
          .insert({
            project_id: selectedProject.id,
            page_id: currentPage.id,
            added_by: authState.user.id
          });
      }

      // Insert the annotation
      const { error: insertErr } = await supabase.from("annotations").insert({
        project_id: selectedProject.id,
        page_id: currentPage.id,
        user_id: authState.user.id,
        content: annotationText,
        annotation_type: isTextAnnotation ? 'text' : 'text',
        highlighted_text: highlightedText,
      });

      if (insertErr) {
        throw new Error(`Insert failed: ${insertErr.message}`);
      }

      // Scroll to top
      if (annotationsRef.current) {
        annotationsRef.current.scrollTo({ top: 0, behavior: "smooth" });
      }
    } catch (error) {
      console.error("[Crossie] Send failed:", error);

      // Mark optimistic annotation as failed
      setAnnotations((cur) =>
        cur.map((ann) =>
          ann.id === optimisticId
            ? { ...ann, error: true, isOptimistic: false }
            : ann
        )
      );

      // Show error to user
      let errorMsg = "Failed to send annotation";
      if (error && typeof error === "object" && "message" in error) {
        errorMsg = `Failed to send annotation: ${
          (error as { message: string }).message
        }`;
      }
      alert(errorMsg);
    } finally {
      setSending(false);
    }
  }, [txt, authState, selectedProject, currentPage, sending, textAnnotationRequest]);

  // Retry failed annotation
  const retryAnnotation = useCallback(
    async (failedAnnotation: Annotation) => {
      if (sending) return;

      setAnnotations((cur) => cur.filter((ann) => ann.id !== failedAnnotation.id));
      setTxt(failedAnnotation.content);

      setTimeout(() => send(), 100);
    },
    [sending, send]
  );

  const startEdit = useCallback((annId: string, currentContent: string) => {
    setEditingId(annId);
    setEditText(currentContent);
  }, []);

  const cancelEdit = useCallback(() => {
    setEditingId(null);
    setEditText("");
  }, []);

  const saveEdit = useCallback(
    async (annId: string) => {
      if (!editText.trim()) return;

      const { error } = await supabase
        .from("annotations")
        .update({ content: editText.trim() })
        .eq("id", annId);

      if (error) {
        console.error("Edit failed:", error);
        return;
      }

      setEditingId(null);
      setEditText("");
    },
    [editText]
  );

  const deleteAnnotation = useCallback(
    async (annId: string) => {
      if (!confirm("Are you sure you want to delete this annotation?")) return;

      // Optimistic update - remove from UI immediately
      setAnnotations((cur) => cur.filter((ann) => ann.id !== annId));

      const { error } = await supabase
        .from("annotations")
        .delete()
        .eq("id", annId);

      if (error) {
        console.error("Delete failed:", error);
        // Revert optimistic update on error
        if (projectId && pageId) {
          const { data } = await supabase
            .from("annotations")
            .select(
              `
            id, content, created_at, user_id, annotation_type, highlighted_text, image_data, coordinates,
            user:profiles ( id, username )
          `
            )
            .eq("project_id", projectId)
            .eq("page_id", pageId)
            .order("created_at", { ascending: false });

          if (data) {
            const mapped = data.map((a: any) => ({
              id: a.id,
              content: a.content,
              timestamp: new Date(a.created_at),
              user: { id: a.user.id, username: a.user.username },
              annotationType: a.annotation_type,
              highlightedText: a.highlighted_text,
              imageData: a.image_data,
              coordinates: a.coordinates,
            }));
            setAnnotations(mapped);
          }
        }
      }
    },
    [projectId, pageId]
  );

  const handleKeyPress = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        send();
      }
    },
    [send]
  );

  const handleEditKeyPress = useCallback(
    (e: React.KeyboardEvent, annId: string) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        saveEdit(annId);
      }
      if (e.key === "Escape") {
        cancelEdit();
      }
    },
    [saveEdit, cancelEdit]
  );

  const isOwnAnnotation = useCallback(
    (ann: Annotation) => {
      return authState.user && ann.user.id === authState.user.id;
    },
    [authState.user]
  );

  // Show loading state
  if (authState.loading) {
    return (
      <div className="w-full h-full bg-slate-900 text-white flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin w-12 h-12 border-4 border-white border-t-transparent rounded-full mx-auto mb-4"></div>
          <p>Loading...</p>
        </div>
      </div>
    );
  }

  // Show sign-in prompt if not authenticated
  if (!authState.authenticated) {
    return (
      <div className="w-full h-full bg-slate-900 text-white flex flex-col">
        <header className="bg-slate-800 px-4 py-3 text-white font-semibold flex items-center justify-between border-b border-slate-700">
          <div className="flex items-center gap-2">
            <span className="text-sm text-slate-300">crossie</span>
          </div>
          <div className="flex items-center space-x-3">
            {/* Close button */}
            <button
              onClick={() => sendToParent({ type: "CROSSIE_MINIMIZE" })}
              className="hover:bg-slate-700 rounded p-1 transition-colors"
              title="Close"
            >
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
              >
                <path d="M18 6L6 18M6 6l12 12" />
              </svg>
            </button>
          </div>
        </header>
        <div className="flex-1 flex items-center justify-center p-6">
          <div className="text-center">
            <svg
              width="48"
              height="48"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              className="mx-auto mb-3 text-slate-400"
            >
              <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
              <circle cx="12" cy="7" r="4" />
            </svg>
            <h3 className="text-lg font-semibold mb-2">Welcome to crossie</h3>
            <p className="text-slate-400 text-sm mb-4">
              Open the extension and sign in to start annotating and connecting
              with others on any website.
            </p>
          </div>
        </div>
      </div>
    );
  }

  // Show main interface if profile exists
  return (
    <div className="relative select-none h-full flex flex-col">
      <header className="bg-slate-800 px-4 py-3 text-white font-semibold flex items-center justify-between border-b border-slate-700">
        <div className="flex items-center gap-2">
          <div
            className="w-8 h-8 rounded-full flex items-center justify-center font-bold text-white text-sm flex-shrink-0"
            style={{
              backgroundColor: stringToColor(
                authState.profile?.username || authState.profile?.email || ""
              ),
            }}
            title={authState.profile?.username}
          >
            {getInitial(
              authState.profile?.username || authState.profile?.email || ""
            )}
          </div>
        </div>
        
        {/* Project selector */}
        <div className="flex items-center space-x-2">
          <div className="relative">
            <button
              onClick={() => setShowProjectSelector(!showProjectSelector)}
              className="flex items-center space-x-2 bg-slate-700 hover:bg-slate-600 px-3 py-1 rounded text-sm transition-colors"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
              </svg>
              <span className="text-xs">
                {selectedProject ? selectedProject.name : 'Select Project'}
              </span>
              <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
              </svg>
            </button>
            
            {/* Project dropdown */}
            {showProjectSelector && (
              <div className="absolute top-full left-0 mt-1 w-64 bg-slate-700 border border-slate-600 rounded-lg shadow-lg z-10">
                <div className="p-2">
                  <div className="text-xs text-slate-400 mb-2 px-2">Your Projects</div>
                  {projects.length === 0 ? (
                    <div className="text-xs text-slate-400 px-2 py-1">No projects yet</div>
                  ) : (
                    <div className="space-y-1">
                      {projects.map((project) => (
                                                 <button
                           key={project.id}
                           onClick={() => selectProject(project)}
                           className={`w-full text-left px-2 py-1 rounded text-xs hover:bg-slate-600 transition-colors ${
                             selectedProject?.id === project.id ? 'bg-blue-600 text-white' : 'text-slate-300'
                           }`}
                         >
                           <div className="font-medium">{project.name}</div>
                           <div className="text-slate-400 truncate">{currentPage?.url || 'Current page'}</div>
                         </button>
                      ))}
                    </div>
                  )}
                  <div className="border-t border-slate-600 mt-2 pt-2">
                    <button
                      onClick={() => {
                        setShowProjectSelector(false);
                        setShowCreateProject(true);
                      }}
                      className="w-full text-left px-2 py-1 rounded text-xs text-blue-400 hover:bg-slate-600 transition-colors"
                    >
                      + Create New Project
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
          
          <div className="flex items-center space-x-2">
            <div
              className="w-3 h-3 bg-green-400 rounded-full animate-pulse"
              title="Online"
            ></div>
            {annotations.length > 0 && (
              <span className="text-xs bg-blue-600 px-2 py-1 rounded-full">
                {annotations.length}
              </span>
            )}
          </div>
          
          {/* Close button */}
          <button
            onClick={() => sendToParent({ type: "CROSSIE_MINIMIZE" })}
            className="hover:bg-slate-700 rounded p-1 transition-colors"
            title="Close"
          >
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <path d="M18 6L6 18M6 6l12 12" />
            </svg>
          </button>
        </div>
      </header>

      <section className="flex-1 bg-slate-900 text-white flex flex-col min-h-0">
        {/* Annotations area */}
        <div ref={annotationsRef} className="flex-1 overflow-y-auto p-4 space-y-3 min-h-0">
          {!selectedProject ? (
            <div className="flex items-center justify-center h-full min-h-0 -mt-4">
              <div className="text-center">
                <svg
                  width="48"
                  height="48"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  className="mx-auto mb-3 text-slate-400"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
                </svg>
                <p className="text-slate-400 text-sm mb-4">
                  Select a project to start annotating
                </p>
                <button
                  onClick={() => setShowProjectSelector(true)}
                  className="bg-blue-600 hover:bg-blue-500 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors"
                >
                  Choose Project
                </button>
              </div>
            </div>
          ) : annotations.length === 0 ? (
            <div className="flex items-center justify-center h-full min-h-0 -mt-4">
              <div className="text-center">
                <svg
                  width="48"
                  height="48"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  className="mx-auto mb-3 text-slate-400"
                >
                  <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
                  <path d="M8 10h.01"/>
                  <path d="M12 10h.01"/>
                  <path d="M16 10h.01"/>
                </svg>
                <p className="text-slate-400 text-sm italic">
                  No annotations yet. Start annotating this page!
                </p>
              </div>
            </div>
          ) : (
            annotations.map((ann) => (
              <div
                key={ann.id}
                className={`bg-slate-800 p-3 rounded-lg ${
                  ann.isOptimistic ? "opacity-70" : ""
                } ${ann.error ? "border border-red-500" : ""}`}
              >
                <div className="flex items-start gap-2">
                  <div
                    className="w-8 h-8 rounded-full flex items-center justify-center font-bold text-white text-sm flex-shrink-0"
                    style={{
                      backgroundColor: stringToColor(
                        ann.user.username || ann.user.email || ""
                      ),
                    }}
                    title={ann.user.username}
                  >
                    {getInitial(ann.user.username || ann.user.email || "")}
                  </div>
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-xs font-medium text-blue-400">
                        {ann.user.username}
                      </span>
                      <span className="text-xs text-slate-400">
                        {ann.isOptimistic
                          ? "sending..."
                          : getRelativeTime(ann.timestamp)}
                      </span>
                      {ann.error && (
                        <span
                          onClick={() => retryAnnotation(ann)}
                          className="text-xs text-red-400 hover:text-red-300 hover:underline transition-colors cursor-pointer"
                          title="Click to retry"
                        >
                          ⟲ retry
                        </span>
                      )}
                      {isOwnAnnotation(ann) && !ann.isOptimistic && !ann.error && (
                        <div className="flex gap-2 ml-auto">
                          <span
                            onClick={() => startEdit(ann.id, ann.content)}
                            className="text-xs text-slate-400 hover:text-slate-300 hover:underline transition-colors cursor-pointer"
                            title="Edit"
                          >
                            ✎
                          </span>
                          <span
                            onClick={() => deleteAnnotation(ann.id)}
                            className="text-xs text-slate-400 hover:text-slate-300 hover:underline transition-colors cursor-pointer"
                            title="Delete"
                          >
                            🗑
                          </span>
                        </div>
                      )}
                    </div>
                    {editingId === ann.id ? (
                      <div className="space-y-2">
                        <textarea
                          value={editText}
                          onChange={(e) => setEditText(e.target.value)}
                          onKeyDown={(e) => handleEditKeyPress(e, ann.id)}
                          className="w-full bg-slate-700 text-white p-2 rounded text-sm resize-none focus:outline-none focus:ring-1 focus:ring-blue-500"
                          rows={2}
                          autoFocus
                        />
                        <div className="flex gap-2">
                          <button
                            onClick={() => saveEdit(ann.id)}
                            className="text-xs bg-blue-600 hover:bg-blue-500 px-2 py-1 rounded transition-colors"
                          >
                            Save
                          </button>
                          <button
                            onClick={cancelEdit}
                            className="text-xs bg-slate-600 hover:bg-slate-500 px-2 py-1 rounded transition-colors"
                          >
                            Cancel
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div className="space-y-2">
                        {ann.annotationType === 'text' && ann.highlightedText && (
                          <div className="bg-yellow-200 text-black px-2 py-1 rounded text-xs font-medium">
                            "{ann.highlightedText}"
                          </div>
                        )}
                        <p className="text-sm break-all">{ann.content}</p>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            ))
          )}
        </div>

        {/* Input area */}
        <div className="p-4 border-t border-slate-700 space-y-2 flex-shrink-0">
          {!selectedProject ? (
            <div className="text-center text-slate-400 text-sm">
              Select a project to start annotating
            </div>
          ) : (
            <>
              {textAnnotationRequest && (
                <div className="bg-yellow-200 text-black px-3 py-2 rounded text-sm mb-2">
                  <div className="font-medium mb-1">Annotating selected text:</div>
                  <div className="italic">"{textAnnotationRequest.selectedText}"</div>
                </div>
              )}
              <textarea
                value={txt}
                onChange={(e) => setTxt(e.target.value)}
                onKeyDown={handleKeyPress}
                rows={3}
                className="w-full bg-slate-800 text-white p-3 rounded-lg resize-none placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder={textAnnotationRequest ? "Add your annotation..." : "Add an annotation..."}
                disabled={sending}
              />

              <div className="flex space-x-2">
                <button
                  onClick={send}
                  disabled={!txt.trim() || sending}
                  className="flex-1 bg-blue-600 hover:bg-blue-500 disabled:bg-slate-700 disabled:text-slate-400 py-2 px-4 rounded-lg text-white font-medium transition-colors"
                >
                  {sending ? "Sending..." : (textAnnotationRequest ? "Add Text Annotation" : "Add Annotation")}
                </button>
              </div>
            </>
          )}
        </div>
      </section>

      {/* Create Project Modal */}
      {showCreateProject && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
          <div className="bg-slate-800 rounded-lg p-6 w-full max-w-md">
            <h3 className="text-lg font-semibold text-white mb-4">Create New Project</h3>
            
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-300 mb-2">
                  Project Name
                </label>
                <input
                  type="text"
                  value={newProject.name}
                  onChange={(e) => setNewProject({ ...newProject, name: e.target.value })}
                  className="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="My Website Project"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-300 mb-2">
                  Description (Optional)
                </label>
                <textarea
                  value={newProject.description}
                  onChange={(e) => setNewProject({ ...newProject, description: e.target.value })}
                  className="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                  rows={3}
                  placeholder="Describe your project..."
                />
              </div>

              <div className="flex items-center">
                <input
                  type="checkbox"
                  id="team-project"
                  checked={newProject.isTeamProject}
                  onChange={(e) => setNewProject({ ...newProject, isTeamProject: e.target.checked })}
                  className="mr-2"
                />
                <label htmlFor="team-project" className="text-sm text-slate-300">
                  This is a team project
                </label>
              </div>

              <div className="text-xs text-slate-400 bg-slate-700 p-3 rounded">
                <strong>Website:</strong> {url}
              </div>
            </div>

            <div className="flex items-center space-x-3 mt-6">
              <button
                onClick={createProject}
                disabled={!newProject.name}
                className="flex-1 bg-blue-600 hover:bg-blue-500 disabled:bg-slate-600 disabled:text-slate-400 text-white py-2 px-4 rounded-lg font-medium transition-colors"
              >
                Create Project
              </button>
              <button
                onClick={() => setShowCreateProject(false)}
                className="flex-1 bg-slate-700 hover:bg-slate-600 text-white py-2 px-4 rounded-lg font-medium transition-colors"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
