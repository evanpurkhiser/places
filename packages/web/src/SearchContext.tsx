import {createContext, useContext, useState, type ReactNode} from 'react';

import {useQueryState} from 'nuqs';

import {appendTagFilter} from './query.ts';

function useSearchState(onTagAdded: () => void) {
  const [appliedSearch, setQuerySearch] = useQueryState('q', {
    defaultValue: '',
    history: 'push',
  });
  const [search, setSearch] = useState(appliedSearch);
  const [previousAppliedSearch, setPreviousAppliedSearch] = useState(appliedSearch);

  if (appliedSearch !== previousAppliedSearch) {
    setPreviousAppliedSearch(appliedSearch);
    setSearch(appliedSearch);
  }

  function applySearch(value: string) {
    void setQuerySearch(value);
  }

  function addTag(name: string) {
    setSearch(current => appendTagFilter(current, name));
    onTagAdded();
  }

  return {search, setSearch, appliedSearch, applySearch, addTag};
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
