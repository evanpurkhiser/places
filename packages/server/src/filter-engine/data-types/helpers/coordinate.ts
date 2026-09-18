import {InvalidValueError, valueType} from '@places/common/filter-engine';

export const coordinate = (name: string, limit: number) =>
  valueType({
    name,
    description: `Decimal degrees between -${limit} and ${limit}, inclusive.`,
    decode: value => {
      const number = Number(value.value);

      if (
        !/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(value.value) ||
        !Number.isFinite(number) ||
        Math.abs(number) > limit
      ) {
        throw new InvalidValueError(
          `Invalid ${name}: expected a number between -${limit} and ${limit}`,
        );
      }

      return number;
    },
  });
