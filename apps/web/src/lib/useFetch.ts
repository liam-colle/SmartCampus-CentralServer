import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "./api";

/** GET `path` (pass null to skip) and refetch when it changes or `reload()` is called. */
export function useFetch<T>(path: string | null) {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(path !== null);
  const [error, setError] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);
  const latest = useRef(0);

  useEffect(() => {
    if (path === null) return;
    const id = ++latest.current;
    setLoading(true);
    api<T>(path)
      .then((d) => id === latest.current && (setData(d), setError(null)))
      .catch((e: Error) => id === latest.current && setError(e.message))
      .finally(() => id === latest.current && setLoading(false));
  }, [path, nonce]);

  const reload = useCallback(() => setNonce((n) => n + 1), []);
  return { data, loading, error, reload };
}

export function useDebounced<T>(value: T, ms = 300): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

/** Runs `fn` when `value` changes after the first render (not on mount). */
export function useOnChange<T>(value: T, fn: () => void) {
  const previous = useRef(value);
  useEffect(() => {
    if (previous.current === value) return;
    previous.current = value;
    fn();
  }, [value, fn]);
}
