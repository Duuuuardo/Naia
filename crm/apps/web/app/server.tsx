import { createStartHandler, defaultStreamHandler } from '@tanstack/react-start/server'
import { loadProductConfig } from './lib/config'

await loadProductConfig()

export default {
  fetch: createStartHandler(defaultStreamHandler),
}
