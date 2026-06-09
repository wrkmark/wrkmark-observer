/**
 * background.test.ts
 *
 * Unit tests for the Chrome extension background service worker.
 * Validates domain matches, malformed URL safety fallbacks, and hostname-only extraction.
 *
 * What this does NOT do: It does not mock or test Chrome chrome.* APIs directly.
 */

import { describe, it, expect } from 'vitest';
import { checkAITool, handleTabActivated } from '../src/background.js';

describe('background.ts — Browser AI Usage Detection', () => {
  
  // ─── AI Tool Hostname Matchers ──────────────────────────────────────────────

  it('notices when Claude is active', () => {
    const result = checkAITool('https://claude.ai/chat/abc-123');
    expect(result.isAITool).toBe(true);
    expect(result.hostname).toBe('claude.ai');
  });

  it('notices when ChatGPT is active', () => {
    const result = checkAITool('https://chatgpt.com/?q=hello');
    expect(result.isAITool).toBe(true);
    expect(result.hostname).toBe('chatgpt.com');
  });

  it('notices when Open AI ChatGPT is active', () => {
    const result = checkAITool('https://chat.openai.com/g/g-some-tool');
    expect(result.isAITool).toBe(true);
    expect(result.hostname).toBe('chat.openai.com');
  });

  it('notices when Gemini is active', () => {
    const result = checkAITool('https://gemini.google.com/app');
    expect(result.isAITool).toBe(true);
    expect(result.hostname).toBe('gemini.google.com');
  });

  it('notices when Google AI Studio is active', () => {
    const result = checkAITool('https://aistudio.google.com/prompts/new');
    expect(result.isAITool).toBe(true);
    expect(result.hostname).toBe('aistudio.google.com');
  });

  it('notices when GitHub Copilot is active', () => {
    const result = checkAITool('https://copilot.github.com/');
    expect(result.isAITool).toBe(true);
    expect(result.hostname).toBe('copilot.github.com');
  });

  // ─── Non-AI Websites (Quiet state verification) ─────────────────────────────

  it('stays quiet about search engines', () => {
    const result = checkAITool('https://google.com/search?q=claude');
    expect(result.isAITool).toBe(false);
  });

  it('stays quiet about developer platforms', () => {
    const result = checkAITool('https://github.com/wrkmark/wrkmark-observer');
    expect(result.isAITool).toBe(false);
  });

  it('stays quiet about developer communities', () => {
    const result = checkAITool('https://stackoverflow.com/questions/123');
    expect(result.isAITool).toBe(false);
  });

  // ─── Malformed and Border Cases ──────────────────────────────────────────────

  it('handles malformed URLs gracefully by rejecting them', () => {
    const result = checkAITool('invalid-url-string');
    expect(result.isAITool).toBe(false);
    expect(result.hostname).toBe('');
  });

  // ─── Privacy: Hostname extraction ────────────────────────────────────────────

  it('never reads the full URL — hostname check only', () => {
    const result = checkAITool('https://claude.ai/chat/secret-document-hash?token=secret');
    expect(result.hostname).toBe('claude.ai');
    expect(result.hostname).not.toContain('secret-document-hash');
    expect(result.hostname).not.toContain('token');
  });

  // ─── Tab Activated Handlers ──────────────────────────────────────────────────

  it('ignores activated tabs with non-AI URLs', () => {
    const message = handleTabActivated(1, 'https://github.com', Date.now());
    expect(message).toBeNull();
  });

  it('returns a valid message when tab switches to an AI tool URL', () => {
    const ts = 1625097600000;
    const message = handleTabActivated(1, 'https://claude.ai/chat', ts);
    expect(message).not.toBeNull();
    expect(message!.type).toBe('AI_TOOL_DETECTED');
    expect(message!.hostname).toBe('claude.ai');
    expect(message!.timestamp).toBe(ts);
  });

  it('ignores activated tabs with undefined URL', () => {
    const message = handleTabActivated(1, undefined, Date.now());
    expect(message).toBeNull();
  });

  it('never leaks the full URL path or query parameters in the message payload', () => {
    const message = handleTabActivated(
      1,
      'https://chatgpt.com/c/secret-context-id?query=private',
      Date.now()
    );
    expect(message!.hostname).toBe('chatgpt.com');
    expect(message!.hostname).not.toContain('secret-context-id');
    expect(message!.hostname).not.toContain('query');
  });

  it('preserves the exact activation timestamp inside the payload', () => {
    const ts = 1625098000000;
    const message = handleTabActivated(1, 'https://gemini.google.com/app', ts);
    expect(message!.timestamp).toBe(ts);
  });

  it('never includes subdirectories or parameters in the matched hostname', () => {
    const result = checkAITool('https://gemini.google.com/app/chat/123?query=abc');
    expect(result.hostname).toBe('gemini.google.com');
    expect(result.hostname).not.toContain('app');
    expect(result.hostname).not.toContain('chat');
  });
});
