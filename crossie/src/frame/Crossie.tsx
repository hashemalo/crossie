import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { type AuthState, type Profile } from "../shared/authService";
import { supabase, supabaseAuthClient } from "../lib/supabaseClient";
import { canonicalise } from "../lib/canonicalise";
import nosignIcon from "../assets/nosign.webp";

// W3C-style Text Selectors (similar to Hypothesis)
interface TextQuoteSelector {
  type: "TextQuoteSelector";
  exact: string;
  prefix?: string;
  suffix?: string;
}

interface TextPositionSelector {
  type: "TextPositionSelector";
  start: number;
  end: number;
}

interface RangeSelector {
  type: "RangeSelector";
  startContainer: string;
  startOffset: number;
  endContainer: string;
  endOffset: number;
}

interface XPathSelector {
  type: "XPathSelector";
  value: string;
}

interface CSSSelector {
  type: "CSSSelector";
  value: string;
}

// Enhanced text selection data interface with W3C-style selectors
interface TextSelectionData {
  selectedText: string;
  // W3C-style selectors for robust anchoring
  selectors: Array<
    | TextQuoteSelector
    | TextPositionSelector
    | RangeSelector
    | XPathSelector
    | CSSSelector
  >;
  // Enhanced fields for precise text location
  startNodePath?: string; // Path to the start text node
  endNodePath?: string; // Path to the end text node
  startOffset?: number; // Offset in the start node
  endOffset?: number; // Offset in the end node
  parentSelector?: string; // CSS selector of the parent element
  precedingText?: string; // Text before selection (for context)
  followingText?: string; // Text after selection (for context)
  rangeStartOffset?: number; // Range start offset
  rangeEndOffset?: number; // Range end offset
  parentTextHash?: string; // Hash of parent text content for verification
  // Additional anchoring data
  textContent?: string; // Full text content of the parent for context
  documentUrl?: string; // URL of the document
  timestamp?: number; // When the selection was made
}

interface Annotation {
  id: string;
  content: string;
  timestamp: Date;
  user: Profile;
  // Remove image and area annotation types - focus only on text
  annotationType: "text";
  highlightedText?: string;
  // Remove imageData and coordinates - focus only on text selection
  isEditing?: boolean;
  isOptimistic?: boolean;
  error?: boolean;
  // Add optimistic tracking ID
  optimisticId?: string;
  // Enhanced selection data for better highlighting
  selectionData?: TextSelectionData;
  // Add expanded state for long content
  isExpanded?: boolean;
  // Add expanded state for highlighted text
  isHighlightExpanded?: boolean;
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
    | "HIGHLIGHT_TEXT"
    | "HIGHLIGHT_ANNOTATIONS"
    | "CLEAR_SELECTION"
    | "SCROLL_TO_HIGHLIGHT"
    | "REQUEST_PAGE_TITLE"
    | "PAGE_TITLE_RESPONSE";
  payload?: any;
}

const sendToParent = (message: ParentMessage) =>
  window.parent.postMessage(message, "*");

const saveSelectedProject = (project: Project | null, url?: string) => {
  if (typeof chrome !== "undefined" && chrome.storage?.local) {
    const key = url ? `selectedProject_${url}` : "selectedProject";
    chrome.storage.local.set({ [key]: project });
  }
};

const loadSelectedProject = (url?: string): Promise<Project | null> => {
  return new Promise((resolve) => {
    if (typeof chrome !== "undefined" && chrome.storage?.local) {
      const key = url ? `selectedProject_${url}` : "selectedProject";
      chrome.storage.local.get([key], (result) => resolve(result[key] || null));
    } else {
      resolve(null);
    }
  });
};

const clearAllSavedProjects = () => {
  if (typeof chrome !== "undefined" && chrome.storage?.local) {
    chrome.storage.local.clear();
  }
};

const getInitial = (str: string): string =>
  str?.trim()[0]?.toUpperCase() || "?";
const stringToColor = (str: string): string => {
  let hash = 0;
  for (let i = 0; i < str.length; i++)
    hash = str.charCodeAt(i) + ((hash << 5) - hash);
  return `hsl(${hash % 360}, 60%, 60%)`;
};
const getRelativeTime = (timestamp: Date): string => {
  const diff = Date.now() - timestamp.getTime();
  const seconds = Math.floor(diff / 1000),
    minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60),
    days = Math.floor(hours / 24);
  if (seconds < 60) return "just now";
  if (minutes < 60) return `${minutes}m`;
  if (hours < 24) return `${hours}h`;
  if (days < 30) return `${days}d`;
  return timestamp.toLocaleDateString();
};

