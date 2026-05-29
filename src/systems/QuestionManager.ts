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
 * equally likely), avoiding repeats within a run and shuffling the options while tracking the
 * correct answer by its string (CLAUDE.md section 6).
 */
export class QuestionManager {
  private readonly all: Question[];
  private readonly seen = new Set<string>();

  constructor(questions: Question[]) {
    this.all = questions;
  }

  /**
   * Pick the next unseen question from the whole bank. When every question has been seen, the
   * seen set resets so the bank can repeat (CLAUDE.md section 6). The score argument is kept
   * for call-site compatibility but no longer influences difficulty.
   */
  next(_score: number): QuizDraw {
    if (this.all.length === 0) {
      // Defensive: should never happen if questions.json loaded.
      return {
        id: "none",
        sentence: "…",
        options: ["—"],
        answer: "—",
        explanation: "",
      };
    }
    if (this.seen.size >= this.all.length) this.seen.clear();

    const pool = this.all.filter((q) => !this.seen.has(q.id));
    const q = pool[Math.floor(Math.random() * pool.length)];
    this.seen.add(q.id);

    return {
      id: q.id,
      sentence: q.sentence,
      options: this.shuffle(q.options),
      answer: q.answer,
      explanation: q.explanation,
    };
  }

  private shuffle(items: string[]): string[] {
    const out = items.slice();
    for (let i = out.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [out[i], out[j]] = [out[j], out[i]];
    }
    return out;
  }
}
