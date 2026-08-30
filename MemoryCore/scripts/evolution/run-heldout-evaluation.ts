import { OUTPUT_ROOT, freezeHeldoutExperiment, runHeldoutMain, runHeldoutProbe } from "./heldout/experiment.js";

const [mode, outputDirectory, caseId, repetition] = process.argv.slice(2);
const outputDir = outputDirectory ?? OUTPUT_ROOT;
if (mode === "freeze") await freezeHeldoutExperiment(outputDir);
else if (mode === "run") await runHeldoutMain(outputDir);
else if (mode === "probe") await runHeldoutProbe(caseId ?? "", Number(repetition), outputDir);
else throw new Error("Usage: run-heldout-evaluation.ts freeze|run|probe [output-directory] [case-id] [repetition]");
