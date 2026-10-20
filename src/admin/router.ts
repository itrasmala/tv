import { useEffect, useState } from 'react';

export interface Route { path: string; query: URLSearchParams; }

function parse(): Route {
  const raw = location.hash.replace(/^#/, '') || '/';
  const [path, qs] = raw.split('?');
  return { path: path || '/', query: new URLSearchParams(qs || '') };
}

export function useRoute(): Route {
  const [route, setRoute] = useState<Route>(parse);
  useEffect(() => {
    const on = () => { setRoute(parse()); window.scrollTo(0, 0); };
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  return route;
}

export function navigate(path: string, query?: Record<string, string>) {
  const qs = query ? '?' + new URLSearchParams(query).toString() : '';
  location.hash = path + qs;
}
