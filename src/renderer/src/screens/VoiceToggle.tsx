import { useEffect, useState } from 'react';
import { api } from '../api';
import { setSpeechEnabled, speechEnabled } from '../audio';

// Quick switch in the header; the same flag lives in Settings → Voz.
export function VoiceToggle() {
  const [on, setOn] = useState(speechEnabled());
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    void api.getSettings().then((s) => setOn(s.voice.speak));
  }, []);

  const toggle = async () => {
    setSaving(true);
    try {
      const s = await api.getSettings();
      const saved = await api.saveSettings({ ...s, voice: { ...s.voice, speak: !s.voice.speak } });
      setSpeechEnabled(saved.voice.speak);
      setOn(saved.voice.speak);
    } finally {
      setSaving(false);
    }
  };

  return (
    <button
      type="button"
      className={`btn ${on ? '' : 'btn-amber'}`}
      style={{ minHeight: 34 }}
      aria-pressed={!on}
      disabled={saving}
      title={on ? 'Os agentes falam em voz alta. Clique para silenciar.' : 'Os agentes só escrevem na tela. Clique para voltar a falar.'}
      onClick={() => void toggle()}
    >
      {on ? 'Voz ligada' : 'Voz desligada'}
    </button>
  );
}
