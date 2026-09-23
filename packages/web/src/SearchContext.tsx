import {createContext, useContext, useState, type ReactNode} from 'react';

import {appendTagFilter} from './query.ts';

function useSearchState(onTagAdded: () => void) {
  const [search, setSearch] = useState('');

  function addTag(name: string) {
    setSearch(current => appendTagFilter(current, name));
    onTagAdded();
  }

  return {search, setSearch, addTag};
}

const SearchContext = createContext<ReturnType<typeof useSearchState> | null>(null);

export function SearchProvider({
  children,
  onTagAdded,
}: {
  children: ReactNode;
  onTagAdded: () => void;
}) {
  const value = useSearchState(onTagAdded);
  return <SearchContext value={value}>{children}</SearchContext>;
}

export function useSearch() {
  const context = useContext(SearchContext);

  if (!context) {
    throw new Error('useSearch requires a SearchProvider');
  }

  return context;
}
