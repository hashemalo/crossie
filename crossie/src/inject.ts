// inject.ts - Pure content script without modules
(() => {
  // Create iframe element
  const iframe = document.createElement("iframe");

  const hostUrl = encodeURIComponent(window.location.href);
  iframe.src = chrome.runtime.getURL(`frame.html?host=${hostUrl}`);

  // Apply iframe styles for fixed sidebar layout
  Object.assign(iframe.style, {
    position: "fixed",
    top: "0px",
    right: "0px",
    width: "350px",
    height: "100vh",
    border: "none",
    borderLeft: "1px solid rgba(0, 0, 0, 0.1)",
    zIndex: "999999",
    backgroundColor: "transparent",
    transition: "transform 0.3s cubic-bezier(0.4, 0, 0.2, 1)",
    display: "none",
    boxShadow: "-4px 0 20px rgba(0, 0, 0, 0.15)",
    transform: "translateX(100%)", // Start off-screen
  });

  // Create toggle button (minimal, Apollo-style)
  const toggleButton = document.createElement("div");
  Object.assign(toggleButton.style, {
    position: "fixed",
    top: "5%",
    right: "0px",
    transform: "translateY(-50%)",
    width: "40px",
    height: "40px",
    backgroundColor: "rgba(30, 41, 59, 0.5)",
    border: "1px solid rgba(255, 255, 255, 0.6)",
    borderRight: "none",
    borderTopLeftRadius: "8px",
    borderBottomLeftRadius: "8px",
    zIndex: "999999",
    cursor: "pointer",
    alignItems: "center",
    justifyContent: "center",
    transition: "all 0.2s ease",
    display: "flex",
    flexDirection: "column",
    gap: "8px",
    padding: "8px 4px",
  });

  // Add icon to toggle button
  toggleButton.innerHTML = `
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2">
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
      <path d="M8 10h.01"/>
      <path d="M12 10h.01"/>
      <path d="M16 10h.01"/>
    </svg>
  `;

  // Button hover effects
  toggleButton.addEventListener("mouseenter", () => {
    toggleButton.style.backgroundColor = "rgba(30, 41, 59, 0.8)";
    toggleButton.style.transform = "translateY(-50%) scale(1.05)";
  });

  toggleButton.addEventListener("mouseleave", () => {
    toggleButton.style.backgroundColor = "rgba(30, 41, 59, 0.5)";
    toggleButton.style.transform = "translateY(-50%) scale(1)";
  });

  // Append elements to DOM
  document.body.appendChild(iframe);
  document.body.appendChild(toggleButton);

  // Track sidebar state
  let isSidebarOpen = false;

  // Sidebar visibility functions
  function closeSidebar() {
    isSidebarOpen = false;
    iframe.style.transform = "translateX(100%)";

    // Clear stored selection data when closing sidebar
    clearStoredSelection();

    // Notify iframe it's being closed
    iframe.contentWindow?.postMessage(
      {
        type: "CROSSIE_MINIMIZE",
      },
      "*"
    );

    setTimeout(() => {
      iframe.style.display = "none";
      toggleButton.style.display = "flex";
      
      // Ensure toggle button is visible and properly positioned
      setTimeout(() => {
        toggleButton.style.transform = "translateY(-50%)";
        toggleButton.style.opacity = "1";
      }, 50);
    }, 300);
  }

  function openSidebar() {
    isSidebarOpen = true;
    toggleButton.style.transform = "translateY(-50%) scale(0.9)";
    toggleButton.style.opacity = "0";

    setTimeout(() => {
      toggleButton.style.display = "none";
      iframe.style.display = "block";

      // Notify iframe it's being opened
      iframe.contentWindow?.postMessage(
        {
          type: "CROSSIE_SHOW",
        },
        "*"
      );

      // Trigger the slide-in animation
      requestAnimationFrame(() => {
        iframe.style.transform = "translateX(0)";
      });
    }, 200);
  }

  // Toggle function
  function toggleSidebar() {
    if (isSidebarOpen) {
      closeSidebar();
    } else {
      openSidebar();
    }
  }

  // Event listeners
  toggleButton.addEventListener("click", toggleSidebar);

  // Function to send auth state to iframe
  async function sendAuthToIframe() {
    // Request auth state from background
    chrome.runtime.sendMessage({ type: "GET_AUTH_STATE" }, (response) => {
      if (chrome.runtime.lastError) {
        console.error(
          "[Inject] Error getting auth state:",
          chrome.runtime.lastError
        );
        // Send empty auth state on error
        iframe.contentWindow?.postMessage(
          {
            type: "AUTH_STATE_UPDATE",
            payload: {
              authData: null,
              profile: null,
            },
          },
          "*"
        );
        return;
      }

      if (response && iframe.contentWindow) {
        iframe.contentWindow.postMessage(
          {
            type: "AUTH_STATE_UPDATE",
            payload: {
              authData: response.authData,
              profile: response.profile,
            },
          },
          "*"
        );
      }
    });
  }

  // Text selection and annotation functionality
  let currentSelection: { text: string; range: Range } | null = null;
  let storedSelectionData: any = null; // Store selection data persistently

  // =============================================
  // ENHANCED HIGHLIGHTING SYSTEM
  // =============================================

  /**
   * Robust highlighting system with proper state management,
   * batching, error recovery, and timing control
   */
  class HighlightManager {
    private currentHighlights: Map<string, Element> = new Map();
    private pendingOperations: Set<string> = new Set();
    private operationQueue: Array<() => Promise<void>> = [];
    private isProcessing = false;
    private retryAttempts: Map<string, number> = new Map();
    private maxRetries = 3;
    private domObserver: MutationObserver | null = null;

    constructor() {
      this.initializeDOMObserver();
    }

    /**
     * Initialize DOM observer to detect changes that might affect highlights
     */
    private initializeDOMObserver() {
      this.domObserver = new MutationObserver((mutations) => {
        let needsRefresh = false;
        
        mutations.forEach((mutation) => {
          // Check if any highlighted elements were removed
          if (mutation.type === 'childList') {
            mutation.removedNodes.forEach((node) => {
              if (node.nodeType === Node.ELEMENT_NODE) {
                const element = node as Element;
                if (element.classList?.contains('crossie-highlight') || 
                    element.querySelector?.('.crossie-highlight')) {
                  needsRefresh = true;
                }
              }
            });
          }
        });

        if (needsRefresh) {
          console.log('[HighlightManager] DOM changes detected, refreshing highlights');
          this.refreshAllHighlights();
        }
      });

      this.domObserver.observe(document.body, {
        childList: true,
        subtree: true
      });
    }

    /**
     * Queue a highlighting operation for batched processing
     */
    private queueOperation(operation: () => Promise<void>) {
      this.operationQueue.push(operation);
      this.processQueue();
    }

    /**
     * Process queued operations with proper timing and error handling
     */
    private async processQueue() {
      if (this.isProcessing || this.operationQueue.length === 0) {
        return;
      }

      this.isProcessing = true;

      try {
        // Wait for DOM to be ready
        await this.waitForDOMReady();

        // Process all queued operations
        while (this.operationQueue.length > 0) {
          const operation = this.operationQueue.shift();
          if (operation) {
            try {
              await operation();
              // Small delay between operations to prevent race conditions
              await this.delay(10);
            } catch (error) {
              console.error('[HighlightManager] Operation failed:', error);
            }
          }
        }
      } finally {
        this.isProcessing = false;
      }
    }

    /**
     * Wait for DOM to be ready for highlighting operations
     */
    private waitForDOMReady(): Promise<void> {
      return new Promise((resolve) => {
        if (document.readyState === 'complete') {
          resolve();
        } else {
          const handleReady = () => {
            document.removeEventListener('readystatechange', handleReady);
            resolve();
          };
          document.addEventListener('readystatechange', handleReady);
        }
      });
    }

    /**
     * Simple delay utility
     */
    private delay(ms: number): Promise<void> {
      return new Promise(resolve => setTimeout(resolve, ms));
    }

    /**
     * Update highlights for multiple annotations (batched operation)
     */
    async updateHighlights(highlights: Array<{id: string, text: string, selectionData?: any}>) {
      console.log(`[HighlightManager] Updating ${highlights.length} highlights`);

      // Create a batch operation
      const batchOperation = async () => {
        // First pass: identify what needs to be changed
        const toAdd = new Set<string>();
        const toRemove = new Set<string>();
        const toUpdate = new Set<string>();

        // Check what's currently highlighted vs what should be highlighted
        const targetIds = new Set(highlights.map(h => h.id));
        
        // Find highlights to remove (currently highlighted but not in new set)
        for (const [id, element] of this.currentHighlights) {
          if (!targetIds.has(id)) {
            toRemove.add(id);
          }
        }

        // Find highlights to add or update
        for (const highlight of highlights) {
          if (!this.currentHighlights.has(highlight.id)) {
            toAdd.add(highlight.id);
          } else {
            // Check if the highlight needs updating
            const currentElement = this.currentHighlights.get(highlight.id);
            if (currentElement && !this.isTextMatch(currentElement.textContent || '', highlight.text)) {
              toUpdate.add(highlight.id);
            }
          }
        }

        console.log(`[HighlightManager] Batch: ${toAdd.size} to add, ${toUpdate.size} to update, ${toRemove.size} to remove`);

        // Remove obsolete highlights
        for (const id of toRemove) {
          await this.removeHighlight(id);
        }

        // Add new highlights
        for (const highlight of highlights) {
          if (toAdd.has(highlight.id) || toUpdate.has(highlight.id)) {
            if (toUpdate.has(highlight.id)) {
              await this.removeHighlight(highlight.id);
            }
            await this.addHighlight(highlight.id, highlight.text, highlight.selectionData);
          }
        }
      };

      this.queueOperation(batchOperation);
    }

    /**
     * Add a single highlight with retry mechanism
     */
    private async addHighlight(id: string, text: string, selectionData?: any): Promise<boolean> {
      if (this.pendingOperations.has(id)) {
        console.log(`[HighlightManager] Skipping ${id} - already pending`);
        return false;
      }

      this.pendingOperations.add(id);
      
      try {
        const success = await this.performHighlight(id, text, selectionData);
        
        if (!success) {
          // Retry logic
          const retries = this.retryAttempts.get(id) || 0;
          if (retries < this.maxRetries) {
            this.retryAttempts.set(id, retries + 1);
            console.log(`[HighlightManager] Retrying ${id} (attempt ${retries + 1})`);
            
            // Wait before retry
            await this.delay(100 * (retries + 1));
            return this.addHighlight(id, text, selectionData);
          } else {
            console.error(`[HighlightManager] Failed to highlight ${id} after ${this.maxRetries} attempts`);
            this.retryAttempts.delete(id);
          }
        } else {
          // Success - clear retry counter
          this.retryAttempts.delete(id);
        }

        return success;
      } finally {
        this.pendingOperations.delete(id);
      }
    }

    /**
     * Remove a highlight
     */
    private async removeHighlight(id: string): Promise<void> {
      const element = this.currentHighlights.get(id);
      if (element && element.parentNode) {
        // Replace highlighted element with its text content
        const textNode = document.createTextNode(element.textContent || '');
        element.parentNode.replaceChild(textNode, element);
        
        // Normalize the parent to merge adjacent text nodes
        element.parentNode.normalize();
        
        this.currentHighlights.delete(id);
        console.log(`[HighlightManager] Removed highlight ${id}`);
      }
    }

    /**
     * Perform the actual highlighting operation
     */
    private async performHighlight(id: string, text: string, selectionData?: any): Promise<boolean> {
      try {
        // Strategy 1: Use W3C-style selectors if available
        if (selectionData?.selectors && selectionData.selectors.length > 0) {
          const range = this.resolveSelectorsToRange(selectionData.selectors, selectionData.parentSelector);
          if (range) {
            const rangeText = range.toString();
            if (this.isTextMatch(rangeText, text)) {
              const element = this.highlightRange(range, id);
              if (element) {
                this.currentHighlights.set(id, element);
                console.log(`[HighlightManager] Successfully highlighted ${id} using selectors`);
                return true;
              }
            }
          }
        }

        // Strategy 2: Use node paths
        if (selectionData?.startNodePath && selectionData?.endNodePath) {
          const success = this.highlightUsingNodePaths(id, text, selectionData);
          if (success) {
            console.log(`[HighlightManager] Successfully highlighted ${id} using node paths`);
            return true;
          }
        }

        // Strategy 3: Context-based highlighting
        if (selectionData?.parentSelector) {
          const parent = document.querySelector(selectionData.parentSelector);
          if (parent) {
            const success = this.highlightInElement(parent, id, text, selectionData);
            if (success) {
              console.log(`[HighlightManager] Successfully highlighted ${id} using parent context`);
              return true;
            }
          }
        }

        // Strategy 4: Document-wide search (last resort)
        const success = this.highlightInDocument(id, text);
        if (success) {
          console.log(`[HighlightManager] Successfully highlighted ${id} using document search`);
          return true;
        }

        console.warn(`[HighlightManager] Failed to highlight ${id}: "${text}"`);
        return false;

      } catch (error) {
        console.error(`[HighlightManager] Error highlighting ${id}:`, error);
        return false;
      }
    }

    /**
     * Scroll to a specific highlight with enhanced visual feedback
     */
    async scrollToHighlight(id: string, selectionData?: any): Promise<boolean> {
      // First try to find existing highlight
      const existingElement = this.currentHighlights.get(id);
      if (existingElement) {
        this.scrollToElement(existingElement);
        return true;
      }

      // If not found, try to re-highlight first
      if (selectionData) {
        const text = selectionData.selectedText || '';
        const success = await this.addHighlight(id, text, selectionData);
        if (success) {
          const element = this.currentHighlights.get(id);
          if (element) {
            this.scrollToElement(element);
            return true;
          }
        }
      }

      // Last resort: try to find by text content
      const allHighlights = document.querySelectorAll('.crossie-highlight');
      const targetText = this.normalizeText(selectionData?.selectedText || '');
      
      for (const highlight of allHighlights) {
        const highlightText = this.normalizeText(highlight.textContent || '');
        if (this.isTextMatch(highlightText, targetText)) {
          this.scrollToElement(highlight);
          return true;
        }
      }

      console.warn(`[HighlightManager] Could not scroll to highlight ${id}`);
      return false;
    }

    /**
     * Clear all highlights
     */
    clearAllHighlights(): void {
      const existingHighlights = document.querySelectorAll('.crossie-highlight');
      existingHighlights.forEach(highlight => {
        const parent = highlight.parentNode;
        if (parent) {
          parent.replaceChild(document.createTextNode(highlight.textContent || ''), highlight);
          parent.normalize();
        }
      });
      
      this.currentHighlights.clear();
      this.retryAttempts.clear();
      console.log('[HighlightManager] Cleared all highlights');
    }

    /**
     * Refresh all current highlights (useful after DOM changes)
     */
    private async refreshAllHighlights(): Promise<void> {
      const currentHighlightData: Array<{id: string, text: string, selectionData?: any}> = [];
      
      // Collect current highlight data before clearing
      for (const [id, element] of this.currentHighlights) {
        currentHighlightData.push({
          id,
          text: element.textContent || '',
          // Note: We don't have selectionData here, but the system should still work
        });
      }

      // Clear and re-highlight
      this.clearAllHighlights();
      
      if (currentHighlightData.length > 0) {
        console.log(`[HighlightManager] Refreshing ${currentHighlightData.length} highlights`);
        await this.updateHighlights(currentHighlightData);
      }
    }

    // Utility methods (keeping the existing ones with improvements)
    
    private normalizeText(text: string): string {
      if (!text) return '';
      return text.normalize('NFC').trim().replace(/\s+/g, ' ');
    }

    private isTextMatch(text1: string, text2: string): boolean {
      if (!text1 || !text2) return false;
      
      const normalized1 = this.normalizeText(text1);
      const normalized2 = this.normalizeText(text2);
      
      return normalized1 === normalized2;
    }

    private scrollToElement(element: Element): void {
      element.scrollIntoView({ 
        behavior: 'smooth', 
        block: 'center',
        inline: 'nearest'
      });
      
      // Enhanced visual feedback
      if (element instanceof HTMLElement) {
        const originalStyle = {
          boxShadow: element.style.boxShadow,
          transform: element.style.transform,
          transition: element.style.transition
        };
        
        element.style.transition = 'all 0.3s ease';
        element.style.boxShadow = '0 0 15px rgba(59, 130, 246, 0.8), 0 0 30px rgba(59, 130, 246, 0.4)';
        element.style.transform = 'scale(1.05)';
        
        setTimeout(() => {
          element.style.transition = 'all 0.3s ease';
          element.style.boxShadow = originalStyle.boxShadow;
          element.style.transform = originalStyle.transform;
          
          setTimeout(() => {
            element.style.transition = originalStyle.transition;
          }, 300);
        }, 2000);
      }
    }

    private highlightRange(range: Range, id: string): Element | null {
      try {
        if (range.collapsed) return null;
        
        const contents = range.extractContents();
        const span = document.createElement('span');
        span.style.backgroundColor = 'rgba(254, 240, 138, 0.4)'; // More transparent yellow
        span.style.color = 'inherit'; // Preserve original text color
        span.style.borderRadius = '2px';
        span.style.padding = '1px 2px';
        span.style.border = '1px solid rgba(254, 240, 138, 0.6)';
        span.className = 'crossie-highlight';
        span.dataset.highlightId = id;
        span.appendChild(contents);
        
        range.insertNode(span);
        return span;
      } catch (error) {
        console.error('[HighlightManager] Error highlighting range:', error);
        return null;
      }
    }

    private highlightUsingNodePaths(id: string, text: string, selectionData: any): boolean {
      try {
        const startNode = this.restoreTextNodeFromPath(selectionData.startNodePath);
        const endNode = this.restoreTextNodeFromPath(selectionData.endNodePath);
        
        if (startNode && endNode && startNode.nodeType === Node.TEXT_NODE && endNode.nodeType === Node.TEXT_NODE) {
          const startOffset = selectionData.startOffset || 0;
          const endOffset = selectionData.endOffset || 0;
          
          if (startNode === endNode) {
            // Single text node selection
            const nodeText = startNode.textContent || '';
            const selectedText = nodeText.substring(startOffset, endOffset);
            
            if (this.isTextMatch(selectedText, text)) {
              const element = this.wrapInHighlight(startNode as Text, startOffset, endOffset - startOffset, id);
              if (element) {
                this.currentHighlights.set(id, element);
                return true;
              }
            }
          }
        }
      } catch (error) {
        console.error('[HighlightManager] Error highlighting using node paths:', error);
      }
      return false;
    }

    private highlightInElement(element: Element, id: string, text: string, selectionData?: any): boolean {
      try {
        const walker = document.createTreeWalker(
          element,
          NodeFilter.SHOW_TEXT,
          null
        );
        
        let node;
        while (node = walker.nextNode()) {
          const nodeText = node.textContent || '';
          const index = this.findTextInNode(nodeText, text);
          
          if (index !== -1) {
            // Verify with context if available
            if (selectionData?.precedingText || selectionData?.followingText) {
              const before = nodeText.substring(Math.max(0, index - 50), index);
              const after = nodeText.substring(index + text.length, index + text.length + 50);
              
              const precedingMatch = !selectionData.precedingText || this.isTextMatch(before, selectionData.precedingText.slice(-50));
              const followingMatch = !selectionData.followingText || this.isTextMatch(after, selectionData.followingText.slice(0, 50));
              
              if (precedingMatch && followingMatch) {
                const highlightElement = this.wrapInHighlight(node as Text, index, text.length, id);
                if (highlightElement) {
                  this.currentHighlights.set(id, highlightElement);
                  return true;
                }
              }
            } else {
              // No context, just highlight
              const highlightElement = this.wrapInHighlight(node as Text, index, text.length, id);
              if (highlightElement) {
                this.currentHighlights.set(id, highlightElement);
                return true;
              }
            }
          }
        }
      } catch (error) {
        console.error('[HighlightManager] Error highlighting in element:', error);
      }
      return false;
    }

    private highlightInDocument(id: string, text: string): boolean {
      try {
        const walker = document.createTreeWalker(
          document.body,
          NodeFilter.SHOW_TEXT,
          null
        );

        let node;
        while (node = walker.nextNode()) {
          const nodeText = node.textContent || '';
          const index = this.findTextInNode(nodeText, text);
          
          if (index !== -1) {
            const highlightElement = this.wrapInHighlight(node as Text, index, text.length, id);
            if (highlightElement) {
              this.currentHighlights.set(id, highlightElement);
              return true;
            }
          }
        }
      } catch (error) {
        console.error('[HighlightManager] Error highlighting in document:', error);
      }
      return false;
    }

    private resolveSelectorsToRange(selectors: any[], parentSelector?: string): Range | null {
      let rootElement: Element | null = null;
      
      if (parentSelector) {
        rootElement = document.querySelector(parentSelector);
      }
      
      // Try selectors in order of reliability
      for (const selector of selectors) {
        let range: Range | null = null;
        
        try {
          switch (selector.type) {
            case 'TextQuoteSelector':
              range = this.resolveTextQuoteSelector(selector, rootElement || undefined);
              break;
            case 'TextPositionSelector':
              range = this.resolveTextPositionSelector(selector, rootElement || undefined);
              break;
            case 'RangeSelector':
              range = this.resolveRangeSelector(selector);
              break;
            case 'XPathSelector':
              const element = this.resolveXPath(selector.value);
              if (element) {
                const textQuoteSelector = selectors.find(s => s.type === 'TextQuoteSelector');
                if (textQuoteSelector) {
                  range = this.resolveTextQuoteSelector(textQuoteSelector, element);
                }
              }
              break;
            case 'CSSSelector':
              const cssElement = document.querySelector(selector.value);
              if (cssElement) {
                const textQuoteSelector = selectors.find(s => s.type === 'TextQuoteSelector');
                if (textQuoteSelector) {
                  range = this.resolveTextQuoteSelector(textQuoteSelector, cssElement as Element);
                }
              }
              break;
          }
          
          if (range) {
            return range;
          }
        } catch (error) {
          console.error(`[HighlightManager] Error resolving ${selector.type}:`, error);
        }
      }
      
      return null;
    }

    // Additional helper methods needed by the main methods
    private restoreTextNodeFromPath(path: string): Node | null {
      if (!path) return null;
      
      const parts = path.split('/');
      let current: Node | null = document.body;
      
      for (const part of parts) {
        if (!current) return null;
        
        if (part.startsWith('text[') && part.endsWith(']')) {
          const index = parseInt(part.substring(5, part.length - 1));
          const textNodes: Node[] = Array.from(current.childNodes).filter(n => n.nodeType === Node.TEXT_NODE);
          current = textNodes[index] || null;
        } else {
          let selector = part;
          let elementIndex = 0;
          
          const indexMatch = selector.match(/\[(\d+)\]$/);
          if (indexMatch) {
            elementIndex = parseInt(indexMatch[1]);
            selector = selector.replace(/\[\d+\]$/, '');
          }
          
          if (selector.includes('#')) {
            const id = selector.split('#')[1];
            current = document.getElementById(id);
          } else if (selector.includes('.')) {
            if (current.nodeType === Node.ELEMENT_NODE) {
              const elements: Element[] = Array.from((current as Element).querySelectorAll(selector));
              current = elements[elementIndex] || null;
            } else {
              current = null;
            }
          } else {
            if (current.nodeType === Node.ELEMENT_NODE) {
              const elements: Element[] = Array.from((current as Element).children).filter(
                (el: Element) => el.nodeName.toLowerCase() === selector
              );
              current = elements[elementIndex] || null;
            } else {
              current = null;
            }
          }
        }
      }
      
      return current;
    }

    private wrapInHighlight(textNode: Text, start: number, length: number, id: string): Element | null {
      try {
        const text = textNode.textContent || '';
        const before = text.substring(0, start);
        const highlighted = text.substring(start, start + length);
        const after = text.substring(start + length);
        
        const span = document.createElement('span');
        span.style.backgroundColor = 'rgba(254, 240, 138, 0.4)'; // More transparent yellow
        span.style.color = 'inherit'; // Preserve original text color
        span.style.borderRadius = '2px';
        span.style.padding = '1px 2px';
        span.style.border = '1px solid rgba(254, 240, 138, 0.6)';
        span.className = 'crossie-highlight';
        span.dataset.highlightId = id;
        span.textContent = highlighted;
        
        const parent = textNode.parentNode;
        if (parent) {
          parent.insertBefore(document.createTextNode(before), textNode);
          parent.insertBefore(span, textNode);
          parent.insertBefore(document.createTextNode(after), textNode);
          parent.removeChild(textNode);
          return span;
        }
      } catch (error) {
        console.error('[HighlightManager] Error wrapping in highlight:', error);
      }
      return null;
    }

    private findTextInNode(nodeText: string, searchText: string): number {
      if (!nodeText || !searchText) return -1;
      
      const normalizedNodeText = this.normalizeText(nodeText);
      const normalizedSearchText = this.normalizeText(searchText);
      
      // Try direct match first
      let index = normalizedNodeText.indexOf(normalizedSearchText);
      if (index !== -1) return index;
      
      // Try with different whitespace normalization
      const whitespaceNormalizedNode = normalizedNodeText.replace(/\s+/g, ' ');
      const whitespaceNormalizedSearch = normalizedSearchText.replace(/\s+/g, ' ');
      
      index = whitespaceNormalizedNode.indexOf(whitespaceNormalizedSearch);
      if (index !== -1) {
        // Map back to original text position
        return nodeText.indexOf(searchText.charAt(0));
      }
      
      return -1;
    }

    private resolveTextQuoteSelector(selector: any, rootElement?: Element): Range | null {
      const root = rootElement || document.body;
      const exact = this.normalizeText(selector.exact);
      const prefix = selector.prefix ? this.normalizeText(selector.prefix) : '';
      const suffix = selector.suffix ? this.normalizeText(selector.suffix) : '';
      
      const walker = document.createTreeWalker(
        root,
        NodeFilter.SHOW_TEXT,
        null
      );
      
      let node;
      while (node = walker.nextNode()) {
        const textContent = node.textContent || '';
        const normalizedTextContent = this.normalizeText(textContent);
        
        const exactIndex = this.findTextInNode(textContent, selector.exact);
        
        if (exactIndex !== -1) {
          let prefixMatch = true;
          let suffixMatch = true;
          
          if (prefix) {
            const beforeText = normalizedTextContent.substring(Math.max(0, exactIndex - prefix.length), exactIndex);
            prefixMatch = this.normalizeText(beforeText).endsWith(prefix);
          }
          
          if (suffix) {
            const afterText = normalizedTextContent.substring(exactIndex + exact.length, exactIndex + exact.length + suffix.length);
            suffixMatch = this.normalizeText(afterText).startsWith(suffix);
          }
          
          if (prefixMatch && suffixMatch) {
            const range = document.createRange();
            range.setStart(node, exactIndex);
            range.setEnd(node, exactIndex + selector.exact.length);
            
            const rangeText = range.toString();
            if (this.isTextMatch(rangeText, selector.exact)) {
              return range;
            }
          }
        }
      }
      
      return null;
    }

    private resolveTextPositionSelector(selector: any, rootElement?: Element): Range | null {
      const root = rootElement || document.body;
      const start = selector.start;
      const end = selector.end;
      
      const textContent = root.textContent || '';
      const normalizedTextContent = this.normalizeText(textContent);
      
      if (start < 0 || end > normalizedTextContent.length || start >= end) {
        return null;
      }
      
      const walker = document.createTreeWalker(
        root,
        NodeFilter.SHOW_TEXT,
        null
      );
      
      let currentOffset = 0;
      let startNode: Node | null = null;
      let endNode: Node | null = null;
      let startOffset = 0;
      let endOffset = 0;
      
      let node;
      while (node = walker.nextNode()) {
        const nodeText = node.textContent || '';
        const normalizedNodeText = this.normalizeText(nodeText);
        const nodeLength = normalizedNodeText.length;
        
        if (startNode === null && currentOffset + nodeLength > start) {
          startNode = node;
          startOffset = start - currentOffset;
        }
        
        if (endNode === null && currentOffset + nodeLength >= end) {
          endNode = node;
          endOffset = end - currentOffset;
          break;
        }
        
        currentOffset += nodeLength;
      }
      
      if (startNode && endNode) {
        const range = document.createRange();
        range.setStart(startNode, startOffset);
        range.setEnd(endNode, endOffset);
        
        const rangeText = range.toString();
        const expectedText = normalizedTextContent.substring(start, end);
        
        if (this.isTextMatch(rangeText, expectedText)) {
          return range;
        }
      }
      
      return null;
    }

    private resolveRangeSelector(selector: any): Range | null {
      try {
        const startContainer = document.evaluate(selector.startContainer, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue;
        const endContainer = document.evaluate(selector.endContainer, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue;
        
        if (startContainer && endContainer) {
          const range = document.createRange();
          range.setStart(startContainer, selector.startOffset);
          range.setEnd(endContainer, selector.endOffset);
          return range;
        }
      } catch (e) {
        // XPath resolution failed
      }
      
      return null;
    }

    private resolveXPath(xpath: string): Element | null {
      try {
        const result = document.evaluate(xpath, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null);
        return result.singleNodeValue as Element;
      } catch (e) {
        return null;
      }
    }

    /**
     * Cleanup method
     */
    destroy(): void {
      if (this.domObserver) {
        this.domObserver.disconnect();
        this.domObserver = null;
      }
      this.clearAllHighlights();
      this.operationQueue = [];
      this.pendingOperations.clear();
      this.retryAttempts.clear();
    }
  }

  // Create global highlight manager instance
  const highlightManager = new HighlightManager();

  // Simple hash function that can handle Unicode characters
  function simpleHash(str: string): string {
    let hash = 0;
    if (str.length === 0) return hash.toString(16);
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32-bit integer
    }
    return Math.abs(hash).toString(16).substring(0, 8);
  }

  // Function to generate a CSS selector for an element
  function generateSelector(element: Element): string {
    const path = [];
    while (element && element.nodeType === Node.ELEMENT_NODE) {
      let selector = element.nodeName.toLowerCase();
      if (element.id) {
        selector += '#' + element.id;
        path.unshift(selector);
        break;
      } else if (element.className) {
        selector += '.' + element.className.split(' ').join('.');
      }
      path.unshift(selector);
      element = element.parentElement as Element;
    }
    return path.join(' > ');
  }

  // Function to create a unique path to a text node
  function getTextNodePath(textNode: Node): string {
    let path = '';
    let current: Node | null = textNode;
    
    while (current && current !== document.body) {
      if (current.nodeType === Node.TEXT_NODE) {
        // Find the index of this text node among its siblings
        const parent = current.parentNode;
        if (parent) {
          const textNodes = Array.from(parent.childNodes).filter(n => n.nodeType === Node.TEXT_NODE);
          const index = textNodes.indexOf(current as ChildNode);
          path = `text[${index}]` + (path ? '/' + path : '');
        }
        current = current.parentNode;
      } else if (current.nodeType === Node.ELEMENT_NODE) {
        const element = current as Element;
        let selector = element.nodeName.toLowerCase();
        
        if (element.id) {
          selector += '#' + element.id;
          path = selector + (path ? '/' + path : '');
          break;
        } else if (element.className) {
          selector += '.' + element.className.split(' ').join('.');
        }
        
        // Add sibling index if there are multiple elements with the same tag
        const siblings = Array.from(element.parentNode?.children || []).filter(
          el => el.nodeName === element.nodeName
        );
        if (siblings.length > 1) {
          const index = siblings.indexOf(element);
          selector += `[${index}]`;
        }
        
        path = selector + (path ? '/' + path : '');
        current = current.parentNode;
      } else {
        current = current.parentNode;
      }
    }
    
    return path;
  }

  // Function to generate XPath for an element
  function getXPath(element: Element): string {
    if (element.id) {
      return `//*[@id="${element.id}"]`;
    }
    
    const parts: string[] = [];
    let current: Element | null = element;
    
    while (current && current.nodeType === Node.ELEMENT_NODE) {
      let index = 0;
      let sibling = current.previousSibling;
      
      while (sibling) {
        if (sibling.nodeType === Node.ELEMENT_NODE && sibling.nodeName === current.nodeName) {
          index++;
        }
        sibling = sibling.previousSibling;
      }
      
      const tagName = current.nodeName.toLowerCase();
      const part = index > 0 ? `${tagName}[${index + 1}]` : tagName;
      parts.unshift(part);
      current = current.parentElement;
    }
    
    return '/' + parts.join('/');
  }

  // Function to generate W3C-style TextQuoteSelector with Unicode support
  function generateTextQuoteSelector(selectedText: string, parentElement: Element): any {
    const normalizedSelectedText = normalizeText(selectedText);
    const fullText = parentElement.textContent || '';
    const normalizedFullText = normalizeText(fullText);
    
    const startIndex = normalizedFullText.indexOf(normalizedSelectedText);
    
    if (startIndex === -1) {
      return null;
    }
    
    const contextLength = 32;
    const prefix = startIndex > 0 ? normalizedFullText.substring(Math.max(0, startIndex - contextLength), startIndex) : '';
    const suffix = normalizedFullText.substring(startIndex + normalizedSelectedText.length, Math.min(normalizedFullText.length, startIndex + normalizedSelectedText.length + contextLength));

    
    return {
      type: "TextQuoteSelector",
      exact: normalizedSelectedText,
      prefix: prefix || undefined,
      suffix: suffix || undefined
    };
  }

  // Function to generate TextPositionSelector with Unicode support
  function generateTextPositionSelector(selectedText: string, parentElement: Element): any {
    const normalizedSelectedText = normalizeText(selectedText);
    const fullText = parentElement.textContent || '';
    const normalizedFullText = normalizeText(fullText);
    
    const startIndex = normalizedFullText.indexOf(normalizedSelectedText);
    
    if (startIndex === -1) return null;
    
    return {
      type: "TextPositionSelector",
      start: startIndex,
      end: startIndex + normalizedSelectedText.length
    };
  }

  // Function to generate RangeSelector
  function generateRangeSelector(range: Range): any {
    const startContainer = range.startContainer;
    const endContainer = range.endContainer;
    
    // Generate XPath for container elements
    const startContainerPath = startContainer.nodeType === Node.TEXT_NODE 
      ? getXPath(startContainer.parentElement!) + '/text()[' + (Array.from(startContainer.parentNode!.childNodes).filter(n => n.nodeType === Node.TEXT_NODE).indexOf(startContainer as ChildNode) + 1) + ']'
      : getXPath(startContainer as Element);
    
    const endContainerPath = endContainer.nodeType === Node.TEXT_NODE
      ? getXPath(endContainer.parentElement!) + '/text()[' + (Array.from(endContainer.parentNode!.childNodes).filter(n => n.nodeType === Node.TEXT_NODE).indexOf(endContainer as ChildNode) + 1) + ']'
      : getXPath(endContainer as Element);
    
    return {
      type: "RangeSelector",
      startContainer: startContainerPath,
      startOffset: range.startOffset,
      endContainer: endContainerPath,
      endOffset: range.endOffset
    };
  }

  // Enhanced text selection capture with W3C-style selectors and Unicode support
  function captureEnhancedSelection() {
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0) return null; // Don't return stored data if no selection
    
    const range = selection.getRangeAt(0);
    const selectedText = selection.toString();
    const normalizedSelectedText = normalizeText(selectedText);
    
    if (!normalizedSelectedText) return null; // Don't return stored data if no text selected
    
    
    // Get the exact start and end nodes and offsets
    const startNode = range.startContainer;
    const endNode = range.endContainer;
    const startOffset = range.startOffset;
    const endOffset = range.endOffset;
    
    // Generate paths to the text nodes
    const startNodePath = getTextNodePath(startNode);
    const endNodePath = getTextNodePath(endNode);
    
    // Get parent element for context
    const parentElement = range.commonAncestorContainer.nodeType === Node.TEXT_NODE
      ? range.commonAncestorContainer.parentElement
      : range.commonAncestorContainer as Element;
    
    if (!parentElement) return null; // Don't return stored data if no parent
    
    const parentSelector = generateSelector(parentElement);
    
    // Get surrounding context for verification
    const fullText = parentElement.textContent || '';
    const normalizedFullText = normalizeText(fullText);
    const selectionStart = normalizedFullText.indexOf(normalizedSelectedText);

    // Generate W3C-style selectors
    const selectors = [];
    
    // 1. TextQuoteSelector (most reliable for content-based matching)
    const textQuoteSelector = generateTextQuoteSelector(selectedText, parentElement);
    if (textQuoteSelector) selectors.push(textQuoteSelector);
    
    // 2. TextPositionSelector (for position-based matching)
    const textPositionSelector = generateTextPositionSelector(selectedText, parentElement);
    if (textPositionSelector) selectors.push(textPositionSelector);
    
    // 3. RangeSelector (for precise DOM range matching)
    const rangeSelector = generateRangeSelector(range);
    if (rangeSelector) selectors.push(rangeSelector);
    
    // 4. XPathSelector (for structural matching)
    const xpathSelector = {
      type: "XPathSelector",
      value: getXPath(parentElement)
    };
    selectors.push(xpathSelector);
    
    // 5. CSSSelector (for CSS-based matching)
    const cssSelector = {
      type: "CSSSelector",
      value: parentSelector
    };
    selectors.push(cssSelector);
    
    // Create a comprehensive selection fingerprint
    const selectionData = {
      selectedText: normalizedSelectedText, // Store normalized version
      selectors,
      // Enhanced fields for precise text location
       startNodePath,
       endNodePath,
       startOffset,
       endOffset,
       parentSelector,
      // Context for verification (normalized)
      precedingText: selectionStart > 0 ? normalizedFullText.substring(Math.max(0, selectionStart - 50), selectionStart) : '',
      followingText: normalizedFullText.substring(selectionStart + normalizedSelectedText.length, selectionStart + normalizedSelectedText.length + 50),
       // Store the exact range boundaries
       rangeStartOffset: startOffset,
       rangeEndOffset: endOffset,
       // Store parent element text content hash for verification
      parentTextHash: simpleHash(normalizedFullText),
      // Additional context
      textContent: normalizedFullText,
      documentUrl: window.location.href,
      timestamp: Date.now()
    };

    
    // Store the selection data
    storedSelectionData = selectionData;
    return selectionData;
  }

  // Handle text selection when iframe is open
  function handleTextSelection() {
    if (!isSidebarOpen) return; // Only handle selection when sidebar is open

    const selectionData = captureEnhancedSelection();
    if (!selectionData) return;

    // Send enhanced selection data to iframe
    iframe.contentWindow?.postMessage(
      {
        type: "TEXT_SELECTION",
        payload: selectionData,
      },
      "*"
    );
  }

  // (OLD FUNCTIONS REMOVED - replaced by HighlightManager)

  // Function to restore a text node from its path
  function restoreTextNodeFromPath(path: string): Node | null {
    if (!path) return null;
    
    const parts = path.split('/');
    let current: Node | null = document.body;
    
    for (const part of parts) {
      if (!current) return null;
      
      if (part.startsWith('text[') && part.endsWith(']')) {
        // This is a text node reference
        const index = parseInt(part.substring(5, part.length - 1));
        const textNodes: Node[] = Array.from(current.childNodes).filter(n => n.nodeType === Node.TEXT_NODE);
        current = textNodes[index] || null;
      } else {
        // This is an element reference
        let selector = part;
        let elementIndex = 0;
        
        // Check if there's an index specified
        const indexMatch = selector.match(/\[(\d+)\]$/);
        if (indexMatch) {
          elementIndex = parseInt(indexMatch[1]);
          selector = selector.replace(/\[\d+\]$/, '');
        }
        
        // Find the element
        if (selector.includes('#')) {
          // ID selector
          const id = selector.split('#')[1];
          current = document.getElementById(id);
        } else if (selector.includes('.')) {
          // Class selector - need to ensure current is an Element
          if (current.nodeType === Node.ELEMENT_NODE) {
            const elements: Element[] = Array.from((current as Element).querySelectorAll(selector));
            current = elements[elementIndex] || null;
          } else {
            current = null;
          }
        } else {
          // Tag selector - need to ensure current is an Element
          if (current.nodeType === Node.ELEMENT_NODE) {
            const elements: Element[] = Array.from((current as Element).children).filter(
              (el: Element) => el.nodeName.toLowerCase() === selector
            );
            current = elements[elementIndex] || null;
          } else {
            current = null;
          }
        }
      }
    }
    
    return current;
  }

  // Function to resolve XPath to element
  function resolveXPath(xpath: string): Element | null {
    try {
      const result = document.evaluate(xpath, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null);
      return result.singleNodeValue as Element;
    } catch (e) {
      return null;
    }
  }

  // Function to normalize text for consistent Unicode handling
  function normalizeText(text: string): string {
    if (!text) return '';
    // Normalize Unicode characters to NFC form and trim whitespace
    return text.normalize('NFC').trim();
  }

  // Enhanced text comparison that handles Unicode properly
  function isTextMatch(text1: string, text2: string): boolean {
    if (!text1 || !text2) return false;
    
    // Normalize both texts for comparison
    const normalized1 = normalizeText(text1);
    const normalized2 = normalizeText(text2);
    
    // Direct match first
    if (normalized1 === normalized2) return true;
    
    // Try with different whitespace normalization
    const whitespaceNormalized1 = normalized1.replace(/\s+/g, ' ');
    const whitespaceNormalized2 = normalized2.replace(/\s+/g, ' ');
    
    if (whitespaceNormalized1 === whitespaceNormalized2) return true;
    
    
    return false;
  }

  // Enhanced text search that handles Unicode properly
  function findTextInNode(nodeText: string, searchText: string): number {
    if (!nodeText || !searchText) return -1;
    
    const normalizedNodeText = normalizeText(nodeText);
    const normalizedSearchText = normalizeText(searchText);
    
    // Try direct match first
    let index = normalizedNodeText.indexOf(normalizedSearchText);
    if (index !== -1) return index;
    
    // Try with whitespace normalization
    const whitespaceNormalizedNode = normalizedNodeText.replace(/\s+/g, ' ');
    const whitespaceNormalizedSearch = normalizedSearchText.replace(/\s+/g, ' ');
    
    index = whitespaceNormalizedNode.indexOf(whitespaceNormalizedSearch);
    if (index !== -1) {
      // Map back to original text position
      return nodeText.indexOf(searchText.charAt(0));
    }
    
    return -1;
  }

  // Function to resolve TextQuoteSelector to range with Unicode support
  function resolveTextQuoteSelector(selector: any, rootElement?: Element): Range | null {
    const root = rootElement || document.body;
    const exact = normalizeText(selector.exact);
    const prefix = selector.prefix ? normalizeText(selector.prefix) : '';
    const suffix = selector.suffix ? normalizeText(selector.suffix) : '';
    
    
    // Create a tree walker to traverse text nodes
    const walker = document.createTreeWalker(
      root,
      NodeFilter.SHOW_TEXT,
      null
    );
    
    let node;
    while (node = walker.nextNode()) {
      const textContent = node.textContent || '';
      const normalizedTextContent = normalizeText(textContent);
      
      // Use enhanced text search
      const exactIndex = findTextInNode(textContent, selector.exact);
      
      if (exactIndex !== -1) {
        
        // Check prefix and suffix if provided
        let prefixMatch = true;
        let suffixMatch = true;
        
        if (prefix) {
          const beforeText = normalizedTextContent.substring(Math.max(0, exactIndex - prefix.length), exactIndex);
          prefixMatch = normalizeText(beforeText).endsWith(prefix);
        }
        
        if (suffix) {
          const afterText = normalizedTextContent.substring(exactIndex + exact.length, exactIndex + exact.length + suffix.length);
          suffixMatch = normalizeText(afterText).startsWith(suffix);
        }
        
        if (prefixMatch && suffixMatch) {
          
          // Create range - need to use original text positions
          const range = document.createRange();
          range.setStart(node, exactIndex);
          range.setEnd(node, exactIndex + selector.exact.length);
          
          // Verify the range content matches
          const rangeText = range.toString();
          if (isTextMatch(rangeText, selector.exact)) {
            return range;
          } 
        }
      }
    }
    
    return null;
  }

  // Function to resolve TextPositionSelector to range with Unicode support
  function resolveTextPositionSelector(selector: any, rootElement?: Element): Range | null {
    const root = rootElement || document.body;
    const start = selector.start;
    const end = selector.end;
    
    
    const textContent = root.textContent || '';
    const normalizedTextContent = normalizeText(textContent);
    
    if (start < 0 || end > normalizedTextContent.length || start >= end) {
      return null;
    }
    
    // Find the text nodes that contain the start and end positions
    const walker = document.createTreeWalker(
      root,
      NodeFilter.SHOW_TEXT,
      null
    );
    
    let currentOffset = 0;
    let startNode: Node | null = null;
    let endNode: Node | null = null;
    let startOffset = 0;
    let endOffset = 0;
    
    let node;
    while (node = walker.nextNode()) {
      const nodeText = node.textContent || '';
      const normalizedNodeText = normalizeText(nodeText);
      const nodeLength = normalizedNodeText.length;
      
      if (startNode === null && currentOffset + nodeLength > start) {
        startNode = node;
        startOffset = start - currentOffset;
      }
      
      if (endNode === null && currentOffset + nodeLength >= end) {
        endNode = node;
        endOffset = end - currentOffset;
        break;
      }
      
      currentOffset += nodeLength;
    }
    
    if (startNode && endNode) {
      const range = document.createRange();
      range.setStart(startNode, startOffset);
      range.setEnd(endNode, endOffset);
      
      // Verify the range content
      const rangeText = range.toString();
      const expectedText = normalizedTextContent.substring(start, end);
      
      
      if (isTextMatch(rangeText, expectedText)) {
        return range;
      } 
    }
    
    return null;
  }

  // Function to resolve RangeSelector to range
  function resolveRangeSelector(selector: any): Range | null {
    try {
      const startContainer = document.evaluate(selector.startContainer, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue;
      const endContainer = document.evaluate(selector.endContainer, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue;
      
      if (startContainer && endContainer) {
        const range = document.createRange();
        range.setStart(startContainer, selector.startOffset);
        range.setEnd(endContainer, selector.endOffset);
        return range;
      }
    } catch (e) {
      // XPath resolution failed
    }
    
    return null;
  }

  // Function to resolve any selector to a range using fallback mechanism
  function resolveSelectorsToRange(selectors: any[], rootElement?: Element): Range | null {
    // Try selectors in order of reliability
    for (const selector of selectors) {
      let range: Range | null = null;
      
      switch (selector.type) {
        case 'TextQuoteSelector':
          range = resolveTextQuoteSelector(selector, rootElement);
          break;
        case 'TextPositionSelector':
          range = resolveTextPositionSelector(selector, rootElement);
          break;
        case 'RangeSelector':
          range = resolveRangeSelector(selector);
          break;
                 case 'XPathSelector':
           // Try to resolve XPath and then find text within it
           const element = resolveXPath(selector.value);
           if (element) {
             // Try to find the text within this element
             const textQuoteSelector = selectors.find(s => s.type === 'TextQuoteSelector');
             if (textQuoteSelector) {
               range = resolveTextQuoteSelector(textQuoteSelector, element);
             }
           }
           break;
                 case 'CSSSelector':
           // Try to resolve CSS selector and then find text within it
           const cssElement = document.querySelector(selector.value);
           if (cssElement) {
             // Try to find the text within this element
             const textQuoteSelector = selectors.find(s => s.type === 'TextQuoteSelector');
             if (textQuoteSelector) {
               range = resolveTextQuoteSelector(textQuoteSelector, cssElement as Element);
             }
           }
           break;
      }
      
      if (range) {
        return range;
      }
    }
    
    return null;
  }

  // (OLD HIGHLIGHTING FUNCTIONS REMOVED - replaced by HighlightManager class above)

  // Clear stored selection when annotation is sent
  function clearStoredSelection() {
    storedSelectionData = null;
    // Also clear any text selection on the page
    if (window.getSelection) {
      const selection = window.getSelection();
      if (selection) {
        selection.removeAllRanges();
      }
    }
    // Notify iframe that selection has been cleared
    iframe.contentWindow?.postMessage(
      {
        type: "CLEAR_SELECTION",
      },
      "*"
    );
  }

  // Message handler for iframe communication
  window.addEventListener("message", (event) => {
    // Only accept messages from our extension
    if (event.source !== iframe.contentWindow) return;

    const { type, payload } = event.data || {};

    switch (type) {
      case "CROSSIE_MINIMIZE":
        closeSidebar();
        break;

      case "CROSSIE_SHOW":
        openSidebar();
        break;

      case "REQUEST_AUTH_STATE":
        // Iframe is requesting auth state
        sendAuthToIframe();
        break;

      case "REQUEST_PAGE_TITLE":
        // Iframe is requesting the page title
        iframe.contentWindow?.postMessage({
          type: "PAGE_TITLE_RESPONSE",
          payload: { title: document.title }
        }, "*");
        break;

      case "HIGHLIGHT_TEXT":
        // Legacy single text highlighting (rarely used)
        const { text } = payload || {};
        if (text) {
          console.log('[Inject] Legacy highlight request for:', text);
          highlightManager.updateHighlights([{
            id: `legacy-${Date.now()}`,
            text: text
          }]);
        }
        break;

      case "HIGHLIGHT_ANNOTATIONS":
        // Enhanced multiple annotations highlighting
        const { highlights } = payload || {};
        if (highlights && Array.isArray(highlights)) {
          console.log(`[Inject] Highlighting ${highlights.length} annotations`);
          highlightManager.updateHighlights(highlights);
        }
        break;

      case "SCROLL_TO_HIGHLIGHT":
        // Scroll to a specific highlight using enhanced system
        const { annotationId, selectionData } = payload || {};
        if (selectionData) {
          console.log(`[Inject] Scroll to highlight request for annotation ${annotationId || 'unknown'}`);
          const highlightId = annotationId || `scroll-${Date.now()}`;
          highlightManager.scrollToHighlight(highlightId, selectionData);
        }
        break;

      case "CLEAR_SELECTION":
        // Clear stored selection after annotation is sent
        clearStoredSelection();
        break;

      default:
        // Unknown message type
        break;
    }
  });

  // Listen for messages from extension (popup/background)
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    const { type, payload } = message || {};

    switch (type) {
      case "SHOW_EXTENSION":
        openSidebar();
        sendResponse({ success: true });
        break;

      case "HIDE_EXTENSION":
        closeSidebar();
        sendResponse({ success: true });
        break;

      case "TOGGLE_EXTENSION":
        toggleSidebar();
        sendResponse({ success: true });
        break;

      case "AUTH_STATE_CHANGED":
        // Auth state changed, send update to iframe
        sendAuthToIframe();
        break;

      default:
        // Unknown message type
        break;
    }

    return true; // Keep message channel open for async response
  });

  // Send initial auth state when iframe loads
  iframe.addEventListener("load", () => {
    // Wait a bit for iframe to initialize
    setTimeout(() => {
      sendAuthToIframe();
    }, 100);
  });

  // Function to highlight text on the page (legacy support)
  function highlightTextOnPage(text: string) {
    highlightManager.updateHighlights([{
      id: `legacy-page-${Date.now()}`,
      text: text
    }]);
  }

  // Handle text selection events
  document.addEventListener("selectionchange", () => {
    // Only handle selection when sidebar is open
    if (isSidebarOpen) {
      // Add a small delay to ensure selection is stable
      setTimeout(() => {
        const selection = window.getSelection();
        const hasSelection = selection && selection.toString().trim().length > 0;
        
        if (hasSelection) {
          handleTextSelection();
        } else if (storedSelectionData) {
          // Text was deselected, clear the stored selection
          clearStoredSelection();
        }
      }, 100);
    }
  });

  // Initial setup - start closed
  setTimeout(() => {
    toggleButton.style.transform = "translateY(-50%)";
    toggleButton.style.opacity = "1";
  }, 500);

  // Add cleanup when page is unloaded
  window.addEventListener("beforeunload", () => {
    highlightManager.destroy();
    clearStoredSelection();
  });

})();