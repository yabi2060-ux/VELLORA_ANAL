import type { ParsedFile, ReportModel, SellerMetric, NormalizedRow } from '../types';
import { parseSpreadsheet } from '../data/normalization/normalizeFile';
import { mergeFiles } from '../data/aggregation/merge';
import {
  aggregateCommission,
  aggregateProducts,
  aggregateSales,
  aggregateSellers,
  assembleReportModel,
  buildInsight,
} from '../report-engine/model/createReportModel';
import { ensurePageFonts } from '../report-engine/fonts';
import { clearMeasureCache } from '../report-engine/scene/text';

export const STAGES = [
  { id: 'read', label: 'Reading your data…' },
  { id: 'combine', label: 'Combining transactions…' },
  { id: 'products', label: 'Analyzing product performance…' },
  { id: 'sales', label: 'Calculating sales…' },
  { id: 'commission', label: 'Calculating commission…' },
  { id: 'visual', label: 'Building your visualization…' },
  { id: 'polish', label: 'Polishing the final report…' },
];

/** yield to the browser so the processing UI stays smooth between real work steps */
const nextFrame = () => new Promise<void>((r) => requestAnimationFrame(() => setTimeout(r, 0)));

/**
 * Readability pacing: a stage that finishes in a few ms stays visible for at least MIN_STAGE_MS
 * so the user can read what happened. The elapsed timer still shows real wall-clock time.
 */
const MIN_STAGE_MS = 200;

export interface PipelineResult {
  model: ReportModel;
  files: ParsedFile[];
  rows: NormalizedRow[];
}

export async function runPipeline(
  inputs: { id: string; file: File }[],
  sellerMetric: SellerMetric,
  onStage: (index: number) => void,
  buildVisual: (model: ReportModel) => Promise<void> | void,
): Promise<PipelineResult> {
  const step = async <T>(i: number, work: () => Promise<T> | T): Promise<T> => {
    onStage(i);
    const t0 = performance.now();
    await nextFrame();
    const out = await work();
    const spent = performance.now() - t0;
    if (spent < MIN_STAGE_MS) await new Promise((r) => setTimeout(r, MIN_STAGE_MS - spent));
    return out;
  };

  const files = await step(0, async () => {
    const out: ParsedFile[] = [];
    for (const { id, file } of inputs) {
      const buf = await file.arrayBuffer();
      out.push(parseSpreadsheet(buf, file.name, id));
      await nextFrame();
    }
    return out;
  });
  const usable = files.filter((f) => !f.fatal);
  if (!usable.length || usable.every((f) => f.rows.length === 0)) {
    throw new Error("We couldn't find enough usable affiliate data to build the report.");
  }
  const merged = await step(1, () => mergeFiles(files));
  const products = await step(2, () => aggregateProducts(merged.rows));
  const sales = await step(3, () => aggregateSales(merged.rows));
  const commission = await step(4, () => aggregateCommission(merged.rows));
  const model = assembleReportModel({
    files,
    rows: merged.rows,
    mergeNotices: merged.notices,
    products,
    sales,
    commission,
    sellerMetric,
  });
  await step(5, async () => {
    await ensurePageFonts();
    clearMeasureCache();
    await buildVisual(model);
  });
  await step(6, async () => {
    if (document.fonts?.ready) await document.fonts.ready;
  });
  onStage(STAGES.length);
  return { model, files, rows: merged.rows };
}

/** Cheap re-ranking when only the seller metric changes (no re-parse). */
export function withSellerMetric(model: ReportModel, rows: NormalizedRow[], metric: SellerMetric): ReportModel {
  const next = { ...model, topSellers: aggregateSellers(rows, metric).slice(0, 5) };
  return { ...next, insight: buildInsight(next) };
}
