import { Injectable, type PipeTransform } from '@nestjs/common';
import type { ZodType } from 'zod';

/** Valide et transforme une entrée (corps, requête, paramètre) avec un schéma Zod ; une erreur devient VALIDATION_ERROR (filtre global). */
@Injectable()
export class ZodValidationPipe<T> implements PipeTransform<unknown, T> {
  constructor(private readonly schema: ZodType<T>) {}

  transform(value: unknown): T {
    return this.schema.parse(value);
  }
}

export const zodPipe = <T>(schema: ZodType<T>) => new ZodValidationPipe(schema);
