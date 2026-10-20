import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './ui/styles.css';
import { installVoice, setTestTone, voiceDebug, voiceStereo } from './voice/voice';
import { useVoice } from './voice/voiceStore';
import { screenDebug, startTestShare, stopShare } from './screen/screenShare';

installVoice();

// Dev rejimida ovozni sinash: window.__debug.voice(), window.__debug.tone(440)
if (import.meta.env.DEV) {
  const w = window as unknown as { __debug?: Record<string, unknown> };
  w.__debug = { ...w.__debug, voice: () => ({ ...voiceDebug(), store: useVoice.getState() }), tone: setTestTone, stereo: voiceStereo,
    screenTest: startTestShare, screenStop: stopShare, screen: screenDebug };
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
