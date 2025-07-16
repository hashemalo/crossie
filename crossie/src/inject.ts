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
      console.log('❌ Failed to find selected text in parent element');
      console.log('Selected text:', JSON.stringify(normalizedSelectedText));
      console.log('Parent text:', JSON.stringify(normalizedFullText));
      return null;
    }
    
    const contextLength = 32;
    const prefix = startIndex > 0 ? normalizedFullText.substring(Math.max(0, startIndex - contextLength), startIndex) : '';
    const suffix = normalizedFullText.substring(startIndex + normalizedSelectedText.length, Math.min(normalizedFullText.length, startIndex + normalizedSelectedText.length + contextLength));
    
    console.log('✅ Generated TextQuoteSelector:');
    console.log('Exact:', JSON.stringify(normalizedSelectedText));
    console.log('Prefix:', JSON.stringify(prefix));
    console.log('Suffix:', JSON.stringify(suffix));
    
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
    
    console.log('📝 Capturing selection:', JSON.stringify(normalizedSelectedText));
    
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
    
    console.log('Parent element text:', JSON.stringify(fullText.substring(0, 100) + '...'));
    console.log('Selection start index:', selectionStart);
    
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
    
    console.log('✅ Selection captured successfully');
    console.log('Generated selectors:', selectors.length);
    
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

  // Enhanced function to scroll to highlighted text
  function scrollToHighlight(selectionData: any) {
    if (!selectionData) {
      console.log('❌ No selection data provided for scroll');
      return;
    }
    
    console.log('🔍 Scrolling to highlight:', selectionData);
    
    // Strategy 1: Try to find highlight using W3C-style selectors
    if (selectionData.selectors && selectionData.selectors.length > 0) {
      console.log('Trying W3C-style selectors...');
      
      // Try to resolve the original text position
      const range = resolveSelectorsToRange(selectionData.selectors);
      if (range) {
        console.log('✅ Found range using selectors');
        
        // Look for highlight elements that might contain this range
        const allHighlights = document.querySelectorAll('.crossie-highlight');
        for (const highlight of allHighlights) {
          const highlightText = normalizeText(highlight.textContent || '');
          const targetText = normalizeText(selectionData.selectedText || '');
          
          if (isTextMatch(highlightText, targetText)) {
            console.log('✅ Found matching highlight, scrolling...');
            scrollToElement(highlight);
            return;
          }
        }
      }
    }
    
    // Strategy 2: Try using parent selector and text matching
    if (selectionData.parentSelector) {
      console.log('Trying parent selector strategy...');
      
      const parent = document.querySelector(selectionData.parentSelector);
      if (parent) {
        console.log('✅ Found parent element');
        
        // Find all highlights within this parent
        const highlights = parent.querySelectorAll('.crossie-highlight');
        console.log(`Found ${highlights.length} highlights in parent`);
        
        // Try to match the exact text
        const targetText = normalizeText(selectionData.selectedText || '');
        for (const highlight of highlights) {
          const highlightText = normalizeText(highlight.textContent || '');
          console.log('Comparing:', JSON.stringify(highlightText), 'vs', JSON.stringify(targetText));
          
          if (isTextMatch(highlightText, targetText)) {
            console.log('✅ Found matching highlight by text');
            scrollToElement(highlight);
            return;
          }
        }
        
        // If no exact match, try partial match
        for (const highlight of highlights) {
          const highlightText = normalizeText(highlight.textContent || '');
          if (highlightText.includes(targetText) || targetText.includes(highlightText)) {
            console.log('✅ Found partial matching highlight');
            scrollToElement(highlight);
            return;
          }
        }
        
        // If still no match, scroll to first highlight in parent
        if (highlights.length > 0) {
          console.log('⚠️ No exact match, scrolling to first highlight in parent');
          scrollToElement(highlights[0]);
          return;
        }
      }
    }
    
    // Strategy 3: Search all highlights on the page
    console.log('Trying global search strategy...');
    
    const allHighlights = document.querySelectorAll('.crossie-highlight');
    const targetText = normalizeText(selectionData.selectedText || '');
    
    console.log(`Searching ${allHighlights.length} highlights globally for:`, JSON.stringify(targetText));
    
    for (const highlight of allHighlights) {
      const highlightText = normalizeText(highlight.textContent || '');
      if (isTextMatch(highlightText, targetText)) {
        console.log('✅ Found matching highlight globally');
        scrollToElement(highlight);
        return;
      }
    }
    
    // Strategy 4: Try to re-create the highlight if it doesn't exist
    console.log('Trying to re-create highlight...');
    if (selectionData.selectedText) {
      const success = highlightTextWithSelectors(selectionData.selectedText, selectionData);
      if (success) {
        console.log('✅ Re-created highlight, trying to scroll again...');
        // Give it a moment to render, then try scrolling again
        setTimeout(() => {
          const newHighlights = document.querySelectorAll('.crossie-highlight');
          const targetText = normalizeText(selectionData.selectedText || '');
          
          for (const highlight of newHighlights) {
            const highlightText = normalizeText(highlight.textContent || '');
            if (isTextMatch(highlightText, targetText)) {
              console.log('✅ Found re-created highlight');
              scrollToElement(highlight);
              return;
            }
          }
        }, 100);
      }
    }
    
    console.log('❌ Could not find highlight to scroll to');
  }

  // Helper function to scroll to an element with enhanced effects
  function scrollToElement(element: Element) {
    console.log('📍 Scrolling to element:', element);
    
    // Scroll with smooth behavior
    element.scrollIntoView({ 
      behavior: 'smooth', 
      block: 'center',
      inline: 'nearest'
    });
    
    // Add enhanced visual feedback (only if it's an HTMLElement)
    if (element instanceof HTMLElement) {
      const originalStyle = {
        boxShadow: element.style.boxShadow,
        transform: element.style.transform,
        transition: element.style.transition
      };
      
      // Apply glow and pulse effect
      element.style.transition = 'all 0.3s ease';
      element.style.boxShadow = '0 0 15px rgba(59, 130, 246, 0.8), 0 0 30px rgba(59, 130, 246, 0.4)';
      element.style.transform = 'scale(1.05)';
      
      // Reset after animation
      setTimeout(() => {
        element.style.transition = 'all 0.3s ease';
        element.style.boxShadow = originalStyle.boxShadow;
        element.style.transform = originalStyle.transform;
        
        // Remove transition after animation
        setTimeout(() => {
          element.style.transition = originalStyle.transition;
        }, 300);
      }, 2000);
    }
  }

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
    
    // For debugging Unicode issues
    if (normalized1 !== normalized2) {
      console.log('Unicode text comparison failed:');
      console.log('Text 1:', JSON.stringify(normalized1));
      console.log('Text 2:', JSON.stringify(normalized2));
      console.log('Text 1 chars:', [...normalized1].map(c => `${c} (U+${c.charCodeAt(0).toString(16).padStart(4, '0')})`));
      console.log('Text 2 chars:', [...normalized2].map(c => `${c} (U+${c.charCodeAt(0).toString(16).padStart(4, '0')})`));
    }
    
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
    
    console.log('Resolving TextQuoteSelector for:', JSON.stringify(exact));
    
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
        console.log('Found potential match at index', exactIndex, 'in text:', JSON.stringify(textContent.substring(exactIndex - 10, exactIndex + selector.exact.length + 10)));
        
        // Check prefix and suffix if provided
        let prefixMatch = true;
        let suffixMatch = true;
        
        if (prefix) {
          const beforeText = normalizedTextContent.substring(Math.max(0, exactIndex - prefix.length), exactIndex);
          prefixMatch = normalizeText(beforeText).endsWith(prefix);
          console.log('Prefix check:', JSON.stringify(beforeText), 'ends with', JSON.stringify(prefix), '=', prefixMatch);
        }
        
        if (suffix) {
          const afterText = normalizedTextContent.substring(exactIndex + exact.length, exactIndex + exact.length + suffix.length);
          suffixMatch = normalizeText(afterText).startsWith(suffix);
          console.log('Suffix check:', JSON.stringify(afterText), 'starts with', JSON.stringify(suffix), '=', suffixMatch);
        }
        
        if (prefixMatch && suffixMatch) {
          console.log('✅ Match found! Creating range...');
          
          // Create range - need to use original text positions
          const range = document.createRange();
          range.setStart(node, exactIndex);
          range.setEnd(node, exactIndex + selector.exact.length);
          
          // Verify the range content matches
          const rangeText = range.toString();
          if (isTextMatch(rangeText, selector.exact)) {
            console.log('✅ Range verification successful');
            return range;
          } else {
            console.log('❌ Range verification failed:', JSON.stringify(rangeText), 'vs', JSON.stringify(selector.exact));
          }
        }
      }
    }
    
    console.log('❌ No match found for TextQuoteSelector');
    return null;
  }

  // Debug function to analyze Unicode text issues
  function debugUnicodeText(text: string, label: string = 'Text') {
    if (!text) {
      console.log(`${label}: (empty)`);
      return;
    }
    
    const normalized = normalizeText(text);
    console.log(`${label}:`, JSON.stringify(text));
    console.log(`${label} (normalized):`, JSON.stringify(normalized));
    console.log(`${label} chars:`, [...text].map(c => `${c} (U+${c.charCodeAt(0).toString(16).padStart(4, '0')})`));
    console.log(`${label} length:`, text.length);
    console.log(`${label} normalized length:`, normalized.length);
  }

  // Function to resolve TextPositionSelector to range with Unicode support
  function resolveTextPositionSelector(selector: any, rootElement?: Element): Range | null {
    const root = rootElement || document.body;
    const start = selector.start;
    const end = selector.end;
    
    console.log('Resolving TextPositionSelector:', { start, end });
    
    const textContent = root.textContent || '';
    const normalizedTextContent = normalizeText(textContent);
    
    if (start < 0 || end > normalizedTextContent.length || start >= end) {
      console.log('❌ TextPositionSelector: Invalid range');
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
      console.log('✅ TextPositionSelector: Found nodes');
      const range = document.createRange();
      range.setStart(startNode, startOffset);
      range.setEnd(endNode, endOffset);
      
      // Verify the range content
      const rangeText = range.toString();
      const expectedText = normalizedTextContent.substring(start, end);
      
      console.log('Range text:', JSON.stringify(rangeText));
      console.log('Expected text:', JSON.stringify(expectedText));
      
      if (isTextMatch(rangeText, expectedText)) {
        console.log('✅ TextPositionSelector verification successful');
        return range;
      } else {
        console.log('❌ TextPositionSelector verification failed');
      }
    }
    
    console.log('❌ TextPositionSelector: No valid range found');
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

  // Function to clear all existing highlights
  function clearAllHighlights() {
    const existingHighlights = document.querySelectorAll('.crossie-highlight');
    existingHighlights.forEach(highlight => {
      const parent = highlight.parentNode;
      if (parent) {
        parent.replaceChild(document.createTextNode(highlight.textContent || ''), highlight);
        parent.normalize();
      }
    });
  }

  // Enhanced highlighting function using W3C-style selectors (without clearing)
  function highlightTextWithSelectors(text: string, selectionData?: any) {
    // Use W3C-style selectors if available
    if (selectionData?.selectors && selectionData.selectors.length > 0) {
      // Try to find the root element first
      let rootElement: Element | null = null;
      
      if (selectionData.parentSelector) {
        rootElement = document.querySelector(selectionData.parentSelector);
      }
      
      // Try to resolve selectors to a range
      const range = resolveSelectorsToRange(selectionData.selectors, rootElement || undefined);
      
      if (range) {
        // Verify the text matches
        const rangeText = range.toString();
        if (isTextMatch(rangeText, text)) { // Use isTextMatch
          highlightRange(range);
          return true;
        }
      }
    }

    // Fallback to legacy methods if W3C selectors fail
    if (selectionData?.startNodePath && selectionData?.endNodePath) {
      const startNode = restoreTextNodeFromPath(selectionData.startNodePath);
      const endNode = restoreTextNodeFromPath(selectionData.endNodePath);
      
      if (startNode && endNode && startNode.nodeType === Node.TEXT_NODE && endNode.nodeType === Node.TEXT_NODE) {
        // Verify the text matches
        const startOffset = selectionData.startOffset || 0;
        const endOffset = selectionData.endOffset || 0;
        
        if (startNode === endNode) {
          // Single text node selection
          const nodeText = startNode.textContent || '';
          const selectedText = nodeText.substring(startOffset, endOffset);
          
          if (isTextMatch(selectedText, text)) { // Use isTextMatch
            wrapInHighlight(startNode as Text, startOffset, endOffset - startOffset);
            return true;
          }
        }
      }
    }

         // Fallback to context-based highlighting
     if (selectionData?.parentSelector) {
       const parent = document.querySelector(selectionData.parentSelector);
       if (parent) {
        return highlightInElement(parent, text, selectionData);
       }
     }
    
    // Last resort: search the whole document
    console.warn('Falling back to document-wide highlighting for:', text);
    return highlightInDocument(text);
  }

  // Update the multiple highlights function to better handle Unicode
  function highlightMultipleAnnotations(highlights: any[]) {
    // First, clear all existing highlights
    clearAllHighlights();
    
    console.log(`🎯 Highlighting ${highlights.length} annotations...`);
    
    // Then highlight each annotation without clearing
    let successCount = 0;
    highlights.forEach((highlight: any, index: number) => {
      if (highlight.text) {
        console.log(`\n--- Highlighting annotation ${index + 1}/${highlights.length} ---`);
        debugUnicodeText(highlight.text, 'Target text');
        
        const success = highlightTextWithSelectors(highlight.text, highlight.selectionData);
        if (success) {
          successCount++;
          console.log(`✅ Annotation ${index + 1} highlighted successfully`);
        } else {
          console.log(`❌ Annotation ${index + 1} failed to highlight`);
        }
      }
    });
    
    console.log(`🎯 Successfully highlighted ${successCount} out of ${highlights.length} annotations`);
  }

  // Enhanced highlightRange function with better Unicode support
  function highlightRange(range: Range) {
    try {
      // Clone the range to avoid modifying the original
      const clonedRange = range.cloneRange();
      
      // Check if the range is valid
      if (clonedRange.collapsed) {
        console.log('❌ Cannot highlight collapsed range');
        return;
      }
      
      const rangeText = clonedRange.toString();
      console.log('Highlighting range with text:', JSON.stringify(rangeText));
      
      // Extract contents and wrap in highlight span
      const contents = clonedRange.extractContents();
      const span = document.createElement('span');
      span.style.backgroundColor = '#fef08a'; // Yellow highlight
      span.style.color = 'black';
      span.style.borderRadius = '2px';
      span.className = 'crossie-highlight';
      span.appendChild(contents);
      
      // Insert the highlighted content
      clonedRange.insertNode(span);
      
      console.log('✅ Range highlighted successfully');
    } catch (error) {
      console.error('❌ Error highlighting range:', error);
    }
  }

  function highlightInElement(element: Element, text: string, selectionData?: any): boolean {
    const walker = document.createTreeWalker(
      element,
      NodeFilter.SHOW_TEXT,
      null
    );
    
    let node;
    let highlighted = false;
    while (node = walker.nextNode()) {
      const nodeText = node.textContent || '';
      const index = findTextInNode(nodeText, text); // Use findTextInNode
      
      if (index !== -1) {
        // Verify with context if available
        if (selectionData?.precedingText || selectionData?.followingText) {
          const before = nodeText.substring(Math.max(0, index - 50), index);
          const after = nodeText.substring(index + text.length, index + text.length + 50);
          
          const precedingMatch = !selectionData.precedingText || isTextMatch(before, selectionData.precedingText.slice(-50)); // Use isTextMatch
          const followingMatch = !selectionData.followingText || isTextMatch(after, selectionData.followingText.slice(0, 50)); // Use isTextMatch
          
          if (precedingMatch && followingMatch) {
            wrapInHighlight(node as Text, index, text.length);
            highlighted = true;
            break; // Only highlight first match
          }
        } else {
          // No context, just highlight
          wrapInHighlight(node as Text, index, text.length);
          highlighted = true;
          break; // Only highlight first match
        }
      }
    }
    
    return highlighted;
  }

  function highlightInDocument(text: string): boolean {
    const walker = document.createTreeWalker(
      document.body,
      NodeFilter.SHOW_TEXT,
      null
    );

    const textNodes: Text[] = [];
    let node;
    while (node = walker.nextNode()) {
      if (node.textContent?.includes(text)) {
        textNodes.push(node as Text);
      }
    }

    let highlighted = false;
    // Only highlight the first occurrence to avoid multiple highlights of the same text
    for (const textNode of textNodes) {
      const content = textNode.textContent || "";
      const index = findTextInNode(content, text); // Use findTextInNode
      
      if (index !== -1) {
        wrapInHighlight(textNode, index, text.length);
        highlighted = true;
        break;
      }
    }
    
    return highlighted;
  }

  function wrapInHighlight(textNode: Text, start: number, length: number) {
    const text = textNode.textContent || '';
    const before = text.substring(0, start);
    const highlighted = text.substring(start, start + length);
    const after = text.substring(start + length);
    
    const span = document.createElement('span');
    span.style.backgroundColor = '#fef08a'; // Yellow highlight
    span.style.color = 'black';
    span.style.borderRadius = '2px';
    span.className = 'crossie-highlight';
    span.textContent = highlighted;
    
    const parent = textNode.parentNode;
    if (parent) {
      parent.insertBefore(document.createTextNode(before), textNode);
      parent.insertBefore(span, textNode);
      parent.insertBefore(document.createTextNode(after), textNode);
      parent.removeChild(textNode);
    }
  }

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

      case "HIGHLIGHT_TEXT":
        // Clear existing highlights and highlight single text (legacy)
        clearAllHighlights();
        const { text } = payload || {};
        if (text) {
          highlightTextWithSelectors(text);
        }
        break;

      case "HIGHLIGHT_ANNOTATIONS":
        // Highlight multiple annotations with context
        const { highlights } = payload || {};
        if (highlights && Array.isArray(highlights)) {
          highlightMultipleAnnotations(highlights);
        }
        break;

      case "SCROLL_TO_HIGHLIGHT":
        // Scroll to a specific highlight
        const { selectionData } = payload || {};
        if (selectionData) {
          scrollToHighlight(selectionData);
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
    clearAllHighlights();
    highlightTextWithSelectors(text);
  }

  // Handle text selection events
  document.addEventListener("selectionchange", () => {
    // Only handle selection when sidebar is open
    if (isSidebarOpen) {
      // Add a small delay to ensure selection is stable
      setTimeout(() => {
      handleTextSelection();
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
    clearAllHighlights();
    clearStoredSelection();
  });

  // Debug function to check highlight state
  function debugHighlights() {
    const highlights = document.querySelectorAll('.crossie-highlight');
    console.log(`Current highlights: ${highlights.length}`);
    highlights.forEach((highlight, index) => {
      console.log(`Highlight ${index + 1}:`, highlight.textContent);
    });
  }

  // Debug function to test scroll functionality
  function debugScrollToHighlight(text: string) {
    console.log('🔍 Debug scroll test for text:', JSON.stringify(text));
    
    const allHighlights = document.querySelectorAll('.crossie-highlight');
    console.log(`Found ${allHighlights.length} highlights on page`);
    
    allHighlights.forEach((highlight, index) => {
      const highlightText = highlight.textContent || '';
      console.log(`Highlight ${index + 1}:`, JSON.stringify(highlightText));
      
      if (normalizeText(highlightText) === normalizeText(text)) {
        console.log(`✅ Found matching highlight ${index + 1}, scrolling...`);
        scrollToElement(highlight);
        return;
      }
    });
  }

  // Debug function to check annotation selection data
  function debugAnnotationData() {
    console.log('📊 Current annotation debugging info:');
    console.log('Stored selection data:', storedSelectionData);
    console.log('Current highlights:', document.querySelectorAll('.crossie-highlight').length);
    console.log('Sidebar open:', isSidebarOpen);
    
    // Test Unicode normalization
    if (storedSelectionData?.selectedText) {
      debugUnicodeText(storedSelectionData.selectedText, 'Stored selection');
    }
  }

  // Make debug functions available globally for testing
  (window as any).debugHighlights = debugHighlights;
  (window as any).debugScrollToHighlight = debugScrollToHighlight;
  (window as any).debugAnnotationData = debugAnnotationData;
  (window as any).debugUnicodeText = debugUnicodeText;
})();