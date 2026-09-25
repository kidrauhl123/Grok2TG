/**
 * Split a turn's assistant text into process narration and the final answer.
 *
 * Grok streams one reply as a run of body chunks broken up by tool calls. A
 * body segment that is followed by a tool call is the model narrating what it
 * is about to do — Hermes sends each of those as its own message, separate
 * from the tool bubble. Only the segment that comes after the last tool call
 * is the answer. A turn that never called a tool is entirely the answer.
 */

export type TurnPart =
  | { kind: "body"; text: string }
  | { kind: "tool" };

export interface SplitBody {
  /** Narration segments, in order. Each one is its own process message. */
  process: string[];
  /** The final answer. Empty when the turn ended on a tool call. */
  answer: string;
}

export function splitBodySegments(parts: TurnPart[]): SplitBody {
  // Body that arrives before any tool call is narration. Once a tool call has
  // happened, body that follows it is the answer — until the next tool call
  // pushes that text back into narration.
  const process: string[] = [];
  let current = "";
  let answer = "";
  let afterTool = false;
  let sawTool = false;

  const closeSegment = (): void => {
    const text = current.trim();
    current = "";
    if (!text) return;
    if (afterTool) answer = answer ? `${answer}\n\n${text}` : text;
    else process.push(text);
  };

  for (const part of parts) {
    if (part.kind === "tool") {
      closeSegment();
      sawTool = true;
      // The text held as the answer was followed by another tool call, so it
      // was narration too.
      if (answer) {
        process.push(answer);
        answer = "";
      }
      afterTool = true;
      continue;
    }
    current += part.text;
  }
  closeSegment();

  if (!sawTool) return { process: [], answer: [...process, answer].filter(Boolean).join("\n\n") };
  return { process, answer };
}
