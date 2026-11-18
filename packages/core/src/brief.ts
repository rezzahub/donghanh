import { Brief, Message } from "./primitives";

export function textBrief(text: string) {
  return Brief({ children: [Message({ children: text })] });
}
