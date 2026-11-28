// The browser sources are concatenated into one factory function at build time
// (dev/tools/build-client.mjs), so every name below is in scope for every file at
// runtime even though the type checker sees ten separate scripts.
declare const React: any
declare function h(type: any, props?: any, ...children: any[]): any
declare const NS: string
declare const BUILD: string
declare const ROUTE: string
declare function report(stage: string, data?: Record<string, unknown>): void
declare const NEXT_DEBOUNCE_MS: number
declare const COMPOSE_DEBOUNCE_MS: number
declare const COVERED_DEBOUNCE_MS: number
declare const DEDUPE_MS: number
declare const SERVED_TTL_MS: number
declare const RETRIGGER_INTERVAL_MS: number
declare const CLIENT_TIMEOUT_MS: number
declare const IGNORE_STREAK_LIMIT: number
declare const MIN_DRAFT_CHARS: number
declare function requestSignature(draft: string, attachmentKey: string): string
declare function signatureAttachmentKey(signature: string | null): string
declare function layerStats(): { layers: number | null, sessions: string[] }
declare function browserLocale(): string
declare function require(name: string): any
declare module 'react'
declare function bestHistoryMatch(items: string[], draft: string): { tail: string } | null
declare function caretRect(): { left: number, right?: number, top: number, bottom: number, width: number, height: number, fromBlock?: boolean } | null
declare function edgeOfText(node: any): { left: number, right?: number, top: number, bottom: number, width: number, height: number, fromBlock?: boolean } | null
declare function lastTextNodeOf(node: any): any
declare function streamRoute(route: string, body: Record<string, unknown>, signal?: AbortSignal, handlers?: any): Promise<any>
declare function callRoute(route: string, body: Record<string, unknown>, signal?: AbortSignal): Promise<any>
declare function fetchUsage(sessionId: string, signal?: AbortSignal): Promise<any>
declare function fetchModels(signal?: AbortSignal): Promise<any>
declare function fetchHistory(sessionId: string, signal?: AbortSignal): Promise<any>
declare function resetUsageTotals(): Promise<any>
declare function nextVisible(input: any): boolean
declare function composeVisible(input: any): boolean
declare function nextAskForAttachments(input: any): boolean
declare function closeOnEscape(input: any): boolean
