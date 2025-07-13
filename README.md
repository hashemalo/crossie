
# Crossie - Web Annotation Extension

## Product Overview

**Crossie** is a Chrome browser extension that enables users to annotate and comment on any website. It provides a collaborative annotation system with a modern sidebar interface, allowing users to highlight text, add comments, and share annotations with others.

## Architecture

### Two-Component System

1. **Browser Extension** (`crossie/`) - The main Chrome extension
2. **Web Application** (`crossie-site/`) - Authentication and user management portal

## Browser Extension (`crossie/`)

### Core Features
- **Fixed Sidebar Interface**: 350px wide sidebar that slides in from the right side of any webpage
- **Text Highlighting**: Users can select text on any webpage and automatically create annotations
- **Real-time Collaboration**: Live updates using Supabase real-time subscriptions
- **Authentication Integration**: Seamless OAuth flow with Google via the web app

### Technical Stack
- **Frontend**: React 19 + TypeScript + Tailwind CSS
- **Build System**: Vite with custom extension build process
- **Database**: Supabase (PostgreSQL) with real-time subscriptions
- **Authentication**: Google OAuth via Supabase Auth

### Key Components

#### 1. Content Script (`src/inject.ts`)
- Injects a fixed sidebar iframe into every webpage
- Handles text selection detection and highlighting
- Manages sidebar toggle button (Apollo-style minimal design)
- Coordinates communication between webpage and extension

#### 2. Sidebar Interface (`src/frame/Crossie.tsx`)
- Main annotation interface with full-height layout
- Real-time annotation display with optimistic updates
- Text selection integration (auto-fills annotation input)
- User authentication state management

#### 3. Background Service (`src/background.js`)
- Chrome extension service worker
- Handles authentication state persistence
- Manages communication between content scripts and web app
- Token refresh and profile management

#### 4. Authentication Service (`src/shared/authService.ts`)
- Centralized auth state management
- Token storage and refresh logic
- Profile fetching and caching
- Cross-extension auth state synchronization

### Database Schema

The extension uses a modern annotation system with the following structure:

```typescript
interface Annotation {
  id: string;
  content: string;
  timestamp: Date;
  user: Profile;
  annotationType: 'text' | 'image' | 'area';
  highlightedText?: string;
  imageData?: string;
  coordinates?: { x: number; y: number; width: number; height: number };
}

interface Project {
  id: string;
  name: string;
  description?: string;
  url: string;
  isTeamProject: boolean;
  createdBy: string;
  createdAt: Date;
}
```

## Web Application (`crossie-site/`)

### Purpose
- **Authentication Portal**: Handles Google OAuth flow
- **User Onboarding**: Profile creation and management
- **Extension Integration**: Sends auth tokens to the browser extension

### Technical Stack
- **Framework**: Next.js 15 with App Router
- **Styling**: Tailwind CSS
- **Authentication**: Supabase Auth with Google OAuth
- **Deployment**: Vercel

### Key Features
- **OAuth Flow**: Google sign-in with automatic profile creation
- **Profile Management**: Username setup for new users
- **Extension Communication**: Secure token transmission to extension
- **Responsive Design**: Mobile-friendly authentication interface

## User Experience Flow

1. **Installation**: User installs the Chrome extension
2. **Authentication**: User clicks extension icon → redirected to web app for Google OAuth
3. **Profile Setup**: New users create a username profile
4. **Usage**: User visits any website and clicks the toggle button to open the annotation sidebar
5. **Annotation**: User selects text on the page → annotation input auto-fills with selected text
6. **Collaboration**: Real-time updates show other users' annotations
7. **Highlighting**: Annotated text remains visually highlighted on the page

## Key Features

### Text Selection Integration
- When sidebar is open, any text selection automatically populates the annotation input
- Selected text is highlighted with yellow background on the page
- Annotations are linked to specific text portions

### Real-time Collaboration
- Live updates via Supabase real-time subscriptions
- Optimistic UI updates for immediate feedback
- Conflict resolution for concurrent edits

### Modern UI/UX
- Smooth slide-in/out animations (300ms cubic-bezier transitions)
- Fixed sidebar layout (350px width, full viewport height)
- Minimal toggle button with hover effects
- Responsive design with proper flexbox layouts

### Authentication System
- Secure OAuth flow with Google
- Token management with automatic refresh
- Cross-extension state synchronization
- Profile-based user identification

## Development Setup

### Extension Development
```bash
cd crossie/
npm install
npm run dev          # Development mode
npm run build:extension  # Build for Chrome
```

### Web App Development
```bash
cd crossie-site/
npm install
npm run dev          # Development server
```

## Deployment

- **Extension**: Manual Chrome Web Store submission
- **Web App**: Vercel deployment with environment variables
- **Database**: Supabase hosted PostgreSQL with real-time enabled

## Security Features

- OAuth 2.0 with Google
- Secure token storage in Chrome extension storage
- Origin validation for external communication
- Automatic token refresh and validation

This architecture provides a seamless annotation experience across any website while maintaining security and real-time collaboration capabilities.