import { join } from "path";
import { readdir, readFile } from "fs/promises";
import { existsSync } from "fs";
import YAML from "yaml";

export interface Skill {
  name: string;
  description: string;
  parameters: any;
  instructions: string;
  handlerPath: string;
  execute: (args: any, context?: any) => Promise<any>;
}

export class SkillRegistry {
  private static instance: SkillRegistry | null = null;
  private skills = new Map<string, Skill>();
  private skillsDir: string;

  private constructor() {
    this.skillsDir = join(process.cwd(), ".agent", "skills");
  }

  static getInstance(): SkillRegistry {
    if (!SkillRegistry.instance) {
      SkillRegistry.instance = new SkillRegistry();
    }
    return SkillRegistry.instance;
  }

  async initialize(): Promise<void> {
    await this.reload();
  }

  async reload(): Promise<void> {
    this.skills.clear();

    const { StorageService } = await import("../database/Storage");
    const storage = new StorageService();
    await storage.initialize();
    await storage.checkAndSeedSkills();

    const dbSkills = await storage.getSkills();

    for (const skill of dbSkills) {
      try {
        const name = skill.name;
        const description = skill.description;
        const parameters = skill.paramSchema;
        const code = skill.code;
        const instructions = skill.instructions;

        // Write to cache file because Bun's import() rejects long data URIs with NameTooLong
        const { writeFileSync, mkdirSync } = await import("fs");
        const { join } = await import("path");
        const cacheDir = join(process.cwd(), ".agent", "cache");
        try { mkdirSync(cacheDir, { recursive: true }); } catch (e) {}
        const tmpFile = join(cacheDir, `${name}_${Date.now()}.js`);
        
        // Fix relative paths for the new location (.agent/cache is 2 levels deep, not 3)
        let fixedCode = code.replace(/(['"])\.\.\/\.\.\/\.\.\/src\//g, "$1../../src/");
        const transpiler = new Bun.Transpiler({ loader: "ts" });
        const transpiled = transpiler.transformSync(fixedCode);
        writeFileSync(tmpFile, transpiled);
        
        // Execute in-memory runtime hook
        const handlerModule = await import(tmpFile);

        if (typeof handlerModule.execute !== "function") {
          console.warn(`[SkillRegistry] handler code for '${name}' must export a function named 'execute'.`);
          continue;
        }

        this.skills.set(name, {
          name,
          description,
          parameters,
          instructions: instructions || "",
          handlerPath: `db://${name}`,
          execute: handlerModule.execute,
        });
      } catch (error: any) {
        console.error(`[SkillRegistry] Failed to load skill '${skill.name}':`, error.message);
      }
    }
    
    await storage.close();
  }

  getSkills(): Skill[] {
    return Array.from(this.skills.values());
  }

  getSkill(name: string): Skill | undefined {
    return this.skills.get(name);
  }

  async executeSkill(name: string, args: any, context?: any): Promise<any> {
    const skill = this.skills.get(name);
    if (!skill) {
      throw new Error(`Skill '${name}' not found in registry.`);
    }
    return skill.execute(args, context);
  }
}
