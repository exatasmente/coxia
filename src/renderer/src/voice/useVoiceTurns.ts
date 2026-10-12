import { useCallback, useEffect, useRef, useState } from 'react';
import type { Voice } from '../../../shared/types';
import { useLiveAnswers } from '../liveApi';
import { useThread } from '../screens/cycle/forumApi';
import type { Player, SpeechStream } from './playback';
import { createTurnTracker } from './voiceTurns';

// Speaks the persona's answers to the turns this device sent by voice, sentence by sentence while they are written. With speech off the text shows and nothing is
// synthesized (the player's stream is silent then).

export interface TurnHandlers {
  /** The first text of the answer to `to` arrived. */
  started?: (to: number) => void;
  /** The answer to `to` is over and its speech finished (or was stopped). */
  done?: (to: number) => void;
}

export function useVoiceTurns(thread: string, player: Player, voice: Voice | null, who: string, handlers: TurnHandlers = {}) {
  const live = useLiveAnswers(thread);
  const { messages } = useThread(thread);
  const [tracker] = useState(createTurnTracker);
  const streams = useRef(new Map<number, SpeechStream>());
  // turns the person talked over or stopped: their remaining sentences are not spoken
  const silenced = useRef(new Set<number>());
  const [caption, setCaption] = useState('');
  const on = useRef(handlers);
  on.current = handlers;

  const feed = useCallback(() => {
    for (const u of tracker.feed(live, messages, Date.now())) {
      if (u.started) on.current.started?.(u.to);
      if (u.text) setCaption(u.text);
      let stream = streams.current.get(u.to);
      if (u.interrupted || silenced.current.has(u.to)) {
        stream?.cancel();
        streams.current.delete(u.to);
        if (u.done) on.current.done?.(u.to);
        continue;
      }
      if (u.speak.length && !stream && voice) {
        stream = player.sayStream(voice, who);
        streams.current.set(u.to, stream);
      }
      for (const sentence of u.speak) stream?.push(sentence);
      if (!u.done) continue;
      streams.current.delete(u.to);
      if (!stream) on.current.done?.(u.to);
      else {
        stream.end();
        void stream.done.then(() => on.current.done?.(u.to));
      }
    }
  }, [tracker, live, messages, player, voice, who]);

  const feedRef = useRef(feed);
  feedRef.current = feed;
  useEffect(() => feed(), [feed]);
  // an answer that failed leaves no event behind: look again while a turn is open
  useEffect(() => {
    const timer = window.setInterval(() => tracker.open().length > 0 && feedRef.current(), 1000);
    return () => window.clearInterval(timer);
  }, [tracker]);

  const mark = useCallback((seq: number) => {
    setCaption('');
    tracker.mark(seq, Date.now());
  }, [tracker]);

  /** Stops what is being said and keeps the rest of the open answers silent. */
  const silence = useCallback(() => {
    for (const seq of tracker.open()) silenced.current.add(seq);
    for (const stream of streams.current.values()) stream.cancel();
    streams.current.clear();
  }, [tracker]);

  useEffect(
    () => () => {
      for (const stream of streams.current.values()) stream.cancel();
      streams.current.clear();
      tracker.clear();
    },
    [tracker],
  );

  return { mark, silence, caption };
}
