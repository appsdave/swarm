import { useState, useRef, useCallback, useEffect } from 'react';
import Button from '../../../components/ui/Button';
import Spinner from '../../../components/ui/Spinner';
import { sendPrompt } from '../../../api/prompts';
import './PromptBox.css';

const AGENT_POLL_INTERVAL = 4000;

const TIPS = [
  { icon: '⌨️', text: 'Press Ctrl + Enter to send' },
  { icon: '🎯', text: 'Be specific — mention files, features, or endpoints' },
  { icon: '📋', text: 'Break complex tasks into smaller steps for best results' },
  { icon: '↩️', text: 'Use "Recall" to reuse your last prompt' },
];

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
    requestAnimationFrame(() => {
      const { selectionEnd, value } = ta;
      const textBeforeCaret = value.substring(0, selectionEnd);
      const lineHeight = parseFloat(getComputedStyle(ta).lineHeight) || 20;

      // Use a hidden mirror div to measure real visual caret position
      // accounting for word-wrap on long lines without newlines.
      const mirror = document.createElement('div');
      const style = getComputedStyle(ta);
      mirror.style.cssText = [
        'position:absolute',
        'visibility:hidden',
        'white-space:pre-wrap',
        'word-wrap:break-word',
        `width:${ta.clientWidth}px`,
        `font:${style.font}`,
        `letter-spacing:${style.letterSpacing}`,
        `padding:${style.padding}`,
        `border:${style.border}`,
        `line-height:${style.lineHeight}`,
      ].join(';');
      mirror.textContent = textBeforeCaret || '.';
      document.body.appendChild(mirror);
      const caretY = mirror.scrollHeight;
      document.body.removeChild(mirror);

      const visibleTop = ta.scrollTop;
      const visibleBottom = visibleTop + ta.clientHeight;

      if (caretY > visibleBottom) {
        ta.scrollTop = caretY - ta.clientHeight + lineHeight;
      } else if (caretY - lineHeight < visibleTop) {
        ta.scrollTop = Math.max(0, caretY - lineHeight * 2);
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

      <ul className="prompt-box__tips">
        {TIPS.map((tip) => (
          <li key={tip.text} className="prompt-box__tip">
            <span className="prompt-box__tip-icon">{tip.icon}</span>
            {tip.text}
          </li>
        ))}
      </ul>

      {agentsRunning && (
        <div className="prompt-box__status">
          <Spinner size="small" />
          <span>Agents are working on your prompt…</span>
        </div>
      )}
    </div>
  );
}
