import { useEffect, useRef, useState } from 'react';

// A search box that searches as you type (Keeley's request, 2026-10-01: no Enter or Search button
// anywhere) - `onSearch` runs a moment after typing pauses, so each keystroke doesn't fire its own
// lookup. `value` is the search currently applied; when it changes from outside (e.g. "Reset
// filters"), the box follows it without overwriting what's being typed.
export default function LiveSearchInput({ value = '', onSearch, delay = 300, ...inputProps }) {
  const [text, setText] = useState(value);
  const lastSent = useRef(value);

  useEffect(() => {
    if (value !== lastSent.current) {
      lastSent.current = value;
      setText(value);
    }
  }, [value]);

  useEffect(() => {
    if (text === lastSent.current) return undefined;
    const handle = setTimeout(() => {
      lastSent.current = text;
      onSearch(text);
    }, delay);
    return () => clearTimeout(handle);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text]);

  return (
    <input
      type="search"
      {...inputProps}
      value={text}
      onChange={(e) => setText(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          lastSent.current = text;
          onSearch(text);
        }
      }}
    />
  );
}
