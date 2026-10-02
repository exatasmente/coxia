import { useState } from 'react';
import { api } from '../api';
import { setSpeechEnabled, useSpeechEnabled } from '../audio';
import { useVoiceEnabled } from '../i18n';
import { SpeakerOffIcon, SpeakerOnIcon } from './dashIcons';

// Quick switch in the top bar; the same flag lives in Settings → Voz.
export function VoiceToggle() {
  const on = useSpeechEnabled();
  const voiceOn = useVoiceEnabled();
  const [saving, setSaving] = useState(false);

  const toggle = async () => {
    setSaving(true);
    try {
      const s = await api.getSettings();
      const saved = await api.saveSettings({ ...s, voice: { ...s.voice, speak: !s.voice.speak } });
      setSpeechEnabled(saved.voice.speak);
    } finally {
      setSaving(false);
    }
  };

  // The speaker switch is a sub-option of voice: with voice off there is nothing to silence.
  if (!voiceOn) return null;
  return (
    <button
      type="button"
      className={`btn icon-btn ${on ? '' : 'btn-amber'}`}
      aria-pressed={on}
      aria-label="Voz dos agentes"
      disabled={saving}
      title={on ? 'Os agentes falam em voz alta. Toque para silenciar.' : 'Os agentes só escrevem na tela. Toque para voltar a falar.'}
      onClick={() => void toggle()}
    >
      {on ? <SpeakerOnIcon /> : <SpeakerOffIcon />}
    </button>
  );
}
