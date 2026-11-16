import { useEffect, useLayoutEffect, useRef, useState } from 'react';

export function useDebouncedSearch(applied, onSearch, enabled = true) {
  const [draft, setDraft] = useState(applied);
  const [previousApplied, setPreviousApplied] = useState(applied);
  if (applied !== previousApplied) {
    setPreviousApplied(applied);
    setDraft(applied);
  }

  const latestSearch = useRef(onSearch);
  useLayoutEffect(() => {
    latestSearch.current = onSearch;
  }, [onSearch]);

  useEffect(() => {
    if (!enabled || draft === applied) return;
    const timer = setTimeout(() => latestSearch.current(draft), 500);
    return () => clearTimeout(timer);
  }, [applied, draft, enabled]);

  return [draft, setDraft];
}
