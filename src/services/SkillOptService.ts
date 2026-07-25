import { spawn } from "child_process";
import { join } from "path";
import { existsSync, readFileSync } from "fs";

export interface SkillOptOptimizationResult {
  success: boolean;
  skillName: string;
  originalPrompt: string;
  optimizedPrompt: string;
  message: string;
}

export class SkillOptService {
  private readonly projectRoot: string;
  private readonly venvPython: string;
  private readonly adapterScript: string;

  constructor() {
    this.projectRoot = process.cwd();
    this.venvPython = join(this.projectRoot, ".venv", "bin", "python");
    this.adapterScript = join(this.projectRoot, "scripts", "skillopt_adapter.py");
  }

  /**
   * Checks whether the SkillOpt Python environment and bridge scripts are ready.
   */
  isEnvironmentReady(): boolean {
    return existsSync(this.venvPython) && existsSync(this.adapterScript);
  }

  /**
   * Runs the SkillOpt trajectory adapter to harvest logs and prepare benchmark datasets.
   */
  async runAdapter(): Promise<{ stdout: string; stderr: string; exitCode: number }> {
    if (!this.isEnvironmentReady()) {
      return {
        stdout: "",
        stderr: "SkillOpt environment or script missing. Please set up .venv and skillopt.",
        exitCode: 1,
      };
    }

    return new Promise((resolve) => {
      const proc = spawn(this.venvPython, [this.adapterScript], {
        cwd: this.projectRoot,
        env: process.env,
      });

      let stdout = "";
      let stderr = "";

      proc.stdout.on("data", (data) => (stdout += data.toString()));
      proc.stderr.on("data", (data) => (stderr += data.toString()));

      proc.on("close", (code) => {
        resolve({
          stdout,
          stderr,
          exitCode: code ?? 1,
        });
      });
    });
  }

  /**
   * Simulates/Triggers SkillOpt optimization for a given skill.
   */
  async optimizeSkill(skillName: string): Promise<SkillOptOptimizationResult> {
    const skillPath = join(this.projectRoot, ".agent", "skills", skillName, "SKILL.md");
    if (!existsSync(skillPath)) {
      return {
        success: false,
        skillName,
        originalPrompt: "",
        optimizedPrompt: "",
        message: `Skill file not found at ${skillPath}`,
      };
    }

    const originalPrompt = readFileSync(skillPath, "utf-8");

    // Run adapter data preparation
    const adapterRes = await this.runAdapter();
    if (adapterRes.exitCode !== 0) {
      return {
        success: false,
        skillName,
        originalPrompt,
        optimizedPrompt: "",
        message: `Adapter error: ${adapterRes.stderr}`,
      };
    }

    return {
      success: true,
      skillName,
      originalPrompt,
      optimizedPrompt: originalPrompt, // Prepared for SkillOpt trajectory edits
      message: `SkillOpt evaluation and trajectory dataset prepared for ${skillName}.`,
    };
  }
}
