/// <reference lib="webworker" />
// Runs import sessions off the main thread. The page passes its settings in the worker's name.
import { exposeImporter } from '@openimport/worker'
import { makeImporter, type PlaygroundOptions } from './importer'

const options = JSON.parse(self.name || '{}') as PlaygroundOptions
exposeImporter(makeImporter(options))
