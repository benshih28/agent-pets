import { redactText } from './redact.ts'

export type DiagnosticsSection = () => unknown

/** Sections are registered by subsystems; each must return only non-sensitive counters and states. */
const sections = new Map<string, DiagnosticsSection>()

export function registerDiagnosticsSection(name: string, producer: DiagnosticsSection): void {
  sections.set(name, producer)
}

export function clearDiagnosticsSections(): void {
  sections.clear()
}

export interface DiagnosticsInput {
  app: { version: string; electron: string; chrome: string; node: string; platform: string; arch: string; packaged: boolean; locale: string }
  recentLogLines: string[]
  generatedAt: number
}

export function buildDiagnosticsReport(input: DiagnosticsInput): string {
  const body: Record<string, unknown> = { generatedAt: new Date(input.generatedAt).toISOString(), app: input.app }
  for (const [name, producer] of sections) {
    try { body[name] = producer() } catch (error) {
      body[name] = { error: error instanceof Error ? error.message : String(error) }
    }
  }
  body.recentLog = input.recentLogLines
  // Final pass over the whole document so a section can never leak a path or token.
  return redactText(JSON.stringify(body, null, 2))
}
