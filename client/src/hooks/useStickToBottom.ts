import { useCallback, useEffect, useLayoutEffect, useState, type RefObject } from 'react';

const THRESHOLD = 48;

/**
 * Keeps a scroll container pinned to its end while the reader is already
 * there, and leaves it alone once they scroll up. `signal` changes whenever
 * the content grows.
 */
export function useStickToBottom(ref: RefObject<HTMLElement | null>, signal: unknown): { pinned: boolean; jump: () => void } {
  const [pinned, setPinned] = useState(true);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const onScroll = () => setPinned(el.scrollHeight - el.scrollTop - el.clientHeight < THRESHOLD);
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => el.removeEventListener('scroll', onScroll);
  }, [ref]);

  useLayoutEffect(() => {
    const el = ref.current;
    if (el && pinned) el.scrollTop = el.scrollHeight;
  }, [ref, pinned, signal]);

  const jump = useCallback(() => {
    const el = ref.current;
    if (el) el.scrollTop = el.scrollHeight;
    setPinned(true);
  }, [ref]);

  return { pinned, jump };
}
