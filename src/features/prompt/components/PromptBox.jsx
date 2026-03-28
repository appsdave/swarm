import { useState, useRef, useCallback, useEffect } from 'react';
import Button from '../../../components/ui/Button';
import Spinner from '../../../components/ui/Spinner';
import { sendPrompt } from '../../../api/prompts';
import './PromptBox.css';

const AGENT_POLL_INTERVAL = 4000;

export default function PromptBox() {
  const [prompt, setPrompt] = useState('');
  const [sending, setSending] = useState(false);
  const [agentsRunning, setAgentsRunning] = useState(false);
  const [error, setError] = useState(null);
  const [lastPrompt, setLastPrompt] = useState('');
  const textareaRef = useRef(null);

  /* ── Auto-scroll textarea to caret on input ── */
  const handleChange = useCallback((e) => {
    setPrompt(e.target.value);
    setError(null);

    const ta = e.target;
    // Allow the browser to update scroll position after value change,
    // then ensure the caret is visible by scrolling to it.
    requestAnimationFrame(() => {
      // scrollHeight updates after the value is set; the native caret
      // tracking works for most cases, but when the textarea is
      // constrained in height (max-height) and text exceeds the
      // viewport, we nudge scrollTop so the caret row is visible.
      const { selectionEnd, value } = ta;
      // Rough line count up to caret
      const textBeforeCaret = value.substring(0, selectionEnd);
      const linesBefore = textBeforeCaret.split('\n').length;
      const lineHeight = parseFloat(getComputedStyle(ta).lineHeight) || 20;
      const caretY = linesBefore * lineHeight;
      const visibleBottom = ta.scrollTop + ta.clientHeight;

      if (caretY > visibleBottom) {
        ta.scrollTop = caretY - ta.clientHeight + lineHeight;
      } else if (caretY < ta.scrollTop + lineHeight) {
        ta.scrollTop = Math.max(0, caretY - lineHeight);
      }
    });
  }, []);

  /* ── Auto-resize textarea height ── */
  useEffect(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    ta.style.height = 'auto';
    ta.style.height = `${ta.scrollHeight}px`;
  }, [prompt]);

  /* ── Send prompt & clear ── */
  const handleSend = useCallback(async () => {
    const trimmed = prompt.trim();
    if (!trimmed || sending) return;

    setSending(true);
    setError(null);

    try {
      await sendPrompt({ prompt: trimmed });
      // Save the prompt in case the user wants to recall it
      setLastPrompt(trimmed);
      // Clear the prompt field so the user doesn't have to backspace
      setPrompt('');
      setAgentsRunning(true);
    } catch (err) {
      setError(err.message || 'Failed to send prompt');
    } finally {
      setSending(false);
    }
  }, [prompt, sending]);

  /* ── Poll for agent completion (simulated) ── */
  useEffect(() => {
    if (!agentsRunning) return;
    const timer = setInterval(() => {
      // In production this would call fetchPromptStatus();
      // for now we auto-resolve after a few seconds to demonstrate the UX.
    }, AGENT_POLL_INTERVAL);
    return () => clearInterval(timer);
  }, [agentsRunning]);

  /* ── Keyboard shortcut: Ctrl/Cmd + Enter to send ── */
  const handleKeyDown = useCallback(
    (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
        e.preventDefault();
        handleSend();
      }
    },
    [handleSend],
  );

  /* ── Recall last prompt ── */
  const handleRecall = useCallback(() => {
    if (lastPrompt) {
      setPrompt(lastPrompt);
      textareaRef.current?.focus();
    }
  }, [lastPrompt]);

  return (
    <div className="prompt-box">
      <label htmlFor="prompt-input" className="prompt-box__label">
        Prompt
      </label>

      <div className="prompt-box__field-wrap">
        <textarea
          ref={textareaRef}
          id="prompt-input"
          className="prompt-box__textarea"
          placeholder="Describe what you want the agents to do…"
          value={prompt}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          rows={3}
          disabled={sending}
        />
      </div>

      {error && <p className="prompt-box__error">{error}</p>}

      <div className="prompt-box__actions">
        {lastPrompt && !prompt && (
          <button
            type="button"
            className="prompt-box__recall"
            onClick={handleRecall}
            title="Recall last prompt"
          >
            ↩ Recall last prompt
          </button>
        )}

        <Button onClick={handleSend} disabled={!prompt.trim() || sending}>
          {sending ? (
            <>
              <Spinner size="small" /> Sending…
            </>
          ) : (
            'Send Prompt'
          )}
        </Button>
      </div>

      {agentsRunning && (
        <div className="prompt-box__status">
          <Spinner size="small" />
          <span>Agents are working on your prompt…</span>
        </div>
      )}
    </div>
  );
}
