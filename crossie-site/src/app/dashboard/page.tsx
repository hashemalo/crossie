'use client';

import { useState, useEffect } from 'react';
import { createClient } from '@supabase/supabase-js';
import { sendSignOutToExtension } from '../lib/supabase';

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
  page_count?: number;
  annotation_count?: number;
}

interface Page {
  id: string;
  url: string;
  title?: string;
  created_at: string;
}

interface User {
  id: string;
  username: string;
  email?: string;
}

export default function Dashboard() {
  const [user, setUser] = useState<User | null>(null);
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [newProject, setNewProject] = useState({
    name: '',
    description: '',
    is_team_project: false
  });

  // Add auth state listener
  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (event, session) => {
      if (event === 'SIGNED_OUT') {
        console.log('Dashboard: Auth state changed to SIGNED_OUT, notifying extension...')
        // Notify extension of sign out
        await sendSignOutToExtension()
        
        setUser(null);
        setProjects([]);
        setLoading(false);
      } else if (event === 'SIGNED_IN' && session?.user) {
        checkAuth();
      }
    });

    return () => subscription.unsubscribe();
  }, []);

  // Check authentication on mount
  useEffect(() => {
    checkAuth();
  }, []);

  const checkAuth = async () => {
    const { data: { session } } = await supabase.auth.getSession();
    if (session?.user) {
      // Fetch user profile
      const { data: profile } = await supabase
        .from('profiles')
        .select('id, username, email')
        .eq('id', session.user.id)
        .single();
      
      if (profile) {
        setUser(profile);
        fetchProjects(session.user.id);
      }
    } else {
      setLoading(false);
      // Redirect to home if not authenticated
      window.location.href = '/';
    }
  };

  const fetchProjects = async (userId: string) => {
    try {
      // First, get projects created by the user
      const { data: ownedProjects, error: ownedError } = await supabase
        .from("projects")
        .select(`
          id,
          name,
          description,
          is_team_project,
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
      const data = uniqueProjects.sort((a, b) => 
        new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
      );

      // Fetch page counts and annotation counts for each project
      const projectsWithCounts = await Promise.all(
        (data || []).map(async (project) => {
          // Get page count
          const { count: pageCount } = await supabase
            .from("project_pages")
            .select("*", { count: "exact", head: true })
            .eq("project_id", project.id);

          // Get annotation count across all pages in the project
          const { count: annotationCount } = await supabase
            .from("annotations")
            .select("*", { count: "exact", head: true })
            .eq("project_id", project.id);
          
          return {
            ...project,
            page_count: pageCount || 0,
            annotation_count: annotationCount || 0
          };
        })
      );

      setProjects(projectsWithCounts);
    } catch (error) {
      console.error('Error fetching projects:', error);
    } finally {
      setLoading(false);
    }
  };

  const createProject = async () => {
    if (!user || !newProject.name) return;

    try {
      const { data, error } = await supabase
        .from("projects")
        .insert({
          name: newProject.name,
          description: newProject.description,
          created_by: user.id,
          is_team_project: newProject.is_team_project
        })
        .select()
        .single();

      if (error) throw error;

      // Add user as project member
      await supabase
        .from("project_members")
        .insert({
          project_id: data.id,
          user_id: user.id,
          role: 'owner'
        });

      setProjects([{ ...data, page_count: 0, annotation_count: 0 }, ...projects]);
      setShowCreateModal(false);
      setNewProject({ name: '', description: '', is_team_project: false });
    } catch (error) {
      console.error('Error creating project:', error);
      alert('Failed to create project');
    }
  };

  const deleteProject = async (projectId: string) => {
    if (!confirm('Are you sure you want to delete this project? This will also delete all annotations.')) return;

    try {
      // Delete annotations first
      await supabase
        .from("annotations")
        .delete()
        .eq("project_id", projectId);

      // Delete project pages
      await supabase
        .from("project_pages")
        .delete()
        .eq("project_id", projectId);

      // Delete project members
      await supabase
        .from("project_members")
        .delete()
        .eq("project_id", projectId);

      // Delete project
      await supabase
        .from("projects")
        .delete()
        .eq("id", projectId);

      setProjects(projects.filter(p => p.id !== projectId));
    } catch (error) {
      console.error('Error deleting project:', error);
      alert('Failed to delete project');
    }
  };

  const getDomainFromUrl = (url: string) => {
    try {
      const domain = new URL(url).hostname;
      return domain.replace("www.", "");
    } catch {
      return url;
    }
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString("en-US", {
      year: "numeric",
      month: "short",
      day: "numeric"
    });
  };

  const handleSignOut = async () => {
    try {
      // Send sign out notification to extension before signing out
      await sendSignOutToExtension()
      
      await supabase.auth.signOut();
      // The auth state listener will handle the state updates
    } catch (error) {
      console.error('Error signing out:', error);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-900 flex items-center justify-center">
        <div className="animate-spin w-12 h-12 border-4 border-blue-400 border-t-transparent rounded-full"></div>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="min-h-screen bg-slate-900 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin w-12 h-12 border-4 border-blue-400 border-t-transparent rounded-full mx-auto mb-4"></div>
          <p className="text-white">Loading...</p>
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
            <div className="flex items-center">
              <a href="/" className="text-xl font-semibold text-blue-400 hover:text-blue-300 transition-colors">
                crossie
              </a>
            </div>
            <div className="flex items-center space-x-4">
              <span className="text-sm text-slate-400">
                Welcome, {user.username}
              </span>
              <button
                onClick={handleSignOut}
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
        <div className="flex items-center justify-between mb-8">
          <div>
            <h2 className="text-2xl font-bold text-white">Your Projects</h2>
            <p className="text-slate-400 mt-1">
              Manage your annotation projects across the web
            </p>
          </div>
          <button
            onClick={() => setShowCreateModal(true)}
            className="bg-blue-600 hover:bg-blue-500 text-white px-4 py-2 rounded-lg font-medium transition-colors"
          >
            Create Project
          </button>
        </div>

        {/* Projects Grid */}
        {projects.length === 0 ? (
          <div className="text-center py-12">
            <div className="w-16 h-16 bg-slate-700 rounded-full mx-auto mb-4 flex items-center justify-center">
              <svg className="w-8 h-8 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
              </svg>
            </div>
            <h3 className="text-lg font-medium text-white mb-2">No projects yet</h3>
            <p className="text-slate-400 mb-6">
              Create your first project to start annotating websites
            </p>
            <button
              onClick={() => setShowCreateModal(true)}
              className="bg-blue-600 hover:bg-blue-500 text-white px-6 py-2 rounded-lg font-medium transition-colors"
            >
              Create Your First Project
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {projects.map((project) => (
              <div
                key={project.id}
                className="bg-slate-800 border border-slate-700 rounded-lg p-6 hover:border-slate-600 transition-colors"
              >
                <div className="flex items-start justify-between mb-4">
                  <div className="flex-1 min-w-0">
                    <h3 className="text-lg font-semibold text-white truncate">
                      {project.name}
                    </h3>
                    <p className="text-sm text-slate-400 mt-1">
                      {project.description || 'No description'}
                    </p>
                  </div>
                  {project.is_team_project && (
                    <span className="text-xs bg-blue-600 text-white px-2 py-1 rounded-full">
                      Team
                    </span>
                  )}
                </div>

                <div className="flex items-center justify-between text-sm text-slate-400 mb-4">
                  <div className="flex items-center space-x-4">
                    <span>{project.page_count} pages</span>
                    <span>{project.annotation_count} annotations</span>
                  </div>
                  <span>{formatDate(project.created_at)}</span>
                </div>

                <div className="flex items-center space-x-2">
                  <button
                    onClick={() => window.open(`/project/${project.id}`, '_blank')}
                    className="flex-1 bg-slate-700 hover:bg-slate-600 text-white text-sm py-2 px-3 rounded transition-colors text-center"
                  >
                    View Project
                  </button>
                  <button
                    onClick={() => deleteProject(project.id)}
                    className="text-red-400 hover:text-red-300 transition-colors p-2"
                    title="Delete project"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                    </svg>
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </main>

      {/* Create Project Modal */}
      {showCreateModal && (
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
                  checked={newProject.is_team_project}
                  onChange={(e) => setNewProject({ ...newProject, is_team_project: e.target.checked })}
                  className="mr-2"
                />
                <label htmlFor="team-project" className="text-sm text-slate-300">
                  This is a team project
                </label>
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
                onClick={() => setShowCreateModal(false)}
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