// RLS error handling utility
const handleRLSError = (error: any, context: string) => {
  if (error?.code === "PGRST116") {
    console.error(`RLS Permission denied in ${context}:`, error);
    return "You don't have permission to access this resource";
  } else if (error?.code === "PGRST301") {
    console.error(`RLS Row not found in ${context}:`, error);
    return "Resource not found or access denied";
  }
  return `Error in ${context}: ${error?.message || "Unknown error"}`;
};

// Utility function to truncate text for display
const truncateText = (
  text: string,
  maxLength: number = 280
): { text: string; isTruncated: boolean } => {
  if (text.length <= maxLength) {
    return { text, isTruncated: false };
  }

  // Find the last space before maxLength to avoid cutting words
  const lastSpace = text.lastIndexOf(" ", maxLength);
  const cutoffPoint = lastSpace > 0 ? lastSpace : maxLength;

  return {
    text: text.substring(0, cutoffPoint) + "...",
    isTruncated: true,
  };
};

// Component for displaying annotation content with expand/collapse
const AnnotationContent: React.FC<{
  content: string;
  isExpanded: boolean;
  onToggleExpand: () => void;
}> = ({ content, isExpanded, onToggleExpand }) => {
  const { text, isTruncated } = truncateText(content);

  return (
    <div className="space-y-1">
      <p className="text-sm break-words whitespace-pre-wrap">
        {isExpanded ? content : text}
      </p>
      {isTruncated && (
        <button
          onClick={onToggleExpand}
          className="text-xs text-blue-400 hover:text-blue-300 transition-colors"
        >
          {isExpanded ? "Show less" : "Show more"}
        </button>
      )}
    </div>
  );
};

// Component for displaying highlighted text with expand/collapse
const HighlightedTextContent: React.FC<{
  highlightedText: string;
  isExpanded: boolean;
  onToggleExpand: () => void;
  onScrollToHighlight: () => void;
}> = ({ highlightedText, isExpanded, onToggleExpand, onScrollToHighlight }) => {
  const { text, isTruncated } = truncateText(highlightedText, 500); // Shorter limit for highlights

  return (
    <div className="space-y-2">
      <div
        className="bg-yellow-200 text-black px-3 py-2 rounded-lg text-sm font-medium cursor-pointer hover:bg-yellow-300 hover:shadow-md transition-all duration-200 border border-yellow-300"
        onClick={onScrollToHighlight}
        title="Click to scroll to highlight on page"
      >
        <span className="break-words">
          "{isExpanded ? highlightedText : text}"
        </span>
      </div>
      {isTruncated && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            onToggleExpand();
          }}
          className="text-xs text-yellow-600 hover:text-yellow-500 transition-colors ml-3"
        >
          {isExpanded ? "Show less" : "Show more"}
        </button>
      )}
    </div>
  );
};

