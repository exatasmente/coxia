import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { AgentTurn, Card, CardsResult, Decision, Effect, Minutes, Voice } from '../../shared/types';
import { AGENT_COLORS, api, clock, errorText } from './api';

export interface LogLine {
  who: string;
  text: string;
  at: string;
  color: string;
}

const LIMIT = 8;
const PARALLEL = 3;

export function useCeremony() {
  const [cards, setCards] = useState<CardsResult | null>(null);
  const [cardsError, setCardsError] = useState<string | null>(null);
  const [loadingCards, setLoadingCards] = useState(false);
  const [turns, setTurns] = useState<Record<string, AgentTurn>>({});
  const [turnErrors, setTurnErrors] = useState<Record<string, string>>({});
  const [decisions, setDecisions] = useState<Decision[]>([]);
  const [effects, setEffects] = useState<Effect[]>([]);
  const [answered, setAnswered] = useState<Record<string, boolean>>({});
  const [log, setLog] = useState<LogLine[]>([]);
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [endedAt, setEndedAt] = useState<number | null>(null);
  const [voices, setVoices] = useState<{ moderator: Voice; agents: Voice[] } | null>(null);
  const [callIdx, setCallIdx] = useState(-1);
  const [callEnded, setCallEnded] = useState(false);
  const [spoken, setSpoken] = useState<Record<string, boolean>>({});
  const pending = useRef(new Map<string, Promise<AgentTurn>>());

  useEffect(() => {
    void api.voices().then(setVoices);
  }, []);

  const loadCards = useCallback(async () => {
    setLoadingCards(true);
    setCardsError(null);
    try {
      setCards(await api.loadCards(LIMIT));
    } catch (e) {
      setCardsError(errorText(e));
    } finally {
      setLoadingCards(false);
    }
  }, []);

  const getTurn = useCallback((card: Card): Promise<AgentTurn> => {
    const known = pending.current.get(card.ref);
    if (known) return known;
    const p = api.prepareTurn(card).then(
      (turn) => {
        setTurns((t) => ({ ...t, [card.ref]: turn }));
        return turn;
      },
      (e) => {
        pending.current.delete(card.ref);
        setTurnErrors((t) => ({ ...t, [card.ref]: errorText(e) }));
        throw e;
      },
    );
    pending.current.set(card.ref, p);
    return p;
  }, []);

  const prepareAll = useCallback(async () => {
    if (!cards) return;
    const queue = [...cards.cards];
    const worker = async () => {
      for (let card = queue.shift(); card; card = queue.shift()) await getTurn(card).catch(() => undefined);
    };
    await Promise.all(Array.from({ length: PARALLEL }, worker));
  }, [cards, getTurn]);

  const colorOf = useCallback(
    (ref: string) => AGENT_COLORS[Math.max(0, cards?.cards.findIndex((c) => c.ref === ref) ?? 0) % AGENT_COLORS.length],
    [cards],
  );

  const voiceOf = useCallback(
    (ref: string): Voice | null => {
      if (!voices) return null;
      const i = Math.max(0, cards?.cards.findIndex((c) => c.ref === ref) ?? 0);
      return voices.agents[i % voices.agents.length];
    },
    [cards, voices],
  );

  const addLog = useCallback(
    (who: string, text: string, color: string) => {
      const start = startedAt ?? Date.now();
      setLog((l) => [...l, { who, text, color, at: clock(start) }]);
    },
    [startedAt],
  );

  const start = useCallback(() => {
    if (startedAt) return;
    setStartedAt(Date.now());
    setEndedAt(null);
  }, [startedAt]);

  const minutes = useMemo((): Minutes => {
    const unanswered = (cards?.cards ?? [])
      .map((c) => ({ ref: c.ref, question: turns[c.ref]?.question ?? null }))
      .filter((u): u is { ref: string; question: string } => !!u.question && !answered[u.ref]);
    return {
      startedAt: new Date(startedAt ?? Date.now()).toISOString(),
      endedAt: new Date(endedAt ?? Date.now()).toISOString(),
      decisions,
      effects,
      unanswered,
      transcript: log.map((l) => ({ who: l.who, text: l.text, at: l.at })),
    };
  }, [cards, turns, answered, decisions, effects, log, startedAt, endedAt]);

  return {
    cards,
    cardsError,
    loadingCards,
    loadCards,
    turns,
    turnErrors,
    getTurn,
    prepareAll,
    decisions,
    addDecision: (d: Decision) => setDecisions((all) => [...all, d]),
    effects,
    addEffect: (e: Effect) => setEffects((all) => [...all, e]),
    answered,
    markAnswered: (ref: string) => setAnswered((a) => ({ ...a, [ref]: true })),
    log,
    addLog,
    startedAt,
    start,
    end: () => {
      setEndedAt(Date.now());
      setCallEnded(true);
    },
    callIdx,
    setCallIdx,
    callEnded,
    spoken,
    markSpoken: (ref: string) => setSpoken((s) => ({ ...s, [ref]: true })),
    voices,
    colorOf,
    voiceOf,
    minutes,
  };
}

export type Ceremony = ReturnType<typeof useCeremony>;
