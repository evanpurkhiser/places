import {defineValue, InvalidValueError} from '../definitions.ts';

export const degrees = defineValue<number>()({
  name: 'degrees',
  description: 'An angle with the deg unit, such as 30deg or 90deg.',
  literals: true,
  references: false,
  decode: literal => {
    const match = /^([+-]?(?:\d+(?:\.\d*)?|\.\d+))deg$/.exec(literal.value);
    const angle = match ? Number(match[1]) : Number.NaN;

    if (!Number.isFinite(angle)) {
      throw new InvalidValueError('Expected a finite angle with unit deg');
    }

    return angle;
  },
});
