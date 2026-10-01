import { StrictMode, useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import '../styles.css';

const MAX_UPLOAD_BYTES = 100 * 1024 * 1024;
const API_BASE = (import.meta.env.VITE_API_BASE || '').replace(/\/$/, '');

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
  const [selectedSample, setSelectedSample] = useState(null);
  const [samples, setSamples] = useState([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState(null);
  const [previewUrl, setPreviewUrl] = useState('');
  const [playbackProgress, setPlaybackProgress] = useState(0);
  const [durationLabel, setDurationLabel] = useState('00:00');
  const [currentLabel, setCurrentLabel] = useState('00:00');
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef(null);
  const audioRef = useRef(null);
  const waveformRef = useRef(null);
  const wasPlayingBeforeDragRef = useRef(false);

  const hasAudioSource = Boolean(selectedFile || selectedSample);

  useEffect(() => {
    let cancelled = false;

    async function loadSamples() {
      try {
        const response = await fetch(`${API_BASE}/api/samples`);
        if (!response.ok) return;
        const data = await response.json();
        if (!cancelled) setSamples(Array.isArray(data?.samples) ? data.samples : []);
      } catch {
        if (!cancelled) setSamples([]);
      }
    }

    loadSamples();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    setPlaybackProgress(0);
    setCurrentLabel('00:00');
    setDurationLabel('00:00');
    setIsPlaying(false);

    if (selectedFile) {
      const objectUrl = URL.createObjectURL(selectedFile);
      setPreviewUrl(objectUrl);
      return () => URL.revokeObjectURL(objectUrl);
    }

    if (selectedSample?.audio_url) {
      setPreviewUrl(`${API_BASE}${selectedSample.audio_url}`);
      return undefined;
    }

    setPreviewUrl('');
    return undefined;
  }, [selectedFile, selectedSample]);

  function chooseFile(file) {
    if (!file) return;
    setError('');
    setResult(null);
    setSelectedSample(null);
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

  function chooseSample(sample) {
    if (!sample || isProcessing) return;
    setError('');
    setResult(null);
    setSelectedFile(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
    setSelectedSample(sample);
  }

  function clearFile() {
    setSelectedFile(null);
    setSelectedSample(null);
    setResult(null);
    setIsPlaying(false);
    if (fileInputRef.current) fileInputRef.current.value = '';
  }

  async function runDiarization() {
    if ((!selectedFile && !selectedSample) || isProcessing) return;

    setError('');
    setResult(null);
    setIsProcessing(true);

    const payload = new FormData();
    if (selectedSample) {
      payload.append('sample_id', selectedSample.id);
    } else {
      payload.append('audio', selectedFile);
    }

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
              ? 'API route not found. Check that the backend is running.'
              : `Backend returned non-JSON (HTTP ${response.status}).`,
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
          ? 'Cannot reach the API. Check that the backend is running and reachable.'
          : message,
      );
    } finally {
      setIsProcessing(false);
    }
  }

  async function exportToTraining() {
    if (!result?.job_id || isExporting) return;

    setError('');
    setIsExporting(true);

    try {
      const response = await fetch(`${API_BASE}/api/export/${encodeURIComponent(result.job_id)}`);
      if (!response.ok) {
        const contentType = response.headers.get('content-type') || '';
        let message = 'Could not export training files.';
        if (contentType.includes('application/json')) {
          const data = await response.json();
          const detail = data?.detail;
          message = typeof detail === 'string'
            ? detail
            : Array.isArray(detail)
              ? detail.map((item) => item.msg || JSON.stringify(item)).join('; ')
              : message;
        }
        throw new Error(message);
      }

      const blob = await response.blob();
      const objectUrl = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = objectUrl;
      anchor.download = `${result.job_id}_training_export.zip`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(objectUrl);
    } catch (exportError) {
      const message = exportError.message || 'Could not export training files.';
      setError(
        /Failed to fetch|NetworkError|fetch/i.test(message)
          ? 'Cannot reach the API. Check that the backend is running and reachable.'
          : message,
      );
    } finally {
      setIsExporting(false);
    }
  }

  async function handlePlayAudioPreview() {
    setError('');

    if (!hasAudioSource) {
      setError('Select a WAV file or scenario sample to listen to the audio.');
      return;
    }

    if (!audioRef.current || !previewUrl) {
      setError('Audio preview is not ready yet.');
      return;
    }

    if (audioRef.current.paused) {
      try {
        await audioRef.current.play();
        setIsPlaying(true);
      } catch {
        setIsPlaying(false);
        setError('This browser blocked playback. Try clicking the button again.');
      }
      return;
    }

    audioRef.current.pause();
    setIsPlaying(false);
  }

  function handleTimeUpdate() {
    const audio = audioRef.current;
    if (!audio || !audio.duration) return;
    const progress = audio.currentTime / audio.duration;
    setPlaybackProgress(progress);
    setCurrentLabel(ticksToClock(audio.currentTime * 10_000_000));
    setDurationLabel(ticksToClock(audio.duration * 10_000_000));
  }

  function seekAudioAtPointer(clientX) {
    const audio = audioRef.current;
    const waveform = waveformRef.current;
    if (!audio || !audio.duration || !waveform) return;

    const bounds = waveform.getBoundingClientRect();
    const relativeX = Math.min(Math.max(clientX - bounds.left, 0), bounds.width);
    const progress = bounds.width ? relativeX / bounds.width : 0;
    const nextTime = Math.min(Math.max(progress * audio.duration, 0), audio.duration);

    audio.currentTime = nextTime;
    setPlaybackProgress(progress);
    setCurrentLabel(ticksToClock(nextTime * 10_000_000));
  }

  function handleWaveformPointerDown(event) {
    if (!hasAudioSource) return;

    const audio = audioRef.current;
    wasPlayingBeforeDragRef.current = !!audio && !audio.paused;

    if (audio && !audio.paused) {
      audio.pause();
      setIsPlaying(false);
    }

    setIsDragging(true);
    seekAudioAtPointer(event.clientX);
    event.preventDefault();
  }

  function handleWaveformPointerMove(event) {
    if (!isDragging) return;
    seekAudioAtPointer(event.clientX);
  }

  async function handleWaveformPointerUp() {
    setIsDragging(false);

    const audio = audioRef.current;
    if (!audio || !wasPlayingBeforeDragRef.current) return;

    try {
      await audio.play();
      setIsPlaying(true);
    } catch {
      setIsPlaying(false);
    }

    wasPlayingBeforeDragRef.current = false;
  }

  const transcriptItems = useMemo(() => {
    const groupedData = result?.grouped;

    if (groupedData && typeof groupedData === 'object' && !Array.isArray(groupedData)) {
      return Object.entries(groupedData).map(([speaker, texts], index) => ({
        id: `${speaker}-${index}`,
        speaker: formatSpeakerLabel(speaker, index),
        text: Array.isArray(texts) ? texts.filter(Boolean).join(' ') : String(texts || ''),
        tone: speakerTone(index),
        count: Array.isArray(texts) ? texts.length : 1,
      }));
    }

    if (!result?.transcriptions?.length) return [];

    const grouped = {};
    result.transcriptions.forEach((item, index) => {
      const key = item.speaker || `Speaker-${index}`;
      if (!grouped[key]) grouped[key] = [];
      const text = String(item.text || '').trim();
      if (text) grouped[key].push(text);
    });

    return Object.entries(grouped).map(([speaker, texts], index) => ({
      id: `${speaker}-${index}`,
      speaker: formatSpeakerLabel(speaker, index),
      text: texts.join(' '),
      tone: speakerTone(index),
      count: texts.length,
    }));
  }, [result]);

  const riskScore = useMemo(() => {
    const similarity = result?.total_score != null ? Number(result.total_score) : null;

    if (similarity == null) return null;

    const derivedRisk = 1 - similarity;
    return Number(Math.max(0, Math.min(1, derivedRisk)).toFixed(4));
  }, [result]);

  const extractedEntities = useMemo(() => {
    const regex = result?.regex ?? {};
    const entityValue = (key) => {
      const speakerValues = ['Guest-1', 'Guest-2']
        .map((speaker) => regex[speaker]?.[key])
        .filter((value) => value != null && value !== '');
      const uniqueValues = [...new Set(speakerValues)];
      return uniqueValues.length > 0
        ? uniqueValues.join(' / ')
        : regex[key] ?? '—';
    };

    return {
      truck: entityValue('truck_id'),
      shovel: entityValue('shovel_id'),
      pocket: entityValue('pocket_id'),
    };
  }, [result]);

  const protocolSteps = useMemo(() => {
    const status = result?.regex?.status;
    const isProceed = status === 'PROCEED';
    const isAmbiguous = status === 'AMBIGUOUS';
    const isHold = status === 'HOLD';
    const isMismatch = result?.regex?.flag === 'Mis Matched';
    const activeIndex = isProceed
      ? 2
      : isAmbiguous
        ? 1
        : isHold
          ? 0
          : isMismatch
            ? 1
            : null;

    const passedIndices = isProceed
      ? [0, 1, 2]
      : isMismatch
        ? [0]
        : isAmbiguous
          ? [0]
          : isHold
            ? [0]
            : [];

    const failedIndices = isMismatch
        ? [1, 2]
        : isHold
            ? [0, 1, 2]
            : [];

    return [
      {
        id: '1',
        label: 'CALLOUT',
        description: 'Vehicle ID + Intent stated',
        state: result ? 'PASS' : 'WAIT',
      },
      {
        id: '2',
        label: 'CLEARANCE',
        description: 'Explicit keyword',
        state: !result ? 'WAIT' : isMismatch ? 'FAIL' : isAmbiguous ? 'READY' : 'PASS',
      },
      {
        id: '3',
        label: 'ACKNOWLEDGEMENT',
        description: 'Proceeding under confirmed standard',
        state: !result ? 'WAIT' : isMismatch ? 'FAIL' : isAmbiguous ? 'WAIT' : 'PASS',
      },
    ].map((step, index) => ({
      ...step,
      isActive: activeIndex === index
        && !passedIndices.includes(index)
        && !failedIndices.includes(index),
      isPassed: passedIndices.includes(index),
      isFailed: failedIndices.includes(index),
    }));
  }, [result]);

  const protocolStatusTone = result?.regex?.status === 'PROCEED' && result?.regex?.acknowledgment
    ? 'is-success'
    : result?.regex?.status === 'AMBIGUOUS' || result?.regex?.status === 'HOLD' || result?.regex?.flag === 'Mis Matched'
      ? 'is-error'
      : 'is-idle';

  const reasoningText = useMemo(() => {
    if (!result) return 'Evaluator reasoning will appear after diarization completes.';

    const similarity = Number(result.total_score || 0);
    const risk = Math.max(0, Math.min(1, 1 - similarity));

    return `Paragraph comparison complete. BERT similarity is ${similarity.toFixed(3)}, so derived risk is ${risk.toFixed(3)} on a 0–1 scale.`;
  }, [result]);

  const alertTitle = result
    ? 'DIARIZATION COMPLETE'
    : isProcessing
      ? 'PROCESSING AUDIO STREAM'
      : 'READY: AWAITING AUDIO STREAM';

  const selectedLabel = selectedSample?.filename || selectedFile?.name || 'Recording';

  const alertSub = result
    ? `${selectedLabel} · ${result.transcriptions?.length || 0} segments`
    : isProcessing
      ? 'Speaker separation and comparison may take a few minutes.'
      : 'Pick a scenario sample or upload a WAV, then play the stream to run diarization.';

  const statusText = isProcessing
    ? 'LIVE STATUS: PROCESSING AUDIO STREAM...'
    : result
      ? 'LIVE STATUS: DIARIZATION COMPLETE'
      : hasAudioSource
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
          <button
            className="export-btn"
            type="button"
            onClick={exportToTraining}
            disabled={!result?.job_id || isExporting}
          >
            {isExporting ? 'Exporting...' : 'Export to Training'}
          </button>
        </div>
      </section>

      <div className="dashboard-grid">
        <section className="panel" aria-labelledby="stream-heading">
          <h2 className="panel-heading" id="stream-heading">Stream Control & Audio</h2>

          <div className="file-row">
            {samples.length > 0 && (
              <div className="sample-picker" role="group" aria-label="Built-in scenario samples">
                <p className="sample-picker-label">Demo scenarios</p>
                <div className="sample-picker-grid">
                  {samples.map((sample) => {
                    const isActive = selectedSample?.id === sample.id;
                    return (
                      <button
                        key={sample.id}
                        type="button"
                        className={`sample-chip${isActive ? ' is-active' : ''}`}
                        onClick={() => chooseSample(sample)}
                        disabled={isProcessing}
                        title={sample.summary}
                      >
                        <span className="sample-chip-title">{sample.label}</span>
                        <span className="sample-chip-meta">
                          Expects {sample.expected_status}
                          {typeof sample.size_bytes === 'number'
                            ? ` · ${formatBytes(sample.size_bytes)}`
                            : ''}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            <p className="sample-picker-label">Or choose your own file</p>
            <input
              ref={fileInputRef}
              className="file-field"
              type="file"
              accept=".wav,audio/wav,audio/x-wav"
              onChange={(event) => chooseFile(event.target.files?.[0])}
            />
            {hasAudioSource && (
              <div className="file-meta">
                <span>
                  {selectedSample
                    ? `${selectedSample.filename} · demo sample`
                    : `${selectedFile.name} · ${formatBytes(selectedFile.size)}`}
                </span>
                <button className="clear-file" type="button" onClick={clearFile}>Clear</button>
              </div>
            )}
          </div>

          <div className="action-row">
            <button
              className={`secondary-btn${isPlaying ? ' is-playing' : ''}`}
              type="button"
              onClick={handlePlayAudioPreview}
              disabled={isProcessing || !hasAudioSource}
            >
              <svg viewBox="0 0 20 20" fill="none" aria-hidden="true">
                {isPlaying ? (
                  <path d="M4 4h4v12H4V4Zm8 0h4v12h-4V4Z" fill="currentColor" />
                ) : (
                  <path d="M6 4.5v11l10-5.5L6 4.5Z" fill="currentColor" />
                )}
              </svg>
              <span>{isPlaying ? 'Pause Audio' : 'Listen Audio'}</span>
            </button>

            <button
              className={`primary-btn${isProcessing ? ' is-busy' : ''}`}
              type="button"
              onClick={runDiarization}
              disabled={isProcessing || !hasAudioSource}
            >
              <svg viewBox="0 0 20 20" fill="none" aria-hidden="true">
                {isProcessing ? (
                  <path d="M4 4h4v12H4V4Zm8 0h4v12h-4V4Z" fill="currentColor" />
                ) : (
                  <path d="M6 4.5v11l10-5.5L6 4.5Z" fill="currentColor" />
                )}
              </svg>
              <span>{isProcessing ? 'Processing...' : 'Start Process'}</span>
            </button>
          </div>

          <div className="waveform-card">
            <div className="waveform-header">
              <span>Audio Waveform</span>
              <span>{currentLabel} / {durationLabel}</span>
            </div>
            <div
              ref={waveformRef}
              className="waveform-canvas"
              aria-label="Audio waveform scrubber"
              role="slider"
              tabIndex={0}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={Math.round(playbackProgress * 100)}
              onPointerDown={handleWaveformPointerDown}
              onPointerMove={handleWaveformPointerMove}
              onPointerUp={handleWaveformPointerUp}
              onPointerLeave={handleWaveformPointerUp}
            >
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

        <section className="panel middle-panel" aria-labelledby="entities-heading">
          <div className="entity-card">
            <h2 className="panel-heading" id="entities-heading">Extracted Entities</h2>
            <div className="entity-row">
              <span>Truck number</span>
              <strong>{extractedEntities.truck}</strong>
            </div>
            <div className="entity-row">
              <span>Shovel No</span>
              <strong>{extractedEntities.shovel}</strong>
            </div>
            <div className="entity-row">
              <span>Pocket</span>
              <strong>{extractedEntities.pocket}</strong>
            </div>
          </div>

          <div className="protocol-card">
            <h2 className="panel-heading" id="protocol-heading">Protocol State</h2>
            <div className="protocol-list">
              {protocolSteps.map((step) => (
                <div
                  key={step.id}
                  className={[
                    'protocol-step',
                    step.isActive ? 'is-active' : '',
                    step.isPassed ? 'is-passed' : '',
                    step.isFailed ? 'is-failed' : '',
                  ].join(' ')}
                >
                  <div className="protocol-head">
                    <span>{step.id} - {step.label}</span>
                    <em>{step.state}</em>
                  </div>
                  <p>{step.description}</p>
                </div>
              ))}
            </div>
            <div className={`protocol-summary ${protocolStatusTone}`}>
              <span className={`status-dot ${protocolStatusTone}`} />
              <span>STATUS: {result?.regex?.status ?? result?.regex?.flag ?? 'IDLE'}</span>
            </div>
          </div>
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
                    <span className="utterance-time">{item.count} segment{item.count === 1 ? '' : 's'}</span>
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
              Risk Score: {riskScore == null ? '—' : riskScore.toFixed(2)}
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
