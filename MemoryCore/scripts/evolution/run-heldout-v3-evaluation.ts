import { freezeHeldoutExperiment, runHeldoutMain, runHeldoutProbe } from "./heldout/experiment.js";

const [mode, outputDirectory, caseId, repetition] = process.argv.slice(2);
const outputDir = outputDirectory ?? "/Users/lsmax/Documents/Codex/2026-08-29/n/outputs/heldout-protocol-v3";
if (mode === "freeze") {
  await freezeHeldoutExperiment(outputDir, "heldout-v3");
} else if (mode === "run") await runHeldoutMain(outputDir);
else if (mode === "probe") await runHeldoutProbe(caseId ?? "", Number(repetition), outputDir);
else throw new Error("Usage: run-heldout-v3-evaluation.ts freeze|run|probe [output-directory] [case-id] [repetition]");
