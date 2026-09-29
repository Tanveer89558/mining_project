import { StrictMode, useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import '../styles.css';

const MAX_UPLOAD_BYTES = 100 * 1024 * 1024;
const API_BASE = (import.meta.env.VITE_API_BASE || 'http://127.0.0.1:8000').replace(/\/$/, '');

const WAVE_HEIGHTS = [
  18, 34, 52, 28, 66, 40, 78, 55, 30, 62, 44, 86, 58, 36, 70, 48, 82, 60, 32, 74,
  46, 68, 38, 90, 54, 42, 76, 50, 28, 64, 47, 72, 35, 58, 80, 43, 67, 39, 55, 73,
  41, 61, 33, 69, 49, 77, 45, 59, 31, 65,
];

function formatBytes(bytes) {
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function ticksToClock(ticks) {
  const totalSeconds = Math.max(0, Math.floor(Number(ticks || 0) / 10_000_000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

function speakerTone(index) {
  if (index % 3 === 0) return 'a';
  if (index % 3 === 1) return 'b';
  return 'c';
}

function formatSpeakerLabel(raw, index) {
  const cleaned = String(raw || `Speaker ${index + 1}`).replace(/Guest-/i, 'SPEAKER ');
  return cleaned.toUpperCase();
}

function App() {
  const [selectedFile, setSelectedFile] = useState(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState(null);
  const [previewUrl, setPreviewUrl] = useState('');
  const [playbackProgress, setPlaybackProgress] = useState(0);
  const [durationLabel, setDurationLabel] = useState('00:00');
  const [currentLabel, setCurrentLabel] = useState('00:00');
  const fileInputRef = useRef(null);
  const audioRef = useRef(null);

  useEffect(() => {
    if (!selectedFile) {
      setPreviewUrl('');
      setPlaybackProgress(0);
      setCurrentLabel('00:00');
      setDurationLabel('00:00');
      return undefined;
    }
    const objectUrl = URL.createObjectURL(selectedFile);
    setPreviewUrl(objectUrl);
    return () => URL.revokeObjectURL(objectUrl);
  }, [selectedFile]);

  function chooseFile(file) {
    if (!file) return;
    setError('');
    setResult(null);
    if (!file.name.toLowerCase().endsWith('.wav')) {
      setError('Choose a WAV audio file to continue.');
      return;
    }
    if (file.size > MAX_UPLOAD_BYTES) {
      setError('This file is larger than the 100 MB upload limit.');
      return;
    }
    if (file.size === 0) {
      setError('This audio file is empty. Choose another file.');
      return;
    }
    setSelectedFile(file);
  }

  function clearFile() {
    setSelectedFile(null);
    setResult(null);
    setIsPlaying(false);
    if (fileInputRef.current) fileInputRef.current.value = '';
  }

  async function runDiarization() {
    if (!selectedFile || isProcessing) return;

    setError('');
    setResult(null);
    setIsProcessing(true);

    const payload = new FormData();
    payload.append('audio', selectedFile);

    try {
      const response = await fetch(`${API_BASE}/api/process`, { method: 'POST', body: payload });
      const contentType = response.headers.get('content-type') || '';
      const raw = await response.text();

      let data = null;
      if (contentType.includes('application/json')) {
        data = JSON.parse(raw);
      } else {
        try {
          data = JSON.parse(raw);
        } catch {
          throw new Error(
            response.status === 404
              ? 'API not found. Start the backend with: uvicorn api:app --reload --port 8000'
              : `Backend returned non-JSON (HTTP ${response.status}). Is uvicorn running on port 8000?`,
          );
        }
      }

      if (!response.ok) {
        const detail = data?.detail;
        const message = typeof detail === 'string'
          ? detail
          : Array.isArray(detail)
            ? detail.map((item) => item.msg || JSON.stringify(item)).join('; ')
            : 'The audio could not be processed.';
        throw new Error(message);
      }
      setResult(data);
    } catch (requestError) {
      const message = requestError.message || 'Could not connect to the diarization service.';
      setError(
        /Failed to fetch|NetworkError|fetch/i.test(message)
          ? 'Cannot reach API at http://127.0.0.1:8000. Start it with: uvicorn api:app --reload --port 8000'
          : message,
      );
    } finally {
      setIsProcessing(false);
    }
  }

  async function handlePlayStream() {
    setError('');

    if (!selectedFile) {
      setError('Select a WAV file to play the stream.');
      return;
    }

    await runDiarization();

    if (audioRef.current && previewUrl) {
      try {
        await audioRef.current.play();
        setIsPlaying(true);
      } catch {
        setIsPlaying(false);
      }
    }
  }

  function handleTimeUpdate() {
    const audio = audioRef.current;
    if (!audio || !audio.duration) return;
    const progress = audio.currentTime / audio.duration;
    setPlaybackProgress(progress);
    setCurrentLabel(ticksToClock(audio.currentTime * 10_000_000));
    setDurationLabel(ticksToClock(audio.duration * 10_000_000));
  }

  const transcriptItems = useMemo(() => {
    if (!result?.transcriptions?.length) return [];

    const speakerOrder = [];
    return result.transcriptions.map((item, index) => {
      const key = item.speaker || `Speaker-${index}`;
      if (!speakerOrder.includes(key)) speakerOrder.push(key);
      const toneIndex = speakerOrder.indexOf(key);
      const start = ticksToClock(item.offset);
      const end = ticksToClock(Number(item.offset || 0) + Number(item.duration || 0));
      return {
        id: `${key}-${item.offset}-${index}`,
        speaker: formatSpeakerLabel(key, toneIndex),
        text: item.text || '',
        start,
        end,
        tone: speakerTone(toneIndex),
      };
    });
  }, [result]);

  const riskScore = useMemo(() => {
    if (result?.total_score != null) {
      return Number(result.total_score);
    }
    return null;
  }, [result]);

  const reasoningText = useMemo(() => {
    if (!result) return 'Evaluator reasoning will appear after diarization completes.';
    return `Paragraph comparison complete. Similarity between the first two speakers is ${Number(result.total_score || 0).toFixed(3)} on a 0–1 scale.`;
  }, [result]);

  const alertTitle = result
    ? 'DIARIZATION COMPLETE'
    : isProcessing
      ? 'PROCESSING AUDIO STREAM'
      : 'READY: AWAITING AUDIO STREAM';

  const alertSub = result
    ? `${selectedFile?.name || 'Recording'} · ${result.transcriptions?.length || 0} segments`
    : isProcessing
      ? 'Speaker separation and comparison may take a few minutes.'
      : 'Upload a WAV recording, then play the stream to run diarization.';

  const statusText = isProcessing
    ? 'LIVE STATUS: PROCESSING PaaS STREAM...'
    : result
      ? 'LIVE STATUS: DIARIZATION COMPLETE'
      : selectedFile
        ? 'LIVE STATUS: READY TO PLAY STREAM'
        : 'LIVE STATUS: IDLE';

  const activeWaveIndex = Math.min(
    WAVE_HEIGHTS.length - 1,
    Math.floor(playbackProgress * WAVE_HEIGHTS.length),
  );

  return (
    <div className="app-shell">
      <header className="app-header">
        <div className="brand-block">
          <h1>Mining Voice AI Accelerator</h1>
          <p>Evolution Mining — Haulage Safety Pilot</p>
        </div>
        <div className="kpi-row">
          <div className="kpi-card">
            <span>Shift Coverage</span>
            <strong>100% Automated</strong>
          </div>
          <div className="kpi-card">
            <span>% Compliant (Shift)</span>
            <strong>92%</strong>
          </div>
          <div className="kpi-card">
            <span>Avg Review Cycle</span>
            <strong>1.2 s</strong>
          </div>
        </div>
      </header>

      <section className="alert-banner is-idle" aria-live="polite">
        <div className="alert-main">
          <div className="alert-icon" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none">
              <path d="M12 8v5m0 3.5h.01M4.6 19h14.8c1.4 0 2.3-1.5 1.6-2.7L13.6 4.8c-.7-1.2-2.5-1.2-3.2 0L3 16.3c-.7 1.2.2 2.7 1.6 2.7Z" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </div>
          <div className="alert-copy">
            <p className="alert-title">{alertTitle}</p>
            <p className="alert-sub">{alertSub}</p>
          </div>
        </div>
        <div className="alert-actions">
          <div className="risk-score">
            RISK SCORE{' '}
            <em>{riskScore == null ? '—' : riskScore.toFixed(2)}</em>
          </div>
          <button className="export-btn" type="button" disabled={!result}>
            Export to Training
          </button>
        </div>
      </section>

      <div className="dashboard-grid">
        <section className="panel" aria-labelledby="stream-heading">
          <h2 className="panel-heading" id="stream-heading">Stream Control & Audio</h2>

          <div className="file-row">
            <input
              ref={fileInputRef}
              className="file-field"
              type="file"
              accept=".wav,audio/wav,audio/x-wav"
              onChange={(event) => chooseFile(event.target.files?.[0])}
            />
            {selectedFile && (
              <div className="file-meta">
                <span>{selectedFile.name} · {formatBytes(selectedFile.size)}</span>
                <button className="clear-file" type="button" onClick={clearFile}>Clear</button>
              </div>
            )}
          </div>

          <button
            className={`play-btn${isProcessing ? ' is-busy' : ''}`}
            type="button"
            onClick={handlePlayStream}
            disabled={isProcessing || !selectedFile}
          >
            <svg viewBox="0 0 20 20" fill="none" aria-hidden="true">
              {isProcessing ? (
                <path d="M4 4h4v12H4V4Zm8 0h4v12h-4V4Z" fill="currentColor" />
              ) : (
                <path d="M6 4.5v11l10-5.5L6 4.5Z" fill="currentColor" />
              )}
            </svg>
            <span>{isProcessing ? 'Processing Stream' : 'Play Audio Stream'}</span>
          </button>

          <div className="waveform-card">
            <div className="waveform-header">
              <span>Audio Waveform</span>
              <span>{currentLabel} / {durationLabel}</span>
            </div>
            <div className="waveform-canvas" aria-hidden="true">
              <div className="wave-bars">
                {WAVE_HEIGHTS.map((height, index) => (
                  <span
                    key={`bar-${index}`}
                    className={
                      index === activeWaveIndex
                        ? 'is-active'
                        : index < activeWaveIndex
                          ? 'is-past'
                          : undefined
                    }
                    style={{ height: `${height}%` }}
                  />
                ))}
              </div>
              <div className="playhead" style={{ left: `${playbackProgress * 100}%` }} />
            </div>
          </div>

          {previewUrl && (
            <audio
              ref={audioRef}
              className="hidden-audio"
              src={previewUrl}
              onTimeUpdate={handleTimeUpdate}
              onLoadedMetadata={handleTimeUpdate}
              onEnded={() => setIsPlaying(false)}
              onPlay={() => setIsPlaying(true)}
              onPause={() => setIsPlaying(false)}
            />
          )}

          <div className="live-status">
            <span
              className={`status-dot${error ? ' is-error' : !isProcessing && !result && !isPlaying ? ' is-idle' : ''}`}
            />
            <span>{error ? 'LIVE STATUS: STREAM ERROR' : statusText}</span>
          </div>

          {error && <p className="error-banner" role="alert">{error}</p>}
        </section>

        <section className="panel transcript-panel" aria-labelledby="transcript-heading">
          <h2 className="panel-heading" id="transcript-heading">Diarized Live Transcript</h2>

          {transcriptItems.length === 0 ? (
            <div className="empty-transcript">
              No transcript yet. Upload a WAV and play the stream to run diarization.
            </div>
          ) : (
            <ol className="transcript-list">
              {transcriptItems.map((item) => (
                <li className={`utterance speaker-${item.tone}`} key={item.id}>
                  <div className="utterance-head">
                    <p className="speaker-name">{item.speaker}</p>
                    <span className="utterance-time">{item.start} — {item.end}</span>
                  </div>
                  <p className="utterance-text">{item.text}</p>
                </li>
              ))}
            </ol>
          )}

          <div className="reasoning-card">
            <h3>Evaluator Reasoning</h3>
            <p>{reasoningText}</p>
            <div className="reasoning-footer">
              risk_score: {riskScore == null ? '—' : riskScore.toFixed(2)}
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
