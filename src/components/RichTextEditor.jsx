import React, { useRef } from 'react';
import { Bold, Italic, Type } from 'lucide-react';

/**
 * A lightweight rich-text editor using contentEditable.
 * Stores output as HTML string (e.g. "<b>Storm</b> moving east").
 *
 * Props:
 *   value       - HTML string
 *   onChange    - called with new HTML string
 *   placeholder - placeholder text
 *   rows        - approximate min-height in lines (default 3)
 *   className   - extra classes on the wrapper
 */
export default function RichTextEditor({ value, onChange, placeholder = 'Type here...', rows = 3, className = '' }) {
  const editorRef = useRef(null);
  const isComposing = useRef(false);

  // Sync incoming value to DOM only when it differs (avoids cursor jump)
  React.useLayoutEffect(() => {
    const el = editorRef.current;
    if (!el) return;
    if (el.innerHTML !== (value || '')) {
      el.innerHTML = value || '';
    }
  }, [value]);

  const exec = (command) => {
    // Don't call focus() — selection is preserved via e.preventDefault() on mousedown
    document.execCommand(command, false, null);
    fireChange();
  };

  const fireChange = () => {
    const html = editorRef.current?.innerHTML || '';
    onChange(html === '<br>' ? '' : html);
  };

  const handlePaste = (e) => {
    e.preventDefault();
    // Strip all formatting — only insert the raw plain text from the clipboard.
    // Without this, pasting from Word/Google Docs/etc injects background colours,
    // font-size spans, and other inline styles that bleed into the rendered output.
    const text = e.clipboardData.getData('text/plain');
    document.execCommand('insertText', false, text);
    fireChange();
  };

  const minH = `${rows * 1.6}rem`;

  return (
    <div className={`border border-input rounded-md overflow-hidden focus-within:ring-1 focus-within:ring-ring ${className}`}>
      {/* Toolbar */}
      <div className="flex items-center gap-1 px-2 py-1 border-b border-input bg-slate-50">
        <ToolbarBtn icon={Bold} title="Bold" onClick={() => exec('bold')} />
        <ToolbarBtn icon={Italic} title="Italic" onClick={() => exec('italic')} />
        <div className="w-px h-4 bg-slate-200 mx-1" />
        <ToolbarBtn icon={Type} title="Remove formatting" onClick={() => exec('removeFormat')} />
      </div>

      {/* Editable area */}
      <div
        ref={editorRef}
        contentEditable
        suppressContentEditableWarning
        onPaste={handlePaste}
        onCompositionStart={() => { isComposing.current = true; }}
        onCompositionEnd={() => { isComposing.current = false; fireChange(); }}
        style={{ minHeight: minH }}
        className="px-3 py-2 text-sm text-foreground outline-none empty:before:content-[attr(data-placeholder)] empty:before:text-muted-foreground empty:before:pointer-events-none"
        data-placeholder={placeholder}
      />
    </div>
  );
}

function ToolbarBtn({ icon: Icon, title, onClick }) {
  return (
    <button
      type="button"
      title={title}
      onMouseDown={(e) => { e.preventDefault(); onClick(); }}
      className="p-1 rounded hover:bg-slate-200 text-slate-600 hover:text-slate-900 transition-colors"
    >
      <Icon className="w-3.5 h-3.5" />
    </button>
  );
}