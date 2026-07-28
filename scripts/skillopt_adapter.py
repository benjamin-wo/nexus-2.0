#!/usr/bin/env python3
"""
SkillOpt Adapter for Nexus Assistant.
Converts Nexus execution logs into trajectory datasets for SkillOpt text-space optimization.
"""

import os
import sys
import json
import sqlite3
from pathlib import Path

def extract_nexus_trajectories(db_path="assistant.db", limit=50):
    """
    Reads recent logs from assistant.db and formats them into SkillOpt trajectory rollouts.
    """
    if not os.path.exists(db_path):
        print(f"[SkillOpt Adapter] Database file {db_path} not found.")
        return []

    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    cursor = conn.cursor()

    try:
        cursor.execute("SELECT * FROM logs ORDER BY id DESC LIMIT ?", (limit,))
        rows = cursor.fetchall()
    except Exception as e:
        print(f"[SkillOpt Adapter] Error querying logs: {e}")
        return []
    finally:
        conn.close()

    trajectories = []
    for row in rows:
        r_dict = dict(row)
        trajectories.append({
            "id": r_dict.get("id"),
            "category": r_dict.get("category"),
            "message": r_dict.get("message"),
            "is_error": bool(r_dict.get("is_error")),
            "created_at": r_dict.get("created_at")
        })

    return trajectories

def generate_skillopt_benchmark(eval_file=".agent/evals/eval_dataset.json", output_dir="skillopt_dataset"):
    """
    Generates a SkillOpt compatible benchmark dataset from Nexus eval definitions.
    """
    os.makedirs(output_dir, exist_ok=True)
    
    if not os.path.exists(eval_file):
        default_evals = [
            {
                "id": "eval_calc_1",
                "skill": "calculator",
                "input": "Calculate 15 * 4 + 10",
                "expected_contains": "70"
            },
            {
                "id": "eval_search_1",
                "skill": "webSearch",
                "input": "What's the weather in Tokyo?",
                "expected_contains": "Tokyo"
            }
        ]
        os.makedirs(os.path.dirname(eval_file), exist_ok=True)
        with open(eval_file, "w") as f:
            json.dump(default_evals, f, indent=2)

    with open(eval_file, "r") as f:
        eval_data = json.load(f)

    benchmark_path = os.path.join(output_dir, "nexus_benchmark.json")
    with open(benchmark_path, "w") as f:
        json.dump({
            "name": "nexus_skills_benchmark",
            "eval_count": len(eval_data),
            "evals": eval_data
        }, f, indent=2)

    print(f"[SkillOpt Adapter] Exported benchmark to {benchmark_path}")
    return benchmark_path

def main():
    print("[SkillOpt Adapter] Initializing Nexus -> SkillOpt bridge...")
    trajectories = extract_nexus_trajectories()
    print(f"[SkillOpt Adapter] Loaded {len(trajectories)} log entries.")
    
    benchmark = generate_skillopt_benchmark()
    print(f"[SkillOpt Adapter] Ready for SkillOpt rollout optimization using {benchmark}.")

if __name__ == "__main__":
    main()
