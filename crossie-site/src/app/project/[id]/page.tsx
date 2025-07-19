'use client';

import { useState, useEffect } from 'react';
import { createClient } from '@supabase/supabase-js';
import { useParams, useRouter } from 'next/navigation';

const supabase = createClient(
  "https://sxargqkknhkcfvhbttrh.supabase.co",
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InN4YXJncWtrbmhrY2Z2aGJ0dHJoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTA3MzEyMDAsImV4cCI6MjA2NjMwNzIwMH0.Q70cLGf69Al2prKMDSkCTnCGTuiKGY-MFK2tQ1g2T-k"
);

interface Project {
  id: string;
  name: string;
  description?: string;
  is_team_project: boolean;
  created_at: string;
  created_by: string;
  creator_username?: string;
}

interface Page {
  id: string;
  url: string;
  title?: string;
  created_at: string;
  added_by?: string;
  annotation_count?: number;
}

interface Annotation {
  id: string;
  content: string;
  highlighted_text?: string;
  annotation_type: string;
  created_at: string;
  user_id: string;
  username?: string;
  page_url?: string;
  page_title?: string;
}

interface User {
  id: string;
  username: string;
  email?: string;
}

interface ProjectMember {
  id: string;
  user_id: string;
  role: string;
  joined_at: string;
  username?: string;
}

