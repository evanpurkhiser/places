import {useCallback, useEffect, useMemo, useState} from 'react';

import {Button} from '@base-ui/react/button';
import {Input} from '@base-ui/react/input';
import {ORPCError} from '@orpc/client';
import type {PlaceSort} from '@places/common/contract/place';
import {keepPreviousData, skipToken, useQuery} from '@tanstack/react-query';
import {Compass, PanelLeft, Search, X} from 'lucide-react';

import {MapView} from './Map.tsx';
import {PlaceDetails} from './PlaceDetails.tsx';
import {PlaceList} from './PlaceList.tsx';
import {parseSearch, placesQuery, type Bounds} from './query.ts';
import {rpc, type Place} from './rpc.ts';
import {SearchProvider, useSearch} from './SearchContext.tsx';

const emptyPlaces: Place[] = [];

export function App() {
  const [selected, setSelected] = useState<Place | null>(null);

  return (
    <SearchProvider onTagAdded={() => setSelected(null)}>
      <PlacesApp selected={selected} setSelected={setSelected} />
    </SearchProvider>
  );
}

function PlacesApp({
  selected,
  setSelected,
}: {
  selected: Place | null;
  setSelected: (place: Place | null) => void;
}) {
  const [bounds, setBounds] = useState<Bounds | null>(null);
  const [mapTarget, setMapTarget] = useState<{
    place: Place;
    request: number;
  } | null>(null);
  const {search, setSearch, appliedSearch, applySearch} = useSearch();
  const parsedSearch = useMemo(() => parseSearch(search), [search]);
  const [debouncedSearch, setDebouncedSearch] = useState(appliedSearch);
  const [collapsed, setCollapsed] = useState(false);
  const [sort, setSort] = useState<PlaceSort>('name');
  const result = useQuery(
    rpc.places.list.queryOptions({
      input: bounds ? {query: placesQuery(bounds, debouncedSearch, ''), sort} : skipToken,
      enabled: !parsedSearch.error && search === debouncedSearch,
      placeholderData: keepPreviousData,
      retry: (count, error) =>
        !(error instanceof ORPCError && error.code === 'BAD_REQUEST') && count < 1,
    }),
  );
  const places = result.data ?? emptyPlaces;
  const select = useCallback(
    (place: Place) => {
      setSelected(place);
      setCollapsed(false);
    },
    [setSelected],
  );
  const pending =
    !parsedSearch.error && (result.isFetching || search !== debouncedSearch);

  useEffect(() => {
    if (parsedSearch.error) {
      return;
    }

    const timeout = window.setTimeout(() => {
      setDebouncedSearch(search);
      applySearch(search);
    }, 600);
    return () => window.clearTimeout(timeout);
  }, [search, parsedSearch, applySearch]);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        setSelected(null);
      }

      const target = event.target;
      const editing =
        target instanceof HTMLElement &&
        (target.isContentEditable ||
          Boolean(
            target.closest(
              'input, textarea, select, [role="combobox"], [role="listbox"]',
            ),
          ));

      if (
        editing ||
        event.defaultPrevented ||
        event.metaKey ||
        event.ctrlKey ||
        event.altKey ||
        event.repeat
      ) {
        return;
      }

      if (event.key === '[') {
        event.preventDefault();
        document.getElementById('sidebar-toggle')?.focus();
        setCollapsed(value => !value);
      }

      if (event.key === '/') {
        event.preventDefault();
        setSelected(null);
        setCollapsed(false);
        window.requestAnimationFrame(() => document.getElementById('search')?.focus());
      }
    }

    function updateShift(event: KeyboardEvent) {
      document.documentElement.toggleAttribute('data-shift-pressed', event.shiftKey);
    }

    function releaseShift() {
      document.documentElement.removeAttribute('data-shift-pressed');
    }

    window.addEventListener('keydown', onKey);
    window.addEventListener('keydown', updateShift);
    window.addEventListener('keyup', updateShift);
    window.addEventListener('blur', releaseShift);

    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('keydown', updateShift);
      window.removeEventListener('keyup', updateShift);
      window.removeEventListener('blur', releaseShift);
      releaseShift();
    };
  }, [setSelected]);

  function resetFilters() {
    setSearch('');
    setDebouncedSearch('');
    applySearch('');
  }

  function showOnMap(place: Place) {
    setMapTarget(current => ({place, request: (current?.request ?? 0) + 1}));
  }

  return (
    <main>
      <header className="topbar">
        <Button
          id="sidebar-toggle"
          className="icon-button"
          aria-label={collapsed ? 'Open sidebar' : 'Close sidebar'}
          aria-expanded={!collapsed}
          aria-controls="places-sidebar"
          aria-keyshortcuts="["
          title="Toggle sidebar ([)"
          onClick={() => setCollapsed(value => !value)}
        >
          <PanelLeft size={17} />
        </Button>
        <a href="/" className="brand">
          <Compass size={17} />
          places
        </a>
        <span className="header-shortcuts">
          <kbd>[</kbd> sidebar <kbd>/</kbd> search
        </span>
      </header>
      <div className="workspace">
        <aside
          id="places-sidebar"
          className="places-panel"
          hidden={collapsed}
          aria-label="Places"
        >
          {selected ? (
            <PlaceDetails
              place={selected}
              onClose={() => setSelected(null)}
              onUpdate={setSelected}
            />
          ) : (
            <>
              <div className="panel-heading">
                <h1>Places</h1>
              </div>
              <div className="search-wrap">
                <Search size={18} />
                <Input
                  id="search"
                  aria-label="Filter saved places"
                  aria-invalid={Boolean(parsedSearch.error)}
                  aria-describedby={parsedSearch.error ? 'search-error' : undefined}
                  placeholder="name[coffee] or tag[type.cafe]"
                  value={search}
                  onChange={event => setSearch(event.target.value)}
                />
                {search ? (
                  <Button aria-label="Clear search" onClick={() => setSearch('')}>
                    <X size={15} />
                  </Button>
                ) : (
                  <kbd>/</kbd>
                )}
              </div>
              {parsedSearch.error && (
                <div id="search-error" className="query-error" role="status">
                  <p>{parsedSearch.error.message}</p>
                </div>
              )}
              <div className="results-heading" role="status">
                <span>
                  {parsedSearch.error ? (
                    'Search is incomplete or invalid'
                  ) : pending ? (
                    'Updating places…'
                  ) : bounds ? (
                    <>
                      <strong>{places.length}</strong> places in this area
                    </>
                  ) : (
                    'Waiting for map…'
                  )}
                </span>
                <span className="results-actions">
                  {search && <Button onClick={resetFilters}>Reset</Button>}
                  <label className="sort-control">
                    Sort
                    <select
                      aria-label="Sort places"
                      value={sort}
                      onChange={event => setSort(event.target.value as PlaceSort)}
                    >
                      <option value="name">Name</option>
                      <option value="recently-saved">Recently saved</option>
                      <option value="recently-recommended">Recently recommended</option>
                    </select>
                  </label>
                </span>
              </div>
              {result.isError && !parsedSearch.error && (
                <div className="query-error" role="alert">
                  <p>Could not load places.</p>
                  <p>{result.error.message}</p>
                  <Button onClick={() => void result.refetch()}>Try again</Button>
                </div>
              )}
              <PlaceList
                key={`${debouncedSearch}:${sort}`}
                places={places}
                pending={pending}
                onSelect={select}
                onLocate={showOnMap}
              >
                {result.isSuccess &&
                  !parsedSearch.error &&
                  !pending &&
                  !places.length && (
                    <div className="empty">
                      <Search size={26} />
                      <h2>No places here yet</h2>
                      <p>
                        Move the map or zoom out
                        {search ? ', or clear your filters' : ''} to explore your saved
                        places.
                      </p>
                      {search && <Button onClick={resetFilters}>Clear filters</Button>}
                    </div>
                  )}
              </PlaceList>
              <div className="panel-footer">
                <span className="green-dot" />
                Search updates with the map.
              </div>
            </>
          )}
        </aside>
        <section className="map-pane" aria-label="Map of saved places">
          <MapView
            places={places}
            selected={selected}
            target={mapTarget}
            onSelect={select}
            onBoundsChange={setBounds}
          />
        </section>
      </div>
    </main>
  );
}
