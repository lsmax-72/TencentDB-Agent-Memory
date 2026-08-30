import { resolve } from "node:path";
import { freezeExperiment, runExperiment, SOURCE_DIR } from "./refinement/experiment.js";

const [mode, directory, probe] = process.argv.slice(2);
const outputDir = resolve(directory ?? `${SOURCE_DIR}/phase-5b`);
if (mode === "freeze") await freezeExperiment(outputDir);
else if (mode === "run") await runExperiment(outputDir);
else if (mode === "probe") await runExperiment(outputDir, Number(probe));
else if (mode === "retry") await runExperiment(outputDir, undefined, true);
else if (mode === "retry-probe") await runExperiment(outputDir, Number(probe), true);
else if (mode === "ac05-probe") await runExperiment(outputDir, Number(probe), true, "AC-05", true);
else throw new Error("Usage: run-candidate-refinement.ts freeze|run|probe|retry|retry-probe|ac05-probe [output-directory] [probe-number]");
