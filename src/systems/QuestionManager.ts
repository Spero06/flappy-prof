import { STORAGE } from "../config";
import type { Rng } from "./Rng";

export type Difficulty = "facile" | "moyen" | "difficile";

export interface Question {
  id: string;
  topic: string;
  difficulty: Difficulty;
  sentence: string;
  options: string[];
  answer: string;
  explanation: string;
}

/** A question prepared for display: options shuffled, correct one tracked by string. */
export interface QuizDraw {
  id: string;
  sentence: string;
  options: string[];
  answer: string;
  explanation: string;
}

/**
 * Loads public/questions.json (authored content — never modified here) and draws the next
 * question from a SINGLE pool of all questions (no difficulty tiering — every question is
 * equally likely), shuffling the options while tracking the correct answer by its string
 * (CLAUDE.md section 6).
 *
 * The set of already-seen ids is PERSISTED to localStorage (CLAUDE.md section 13), so a
 * question never repeats until the WHOLE bank has been shown — even across separate runs /
 * page reloads. Without this, `seen` reset every run and the same ~20-30 questions kept
 * resurfacing even though 180+ exist.
 */
export class QuestionManager {
  private readonly all: Question[];
  private seen: Set<string>;
  /** When set (multiplayer), draws + shuffles are DETERMINISTIC so every client sharing the
   *  seed sees the identical question + option order. No localStorage persistence in this mode. */
  private readonly rng?: Rng;

  constructor(questions: Question[], rng?: Rng) {
    this.all = questions;
    this.rng = rng;
    this.seen = rng ? new Set() : this.loadSeen();
  }

  next(_score: number): QuizDraw {
    if (this.all.length === 0) {
      // Defensive: should never happen if questions.json loaded.
      return { id: "none", sentence: "…", options: ["—"], answer: "—", explanation: "" };
    }
    if (this.seen.size >= this.all.length) this.seen.clear();

    const pool = this.all.filter((q) => !this.seen.has(q.id));
    const q = pool[this.randInt(pool.length)];
    this.seen.add(q.id);
    if (!this.rng) this.persist();

    return {
      id: q.id,
      sentence: q.sentence,
      options: this.shuffle(q.options),
      answer: q.answer,
      explanation: q.explanation,
    };
  }

  /** Integer in [0, n) — seeded in multiplayer, Math.random otherwise. */
  private randInt(n: number): number {
    return this.rng ? this.rng.int(0, n - 1) : Math.floor(Math.random() * n);
  }

  /** Load persisted seen-ids, dropping any that no longer exist in the bank. */
  private loadSeen(): Set<string> {
    try {
      const raw = localStorage.getItem(STORAGE.seenIds);
      if (raw) {
        const ids = JSON.parse(raw) as string[];
        const valid = new Set(this.all.map((q) => q.id));
        return new Set(ids.filter((id) => valid.has(id)));
      }
    } catch {
      // ignore corrupt/unavailable storage
    }
    return new Set();
  }

  private persist(): void {
    try {
      localStorage.setItem(STORAGE.seenIds, JSON.stringify([...this.seen]));
    } catch {
      // storage may be unavailable (private mode); the in-memory set still works for this run
    }
  }

  private shuffle(items: string[]): string[] {
    const out = items.slice();
    for (let i = out.length - 1; i > 0; i--) {
      const j = this.randInt(i + 1);
      [out[i], out[j]] = [out[j], out[i]];
    }
    return out;
  }
}