export default function ProjectPage() {
  const params = useParams();
  const router = useRouter();
  const projectId = params?.id as string;

  const [user, setUser] = useState<User | null>(null);
  const [project, setProject] = useState<Project | null>(null);
  const [pages, setPages] = useState<Page[]>([]);
  const [annotations, setAnnotations] = useState<Annotation[]>([]);
  const [members, setMembers] = useState<ProjectMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<'pages' | 'annotations' | 'members'>('pages');
  const [showAddPageModal, setShowAddPageModal] = useState(false);
  const [showAddMemberModal, setShowAddMemberModal] = useState(false);
  const [showShareModal, setShowShareModal] = useState(false);
  const [newPageUrl, setNewPageUrl] = useState('');
  const [newMemberUsername, setNewMemberUsername] = useState('');
  const [shareEmail, setShareEmail] = useState('');
  const [shareRole, setShareRole] = useState<'member' | 'editor'>('member');

  useEffect(() => {
    checkAuth();
  }, []);

  const checkAuth = async () => {
    const { data: { session } } = await supabase.auth.getSession();
    if (session?.user) {
      const { data: profile } = await supabase
        .from('profiles')
        .select('id, username, email')
        .eq('id', session.user.id)
        .single();
      
      if (profile) {
        setUser(profile);
        await fetchProject(profile.id);
      }
    } else {
      router.push('/auth');
    }
  };

  const fetchProject = async (userId: string) => {
    try {
      // Fetch project details
      const { data: projectData, error: projectError } = await supabase
        .from('projects')
        .select(`
          *,
          profiles!fk_project_creator (username)
        `)
        .eq('id', projectId)
        .single();

      if (projectError) throw projectError;

      // Check if user has access to this project
      const { data: memberData } = await supabase
        .from('project_members')
        .select('role')
        .eq('project_id', projectId)
        .eq('user_id', userId)
        .single();

      // User must be the creator or a member
      if (projectData.created_by !== userId && !memberData) {
        router.push('/dashboard');
        return;
      }

      setProject({
        ...projectData,
        creator_username: projectData.profiles?.username
      });

      // Fetch project pages
      await fetchPages();
      
      // Fetch annotations
      await fetchAnnotations();
      
      // Fetch members (always visible now with new sharing model)
      await fetchMembers();
    } catch (error) {
      console.error('Error fetching project:', error);
      router.push('/dashboard');
    } finally {
      setLoading(false);
    }
  };

  const fetchPages = async () => {
    try {
      const { data, error } = await supabase
        .from('project_pages')
        .select(`
          *,
          pages (
            id,
            url,
            title,
            created_at
          )
        `)
        .eq('project_id', projectId);

      if (error) throw error;

      // Get annotation counts for each page
      const pagesWithCounts = await Promise.all(
        (data || []).map(async (projectPage: any) => {
          const { count } = await supabase
            .from('annotations')
            .select('*', { count: 'exact', head: true })
            .eq('project_id', projectId)
            .eq('page_id', projectPage.pages.id);

          return {
            ...projectPage.pages,
            added_by: projectPage.added_by,
            annotation_count: count || 0
          };
        })
      );

      setPages(pagesWithCounts);
    } catch (error) {
      console.error('Error fetching pages:', error);
    }
  };

  const fetchAnnotations = async () => {
    try {
      const { data, error } = await supabase
        .from('annotations')
        .select(`
          *,
          profiles!fk_annotation_user (username),
          pages (url, title)
        `)
        .eq('project_id', projectId)
        .order('created_at', { ascending: false });

      if (error) throw error;

      const annotationsWithDetails = (data || []).map((annotation: any) => ({
        ...annotation,
        username: annotation.profiles?.username,
        page_url: annotation.pages?.url,
        page_title: annotation.pages?.title
      }));

      setAnnotations(annotationsWithDetails);
    } catch (error) {
      console.error('Error fetching annotations:', error);
    }
  };

  const fetchMembers = async () => {
    try {
      const { data, error } = await supabase
        .from('project_members')
        .select(`
          *,
          profiles!fk_project_member_user (username)
        `)
        .eq('project_id', projectId)
        .order('joined_at', { ascending: false });

      if (error) throw error;

      const membersWithDetails = (data || []).map((member: any) => ({
        ...member,
        username: member.profiles?.username
      }));

      setMembers(membersWithDetails);
    } catch (error) {
      console.error('Error fetching members:', error);
    }
  };

  const addPage = async () => {
    if (!newPageUrl || !user) return;

    try {
      // Normalize the URL
      let url = newPageUrl.trim();
      if (!url.startsWith('http://') && !url.startsWith('https://')) {
        url = 'https://' + url;
      }

      // Create URL hash
      const urlHash = btoa(url);

      // Check if page already exists
      let { data: existingPage, error: pageError } = await supabase
        .from('pages')
        .select('id')
        .eq('url_hash', urlHash)
        .single();

      if (pageError && pageError.code !== 'PGRST116') {
        throw pageError;
      }

      // Create page if it doesn't exist
      if (!existingPage) {
        const { data: newPage, error: createError } = await supabase
          .from('pages')
          .insert({
            url,
            url_hash: urlHash,
            title: url // Will be updated by extension when visited
          })
          .select('id')
          .single();

        if (createError) throw createError;
        existingPage = newPage;
      }

      // Add page to project
      const { error: projectPageError } = await supabase
        .from('project_pages')
        .insert({
          project_id: projectId,
          page_id: existingPage.id,
          added_by: user.id
        });

      if (projectPageError) throw projectPageError;

      setNewPageUrl('');
      setShowAddPageModal(false);
      await fetchPages();
    } catch (error) {
      console.error('Error adding page:', error);
      alert('Failed to add page');
    }
  };

  const addMember = async () => {
    if (!newMemberUsername || !user) return;

    try {
      // Find user by username
      const { data: userData, error: userError } = await supabase
        .from('profiles')
        .select('id')
        .eq('username', newMemberUsername)
        .single();

      if (userError) {
        alert('User not found');
        return;
      }

      // Check if user is already a member
      const { data: existingMember, error: memberError } = await supabase
        .from('project_members')
        .select('id')
        .eq('project_id', projectId)
        .eq('user_id', userData.id)
        .single();

      if (memberError && memberError.code !== 'PGRST116') {
        throw memberError;
      }

      if (existingMember) {
        alert('User is already a member');
        return;
      }

      // Add member
      const { error: addError } = await supabase
        .from('project_members')
        .insert({
          project_id: projectId,
          user_id: userData.id,
          role: 'member'
        });

      if (addError) throw addError;

      setNewMemberUsername('');
      setShowAddMemberModal(false);
      await fetchMembers();
    } catch (error) {
      console.error('Error adding member:', error);
      alert('Failed to add member');
    }
  };

  const removePage = async (pageId: string) => {
    if (!confirm('Are you sure you want to remove this page from the project?')) return;

    try {
      await supabase
        .from('project_pages')
        .delete()
        .eq('project_id', projectId)
        .eq('page_id', pageId);

      await fetchPages();
    } catch (error) {
      console.error('Error removing page:', error);
      alert('Failed to remove page');
    }
  };

  const shareProject = async () => {
    if (!shareEmail.trim() || !project || !user) return;
    
    try {
      // Find user by email
      const { data: userData, error: userError } = await supabase
        .from('profiles')
        .select('id, username')
        .eq('email', shareEmail.trim().toLowerCase())
        .single();

      if (userError || !userData) {
        alert('User not found. Please make sure the email address is correct and the user has a Crossie account.');
        return;
      }

      // Check if user is already a member
      const { data: existingMember, error: memberError } = await supabase
        .from('project_members')
        .select('id, role')
        .eq('project_id', project.id)
        .eq('user_id', userData.id)
        .maybeSingle();

      if (memberError && memberError.code !== 'PGRST116') {
        throw memberError;
      }

      if (existingMember) {
        alert(`${userData.username} is already a member of this project with role: ${existingMember.role}`);
        return;
      }

      // Add user as project member
      const { error: insertError } = await supabase
        .from('project_members')
        .insert({
          project_id: project.id,
          user_id: userData.id,
          role: shareRole
        });

      if (insertError) throw insertError;

      alert(`Successfully shared "${project.name}" with ${userData.username} (${shareEmail}) as ${shareRole}.`);
      setShowShareModal(false);
      setShareEmail('');
      setShareRole('member');
      
      // Refresh members list to show the new member
      await fetchMembers();
    } catch (error) {
      console.error('Error sharing project:', error);
      alert('Failed to share project. Please try again.');
    }
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric'
    });
  };

  const getDomainFromUrl = (url: string) => {
    try {
      const domain = new URL(url).hostname;
      return domain.replace('www.', '');
    } catch {
      return url;
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-900 flex items-center justify-center">
        <div className="animate-spin w-12 h-12 border-4 border-blue-400 border-t-transparent rounded-full"></div>
      </div>
    );
  }

  if (!project) {
    return (
      <div className="min-h-screen bg-slate-900 flex items-center justify-center">
        <div className="text-center">
          <h1 className="text-2xl font-bold text-white mb-4">Project not found</h1>
          <a href="/dashboard" className="text-blue-400 hover:text-blue-300">
            Back to Dashboard
          </a>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-900 text-white">
      {/* Header */}
      <header className="bg-slate-800 border-b border-slate-700">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16">
            <div className="flex items-center space-x-4">
              <a href="/dashboard" className="text-blue-400 hover:text-blue-300 transition-colors">
                ← Dashboard
              </a>
              <div className="w-px h-6 bg-slate-600"></div>
              <h1 className="text-xl font-semibold text-white">{project.name}</h1>
              <span className="text-xs bg-green-600 text-white px-2 py-1 rounded-full">
                Shareable
              </span>
            </div>
            <div className="flex items-center space-x-4">
              <button
                onClick={() => setShowShareModal(true)}
                className="flex items-center space-x-1 text-sm bg-green-600 hover:bg-green-500 text-white px-3 py-1 rounded transition-colors"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.367 2.684 3 3 0 00-5.367-2.684z" />
                </svg>
                <span>Share</span>
              </button>
              <span className="text-sm text-slate-400">
                Welcome, {user?.username}
              </span>
              <button
                onClick={() => supabase.auth.signOut()}
                className="text-sm text-slate-400 hover:text-slate-300 transition-colors"
              >
                Sign Out
              </button>
            </div>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Project Info */}
        <div className="bg-slate-800 rounded-lg p-6 mb-8">
          <div className="flex items-start justify-between">
            <div>
              <h2 className="text-2xl font-bold text-white mb-2">{project.name}</h2>
              <p className="text-slate-400 mb-4">
                {project.description || 'No description provided'}
              </p>
              <div className="flex items-center space-x-4 text-sm text-slate-500">
                <span>Created by {project.creator_username}</span>
                <span>•</span>
                <span>{formatDate(project.created_at)}</span>
              </div>
            </div>
            <div className="text-right text-sm text-slate-400">
              <div>{pages.length} pages</div>
              <div>{annotations.length} annotations</div>
            </div>
          </div>
        </div>

        {/* Tabs */}
        <div className="border-b border-slate-700 mb-6">
          <nav className="flex space-x-8">
            <button
              onClick={() => setActiveTab('pages')}
              className={`py-2 px-1 border-b-2 font-medium text-sm ${
                activeTab === 'pages'
                  ? 'border-blue-500 text-blue-400'
                  : 'border-transparent text-slate-400 hover:text-slate-300'
              }`}
            >
              Pages ({pages.length})
            </button>
            <button
              onClick={() => setActiveTab('annotations')}
              className={`py-2 px-1 border-b-2 font-medium text-sm ${
                activeTab === 'annotations'
                  ? 'border-blue-500 text-blue-400'
                  : 'border-transparent text-slate-400 hover:text-slate-300'
              }`}
            >
              Annotations ({annotations.length})
            </button>
            <button
              onClick={() => setActiveTab('members')}
              className={`py-2 px-1 border-b-2 font-medium text-sm ${
                activeTab === 'members'
                  ? 'border-blue-500 text-blue-400'
                  : 'border-transparent text-slate-400 hover:text-slate-300'
              }`}
            >
              Members ({members.length})
            </button>
          </nav>
        </div>

        {/* Tab Content */}
        {activeTab === 'pages' && (
          <div>
            <div className="flex items-center justify-between mb-6">
              <h3 className="text-lg font-medium text-white">Project Pages</h3>
              <button
                onClick={() => setShowAddPageModal(true)}
                className="bg-blue-600 hover:bg-blue-500 text-white px-4 py-2 rounded-lg font-medium transition-colors"
              >
                Add Page
              </button>
            </div>

            {pages.length === 0 ? (
              <div className="text-center py-12 bg-slate-800 rounded-lg">
                <div className="w-16 h-16 bg-slate-700 rounded-full mx-auto mb-4 flex items-center justify-center">
                  <svg className="w-8 h-8 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                  </svg>
                </div>
                <h4 className="text-lg font-medium text-white mb-2">No pages yet</h4>
                <p className="text-slate-400 mb-4">
                  Add pages to this project to start annotating
                </p>
                <button
                  onClick={() => setShowAddPageModal(true)}
                  className="bg-blue-600 hover:bg-blue-500 text-white px-4 py-2 rounded-lg font-medium transition-colors"
                >
                  Add First Page
                </button>
              </div>
            ) : (
              <div className="grid gap-4">
                {pages.map((page) => (
                  <div key={page.id} className="bg-slate-800 rounded-lg p-4 flex items-center justify-between">
                    <div className="flex-1">
                      <div className="flex items-center space-x-2 mb-2">
                        <h4 className="text-white font-medium">
                          {page.title || getDomainFromUrl(page.url)}
                        </h4>
                        <span className="text-xs bg-slate-700 text-slate-300 px-2 py-1 rounded">
                          {page.annotation_count} annotations
                        </span>
                      </div>
                      <p className="text-sm text-slate-400 mb-2">{page.url}</p>
                      <p className="text-xs text-slate-500">
                        Added {formatDate(page.created_at)}
                      </p>
                    </div>
                    <div className="flex items-center space-x-2">
                      <button
                        onClick={() => window.open(page.url, '_blank')}
                        className="text-blue-400 hover:text-blue-300 transition-colors"
                      >
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                        </svg>
                      </button>
                      <button
                        onClick={() => removePage(page.id)}
                        className="text-red-400 hover:text-red-300 transition-colors"
                      >
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                        </svg>
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {activeTab === 'annotations' && (
          <div>
            <h3 className="text-lg font-medium text-white mb-6">Project Annotations</h3>
            
            {annotations.length === 0 ? (
              <div className="text-center py-12 bg-slate-800 rounded-lg">
                <div className="w-16 h-16 bg-slate-700 rounded-full mx-auto mb-4 flex items-center justify-center">
                  <svg className="w-8 h-8 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                  </svg>
                </div>
                <h4 className="text-lg font-medium text-white mb-2">No annotations yet</h4>
                <p className="text-slate-400">
                  Install the crossie extension and start annotating pages in this project
                </p>
              </div>
            ) : (
              <div className="space-y-4">
                {annotations.map((annotation) => (
                  <div key={annotation.id} className="bg-slate-800 rounded-lg p-4">
                    <div className="flex items-start justify-between mb-3">
                      <div className="flex items-center space-x-2">
                        <span className="text-sm font-medium text-white">
                          {annotation.username}
                        </span>
                        <span className="text-xs text-slate-500">
                          {formatDate(annotation.created_at)}
                        </span>
                      </div>
                      <span className="text-xs bg-slate-700 text-slate-300 px-2 py-1 rounded">
                        {annotation.annotation_type}
                      </span>
                    </div>
                    
                    {annotation.highlighted_text && (
                      <div className="mb-3 p-3 bg-slate-700 rounded border-l-4 border-blue-500">
                        <p className="text-sm text-slate-300">"{annotation.highlighted_text}"</p>
                      </div>
                    )}
                    
                    <p className="text-slate-300 mb-3">{annotation.content}</p>
                    
                    <div className="flex items-center space-x-2 text-xs text-slate-500">
                      <span>{getDomainFromUrl(annotation.page_url || '')}</span>
                      <span>•</span>
                      <span>{annotation.page_title || 'Untitled Page'}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {activeTab === 'members' && (
          <div>
            <div className="flex items-center justify-between mb-6">
              <h3 className="text-lg font-medium text-white">Project Members</h3>
              <button
                onClick={() => setShowShareModal(true)}
                className="bg-green-600 hover:bg-green-500 text-white px-4 py-2 rounded-lg font-medium transition-colors"
              >
                Share Project
              </button>
            </div>

            <div className="space-y-4">
              {members.map((member) => (
                <div key={member.id} className="bg-slate-800 rounded-lg p-4 flex items-center justify-between">
                  <div>
                    <h4 className="text-white font-medium">{member.username}</h4>
                    <p className="text-sm text-slate-400">
                      {member.role} • Joined {formatDate(member.joined_at)}
                    </p>
                  </div>
                  <div className="flex items-center space-x-2">
                    <span className="text-xs bg-slate-700 text-slate-300 px-2 py-1 rounded capitalize">
                      {member.role}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </main>

      {/* Add Page Modal */}
      {showAddPageModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
          <div className="bg-slate-800 rounded-lg p-6 w-full max-w-md">
            <h3 className="text-lg font-semibold text-white mb-4">Add Page to Project</h3>
            
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-300 mb-2">
                  Page URL
                </label>
                <input
                  type="url"
                  value={newPageUrl}
                  onChange={(e) => setNewPageUrl(e.target.value)}
                  className="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="https://example.com"
                />
              </div>
            </div>

            <div className="flex items-center space-x-3 mt-6">
              <button
                onClick={addPage}
                disabled={!newPageUrl}
                className="flex-1 bg-blue-600 hover:bg-blue-500 disabled:bg-slate-600 disabled:text-slate-400 text-white py-2 px-4 rounded-lg font-medium transition-colors"
              >
                Add Page
              </button>
              <button
                onClick={() => setShowAddPageModal(false)}
                className="flex-1 bg-slate-700 hover:bg-slate-600 text-white py-2 px-4 rounded-lg font-medium transition-colors"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Add Member Modal */}
      {showAddMemberModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
          <div className="bg-slate-800 rounded-lg p-6 w-full max-w-md">
            <h3 className="text-lg font-semibold text-white mb-4">Add Team Member</h3>
            
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-300 mb-2">
                  Username
                </label>
                <input
                  type="text"
                  value={newMemberUsername}
                  onChange={(e) => setNewMemberUsername(e.target.value)}
                  className="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="Enter username"
                />
              </div>
            </div>

            <div className="flex items-center space-x-3 mt-6">
              <button
                onClick={addMember}
                disabled={!newMemberUsername}
                className="flex-1 bg-blue-600 hover:bg-blue-500 disabled:bg-slate-600 disabled:text-slate-400 text-white py-2 px-4 rounded-lg font-medium transition-colors"
              >
                Add Member
              </button>
              <button
                onClick={() => setShowAddMemberModal(false)}
                className="flex-1 bg-slate-700 hover:bg-slate-600 text-white py-2 px-4 rounded-lg font-medium transition-colors"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Share Project Modal */}
      {showShareModal && project && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
          <div className="bg-slate-800 rounded-lg p-6 w-full max-w-md">
            <h3 className="text-lg font-semibold text-white mb-4">
              Share Project: {project.name}
            </h3>
            <div className="space-y-4">
              <div className="bg-slate-700 p-3 rounded-lg">
                <div className="text-sm text-slate-300 mb-2">
                  <strong>Current sharing:</strong> Any member can share this project
                </div>
                <div className="text-xs text-slate-400">
                  Google Docs style - all members have sharing permissions
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-300 mb-2">
                  Email Address
                </label>
                <input
                  type="email"
                  value={shareEmail}
                  onChange={(e) => setShareEmail(e.target.value)}
                  className="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="person@example.com"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-300 mb-2">
                  Role
                </label>
                <select
                  value={shareRole}
                  onChange={(e) => setShareRole(e.target.value as 'member' | 'editor')}
                  className="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="member">Member - Can view and annotate</option>
                  <option value="editor">Editor - Can manage and share</option>
                </select>
              </div>
                             <div className="text-xs text-slate-400 bg-slate-700 p-3 rounded">
                 <strong>Note:</strong> The user will be added to the project immediately. 
                 Email notifications will be added in a future update.
               </div>
            </div>
            <div className="flex items-center space-x-3 mt-6">
              <button
                onClick={shareProject}
                disabled={!shareEmail.trim()}
                className="flex-1 bg-green-600 hover:bg-green-500 disabled:bg-slate-600 disabled:text-slate-400 text-white py-2 px-4 rounded-lg font-medium transition-colors"
              >
                Share Project
              </button>
              <button
                onClick={() => {
                  setShowShareModal(false);
                  setShareEmail('');
                  setShareRole('member');
                }}
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