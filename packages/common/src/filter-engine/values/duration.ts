import {defineValue, InvalidValueError} from '../definitions.ts';

const millisecondsPerUnit = {m: 60_000n, h: 3_600_000n};

export const duration = defineValue<number>()({
  name: 'duration',
  description:
    'Positive elapsed duration with unit m (minutes) or h (hours), such as 30m, 2h, or 1.5h. Decodes to whole milliseconds.',
  literals: true,
  references: false,
  decode: literal => {
    const match = /^(\d+(?:\.\d*)?|\.\d+)(m|h)$/.exec(literal.value);

    if (!match) {
      throw new InvalidValueError('Expected a positive duration with unit m or h.');
    }

    const [whole, fraction = ''] = match[1]!.split('.');
    const scale = 10n ** BigInt(fraction.length);
    const numerator =
      BigInt(`${whole || '0'}${fraction}`) *
      millisecondsPerUnit[match[2] as keyof typeof millisecondsPerUnit];
    const milliseconds = numerator / scale;

    if (
      numerator % scale !== 0n ||
      milliseconds <= 0n ||
      milliseconds > BigInt(Number.MAX_SAFE_INTEGER)
    ) {
      throw new InvalidValueError(
        'Expected a positive duration with unit m or h, representable in whole milliseconds.',
      );
    }

    return Number(milliseconds);
  },
});
