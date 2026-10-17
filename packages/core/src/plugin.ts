import type { FormatAdapter, ImportPlugin, Matcher, TransformDefinition } from './types'

/** Identity helper that gives plugin authors full type inference. */
export function definePlugin<P extends ImportPlugin>(plugin: P): P {
  return plugin
}

export function defineFormat(format: FormatAdapter): FormatAdapter {
  return format
}

export function defineMatcher(matcher: Matcher): Matcher {
  return matcher
}

export function defineTransform(transform: TransformDefinition): TransformDefinition {
  return transform
}
