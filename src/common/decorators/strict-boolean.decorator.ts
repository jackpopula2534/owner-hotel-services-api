import { applyDecorators } from '@nestjs/common';
import { Transform } from 'class-transformer';
import { IsBoolean } from 'class-validator';

/**
 * `@IsBoolean()` that cannot be talked into the wrong answer.
 *
 * The global ValidationPipe runs with `enableImplicitConversion: true`, which
 * coerces a body value to the property's reflected type before validation. For
 * a boolean that means `Boolean(value)` — so the string `"false"` arrives as
 * `true` and passes `@IsBoolean()` without complaint.
 *
 * On a field like `isActive` that is merely untidy. On a switch that decides
 * whether a guest is charged VAT it is a defect: a client that sends the string
 * `"false"` would silently turn the charge on.
 *
 * Implicit conversion has already run by the time a `@Transform` sees `value`,
 * so this reads the untouched request body off `obj` instead. Only a real
 * boolean or the two strings that unambiguously spell one are accepted; every
 * other shape is handed to `@IsBoolean()` as-is and comes back a 400 rather
 * than a guess.
 */
export function IsStrictBoolean() {
  return applyDecorators(
    Transform(({ obj, key }) => {
      const raw = (obj as Record<string, unknown>)?.[key];
      if (typeof raw === 'boolean') return raw;
      if (raw === 'true') return true;
      if (raw === 'false') return false;
      // An explicit null is "leave it alone", not "write NULL": these columns are
      // NOT NULL, and letting it through surfaced a raw Prisma error to the client.
      if (raw === null) return undefined;
      return raw;
    }),
    IsBoolean(),
  );
}
