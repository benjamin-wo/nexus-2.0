import { join, resolve } from "path";
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

export const DEPRECATED_SKILL_MAPPINGS: { [key: string]: string } = {
  reminder: "schedule",
  gmail: "email",
  outlookEmail: "email",
  googleMaps: "maps",
  ltaDataMall: "maps",
  searchWeb: "webSearch",
  webScraper: "webSearch",
  getExpenses: "expenses",
  logExpense: "expenses",
  splitBill: "expenses",
  getResearchNotes: "notes",
  saveResearchNote: "notes",
  htmlAnything: "webPage",
  hostHtmlPage: "webPage",
  "web-design-guidelines": "webPage"
};

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
        if (this.skills.has(name)) {
          console.warn(`[SkillRegistry] Skipping DB skill '${name}' because a native hardcoded skill with the same name already exists.`);
          continue;
        }
        const description = skill.description;
        const parameters = skill.paramSchema;
        const code = skill.code;
        const instructions = skill.instructions;

        // Write to cache file because Bun's import() rejects long data URIs with NameTooLong
        const { writeFileSync, mkdirSync, readdirSync, unlinkSync } = await import("fs");
        const { join } = await import("path");
        const cacheDir = join(process.cwd(), ".agent", "cache");
        try { mkdirSync(cacheDir, { recursive: true }); } catch (e) {}

        // Prune older transpiled files for this skill to prevent directory bloat
        try {
          const files = readdirSync(cacheDir);
          for (const file of files) {
            if (file.startsWith(`${name}_`) && file.endsWith(".js")) {
              unlinkSync(join(cacheDir, file));
            }
          }
        } catch (_) {}

        const tmpFile = join(cacheDir, `${name}_${Date.now()}.js`);

        // Resolve relative imports against the skill's source directory so they
        // survive the move into the flat .agent/cache directory:
        //  - ../../../src/...  →  <cwd>/src/...  (replaces the old manual rewrite)
        //  - ./siblingHelper   →  <cwd>/.agent/skills/<name>/siblingHelper
        // This keeps multi-file skills (e.g. webPage + its helper modules) loadable.
        const skillSourceDir = join(this.skillsDir, name);
        let fixedCode = code.replace(/(from\s+['"])(\.\.?\/[^'"]+)(['"])/g, (_m, pre, spec, post) => {
          return `${pre}${resolve(skillSourceDir, spec)}${post}`;
        });
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
    const resolvedName = DEPRECATED_SKILL_MAPPINGS[name] || name;
    if (resolvedName !== name) {
      console.warn(`[SkillRegistry] Mapping deprecated skill call '${name}' to '${resolvedName}'`);
      context = { ...context, alias: name };
    }

    const skill = this.skills.get(resolvedName);
    if (!skill) {
      throw new Error(`Skill '${resolvedName}' not found in registry.`);
    }
    return skill.execute(args, context);
  }
}
