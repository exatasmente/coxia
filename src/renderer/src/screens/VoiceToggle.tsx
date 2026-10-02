import { useState } from 'react';
import { api } from '../api';
import { setSpeechEnabled, useSpeechEnabled } from '../audio';
import { useT, useVoiceEnabled } from '../i18n';
import { SpeakerOffIcon, SpeakerOnIcon } from './dashIcons';

// Quick switch in the top bar; the same flag lives in Settings → Voz.
export function VoiceToggle() {
  const t = useT();
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
      aria-label={t('ui.voiceToggle.label')}
      disabled={saving}
      title={on ? t('ui.voiceToggle.on') : t('ui.voiceToggle.off')}
      onClick={() => void toggle()}
    >
      {on ? <SpeakerOnIcon /> : <SpeakerOffIcon />}
    </button>
  );
}
