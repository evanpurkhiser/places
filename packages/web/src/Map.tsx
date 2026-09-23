import 'maplibre-gl/dist/maplibre-gl.css';

import {useCallback, useEffect, useMemo, useRef, useState} from 'react';

import {Button} from '@base-ui/react/button';
import {House, Layers, Maximize, Minus, Plus} from 'lucide-react';
import * as maplibregl from 'maplibre-gl';
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';
import Map, {
  GeolocateControl,
  Layer,
  Popup,
  Source,
  type MapRef,
} from 'react-map-gl/maplibre';

import {labelLayout, pinImage, pinImageId} from './map-symbols.ts';
import {placeEmoji} from './place-icon.ts';
import type {Bounds} from './query.ts';
import type {Place} from './rpc.ts';

maplibregl.setWorkerUrl(workerUrl);

const home = {longitude: -74.002, latitude: 40.726, zoom: 13.2};

interface Props {
  places: Place[];
  selected: Place | null;
  target: {place: Place; request: number} | null;
  onSelect: (place: Place) => void;
  onBoundsChange: (bounds: Bounds) => void;
}

export function MapView({places, selected, target, onSelect, onBoundsChange}: Props) {
  const map = useRef<MapRef>(null);
  const container = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!container.current) {
      return;
    }

    const observer = new ResizeObserver(() => map.current?.resize());
    observer.observe(container.current);
    return () => observer.disconnect();
  }, []);
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const hoveredPlace = places.find(place => place.id === hoveredId);
  const primaryEmoji = placeEmoji(hoveredPlace?.tags);
  const hoverTags = (hoveredPlace?.tags ?? [])
    .map(({tag}) => tag)
    .filter(tag => tag.icon?.emoji && tag.icon.emoji !== primaryEmoji)
    .toSorted((a, b) => a.name.localeCompare(b.name));
  const data = useMemo(
    () => ({
      type: 'FeatureCollection' as const,
      features: places.map(place => ({
        type: 'Feature' as const,
        geometry: {
          type: 'Point' as const,
          coordinates: [place.coordinates.longitude, place.coordinates.latitude],
        },
        properties: {
          id: place.id,
          name: place.name,
          icon: pinImageId(placeEmoji(place.tags)),
          selected: place.id === selected?.id,
        },
      })),
    }),
    [places, selected?.id],
  );
  const [dark, setDark] = useState(false);
  const [error, setError] = useState('');
  const [locationError, setLocationError] = useState('');
  const reportBounds = useCallback(() => {
    const bounds = map.current?.getBounds();

    if (bounds) {
      onBoundsChange({
        west: bounds.getWest(),
        north: bounds.getNorth(),
        east: bounds.getEast(),
        south: bounds.getSouth(),
      });
    }
  }, [onBoundsChange]);

  useEffect(() => {
    if (!map.current || !selected) {
      return;
    }

    map.current.flyTo({
      center: [selected.coordinates.longitude, selected.coordinates.latitude],
      zoom: Math.max(map.current.getZoom(), 15),
      duration: 850,
    });
  }, [selected]);

  useEffect(() => {
    if (!map.current || !target) {
      return;
    }

    const {longitude, latitude} = target.place.coordinates;
    map.current.flyTo({
      center: [longitude, latitude],
      zoom: Math.max(map.current.getZoom(), 15),
      duration: 850,
    });
  }, [target]);

  function fit() {
    if (!map.current || !places.length) {
      return;
    }

    const bounds = new maplibregl.LngLatBounds();
    const center = map.current.getCenter().lng;

    for (const place of places) {
      const {longitude, latitude} = place.coordinates;
      bounds.extend([longitude + 360 * Math.round((center - longitude) / 360), latitude]);
    }

    map.current.fitBounds(bounds, {padding: 40, maxZoom: 15, duration: 700});
  }

  return (
    <div ref={container} className="map-container">
      <Map
        ref={map}
        mapLib={maplibregl}
        initialViewState={home}
        style={{position: 'absolute', inset: 0}}
        mapStyle={`https://basemaps.cartocdn.com/gl/${dark ? 'dark-matter' : 'voyager'}-gl-style/style.json`}
        attributionControl={{compact: true}}
        interactiveLayerIds={['place-icons', 'place-labels']}
        cursor={hoveredPlace ? 'pointer' : 'grab'}
        onMouseMove={event => setHoveredId(event.features?.[0]?.properties.id ?? null)}
        onMouseLeave={() => setHoveredId(null)}
        onMoveStart={() => setHoveredId(null)}
        onClick={event => {
          const id = event.features?.[0]?.properties.id;
          const place = places.find(place => place.id === id);

          if (place) {
            onSelect(place);
          }
        }}
        onLoad={event => {
          event.target.on('styleimagemissing', missing => {
            const image = pinImage(missing.id);

            if (image && !missing.target.hasImage(missing.id)) {
              missing.target.addImage(missing.id, image, {pixelRatio: 2});
            }
          });
          reportBounds();
        }}
        onMoveEnd={reportBounds}
        onResize={reportBounds}
        onError={() =>
          setError('The map could not load. Check your connection and WebGL support.')
        }
        onIdle={() => setError('')}
      >
        <GeolocateControl
          position="top-right"
          positionOptions={{enableHighAccuracy: true}}
          trackUserLocation
          showUserLocation
          showAccuracyCircle
          onGeolocate={() => setLocationError('')}
          onError={event =>
            setLocationError(
              event.code === 1
                ? 'Location access is blocked. Allow location access in your browser settings, then try again.'
                : 'Your location could not be found. Try the location button again.',
            )
          }
        />
        <Source id="places" type="geojson" data={data}>
          <Layer
            id="place-labels"
            type="symbol"
            layout={labelLayout}
            paint={{
              'text-color': '#111111',
              'text-halo-color': '#ffffff',
              'text-halo-width': 1.5,
            }}
          />
          <Layer
            id="place-selection"
            type="circle"
            filter={['==', ['get', 'selected'], true]}
            paint={{
              'circle-radius': 15,
              'circle-color': '#ffffff',
              'circle-opacity': 0.65,
            }}
          />
          {/* Icons are placed first so every pin reserves space before labels are placed. */}
          <Layer
            id="place-icons"
            type="symbol"
            layout={{
              'icon-image': ['get', 'icon'],
              'icon-size': 0.6,
              'icon-allow-overlap': true,
              'icon-ignore-placement': false,
              'icon-padding': 2,
              'symbol-sort-key': ['case', ['get', 'selected'], 1, 0],
            }}
          />
        </Source>
        {hoveredPlace && (
          <Popup
            longitude={hoveredPlace.coordinates.longitude}
            latitude={hoveredPlace.coordinates.latitude}
            anchor="bottom"
            offset={12}
            closeButton={false}
            closeOnClick={false}
            focusAfterOpen={false}
            className="place-icon-tooltip"
          >
            <div role="tooltip">
              <div className="place-tooltip-name">{hoveredPlace.name}</div>
              {hoverTags.length > 0 && (
                <div className="place-tooltip-icons">
                  {hoverTags.map(tag => (
                    <span key={tag.id} role="img" aria-label={tag.name}>
                      {tag.icon?.emoji}
                    </span>
                  ))}
                </div>
              )}
            </div>
          </Popup>
        )}
      </Map>
      {(error || locationError) && (
        <div className="map-error" role="alert">
          {error || locationError}
        </div>
      )}
      <div className="map-controls">
        <Button
          title="Fit current results"
          aria-label="Fit current results"
          disabled={!places.length}
          onClick={fit}
        >
          <Maximize size={18} />
        </Button>
        <Button
          title="Back to New York"
          aria-label="Back to New York"
          onClick={() =>
            map.current?.flyTo({center: [home.longitude, home.latitude], zoom: home.zoom})
          }
        >
          <House size={19} />
        </Button>
        <div className="zoom-controls">
          <Button aria-label="Zoom in" onClick={() => map.current?.zoomIn()}>
            <Plus size={20} />
          </Button>
          <Button aria-label="Zoom out" onClick={() => map.current?.zoomOut()}>
            <Minus size={20} />
          </Button>
        </div>
      </div>
      <Button className="map-style" onClick={() => setDark(!dark)}>
        <Layers size={16} />
        {dark ? 'Light map' : 'Dark map'}
      </Button>
    </div>
  );
}
