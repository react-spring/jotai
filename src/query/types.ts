import { QueryClient } from '@tanstack/react-query'
import { Getter } from 'jotai'

export type CreateQueryOptions<Options> = Options | ((get: Getter) => Options)
export type GetQueryClient = (get: Getter) => QueryClient
