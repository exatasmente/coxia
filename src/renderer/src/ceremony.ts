import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type {
  AgentTurn,
  Card,
  CardsResult,
  Decision,
  DeepState,
  Effect,
  LogLine,
  Minutes,
  SaveResult,
  SavedCeremony,
  Voice,
} from '../../shared/types';
import { buildMinutes } from '../../shared/minutes';
import { FLUSH_EVENT } from '../../shared/update';
import { AGENT_COLORS, api, clock, errorText, moduleEvents } from './api';
import { withJob } from './jobs';

export type { LogLine };

const LIMIT = 8;
const PARALLEL = 3;
const SAVE_DELAY_MS = 400;

function newId(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.toLocaleDateString('sv-SE')}T${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

export const EMPTY_DEEP: DeepState = { sessionId: null, msgs: [], sources: [], options: null, pick: null, saved: false };

export function useCeremony() {
  const [restored, setRestored] = useState(false);
  const [id, setId] = useState(newId);
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
  const [deep, setDeep] = useState<Record<string, DeepState>>({});
  const [teams, setTeams] = useState<string | null>(null);
  const [teamsKey, setTeamsKey] = useState<string | null>(null);
  const [saveResult, setSaveResult] = useState<SaveResult | null>(null);
  const [resumed, setResumed] = useState(false);
  const [statusAt, setStatusAt] = useState<string | null>(null);
  const pending = useRef(new Map<string, Promise<AgentTurn>>());

  const loadCards = useCallback(async (refresh = false) => {
    setLoadingCards(true);
    setCardsError(null);
    try {
      setCards(await api.loadCards(LIMIT, refresh));
    } catch (e) {
      setCardsError(errorText(e));
    } finally {
      setLoadingCards(false);
    }
  }, []);

  const hydrate = useCallback((s: SavedCeremony) => {
    setId(s.id);
    setCards(s.cards);
    setTurns(s.turns);
    for (const [ref, turn] of Object.entries(s.turns)) pending.current.set(ref, Promise.resolve(turn));
    setDecisions(s.decisions);
    setEffects(s.effects);
    setAnswered(s.answered);
    setLog(s.log);
    setStartedAt(s.startedAt);
    setEndedAt(s.endedAt);
    setCallIdx(s.callIdx);
    setCallEnded(s.callEnded);
    setSpoken(s.spoken);
    setDeep(s.deep);
    setTeams(s.teams);
    setTeamsKey(s.teamsKey);
    setSaveResult(s.saveResult);
  }, []);

  // Today's ceremony comes back from disk; otherwise the cards are built from GitLab.
  useEffect(() => {
    void api.voices().then(setVoices);
    void api.loadState().then((saved) => {
      if (saved?.cards) {
        hydrate(saved);
        setResumed(true);
      } else void loadCards();
      setRestored(true);
    });
  }, [hydrate, loadCards]);

  const snapshot = useMemo(
    (): SavedCeremony => ({
      version: 1,
      id,
      kind: 'pre-daily',
      date: '',
      cards,
      turns,
      decisions,
      effects,
      answered,
      log,
      startedAt,
      endedAt,
      callIdx,
      callEnded,
      spoken,
      deep,
      teams,
      teamsKey,
      saveResult,
    }),
    [id, cards, turns, decisions, effects, answered, log, startedAt, endedAt, callIdx, callEnded, spoken, deep, teams, teamsKey, saveResult],
  );

  useEffect(() => {
    if (!restored || !snapshot.cards) return;
    const t = setTimeout(() => void api.saveState(snapshot), SAVE_DELAY_MS);
    return () => clearTimeout(t);
  }, [restored, snapshot]);

  // The app is about to quit for an update: write the ceremony now instead of waiting out the debounce, then say so.
  const latest = useRef({ snapshot, restored });
  latest.current = { snapshot, restored };
  useEffect(() => {
    const onFlush = () => {
      const { snapshot: s, restored: ready } = latest.current;
      const saved = ready && s.cards ? api.saveState(s) : Promise.resolve();
      void saved.catch(() => undefined).finally(() => void api.invoke('update:flushed').catch(() => undefined));
    };
    moduleEvents.addEventListener(FLUSH_EVENT, onFlush);
    return () => moduleEvents.removeEventListener(FLUSH_EVENT, onFlush);
  }, []);

  const reset = useCallback(async () => {
    pending.current.clear();
    hydrate({ ...snapshot, id: newId(), cards: null, turns: {}, decisions: [], effects: [], answered: {}, log: [], startedAt: null, endedAt: null, callIdx: -1, callEnded: false, spoken: {}, deep: {}, teams: null, teamsKey: null, saveResult: null });
    setTurnErrors({});
    setResumed(false);
    await loadCards(true);
  }, [hydrate, snapshot, loadCards]);

  // A status check refreshes the GitLab data of the cards already on the agenda; turns stay as they were.
  const mergeStatus = useCallback((result: CardsResult, checkedAt: string) => {
    setStatusAt(checkedAt);
    setCards((prev) =>
      prev ? { ...prev, generatedAt: result.generatedAt, cards: prev.cards.map((c) => result.cards.find((x) => x.ref === c.ref) ?? c) } : prev,
    );
  }, []);

  const getTurn = useCallback((card: Card): Promise<AgentTurn> => {
    const known = pending.current.get(card.ref);
    if (known) return known;
    const p = withJob(`prep:${card.ref}`, () => api.prepareTurn(card)).then(
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

  const indexOf = useCallback((ref: string) => Math.max(0, cards?.cards.findIndex((c) => c.ref === ref) ?? 0), [cards]);
  const colorOf = useCallback((ref: string) => AGENT_COLORS[indexOf(ref) % AGENT_COLORS.length], [indexOf]);
  const voiceOf = useCallback(
    (ref: string): Voice | null => (voices ? voices.agents[indexOf(ref) % voices.agents.length] : null),
    [voices, indexOf],
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

  const updateDeep = useCallback((ref: string, change: (d: DeepState) => DeepState) => {
    setDeep((all) => ({ ...all, [ref]: change(all[ref] ?? EMPTY_DEEP) }));
  }, []);

  const minutes = useMemo(
    (): Minutes => buildMinutes({ cards, turns, answered, decisions, effects, log, startedAt, endedAt }),
    [cards, turns, answered, decisions, effects, log, startedAt, endedAt],
  );

  return {
    restored,
    resumed,
    statusAt,
    mergeStatus,
    reset,
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
    deep,
    updateDeep,
    teams,
    teamsKey,
    setTeams: (text: string | null, key: string | null) => {
      setTeams(text);
      setTeamsKey(key);
    },
    snapshot,
    saveResult,
    setSaveResult,
    voices,
    colorOf,
    voiceOf,
    minutes,
  };
}

export type Ceremony = ReturnType<typeof useCeremony>;
