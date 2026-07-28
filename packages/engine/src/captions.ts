import type { TranscriptWord } from './types'

export interface CaptionToken extends TranscriptWord {
  active: boolean
}

export function captionTokensAt(
  words: TranscriptWord[],
  time: number,
  maxWords: number,
): CaptionToken[] {
  const activeIndex = words.findIndex((word) => time >= word.start && time < word.end)
  if (activeIndex < 0) return []

  let utteranceStart = activeIndex
  while (
    utteranceStart > 0 &&
    words[utteranceStart]!.start - words[utteranceStart - 1]!.end < 1.2
  ) {
    utteranceStart -= 1
  }
  let utteranceEnd = activeIndex + 1
  while (
    utteranceEnd < words.length &&
    words[utteranceEnd]!.start - words[utteranceEnd - 1]!.end < 1.2
  ) {
    utteranceEnd += 1
  }
  const groupStart =
    utteranceStart + Math.floor((activeIndex - utteranceStart) / maxWords) * maxWords
  const group = words.slice(groupStart, Math.min(groupStart + maxWords, utteranceEnd))
  return group.map((word, index) => ({
    ...word,
    active: groupStart + index === activeIndex,
  }))
}