// Function to send highlight request to parent window
const highlightTextOnPage = (annotations: Annotation[]) => {
  // Extract all text selections that need highlighting
  const highlights = annotations
    .filter((ann) => ann.annotationType === "text" && ann.highlightedText)
    .map((ann) => ({
      id: ann.id,
      text: ann.highlightedText,
      selectionData: ann.selectionData,
    }));

  // Send to parent window to handle highlighting
  sendToParent({
    type: "HIGHLIGHT_ANNOTATIONS",
    payload: { highlights },
  });
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
  const [loadingAnnotations, setLoadingAnnotations] = useState(false);
  const [isVisible, setIsVisible] = useState(false);
  const [isTabActive, setIsTabActive] = useState(!document.hidden);
  const [textAnnotationRequest, setTextAnnotationRequest] =
    useState<TextSelectionData | null>(null);
  const [projects, setProjects] = useState<Project[]>([]);
  const [selectedProject, setSelectedProject] = useState<Project | null>(null);
  const [currentPage, setCurrentPage] = useState<Page | null>(null);
  const [showProjectSelector, setShowProjectSelector] = useState(false);
  const [authInitialized, setAuthInitialized] = useState(false);
  
  // Blacklist state
  const [isCurrentSiteBlacklisted, setIsCurrentSiteBlacklisted] = useState(false);
  const [blacklistLoading, setBlacklistLoading] = useState(false);

  const annotationsRef = useRef<HTMLDivElement>(null);
  const optimisticCounterRef = useRef(0);
  // Track optimistic IDs to real IDs mapping
  const optimisticToRealIdRef = useRef<Map<string, string>>(new Map());

  const url = useMemo(() => {
    const params = new URLSearchParams(window.location.search);
    return canonicalise(decodeURIComponent(params.get("host") || ""));
  }, []);

  // Function to handle toggling content expansion
  const toggleAnnotationExpansion = useCallback((annotationId: string) => {
    setAnnotations((current) =>
      current.map((ann) =>
        ann.id === annotationId ? { ...ann, isExpanded: !ann.isExpanded } : ann
      )
    );
  }, []);

  // Function to handle toggling highlighted text expansion
  const toggleHighlightExpansion = useCallback((annotationId: string) => {
    setAnnotations((current) =>
      current.map((ann) =>
        ann.id === annotationId
          ? { ...ann, isHighlightExpanded: !ann.isHighlightExpanded }
          : ann
      )
    );
  }, []);

  // Enhanced highlighting trigger with better timing control
  useEffect(() => {
    // Only trigger highlighting when we have real annotations (not optimistic)
    const realAnnotations = annotations.filter(ann => !ann.isOptimistic);
    
    if (realAnnotations.length > 0) {
      // Add a small delay to ensure the page is ready for highlighting
      const timeoutId = setTimeout(() => {
        console.log(`[Crossie] Triggering highlights for ${realAnnotations.length} annotations`);
        highlightTextOnPage(realAnnotations);
      }, 150); // Small delay for better reliability
      
      return () => clearTimeout(timeoutId);
    }
  }, [annotations]);

  // State to track page title requests
  const [pageTitle, setPageTitle] = useState<string>("Untitled Document");
  const [titleRequestPending, setTitleRequestPending] = useState<boolean>(false);

  useEffect(() => {
    sendToParent({ type: "REQUEST_AUTH_STATE" });
    sendToParent({ type: "REQUEST_PAGE_TITLE" });
    setTitleRequestPending(true);
    const handleMessage = async (event: MessageEvent) => {
      if (event.data?.type === "AUTH_STATE_UPDATE") {
        const { authData, profile } = event.data.payload || {};

        if (authData?.access_token) {
          await supabaseAuthClient.setAuth(authData);

          setAuthState({
            user: authData.user,
            profile,
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
          setSelectedProject(null);
          saveSelectedProject(null, url);
        }
      }
      if (event.data?.type === "CROSSIE_SHOW") {
        setIsVisible(true);
        if (!document.hidden) sendToParent({ type: "REQUEST_AUTH_STATE" });
      }
      if (event.data?.type === "CROSSIE_MINIMIZE") setIsVisible(false);
      if (event.data?.type === "ANNOTATION_REQUEST") {
        setIsVisible(true);
        sendToParent({ type: "REQUEST_AUTH_STATE" });
      }
      if (event.data?.type === "TEXT_SELECTION") {
        const selectionData = event.data.payload;
        if (selectionData && selectionData.selectedText) {
          setTextAnnotationRequest(selectionData);
          setIsVisible(true);
        }
      }
      if (event.data?.type === "CLEAR_SELECTION") {
        // Clear the text annotation request when text is deselected
        setTextAnnotationRequest(null);
      }
      if (event.data?.type === "PAGE_TITLE_RESPONSE") {
        const { title } = event.data.payload || {};
        setPageTitle(title || "Untitled Document");
        setTitleRequestPending(false);
      }
    };
    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, [url]);

  useEffect(() => {
    const handleVisibilityChange = () => {
      const isActive = !document.hidden;
      setIsTabActive(isActive);
      if (isActive && isVisible) sendToParent({ type: "REQUEST_AUTH_STATE" });
    };
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () =>
      document.removeEventListener("visibilitychange", handleVisibilityChange);
  }, [isVisible]);

  // On extension load, only attempt to load the page, do not create it
  useEffect(() => {
    if (!authState.authenticated || !authState.user || !url) return;
    const loadPage = async () => {
      try {
        const urlHash = btoa(url).replace(/[^a-zA-Z0-9]/g, "");
        const { data: existingPage } = await supabase
          .from("pages")
          .select("id, url, url_hash, title, created_at")
          .eq("url_hash", urlHash)
          .maybeSingle();
        if (existingPage) {
          setCurrentPage({
            id: existingPage.id,
            url: existingPage.url,
            urlHash: existingPage.url_hash,
            title: existingPage.title,
            createdAt: new Date(existingPage.created_at),
          });
        } else {
          setCurrentPage(null);
        }
      } catch (error) {
        console.error("Error loading page:", error);
      }
    };
    loadPage();
  }, [authState.authenticated, authState.user, url]);

  useEffect(() => {
    if (!authState.authenticated || !authState.user) return;

    const fetchProjects = async () => {
      try {
        // With RLS, this query will automatically only return accessible projects
        const { data: allProjects, error } = await supabase
          .from("projects")
          .select(
            "id, name, description, is_team_project, created_by, created_at"
          )
          .order("created_at", { ascending: false });

        if (error) {
          console.error("Error fetching projects:", error);
          if (error.code === "PGRST116") {
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
    fetchProjects();
  }, [authState.authenticated, authState.user]);

  useEffect(() => {
    if (
      projects.length > 0 &&
      !selectedProject &&
      authState.authenticated &&
      url
    ) {
      loadSelectedProject(url).then((savedProject) => {
        if (savedProject) {
          const projectExists = projects.find((p) => p.id === savedProject.id);
          if (projectExists) setSelectedProject(projectExists);
        }
      });
    }
  }, [projects, selectedProject, authState.authenticated, url]);

  useEffect(() => {
    if (!authState.authenticated && authInitialized) clearAllSavedProjects();
  }, [authState.authenticated, authInitialized]);





  const selectProject = async (project: Project) => {
    setSelectedProject(project);
    setShowProjectSelector(false);
    saveSelectedProject(project, url);

    if (currentPage && authState.user) {
      try {
        const { data: existingProjectPage } = await supabase
          .from("project_pages")
          .select("id")
          .eq("project_id", project.id)
          .eq("page_id", currentPage.id)
          .maybeSingle();
        if (!existingProjectPage) {
          await supabase.from("project_pages").insert({
            project_id: project.id,
            page_id: currentPage.id,
            added_by: authState.user.id,
          });
        }
        await loadAnnotations(project.id, currentPage.id);
      } catch (error) {
        console.error("Error selecting project:", error);
      }
    }
  };

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
        if (annotationsError.code === "PGRST116") {
          console.error(
            "Permission denied - user may not have access to this project"
          );
          setAnnotations([]);
          return;
        }
        throw annotationsError;
      } else if (annotationsData) {
        const mapped = annotationsData.map((a: any) => ({
          id: a.id,
          content: a.content,
          timestamp: new Date(a.created_at),
          user: { id: a.user.id, username: a.user.username },
          annotationType: a.annotation_type,
          highlightedText: a.highlighted_text,
          // Parse selection data from coordinates field
          selectionData:
            a.coordinates?.type === "text-selection"
              ? {
                  selectedText:
                    a.highlighted_text || a.coordinates.selectedText || "",
                  selectors: a.coordinates.selectors || [],
                  startNodePath: a.coordinates.startNodePath,
                  endNodePath: a.coordinates.endNodePath,
                  startOffset: a.coordinates.startOffset,
                  endOffset: a.coordinates.endOffset,
                  parentSelector: a.coordinates.parentSelector,
                  precedingText: a.coordinates.precedingText,
                  followingText: a.coordinates.followingText,
                  rangeStartOffset: a.coordinates.rangeStartOffset,
                  rangeEndOffset: a.coordinates.rangeEndOffset,
                  parentTextHash: a.coordinates.parentTextHash,
                  textContent: a.coordinates.textContent,
                  documentUrl: a.coordinates.documentUrl,
                  timestamp: a.coordinates.timestamp,
                }
              : undefined,
          isExpanded: false,
          isHighlightExpanded: false,
        }));
        setAnnotations(mapped);
      }
    } catch (error) {
      console.error("Error in loadAnnotations:", error);
      setAnnotations([]);
    } finally {
      setLoadingAnnotations(false);
    }
  };

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (showProjectSelector) {
        const target = event.target as Element;
        const projectSelector = document.querySelector(
          "[data-project-selector]"
        );
        if (projectSelector && !projectSelector.contains(target))
          setShowProjectSelector(false);
      }
    };
    document.addEventListener("click", handleClickOutside);
    return () => document.removeEventListener("click", handleClickOutside);
  }, [showProjectSelector]);

  useEffect(() => {
    if (!selectedProject || !currentPage || !authInitialized) return;

    loadAnnotations(selectedProject.id, currentPage.id);
  }, [selectedProject, currentPage, authInitialized]);

  const send = useCallback(async () => {
    if (
      !txt.trim() ||
      !authState.profile ||
      !authState.user ||
      sending ||
      !selectedProject
    )
      return;

    setSending(true);
    const isTextAnnotation = !!textAnnotationRequest;
    const highlightedText = textAnnotationRequest?.selectedText;
    const selectionData = textAnnotationRequest as TextSelectionData;

    const optimisticId = `optimistic-${Date.now()}-${++optimisticCounterRef.current}`;
    const optimisticAnnotation: Annotation = {
      id: optimisticId,
      content: txt.trim(),
      timestamp: new Date(),
      user: authState.profile,
      annotationType: "text",
      isOptimistic: true,
      highlightedText,
      optimisticId,
      selectionData: isTextAnnotation ? selectionData : undefined,
      isExpanded: false,
      isHighlightExpanded: false,
    };

    setAnnotations((cur) => [optimisticAnnotation, ...cur]);
    const annotationText = txt.trim();
    setTxt("");
    if (isTextAnnotation) setTextAnnotationRequest(null);

    try {
      let page = currentPage;
      let pageWasJustCreated = false;
      
      // If currentPage is null, create the page now
      if (!page) {
        // Request page title if we haven't already
        if (!titleRequestPending) {
          setTitleRequestPending(true);
          sendToParent({ type: "REQUEST_PAGE_TITLE" });
          
          // Wait a bit for the title response
          await new Promise(resolve => setTimeout(resolve, 100));
        }
        
        const urlHash = btoa(url).replace(/[^a-zA-Z0-9]/g, "");
        const { data: newPage, error: insertError } = await supabase
          .from("pages")
          .insert({ url, url_hash: urlHash, title: pageTitle })
          .select()
          .single();
        if (insertError) throw insertError;
        page = {
          id: newPage.id,
          url: newPage.url,
          urlHash: newPage.url_hash,
          title: newPage.title,
          createdAt: new Date(newPage.created_at),
        };
        setCurrentPage(page);
        pageWasJustCreated = true;
      }

      // Ensure project_pages exists
      const { data: existingProjectPage } = await supabase
        .from("project_pages")
        .select("id")
        .eq("project_id", selectedProject.id)
        .eq("page_id", page.id)
        .maybeSingle();

      if (!existingProjectPage) {
        await supabase.from("project_pages").insert({
          project_id: selectedProject.id,
          page_id: page.id,
          added_by: authState.user.id,
        });
      }

      // Prepare coordinates field with enhanced selection data
      const coordinates =
        isTextAnnotation && selectionData
          ? {
              type: "text-selection",
              selectedText: selectionData.selectedText,
              selectors: selectionData.selectors,
              startNodePath: selectionData.startNodePath,
              endNodePath: selectionData.endNodePath,
              startOffset: selectionData.startOffset,
              endOffset: selectionData.endOffset,
              parentSelector: selectionData.parentSelector,
              precedingText: selectionData.precedingText,
              followingText: selectionData.followingText,
              rangeStartOffset: selectionData.rangeStartOffset,
              rangeEndOffset: selectionData.rangeEndOffset,
              parentTextHash: selectionData.parentTextHash,
              textContent: selectionData.textContent,
              documentUrl: selectionData.documentUrl,
              timestamp: selectionData.timestamp,
            }
          : null; // Use null instead of undefined to avoid empty objects

      // Insert annotation and get the created record with profile info
      const { data: insertedAnnotation, error: insertErr } = await supabase
        .from("annotations")
        .insert({
          project_id: selectedProject.id,
          page_id: page.id,
          user_id: authState.user.id,
          content: annotationText,
          annotation_type: "text",
          highlighted_text: highlightedText,
          coordinates: coordinates, // Store selection data here
        })
        .select(
          "id, content, created_at, user_id, annotation_type, highlighted_text, image_data, coordinates, user:profiles ( id, username )"
        )
        .single();

      if (insertErr) throw new Error(`Insert failed: ${insertErr.message}`);

      // Immediately replace the optimistic annotation with the real one
      if (insertedAnnotation) {
        const realAnnotation: Annotation = {
          id: insertedAnnotation.id,
          content: insertedAnnotation.content,
          timestamp: new Date(insertedAnnotation.created_at),
          user:
            (Array.isArray(insertedAnnotation.user)
              ? insertedAnnotation.user[0]
              : insertedAnnotation.user) || authState.profile,
          annotationType: insertedAnnotation.annotation_type,
          highlightedText: insertedAnnotation.highlighted_text,
          // Parse selection data from coordinates field
          selectionData:
            insertedAnnotation.coordinates?.type === "text-selection"
              ? {
                  selectedText:
                    insertedAnnotation.highlighted_text ||
                    insertedAnnotation.coordinates.selectedText ||
                    "",
                  selectors: insertedAnnotation.coordinates.selectors || [],
                  startNodePath: insertedAnnotation.coordinates.startNodePath,
                  endNodePath: insertedAnnotation.coordinates.endNodePath,
                  startOffset: insertedAnnotation.coordinates.startOffset,
                  endOffset: insertedAnnotation.coordinates.endOffset,
                  parentSelector: insertedAnnotation.coordinates.parentSelector,
                  precedingText: insertedAnnotation.coordinates.precedingText,
                  followingText: insertedAnnotation.coordinates.followingText,
                  rangeStartOffset:
                    insertedAnnotation.coordinates.rangeStartOffset,
                  rangeEndOffset: insertedAnnotation.coordinates.rangeEndOffset,
                  parentTextHash: insertedAnnotation.coordinates.parentTextHash,
                  textContent: insertedAnnotation.coordinates.textContent,
                  documentUrl: insertedAnnotation.coordinates.documentUrl,
                  timestamp: insertedAnnotation.coordinates.timestamp,
                }
              : undefined,
          isExpanded: false,
          isHighlightExpanded: false,
        };

        setAnnotations((cur) =>
          cur.map((ann) => (ann.id === optimisticId ? realAnnotation : ann))
        );

        // Store mapping for realtime deduplication
        optimisticToRealIdRef.current.set(optimisticId, insertedAnnotation.id);
      }

      // Clear the stored selection after successful annotation
      sendToParent({ type: "CLEAR_SELECTION" });

      // If page was just created, immediately load annotations
      if (pageWasJustCreated) {
        await loadAnnotations(selectedProject.id, page.id);
      }

      if (annotationsRef.current)
        annotationsRef.current.scrollTo({ top: 0, behavior: "smooth" });
    } catch (error) {
      console.error("[Crossie] Send failed:", error);
      setAnnotations((cur) =>
        cur.map((ann) =>
          ann.id === optimisticId
            ? { ...ann, error: true, isOptimistic: false }
            : ann
        )
      );

      // Handle RLS-specific errors
      const errorMsg = handleRLSError(error, "sending annotation");
      alert(errorMsg);
    } finally {
      setSending(false);
    }
  }, [
    txt,
    authState,
    selectedProject,
    currentPage,
    sending,
    textAnnotationRequest,
    url,
  ]);

  // Check current site blacklist status
  const checkCurrentSiteBlacklistStatus = useCallback(async () => {
    try {
      const response = await chrome.runtime.sendMessage({
        type: 'CHECK_BLACKLIST',
        url: url
      });
      
      if (response) {
        setIsCurrentSiteBlacklisted(response.isBlacklisted || false);
      }
    } catch (error) {
      console.error('Failed to check blacklist status:', error);
    }
  }, [url]);

  // Toggle current site blacklist status
  const toggleCurrentSiteBlacklist = useCallback(async () => {
    if (!url) return;
    
    setBlacklistLoading(true);
    try {
      const domain = new URL(url).hostname;
      
      if (isCurrentSiteBlacklisted) {
        // Remove from blacklist
        const response = await chrome.runtime.sendMessage({
          type: 'REMOVE_FROM_BLACKLIST',
          domain: domain
        });
        
        if (response && response.success) {
          setIsCurrentSiteBlacklisted(false);
        } else {
          alert('Failed to remove site from blacklist');
        }
      } else {
        // Add to blacklist
        const response = await chrome.runtime.sendMessage({
          type: 'ADD_TO_BLACKLIST',
          domain: domain
        });
        
        if (response && response.success) {
          setIsCurrentSiteBlacklisted(true);
          // Notify user that the site will be blacklisted
          alert(`${domain} has been blacklisted. Crossie will not appear on this site after you refresh the page.`);
        } else {
          alert('Failed to add site to blacklist');
        }
      }
    } catch (error) {
      console.error('Failed to toggle blacklist status:', error);
      alert('Failed to update blacklist');
    } finally {
      setBlacklistLoading(false);
    }
  }, [url, isCurrentSiteBlacklisted]);

  // Check blacklist status when component mounts and auth is initialized
  useEffect(() => {
    if (authInitialized && authState.authenticated) {
      checkCurrentSiteBlacklistStatus();
    }
  }, [authInitialized, authState.authenticated, checkCurrentSiteBlacklistStatus]);

  // Enhanced function to scroll to highlighted text with better error handling
  const scrollToHighlight = useCallback((annotation: Annotation) => {
    console.log(`[Crossie] Scroll to highlight request for annotation ${annotation.id}`);
    
    if (annotation.selectionData) {
      // Use full selection data for most accurate scrolling
      sendToParent({
        type: "SCROLL_TO_HIGHLIGHT",
        payload: { 
          annotationId: annotation.id,
          selectionData: annotation.selectionData 
        },
      });
    } else if (annotation.highlightedText) {
      // Fallback: create minimal selection data from highlighted text
      sendToParent({
        type: "SCROLL_TO_HIGHLIGHT",
        payload: {
          annotationId: annotation.id,
          selectionData: {
            selectedText: annotation.highlightedText,
          },
        },
      });
    } else {
      console.warn(`[Crossie] Cannot scroll to annotation ${annotation.id} - no text data available`);
    }
  }, []);

  const retryAnnotation = useCallback(
    async (failedAnnotation: Annotation) => {
      if (sending) return;
      setAnnotations((cur) =>
        cur.filter((ann) => ann.id !== failedAnnotation.id)
      );
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
      setAnnotations((cur) => cur.filter((ann) => ann.id !== annId));
      const { error } = await supabase
        .from("annotations")
        .delete()
        .eq("id", annId);
      if (error) {
        console.error("Delete failed:", error);
        // Reload annotations on error
        if (selectedProject && currentPage) {
          loadAnnotations(selectedProject.id, currentPage.id);
        }
      }
    },
    [selectedProject, currentPage]
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
      if (e.key === "Escape") cancelEdit();
    },
    [saveEdit, cancelEdit]
  );

  const isOwnAnnotation = useCallback(
    (ann: Annotation) => authState.user && ann.user.id === authState.user.id,
    [authState.user]
  );

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

  if (!authState.authenticated) {
    return (
      <div className="w-full h-full bg-slate-900 text-white flex flex-col">
        <header className="bg-slate-800 px-4 py-3 text-white font-semibold flex items-center justify-between border-b border-slate-700">
          <div className="flex items-center gap-2">
            <span className="text-sm text-slate-300">crossie</span>
          </div>
          <div className="flex items-center space-x-3">
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

  return (
    <div className="relative select-none h-full flex flex-col">
      <header className="bg-slate-800 px-4 py-3 text-white font-semibold flex items-center justify-between border-b border-slate-700">
        <div className="flex items-center gap-2">
          <div
            className="w-8 h-8 rounded-full flex items-center justify-center font-bold text-white text-sm flex-shrink-0 cursor-pointer"
            style={{
              backgroundColor: stringToColor(
                authState.profile?.username || authState.profile?.email || ""
              ),
            }}
            onClick={() =>
              window.open("https://trycrossie.vercel.app/dashboard", "_blank")
            }
            title={authState.profile?.username}
          >
            {getInitial(
              authState.profile?.username || authState.profile?.email || ""
            )}
          </div>
        </div>
        <div className="flex items-center space-x-2">
          <div data-project-selector className="relative">
            <button
              onClick={() => setShowProjectSelector(!showProjectSelector)}
              className="flex items-center space-x-2 bg-slate-700 hover:bg-slate-600 px-3 py-1 rounded text-sm transition-colors"
            >
              <svg
                className="w-4 h-4"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10"
                />
              </svg>
              <span className="text-xs">
                {selectedProject ? selectedProject.name : ""}
              </span>
              <svg
                className="w-3 h-3"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M19 9l-7 7-7-7"
                />
              </svg>
            </button>
            {showProjectSelector && (
              <div
                data-project-selector
                className="absolute top-full left-0 mt-1 w-64 bg-slate-700 border border-slate-600 rounded-lg shadow-lg z-10"
              >
                <div className="p-2">
                  <div className="text-xs text-slate-400 mb-2 px-2">
                    Your Projects
                  </div>
                  {projects.length === 0 ? (
                    <div className="text-xs text-slate-400 px-2 py-1">
                      No projects yet
                    </div>
                  ) : (
                    <div className="space-y-1">
                      {projects.map((project) => (
                        <button
                          key={project.id}
                          onClick={() => selectProject(project)}
                          className={`w-full text-left px-2 py-1 rounded text-xs hover:bg-slate-600 transition-colors ${
                            selectedProject?.id === project.id
                              ? "bg-blue-600 text-white"
                              : "text-slate-300"
                          }`}
                        >
                          <div className="font-medium">{project.name}</div>
                          <div className="text-slate-400 truncate">
                            {project.isTeamProject
                              ? "Team Project"
                              : "Personal Project"}
                          </div>
                        </button>
                      ))}
                    </div>
                  )}

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
            
            {/* Blacklist Toggle Button */}
            {authState.authenticated && (
              <div className="relative group">
                <button
                  onClick={toggleCurrentSiteBlacklist}
                  disabled={blacklistLoading}
                  className={`hover:bg-slate-700 rounded p-1 transition-colors text-xs ${
                    isCurrentSiteBlacklisted 
                      ? 'text-red-400 hover:text-red-300' 
                      : 'text-slate-400 hover:text-slate-300'
                  }`}
                  title={
                    blacklistLoading 
                      ? "Updating..." 
                      : isCurrentSiteBlacklisted 
                      ? "Remove site from blacklist" 
                      : "Blacklist site"
                  }
                >
                  {blacklistLoading ? (
                    <div className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin"></div>
                  ) : (
                    <img 
                      src={nosignIcon} 
                      alt="No sign" 
                      width="16" 
                      height="16" 
                      className="w-4 h-4"
                    />
                  )}
                </button>
              </div>
            )}
          </div>
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
        <div
          ref={annotationsRef}
          className="flex-1 overflow-y-auto p-4 space-y-3 min-h-0"
        >
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
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10"
                  />
                </svg>
                <p className="text-slate-400 text-sm mb-4">
                  Select a project to start annotating
                </p>
              </div>
            </div>
          ) : loadingAnnotations ? (
            <div className="flex items-center justify-center h-full min-h-0 -mt-4">
              <div className="text-center">
                <div className="animate-spin w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full mx-auto mb-3"></div>
                <p className="text-slate-400 text-sm">Loading annotations...</p>
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
                  <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
                  <path d="M8 10h.01" />
                  <path d="M12 10h.01" />
                  <path d="M16 10h.01" />
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
                      {isOwnAnnotation(ann) &&
                        !ann.isOptimistic &&
                        !ann.error && (
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
                        {ann.annotationType === "text" &&
                          ann.highlightedText && (
                            <HighlightedTextContent
                              highlightedText={ann.highlightedText}
                              isExpanded={ann.isHighlightExpanded || false}
                              onToggleExpand={() =>
                                toggleHighlightExpansion(ann.id)
                              }
                              onScrollToHighlight={() => scrollToHighlight(ann)}
                            />
                          )}
                        <AnnotationContent
                          content={ann.content}
                          isExpanded={ann.isExpanded || false}
                          onToggleExpand={() =>
                            toggleAnnotationExpansion(ann.id)
                          }
                        />
                      </div>
                    )}
                  </div>
                </div>
              </div>
            ))
          )}
        </div>

        <div className="p-4 border-t border-slate-700 space-y-2 flex-shrink-0">
          {!selectedProject ? (
            <div className="text-center text-slate-400 text-sm">
              Select a project to start annotating
            </div>
          ) : (
            <>
              <div className="bg-blue-600/20 border border-blue-600/30 px-3 py-2 rounded text-xs text-blue-300 mb-2">
                <div className="font-medium">
                  Annotating in: {selectedProject.name}
                </div>
                <div className="text-blue-200">
                  {selectedProject.isTeamProject
                    ? "Team Project"
                    : "Personal Project"}
                </div>
              </div>
              {textAnnotationRequest && (
                <div className="bg-yellow-200 text-black px-3 py-2 rounded text-sm mb-2">
                  <div className="font-medium mb-1">
                    Annotating selected text:
                  </div>
                  <div className="italic">
                    "{textAnnotationRequest.selectedText}"
                  </div>
                </div>
              )}
              <textarea
                value={txt}
                onChange={(e) => setTxt(e.target.value)}
                onKeyDown={handleKeyPress}
                rows={3}
                className="w-full bg-slate-800 text-white p-3 rounded-lg resize-none placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder={
                  textAnnotationRequest
                    ? "Add your annotation..."
                    : "Add an annotation..."
                }
                disabled={sending}
              />
              <div className="flex space-x-2">
                <button
                  onClick={send}
                  disabled={!txt.trim() || sending}
                  className="flex-1 bg-blue-600 hover:bg-blue-500 disabled:bg-slate-700 disabled:text-slate-400 py-2 px-4 rounded-lg text-white font-medium transition-colors"
                >
                  {sending
                    ? "Sending..."
                    : textAnnotationRequest
                    ? "Add Text Annotation"
                    : "Add Annotation"}
                </button>
              </div>
            </>
          )}
        </div>
      </section>




    </div>
  );
}
