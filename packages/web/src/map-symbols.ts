import type {SymbolLayerSpecification} from 'maplibre-gl';

const imagePrefix = 'place-pin:';

export const pinImageId = (emoji = '') => `${imagePrefix}${emoji}`;

// Canvas sprites preserve the platform's color emoji in MapLibre's collision system.
export function pinImage(id: string) {
  if (!id.startsWith(imagePrefix)) {
    return null;
  }

  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 74;
  const context = canvas.getContext('2d');

  if (!context) {
    return null;
  }

  context.scale(2, 2);
  context.beginPath();
  context.arc(18.5, 18.5, 17, 0, Math.PI * 2);
  context.fillStyle = '#ffffff';
  context.fill();
  context.strokeStyle = '#d6d9d3';
  context.lineWidth = 1;
  context.stroke();

  const emoji = id.slice(imagePrefix.length);
  context.fillStyle = '#61785a';
  context.strokeStyle = '#61785a';

  if (emoji) {
    context.font =
      '22px "Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", sans-serif';
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.fillText(emoji, 18.5, 19.5);
  } else {
    context.translate(7.5, 7.5);
    context.scale(22 / 24, 22 / 24);
    context.lineWidth = 2;
    context.lineCap = context.lineJoin = 'round';
    context.stroke(new Path2D('M20 10c0 5-8 12-8 12S4 15 4 10a8 8 0 1 1 16 0Z'));
    context.beginPath();
    context.arc(12, 10, 3, 0, Math.PI * 2);
    context.stroke();
  }

  return context.getImageData(0, 0, 74, 74);
}

export const labelLayout: SymbolLayerSpecification['layout'] = {
  'text-field': ['get', 'name'],
  'text-font': ['Open Sans Regular', 'Noto Sans Regular'],
  'text-size': 11,
  'text-anchor': 'top',
  'text-offset': [0, 1.8],
  'text-max-width': 12,
  'text-padding': 3,
  'text-allow-overlap': false,
  'symbol-sort-key': ['case', ['get', 'selected'], 0, 1],
};
