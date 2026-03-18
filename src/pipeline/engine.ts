import { writeFile, mkdir, rename } from "node:fs/promises";
import { join } from "node:path";
import { execa } from "execa";
import type { AgentManager } from "../agents/manager.js";
import type { WorktreeManager } from "../worktree/manager.js";
import type {
  PipelineTemplate,
  PipelineState,
  PipelineStatus,
  StageTransition,
  AgentId,
} from "../agents/types.js";
import type { ProgressReporter } from "../interaction/progress.js";
import { fanOut } from "../council/fanout.js";
import { crossReview } from "../council/review.js";
import { synthesize } from "../council/synthesis.js";

interface PipelineEngineOptions {
  taskId: string;
  template: PipelineTemplate;
  task: string;
  params: Record<string, unknown>;
  agentManager: AgentManager;
  worktreeManager: WorktreeManager;
  timeout: number;
  progress?: ProgressReporter;
}

interface PipelineResult {
  status: PipelineStatus;
  history: StageTransition[];
  duration_ms: number;
  finalOutput: string;
}

export class PipelineEngine {
  private state: PipelineState;
  private stateDir: string;

  constructor(private options: PipelineEngineOptions) {
    this.stateDir = join(process.cwd(), ".aog", "sessions");
    this.state = {
      taskId: options.taskId,
      description: options.task,
      pipeline: options.template.name,
      status: "pending",
      currentStage: "",
      implementations: {},
      reviews: {},
      synthesis: null,
      history: [],
      startedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
  }

  async run(): Promise<PipelineResult> {
    const startTime = Date.now();
    this.state.status = "running";
    await this.persistState();

    try {
      for (const stage of this.options.template.stages) {
        if (Date.now() - startTime > this.options.timeout) {
          this.state.status = "failed";
          this.recordTransition(stage.id, "failed", undefined, { reason: "Pipeline timeout" });
          break;
        }

        this.state.currentStage = stage.id;
        this.recordTransition(stage.id, "started");
        if (this.options.progress) {
          await this.options.progress.pipelineStageStarted(stage.id);
        }
        await this.persistState();

        try {
          await this.executeStage(stage);

          // Approval stage pauses the pipeline — stop the loop
          if ((this.state.status as string) === "waiting_approval") {
            this.recordTransition(stage.id, "completed", undefined, { paused: true });
            if (this.options.progress) {
              await this.options.progress.pipelineStageCompleted(stage.id);
            }
            break;
          }

          this.recordTransition(stage.id, "completed");
          if (this.options.progress) {
            await this.options.progress.pipelineStageCompleted(stage.id);
          }
        } catch (error) {
          const message = error instanceof Error ? error.message : "Unknown error";
          this.recordTransition(stage.id, "failed", undefined, { error: message });
          if (this.options.progress) {
            await this.options.progress.pipelineStageFailed(stage.id, message);
          }

          if (stage.on_failure !== "continue") {
            this.state.status = "failed";
            break;
          }
        }

        await this.persistState();
      }

      if (this.state.status === "running") {
        this.state.status = "completed";
      }
    } catch {
      this.state.status = "failed";
    }

    await this.persistState();

    return {
      status: this.state.status,
      history: this.state.history,
      duration_ms: Date.now() - startTime,
      finalOutput: this.buildFinalOutput(),
    };
  }

  private async executeStage(stage: PipelineTemplate["stages"][0]): Promise<void> {
    switch (stage.type) {
      case "fan-out": return this.executeFanOut(stage);
      case "cross-review": return this.executeCrossReview();
      case "chairman": return this.executeChairman(stage);
      case "test": return this.executeTest(stage);
      case "sequential": return this.executeSequential(stage);
      case "approval": return this.executeApproval();
      default: throw new Error(`Unknown stage type: ${stage.type}`);
    }
  }

  private async executeFanOut(stage: PipelineTemplate["stages"][0]): Promise<void> {
    const agents = (stage.agents ?? this.options.agentManager.getAvailableAgents())
      .filter((a) => this.options.agentManager.isAvailable(a));

    const implementations = await fanOut({
      taskId: this.options.taskId,
      task: this.options.task,
      agents,
      agentManager: this.options.agentManager,
      worktreeManager: this.options.worktreeManager,
      timeout: stage.timeout ? stage.timeout * 1000 : undefined,
      progress: this.options.progress,
    });

    this.state.implementations = implementations;
  }

  private async executeCrossReview(): Promise<void> {
    const agents = this.options.agentManager.getAvailableAgents();

    const reviews = await crossReview({
      taskId: this.options.taskId,
      implementations: this.state.implementations,
      agents,
      agentManager: this.options.agentManager,
      progress: this.options.progress,
    });

    this.state.reviews = reviews;
  }

  private async executeChairman(stage: PipelineTemplate["stages"][0]): Promise<void> {
    const chairman = (stage.chairman as AgentId) ?? "claude";

    const result = await synthesize({
      taskId: this.options.taskId,
      implementations: this.state.implementations,
      reviews: this.state.reviews,
      chairman,
      agentManager: this.options.agentManager,
      worktreeManager: this.options.worktreeManager,
      progress: this.options.progress,
    });

    this.state.synthesis = result;
  }

  private async executeTest(stage: PipelineTemplate["stages"][0]): Promise<void> {
    const command = stage.command ?? "npm test";

    for (const [, impl] of Object.entries(this.state.implementations)) {
      if (impl.status !== "completed" || !impl.worktreePath) continue;

      try {
        const { stdout, stderr, exitCode } = await execa("sh", ["-c", command], {
          cwd: impl.worktreePath,
          timeout: (stage.timeout ?? 120) * 1000,
          reject: false,
        });

        impl.testResults = {
          passed: exitCode === 0,
          exit_code: exitCode ?? 1,
          stdout: stdout.slice(0, 5000),
          stderr: stderr.slice(0, 5000),
        };
      } catch {
        impl.testResults = { passed: false, exit_code: 1, stdout: "", stderr: "Test execution failed" };
      }
    }
  }

  /**
   * Execute a sequential stage. If the stage has a prompt_template, spawn an agent
   * to execute it. If it has a command, run that as a shell command. A stage can
   * have both (agent work + verification command).
   */
  private async executeSequential(stage: PipelineTemplate["stages"][0]): Promise<void> {
    // If the stage has a prompt template, spawn an agent to execute it
    if (stage.prompt_template) {
      const agents = stage.agents ?? this.options.agentManager.getAvailableAgents();
      const agent = agents.find((a) => this.options.agentManager.isAvailable(a));

      if (!agent) {
        throw new Error(`No available agent for sequential stage "${stage.id}"`);
      }

      // Build the prompt: combine task context with the stage's prompt template
      const prompt = `${this.options.task}\n\n---\n\n${stage.prompt_template}`;

      if (this.options.progress) {
        await this.options.progress.notify(`${agent}: working on ${stage.id}…`, stage.id, agent);
      }

      const result = await this.options.agentManager.spawn(agent, {
        prompt,
        cwd: process.cwd(),
        taskId: `${this.options.taskId}-${stage.id}`,
        timeout: stage.timeout ? stage.timeout * 1000 : 300_000,
        allowPermissionBypass: true,
      });

      if (result.status !== "completed") {
        throw new Error(`Agent ${agent} failed on stage "${stage.id}": ${result.result.slice(0, 200)}`);
      }

      if (this.options.progress) {
        await this.options.progress.notify(
          `${agent}: completed ${stage.id} (${(result.duration_ms / 1000).toFixed(0)}s)`,
          stage.id,
          agent
        );
      }
    }

    // If the stage has a shell command, run it
    if (stage.command) {
      await execa("sh", ["-c", stage.command], {
        cwd: process.cwd(),
        timeout: (stage.timeout ?? 120) * 1000,
      });
    }

    // A stage with neither prompt_template nor command is a no-op (log it)
    if (!stage.prompt_template && !stage.command) {
      console.error(`[aog] Warning: sequential stage "${stage.id}" has no prompt_template or command — skipping`);
    }
  }

  private async executeApproval(): Promise<void> {
    // TODO: Pipeline resume after approval pause is not yet built.
    // For now, log a warning and auto-approve so the pipeline continues.
    // When resume is implemented, this will set waiting_approval and break.
    console.error(
      `[aog] Approval stage auto-approved (pipeline resume not yet implemented). ` +
      `Review outputs in .aog/sessions/${this.options.taskId}.json`
    );
  }

  private recordTransition(
    stage: string,
    event: StageTransition["event"],
    agent?: AgentId,
    details?: Record<string, unknown>
  ): void {
    this.state.history.push({
      timestamp: new Date().toISOString(),
      stage,
      event,
      agent,
      details,
    });
    this.state.updatedAt = new Date().toISOString();
  }

  private async persistState(): Promise<void> {
    await mkdir(this.stateDir, { recursive: true });
    const filePath = join(this.stateDir, `${this.options.taskId}.json`);
    const tmpPath = filePath + ".tmp";
    await writeFile(tmpPath, JSON.stringify(this.state, null, 2), "utf-8");
    await rename(tmpPath, filePath);
  }

  private buildFinalOutput(): string {
    if (this.state.synthesis) return this.state.synthesis.summary;

    const completed = Object.entries(this.state.implementations)
      .filter(([, impl]) => impl.status === "completed")
      .map(([agent]) => agent);

    return `Pipeline ${this.state.pipeline} ${this.state.status}. Completed agents: ${completed.join(", ")}`;
  }
}
