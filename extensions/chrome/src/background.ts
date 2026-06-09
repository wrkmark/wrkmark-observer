/**
 * background.ts
 *
 * Chrome extension background service worker. Watches which
 * tabs are active and tells the Wrkmark desktop app when an
 * AI tool comes into focus.
 *
 * What this does NOT do: read page content, capture URLs,
 * track browsing history, or care about anything except
 * whether an AI tool hostname is currently active.
 */

import type { WrkmarkMessage, AIToolCheckResult } from './types.js';

// TODO(phase-2): add Gemini, Copilot Chat, Perplexity.
// Keeping the list short for MVP — better to be accurate
// about a few than unreliable about many.
const AI_TOOL_HOSTNAMES = new Set<string>([
  'claude.ai',
  'chatgpt.com',
  'chat.openai.com',
  'copilot.github.com',
  'gemini.google.com',
  'aistudio.google.com',
]);

/**
 * Parses a URL safely and checks if it belongs to an approved AI tool hostname.
 *
 * @param url - Raw browser tab URL.
 * @returns Result details containing boolean matches and hostname.
 */
export function checkAITool(url: string): AIToolCheckResult {
  try {
    const parsed = new URL(url);

    // We only check the hostname, never the full URL.
    // A URL contains path and query params that could
    // leak what the user is doing on the AI tool.
    // The hostname alone tells us the tool is open —
    // that's all we need and all we should know.
    let cleanedHostname = parsed.hostname.toLowerCase();
    
    // Checking hostname only — full URL never read or stored.
    if (cleanedHostname.startsWith('www.')) {
      cleanedHostname = cleanedHostname.substring(4);
    }

    if (AI_TOOL_HOSTNAMES.has(cleanedHostname)) {
      return { isAITool: true, hostname: cleanedHostname };
    }
  } catch {
    // Malformed URLs or browser-internal tabs (e.g. chrome://) fall back to safe rejected state.
  }

  return { isAITool: false, hostname: '' };
}

/**
 * Handles active tab focus transitions. Evaluates tab URLs for AI presence.
 *
 * @param tabId - Browser tab identifier.
 * @param url - Current tab URL.
 * @param timestamp - Event occurrence timestamp (Unix ms).
 * @returns A formatted telemetry message if tool matches, otherwise null.
 */
export function handleTabActivated(
  tabId: number,
  url: string | undefined,
  timestamp: number
): WrkmarkMessage | null {
  if (!url) {
    return null;
  }

  const result = checkAITool(url);
  if (!result.isAITool) {
    return null;
  }

  // Final telemetry payload format. Full URL data is omitted.
  return {
    type: 'AI_TOOL_DETECTED',
    hostname: result.hostname,
    timestamp,
  };
}

// Register browser listeners only when loaded inside Chrome extension context.
if (typeof chrome !== 'undefined' && chrome.tabs) {
  chrome.tabs.onActivated.addListener(async (activeInfo) => {
    try {
      const tab = await chrome.tabs.get(activeInfo.tabId);
      const timestamp = Date.now();
      const message = handleTabActivated(activeInfo.tabId, tab.url, timestamp);
      if (message) {
        chrome.runtime.sendMessage(message).catch(() => {
          // Discard errors when no receiver listener is active in other pages.
        });
      }
    } catch {
      // Extension service worker execution errors must never block page thread.
    }
  });

  chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
    try {
      if (changeInfo.status === 'complete' && tab.active) {
        const timestamp = Date.now();
        const message = handleTabActivated(tabId, tab.url, timestamp);
        if (message) {
          chrome.runtime.sendMessage(message).catch(() => {
            // Discard errors when no receiver listener is active in other pages.
          });
        }
      }
    } catch {
      // Extension service worker execution errors must never block page thread.
    }
  });
}
