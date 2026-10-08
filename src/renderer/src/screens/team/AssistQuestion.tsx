import { useId, useState } from 'react';
import { ASSIST_LIMITS, type AssistAnswer, type AssistQuestion } from '../../../../shared/agentAssist';
import { useT } from '../../i18n';
import { pickOption, withOther, withText } from './assistEdit';
import { Labeled } from './ui';

/**
 * One question of a round: an open one is a text box, a choice is radio buttons (one) or boxes (several), and a choice always ends in "Other" with a text of its own.
 * Every question may stay without an answer; the answer given is held by the screen, and this only says what it becomes.
 */
export function AssistQuestionView({ question, answer, disabled, onChange }: { question: AssistQuestion; answer: AssistAnswer; disabled?: boolean; onChange: (next: AssistAnswer) => void }) {
  const t = useT();
  const group = useId();
  // "Other" can be chosen with its text still empty, so that is the screen's to remember; a text already there means it was chosen.
  const [otherOn, setOtherOn] = useState(answer.other.trim() !== '');
  const why = question.why ? t('ui.team.assist.why', { why: question.why }) : undefined;

  if (question.kind === 'open') {
    return (
      <Labeled label={question.text} hint={why}>
        {(id) => <textarea id={id} className="text-input" rows={3} maxLength={ASSIST_LIMITS.answer} disabled={disabled} value={answer.text} onChange={(e) => onChange(withText(answer, e.target.value))} />}
      </Labeled>
    );
  }

  const single = question.kind === 'single';
  const answered = answer.picked.length > 0 || answer.other.trim() !== '' || otherOn;
  return (
    <fieldset className="wz-fieldset tm-assist-q" disabled={disabled}>
      <legend className="wz-label">{question.text}</legend>
      {why && <div className="small muted">{why}</div>}
      <div className="tm-checks">
        {question.options.map((option) => (
          <label key={option} className="tm-check">
            <input
              type={single ? 'radio' : 'checkbox'}
              name={group}
              checked={answer.picked.includes(option)}
              onChange={() => {
                if (single) setOtherOn(false);
                onChange(pickOption(answer, question, option));
              }}
            />
            <span>{option}</span>
          </label>
        ))}
        <label className="tm-check">
          <input
            type={single ? 'radio' : 'checkbox'}
            name={group}
            checked={otherOn}
            onChange={() => {
              if (single) {
                setOtherOn(true);
                onChange({ ...answer, picked: [] });
              } else {
                setOtherOn(!otherOn);
                if (otherOn) onChange({ ...answer, other: '' });
              }
            }}
          />
          <span>{t('ui.team.assist.other')}</span>
        </label>
      </div>
      {otherOn && <input className="text-input" aria-label={t('ui.team.assist.otherText')} maxLength={ASSIST_LIMITS.answer} value={answer.other} onChange={(e) => onChange(withOther(answer, question, e.target.value))} />}
      {answered && (
        <div>
          <button
            type="button"
            className="btn tm-mini"
            onClick={() => {
              setOtherOn(false);
              onChange({ question: answer.question, picked: [], other: '', text: '' });
            }}
          >
            {t('ui.team.assist.clear')}
          </button>
        </div>
      )}
    </fieldset>
  );
}
