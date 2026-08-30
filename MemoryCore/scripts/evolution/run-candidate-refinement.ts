import { resolve } from "node:path";
import { freezeExperiment, runExperiment, SOURCE_DIR } from "./refinement/experiment.js";

const [mode, directory, probe] = process.argv.slice(2);
const candidateMode = mode?.includes("v3") || mode?.includes("v4");
const candidateOutput = mode?.endsWith("v4") ? "phase-5b-candidate-v4" : "phase-5b-candidate-v3";
const outputDir = resolve(directory ?? `${SOURCE_DIR}/${candidateMode ? candidateOutput : "phase-5b"}`);
if (mode === "freeze") await freezeExperiment(outputDir);
else if (mode === "freeze-v3") await freezeExperiment(outputDir, {
  candidate_id: "phase5b-candidate-v3",
  candidate_file: "candidate-v3/SKILL.md",
  parent_candidate: "phase5b-candidate-v2",
  created_from_evaluation_attempt: "9f6d88f0-e3fe-402b-b9a0-7ee44426aeeb",
  diagnosis_file: "candidate-v3/diagnosis.json",
  lineage: {
    parent_attempt: "9f6d88f0-e3fe-402b-b9a0-7ee44426aeeb",
    diagnostic_probe_attempts: [
      "333ec368-c510-47dc-901d-55f497b7b9b6",
      "e4bfff04-d5a8-4cf9-9ea1-b64cf289ab6c",
      "2aeb9810-542b-4a4b-96f8-c610f9b33442",
    ],
  },
});
else if (mode === "freeze-v4") await freezeExperiment(outputDir, {
  candidate_id: "phase5b-candidate-v4",
  candidate_file: "candidate-v4/SKILL.md",
  parent_candidate: "phase5b-candidate-v3",
  created_from_evaluation_attempt: "c68882a4-ed90-4481-a335-fe561c899b76",
  diagnosis_file: "candidate-v4/diagnosis.json",
  lineage: { parent_attempt: "c68882a4-ed90-4481-a335-fe561c899b76" },
});
else if (mode === "run") await runExperiment(outputDir);
else if (mode === "run-v3") await runExperiment(outputDir);
else if (mode === "run-v4") await runExperiment(outputDir);
else if (mode === "probe") await runExperiment(outputDir, Number(probe));
else if (mode === "retry") await runExperiment(outputDir, undefined, true);
else if (mode === "retry-probe") await runExperiment(outputDir, Number(probe), true);
else if (mode === "ac05-probe") await runExperiment(outputDir, Number(probe), true, "AC-05", true);
else if (mode === "ac05-probe-v4") await runExperiment(outputDir, Number(probe), false, "AC-05", true);
else throw new Error("Usage: run-candidate-refinement.ts freeze|freeze-v3|freeze-v4|run|run-v3|run-v4|probe|retry|retry-probe|ac05-probe|ac05-probe-v4 [output-directory] [probe-number]");
