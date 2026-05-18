import fs from 'node:fs/promises';

interface Snapshot {
  normalized?: {
    power?: unknown;
    mode?: unknown;
  };
  raw?: Record<string, unknown>;
}

interface Observation {
  id?: unknown;
  label?: unknown;
  before?: Snapshot;
  after?: Snapshot;
  changedFields?: Record<string, { before: unknown; after: unknown }>;
}

interface ProbeReport {
  capturedAt?: unknown;
  baseline?: Snapshot;
  observations?: Observation[];
  restored?: Snapshot;
  restoreChangedFields?: Record<string, { before: unknown; after: unknown }>;
}

interface ModeSummary {
  id: string;
  label: string;
  normalizedMode: string;
  rawMode: unknown;
  rawPower: unknown;
  changedFields: string[];
  likelyMapping: Record<string, unknown>;
  confirmed: boolean;
  warnings: string[];
}

async function main(): Promise<void> {
  const file = process.argv[2];
  if (!file || file === '--help') {
    printHelp();
    process.exit(file ? 0 : 1);
  }

  const report = JSON.parse(await fs.readFile(file, 'utf8')) as ProbeReport;
  const summaries = (report.observations ?? []).map(summarizeObservation);
  const restoreWarnings = restoreWarningsFor(report);
  const allConfirmed = summaries.every((summary) => summary.confirmed) && restoreWarnings.length === 0;

  console.log(JSON.stringify({
    analyzedAt: new Date().toISOString(),
    capturedAt: report.capturedAt ?? '',
    confirmed: allConfirmed,
    restoreWarnings,
    summaries,
    guidance: allConfirmed
      ? 'Mappings look clean. Review raw mode fields before promoting any new command support.'
      : 'Do not add command support yet. Resolve warnings or rerun the guided probe.',
  }, null, 2));

  if (!allConfirmed) {
    process.exitCode = 1;
  }
}

function summarizeObservation(observation: Observation): ModeSummary {
  const after = observation.after ?? {};
  const changedFields = Object.keys(observation.changedFields ?? {}).sort();
  const rawMode = after.raw?.Mod;
  const rawPower = after.raw?.Pow;
  const normalizedMode = typeof after.normalized?.mode === 'string' ? after.normalized.mode : 'unknown';
  const warnings: string[] = [];

  if (rawPower !== 1 && rawPower !== true) {
    warnings.push('Power did not read as on after mode change.');
  }
  if (typeof rawMode !== 'number') {
    warnings.push('Raw Mod did not return a numeric value.');
  }
  if (!changedFields.includes('raw.Mod') && !changedFields.includes('normalized.mode')) {
    warnings.push('Mode fields did not change from the immediate before snapshot.');
  }
  if (observation.id === 'cool' && normalizedMode !== 'cool') {
    warnings.push(`Cool did not normalize as cool; got ${normalizedMode}.`);
  }
  if (observation.id === 'cool_hot_water' && normalizedMode === 'cool') {
    warnings.push('Cool + hot water normalized as plain cool; inspect auxiliary raw fields before adding command support.');
  }

  return {
    id: String(observation.id ?? ''),
    label: String(observation.label ?? ''),
    normalizedMode,
    rawMode,
    rawPower,
    changedFields,
    likelyMapping: likelyMapping(after),
    confirmed: warnings.length === 0,
    warnings,
  };
}

function likelyMapping(snapshot: Snapshot): Record<string, unknown> {
  const raw = snapshot.raw ?? {};
  return {
    Pow: raw.Pow,
    Mod: raw.Mod,
    ColHtWter: raw.ColHtWter,
    HetHtWter: raw.HetHtWter,
    CoWatOutTemSet: raw.CoWatOutTemSet,
    HeWatOutTemSet: raw.HeWatOutTemSet,
    WatBoxTemSet: raw.WatBoxTemSet,
  };
}

function restoreWarningsFor(report: ProbeReport): string[] {
  const warnings: string[] = [];
  const baselineMode = report.baseline?.normalized?.mode;
  const restoredMode = report.restored?.normalized?.mode;
  const restoreChangedFields = Object.keys(report.restoreChangedFields ?? {});

  if (baselineMode !== restoredMode) {
    warnings.push(`Restore mode mismatch: baseline ${String(baselineMode)}, restored ${String(restoredMode)}.`);
  }
  const meaningfulRestoreChanges = restoreChangedFields.filter((field) => !field.includes('Temperature') && !field.includes('TemSet'));
  if (meaningfulRestoreChanges.length) {
    warnings.push(`Restore left non-temperature differences: ${meaningfulRestoreChanges.join(', ')}.`);
  }

  return warnings;
}

function printHelp(): void {
  console.log(`Usage: npm run probe:modes:analyze -- <report.json>

Analyze a redacted report created by:
  npm run probe:modes -- --mac <mac> --modes cool,cool_hot_water --output tmp/cooling-modes.json
`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
