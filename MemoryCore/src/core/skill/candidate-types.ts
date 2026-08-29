export interface CandidateArtifact {
  candidate_id: string;
  operation: "CREATE" | "UPDATE";
  skill_id: string;
  base_version: number;
  content: string;
  content_hash: `sha256:${string}`;
  artifact_hash: `sha256:${string}`;
  source: {
    user_id?: string;
    team_id?: string;
    agent_id?: string;
    task_id?: string;
  };
  created_at: string;
}
