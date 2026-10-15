import { pathToFileURL } from 'node:url'

export const localFileUrl = path => pathToFileURL(path).href
