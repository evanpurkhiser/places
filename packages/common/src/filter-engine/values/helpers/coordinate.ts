import {InvalidValueError} from '../../definitions.ts';

export const decodeCoordinate =
  (name: string, limit: number) => (literal: {value: string}) => {
    const input = literal.value.trim();
    const number = Number(input);

    if (
      !/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(input) ||
      !Number.isFinite(number) ||
      number < -limit ||
      number > limit
    ) {
      throw new InvalidValueError(`Expected ${name} from -${limit} to ${limit}`);
    }

    return number;
  };
