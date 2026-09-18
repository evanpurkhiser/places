import {InvalidValueError, valueType} from '@places/common/filter-engine';

const metersPerUnit = {m: 1, km: 1000, ft: 0.3048, mi: 1609.344};
export const distance = valueType({
  name: 'distance',
  description: 'Positive distance with a unit: m, km, ft, or mi. Decodes to meters.',
  decode: value => {
    const match = /^(\d+(?:\.\d*)?|\.\d+)(m|km|ft|mi)$/.exec(value.value);
    const meters = match
      ? Number(match[1]) * metersPerUnit[match[2] as keyof typeof metersPerUnit]
      : Number.NaN;

    if (!Number.isFinite(meters) || meters <= 0) {
      throw new InvalidValueError(
        'Expected a positive distance with unit m, km, ft, or mi',
      );
    }

    return meters;
  },
});
