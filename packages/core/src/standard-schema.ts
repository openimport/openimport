// Vendored from @standard-schema/spec v1.1 (MIT) as recommended by the spec,
// so the core stays dependency-free. https://standardschema.dev

/** The Standard Schema interface. */
export interface StandardSchemaV1<Input = unknown, Output = Input> {
  readonly '~standard': StandardSchemaV1.Props<Input, Output>
}

export declare namespace StandardSchemaV1 {
  export interface Props<Input = unknown, Output = Input> {
    readonly version: 1
    readonly vendor: string
    readonly validate: (value: unknown) => Result<Output> | Promise<Result<Output>>
    readonly types?: Types<Input, Output> | undefined
  }
  export type Result<Output> = SuccessResult<Output> | FailureResult
  export interface SuccessResult<Output> {
    readonly value: Output
    readonly issues?: undefined
  }
  export interface FailureResult {
    readonly issues: ReadonlyArray<Issue>
  }
  export interface Issue {
    readonly message: string
    readonly path?: ReadonlyArray<PropertyKey | PathSegment> | undefined
  }
  export interface PathSegment {
    readonly key: PropertyKey
  }
  export interface Types<Input = unknown, Output = Input> {
    readonly input: Input
    readonly output: Output
  }
  export type InferInput<Schema extends StandardSchemaV1> = NonNullable<Schema['~standard']['types']>['input']
  export type InferOutput<Schema extends StandardSchemaV1> = NonNullable<Schema['~standard']['types']>['output']
}

/** The Standard JSON Schema interface (implemented by zod ≥ 4.2, valibot, arktype, …). */
export interface StandardJSONSchemaV1<Input = unknown, Output = Input> {
  readonly '~standard': StandardSchemaV1.Props<Input, Output> & {
    readonly jsonSchema: {
      readonly input: (options: { target: string }) => Record<string, unknown>
      readonly output: (options: { target: string }) => Record<string, unknown>
    }
  }
}

export function isStandardSchema(value: unknown): value is StandardSchemaV1 {
  // Some libraries (arktype) expose schemas as callable functions.
  return (
    (typeof value === 'object' || typeof value === 'function') &&
    value !== null &&
    '~standard' in value &&
    typeof (value as StandardSchemaV1)['~standard']?.validate === 'function'
  )
}

export function hasJsonSchema(value: unknown): value is StandardJSONSchemaV1 {
  return isStandardSchema(value) && typeof (value as StandardJSONSchemaV1)['~standard'].jsonSchema?.input === 'function'
}
