import {InvalidValueError, valueType} from '@places/common/filter-engine';

export const degrees = valueType({
  name: 'degrees',
  description: 'An angle with the deg unit, such as 30deg or 90deg.',
  decode: value => {
    const match = /^([+-]?(?:\d+(?:\.\d*)?|\.\d+))deg$/.exec(value.value);
    const angle = match ? Number(match[1]) : Number.NaN;

    if (!Number.isFinite(angle)) {
      throw new InvalidValueError('Expected a finite angle with unit deg');
    }

    return angle;
  },
});
