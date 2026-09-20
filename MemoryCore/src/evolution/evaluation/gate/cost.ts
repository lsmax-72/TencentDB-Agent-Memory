import type { CostSummary, PairedCaseResult, RunUsage } from "../contracts/types.js";

export function aggregateCosts(pairs: PairedCaseResult[]): CostSummary {
  const baseline = sumUsage(pairs.map((pair) => pair.baseline.usage));
  const candidate = sumUsage(pairs.map((pair) => pair.candidate.usage));
  if (baseline.total_tokens === 0 && candidate.total_tokens > 0) {
    return {
      baseline,
      candidate,
      token_increase_ratio: null,
      token_ratio_undefined_reason: "ZERO_BASELINE",
      tool_call_increase: candidate.tool_call_count - baseline.tool_call_count,
      model_call_increase: countDifference(candidate.model_call_count, baseline.model_call_count),
    };
  }
  return {
    baseline,
    candidate,
    token_increase_ratio: baseline.total_tokens === 0
      ? 0
      : (candidate.total_tokens - baseline.total_tokens) / baseline.total_tokens,
    tool_call_increase: candidate.tool_call_count - baseline.tool_call_count,
    model_call_increase: countDifference(candidate.model_call_count, baseline.model_call_count),
  };
}

function sumUsage(items: RunUsage[]): RunUsage {
  if (items.length === 0) return emptyUsage();
  const [first, ...rest] = items;
  return rest.reduce<RunUsage>((sum, item) => ({
    input_tokens: sum.input_tokens + item.input_tokens,
    output_tokens: sum.output_tokens + item.output_tokens,
    total_tokens: sum.total_tokens + item.total_tokens,
    cache_read_tokens: (sum.cache_read_tokens ?? 0) + (item.cache_read_tokens ?? 0),
    cache_write_tokens: (sum.cache_write_tokens ?? 0) + (item.cache_write_tokens ?? 0),
    model_call_count: sumCounts(sum.model_call_count, item.model_call_count),
    tool_call_count: sum.tool_call_count + item.tool_call_count,
    tool_names: [...sum.tool_names, ...item.tool_names],
    elapsed_ms: sum.elapsed_ms + item.elapsed_ms,
  }), { ...first, tool_names: [...first.tool_names] });
}

function sumCounts(left: number | null, right: number | null): number | null {
  return left === null || right === null ? null : left + right;
}

function countDifference(candidate: number | null, baseline: number | null): number | null {
  return candidate === null || baseline === null ? null : candidate - baseline;
}

export function emptyUsage(): RunUsage {
  return {
    input_tokens: 0,
    output_tokens: 0,
    total_tokens: 0,
    model_call_count: null,
    tool_call_count: 0,
    tool_names: [],
    elapsed_ms: 0,
  };
}
