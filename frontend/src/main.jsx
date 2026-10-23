import { StrictMode, useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import '../styles.css';
import brandLogo from '../image/logo/image.png';

const MAX_UPLOAD_BYTES = 100 * 1024 * 1024;
const API_BASE = (import.meta.env.VITE_API_BASE || '').replace(/\/$/, '');

const NAV_ITEMS = [
  { id: 'overview', label: 'Overview', icon: 'grid' },
  { id: 'exchanges', label: 'Exchanges', icon: 'wave' },
  { id: 'coaching', label: 'Coaching', icon: 'chat' },
  { id: 'test-audio', label: 'AI Analysis', icon: 'play' },
];

const WAVE_HEIGHTS = [
  22, 40, 58, 34, 70, 46, 82, 54, 30, 66, 42, 78, 50, 28, 72, 48, 86, 56, 32, 68,
  44, 74, 38, 80, 52, 36, 76, 48, 26, 64, 40, 70, 46, 84, 58, 34, 72, 50, 28, 66,
];

const DEMO_AUDIO_OPTIONS = [
  { id: 'ack', label: 'Compliant entry', file: 'demo_ack_noisy_testfile.wav' },
  { id: 'hold', label: 'Explicit HOLD', file: 'demo_hold_noisy_testfile.wav' },
  { id: 'unack', label: 'Vague reply', file: 'demo_unack_noisy_testfile.wav' },
  { id: 'mm', label: 'Entity mismatch', file: 'demo_mm_noisy_testfile.wav' },
];

function formatBytes(bytes) {
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatClock(totalSeconds) {
  const seconds = Math.max(0, Math.floor(Number(totalSeconds) || 0));
  const minutes = Math.floor(seconds / 60);
  const remain = seconds % 60;
  return `${String(minutes).padStart(2, '0')}:${String(remain).padStart(2, '0')}`;
}

function NavIcon({ type }) {
  if (type === 'grid') {
    return (
      <svg viewBox="0 0 20 20" aria-hidden="true">
        <rect x="2" y="2" width="7" height="7" rx="1.5" fill="currentColor" />
        <rect x="11" y="2" width="7" height="7" rx="1.5" fill="currentColor" />
        <rect x="2" y="11" width="7" height="7" rx="1.5" fill="currentColor" />
        <rect x="11" y="11" width="7" height="7" rx="1.5" fill="currentColor" />
      </svg>
    );
  }
  if (type === 'wave') {
    return (
      <svg viewBox="0 0 20 20" aria-hidden="true">
        <path d="M2 10c1.5-4 3-4 4.5 0s3 4 4.5 0 3-4 4.5 0 3 4 4.5 0" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      </svg>
    );
  }
  if (type === 'chat') {
    return (
      <svg viewBox="0 0 20 20" aria-hidden="true">
        <path d="M4 4.5h12a1.5 1.5 0 0 1 1.5 1.5v6A1.5 1.5 0 0 1 16 13.5H9l-4 3v-3H4A1.5 1.5 0 0 1 2.5 12V6A1.5 1.5 0 0 1 4 4.5Z" fill="none" stroke="currentColor" strokeWidth="1.6" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true">
      <circle cx="10" cy="10" r="7" fill="none" stroke="currentColor" strokeWidth="1.6" />
      <path d="M8 7.2v5.6l5-2.8-5-2.8Z" fill="currentColor" />
    </svg>
  );
}

function Sidebar({ activePage, onNavigate, onOpenDemo }) {
  const navActive = activePage === 'exchange-detail' ? 'exchanges' : activePage;

  return (
    <aside className="sidebar">
      <div className="brand">
        <img className="brand-logo" src={brandLogo} alt="" />
        <div className="brand-copy">
          <strong>Evolution Mining</strong>
          <span>Cowal Gold Operation</span>
        </div>
      </div>

      <p className="nav-section-label">Assurance workspace</p>
      <nav className="nav-list" aria-label="Primary">
        {NAV_ITEMS.map((item) => (
          <button
            key={item.id}
            type="button"
            className={`nav-item${navActive === item.id ? ' is-active' : ''}`}
            onClick={() => onNavigate(item.id)}
          >
            <NavIcon type={item.icon} />
            <span>{item.label}</span>
          </button>
        ))}
      </nav>

      <div className="sidebar-bottom">
        <button type="button" className="demo-side-btn" onClick={onOpenDemo}>
          Demo data & controls
        </button>
        {/* <div className="sidebar-foot">
          Positive communications
          <br />
          Open-pit demonstration
          <br />
          Browser-local prototype
        </div> */}
      </div>
    </aside>
  );
}

function Topbar({ crumb }) {
  return (
    <header className="topbar">
      <div className="breadcrumbs">{crumb}</div>
      <div className="topbar-actions">
        <span className="demo-badge">DEMONSTRATION</span>
        <span className="avatar" aria-hidden="true">CM</span>
      </div>
    </header>
  );
}

function StatusPill({ children, tone = 'muted' }) {
  return <span className={`status-pill tone-${tone}`}>{children}</span>;
}

function analysisDisplayName(value) {
  const raw = String(value || '').trim();
  if (!raw) return 'Awaiting';
  if (raw === 'Simulated result') return 'Completed';
  return raw;
}

function statusTone(value) {
  const key = String(value || '').toLowerCase();
  if (
    key === 'successful'
    || key === 'reviewed'
    || key === 'no breach'
    || key === 'completed'
    || key === 'simulated result'
  ) {
    return 'success';
  }
  if (key === 'failed' || key === 'confirmed breach') return 'danger';
  if (
    key === 'awaiting'
    || key === 'pending'
    || key === 'under review'
    || key === 'not reviewed'
    || key === 'needs further review'
  ) {
    return 'review';
  }
  if (key === 'not required' || key === '—') {
    return 'muted';
  }
  return 'muted';
}

const DECISION_OPTIONS = [
  'Confirmed breach',
  'Not a breach',
  'Needs further review',
];

const CLASSIFICATION_OPTIONS = [
  'Invalid response / closure',
  'Asset identity',
  'Intent and context',
  'Readback / hearback',
  'Transmission integrity',
  'Other',
];

function buildSessionKpis(exchanges) {
  const rows = Array.isArray(exchanges) ? exchanges : [];
  const totalComm = rows.length;
  const awaiting = rows.filter((row) => {
    const status = String(row.supervisorStatus || 'Not reviewed');
    return status === 'Not reviewed' || status === 'Under Review' || status === 'Pending';
  }).length;
  const confirmed = rows.filter(
    (row) => row?.validation?.decision === 'Confirmed breach',
  );
  const totalBreach = confirmed.length;
  const coachingDone = confirmed.filter(
    (row) => row?.coaching?.status === 'Completed',
  ).length;
  const communicationQuality = totalComm > 0
    ? Math.round(((totalComm - totalBreach) / totalComm) * 100)
    : 0;

  return [
    {
      id: 'quality',
      label: 'Communication quality',
      value: (
        <>
          {communicationQuality} <span className="kpi-denom">/ 100</span>
        </>
      ),
      detail: '',
    },
    {
      id: 'exchanges',
      label: 'Exchanges assessed',
      value: String(rows.length),
      detail: ' ',
    },
    {
      id: 'awaiting',
      label: 'Awaiting validation',
      value: String(awaiting),
      detail: ' ',
    },
    {
      id: 'breaches',
      label: 'Confirmed breaches',
      value: String(confirmed.length),
      detail: ' ',
    },
    {
      id: 'coaching',
      label: 'Coaching completed',
      value: `${coachingDone} / ${confirmed.length}`,
      detail: ' ',
    },
  ];
}

function coachingStatusLabel(row) {
  if (row?.validation?.decision === 'Confirmed breach') {
    return row?.coaching?.status || 'Pending';
  }
  if (row?.validation?.decision === 'Not a breach') {
    return 'Not required';
  }
  return '—';
}

const STATUS_DISPLAY_NAMES = {
  PROCEED: 'Compliant entry',
  AMBIGUOUS: 'Vague reply',
  HOLD: 'Explicit HOLD',
  'Mis Matched': 'Entity mismatch',
  'Mis Match': 'Entity mismatch',
};

function exchangeDisplayName(row) {
  if (!row) return '—';
  if (row.title && !STATUS_DISPLAY_NAMES[row.title]) {
    return row.title;
  }
  const raw = row.status || row.title;
  return STATUS_DISPLAY_NAMES[raw] || row.title || raw || '—';
}

function exchangeNeedsReview(row) {
  return row.filter === 'needs_review'
    || row.supervisorStatus === 'Under Review'
    || row.supervisorStatus === 'Pending'
    || row.supervisorStatus === 'Not reviewed'
    || !row.filter;
}

function filterExchangesByReview(exchanges, filter) {
  const rows = Array.isArray(exchanges) ? exchanges : [];
  if (filter === 'all') return rows;
  if (filter === 'needs_review') return rows.filter(exchangeNeedsReview);
  return rows.filter((row) => !exchangeNeedsReview(row));
}

const EXCHANGE_REVIEW_FILTERS = [
  { id: 'all', label: 'All' },
  { id: 'needs_review', label: 'Needs review' },
  { id: 'reviewed', label: 'Reviewed' },
];

function ExchangeRows({ exchanges, onOpen }) {
  if (!exchanges.length) {
    return (
      <p className="empty-response">
        No exchanges yet. Upload a WAV on AI analysis and run real analysis to create one.
      </p>
    );
  }

  return (
    <div className="exchange-list">
      <div className="exchange-list-head">
        <span>Exchange / scenario</span>
        <span>AI Analysis</span>
        <span>Supervisor Analysis</span>
        <span>Review status</span>
        <span>Coaching status</span>
        <span />
      </div>
      {exchanges.map((row) => {
        const coachingStatus = coachingStatusLabel(row);
        return (
          <div className="exchange-row" key={row.id}>
            <div className="exchange-copy">
              <strong>{row.id} · {exchangeDisplayName(row)}</strong>
              <span>{row.subtitle || ''}</span>
            </div>
            <StatusPill tone={statusTone(row.execution)}>
              {row.execution || 'Not run'}
            </StatusPill>
            <StatusPill tone={statusTone(row.analysis)}>
              {analysisDisplayName(row.analysis)}
            </StatusPill>
            <StatusPill tone={statusTone(row.supervisorStatus)}>
              {row.supervisorStatus || 'Not reviewed'}
            </StatusPill>
            <StatusPill tone={statusTone(coachingStatus)}>
              {coachingStatus}
            </StatusPill>
            <button type="button" className="open-btn" onClick={() => onOpen(row)}>
              Open ↗
            </button>
          </div>
        );
      })}
    </div>
  );
}

function QualityTrendChart({ points }) {
  const width = 640;
  const height = 180;
  const padX = 28;
  const padTop = 18;
  const padBottom = 36;
  const chartW = width - padX * 2;
  const chartH = height - padTop - padBottom;

  const values = points.map((point) => Number(point.value) || 0);
  const minVal = values.length ? Math.min(...values) : 0;
  const maxVal = values.length ? Math.max(...values) : 100;
  const span = Math.max(maxVal - minVal, 1);
  // Keep some headroom so the line doesn't hug the edges
  const yMin = minVal - span * 0.35;
  const yMax = maxVal + span * 0.2;
  const ySpan = Math.max(yMax - yMin, 1);

  const coords = points.map((point, index) => {
    const x = points.length === 1
      ? padX + chartW / 2
      : padX + (index / (points.length - 1)) * chartW;
    const y = padTop + chartH - ((Number(point.value) - yMin) / ySpan) * chartH;
    return { x, y, label: point.label, value: point.value };
  });

  const linePath = coords
    .map((point, index) => `${index === 0 ? 'M' : 'L'} ${point.x.toFixed(2)} ${point.y.toFixed(2)}`)
    .join(' ');

  const areaPath = coords.length
    ? [
      `M ${coords[0].x.toFixed(2)} ${(padTop + chartH).toFixed(2)}`,
      ...coords.map((point) => `L ${point.x.toFixed(2)} ${point.y.toFixed(2)}`),
      `L ${coords[coords.length - 1].x.toFixed(2)} ${(padTop + chartH).toFixed(2)}`,
      'Z',
    ].join(' ')
    : '';

  const gridYs = [0.2, 0.4, 0.6, 0.8].map((ratio) => padTop + chartH * ratio);

  if (!points.length) {
    return <p className="card-sub">No qualityTrend data available.</p>;
  }

  return (
    <div className="trend-chart" aria-label="Communication quality trend">
      <svg viewBox={`0 0 ${width} ${height}`} role="img" preserveAspectRatio="none">
        <defs>
          <linearGradient id="trendFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#c9a227" stopOpacity="0.28" />
            <stop offset="100%" stopColor="#c9a227" stopOpacity="0.02" />
          </linearGradient>
        </defs>

        {gridYs.map((y) => (
          <line
            key={`grid-${y}`}
            className="trend-grid"
            x1={padX}
            x2={width - padX}
            y1={y}
            y2={y}
          />
        ))}

        <path d={areaPath} fill="url(#trendFill)" />
        <path d={linePath} className="trend-line" fill="none" />

        {coords.map((point) => (
          <circle
            key={`dot-${point.label}`}
            className="trend-dot"
            cx={point.x}
            cy={point.y}
            r="4.5"
          >
            <title>{`${point.label}: ${point.value}`}</title>
          </circle>
        ))}
      </svg>

      <div
        className="trend-labels"
        style={{ gridTemplateColumns: `repeat(${points.length}, minmax(0, 1fr))` }}
      >
        {points.map((point) => (
          <span key={`label-${point.label}`}>{point.label}</span>
        ))}
      </div>
    </div>
  );
}

function OverviewPage({
  data,
  exchanges,
  loading,
  error,
  site,
  crew,
  period,
  onSiteChange,
  onCrewChange,
  onPeriodChange,
  onOpenExchange,
  onStartEvidence,
}) {
  const [exchangeFilter, setExchangeFilter] = useState('all');
  const exchangeRows = Array.isArray(exchanges) ? exchanges : [];
  const filteredExchanges = filterExchangesByReview(exchangeRows, exchangeFilter);
  const kpis = buildSessionKpis(exchangeRows);
  const breachTypes = Array.isArray(data?.breachTypes) ? data.breachTypes : [];
  const qualityTrend = Array.isArray(data?.qualityTrend) ? data.qualityTrend : [];
  const coaching = data?.coachingFocus || {};
  const coachingItems = exchangeRows.filter(
    (row) => row?.validation?.decision === 'Confirmed breach',
  );
  const pendingCoaching = coachingItems.filter(
    (row) => String(row?.coaching?.status || 'Pending') === 'Pending',
  ).length;
  const followUpCoaching = coachingItems.filter((row) => {
    const followUp = String(row?.coaching?.followUp || '').trim();
    return followUp && followUp !== 'No follow-up required';
  }).length;

  return (
    <div>
      <div className="page-head">
        <div>
          <p className="eyebrow">Assurance overview</p>
          <h1>{data?.title || 'Communications overview'}</h1>
          <p>
            {data?.subtitle
              || ''}
          </p>
        </div>

        <div className="filters">
          <div className="filter-field">
            <label htmlFor="filter-site">Site</label>
            <select id="filter-site" value={site} onChange={(event) => onSiteChange(event.target.value)}>
              <option value="Cowal">Cowal</option>
              <option value="Red Lake">Red Lake</option>
              <option value="Mungari">Mungari</option>
            </select>
          </div>
          <div className="filter-field">
            <label htmlFor="filter-crew">Crew</label>
            <select id="filter-crew" value={crew} onChange={(event) => onCrewChange(event.target.value)}>
              <option value="All crews">All crews</option>
              <option value="A crew">A crew</option>
              <option value="B crew">B crew</option>
              <option value="C crew">C crew</option>
            </select>
          </div>
          <div className="filter-field">
            <label htmlFor="filter-period">Period</label>
            <select id="filter-period" value={period} onChange={(event) => onPeriodChange(event.target.value)}>
              <option value="Last 7 shifts">Last 7 shifts</option>
              <option value="Last 14 shifts">Last 14 shifts</option>
              <option value="This month">This month</option>
            </select>
          </div>
        </div>
      </div>

      {loading && <div className="loading-banner">Loading overview data…</div>}
      {error && <p className="error-banner" role="alert">{error}</p>}

      <div className="kpi-grid">
        {kpis.map((kpi) => (
          <article className="kpi-card" key={kpi.id || kpi.label}>
            <span>{kpi.label}</span>
            <strong>{kpi.value}</strong>
            <em className={kpi.tone === 'positive' ? 'is-positive' : kpi.tone === 'warning' ? 'is-warning' : ''}>
              {kpi.detail}
            </em>
          </article>
        ))}
      </div>

      <div className="overview-grid">
        <section className="card">
          <div className="card-head-row">
            <h2>Communication exchanges</h2>
            <div className="seg-filters compact">
              {EXCHANGE_REVIEW_FILTERS.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  className={`seg-btn${exchangeFilter === item.id ? ' is-active' : ''}`}
                  onClick={() => setExchangeFilter(item.id)}
                >
                  {item.label}
                </button>
              ))}
            </div>
          </div>
          <ExchangeRows exchanges={filteredExchanges} onOpen={onOpenExchange} />
        </section>

        <section className="card breach-card">
          <div className="card-head-row">
            <div>
              <h2>Top breach types</h2>
              <p className="card-sub">Share of confirmed failed exchanges · illustrative last 7 shifts</p>
            </div>
          </div>
          <div className="breach-list">
            {breachTypes.map((item) => (
              <div className="breach-row" key={item.label}>
                <span>{item.label}</span>
                <strong>{item.percent}%</strong>
                <div className="bar-track">
                  <div className="bar-fill" style={{ width: `${Number(item.percent) || 0}%` }} />
                </div>
              </div>
            ))}
          </div>
        </section>

        <section className="card coaching-card">
          <p className="gold-eyebrow">{coaching.eyebrow || 'Supervisor focus'}</p>
          <h2>{coaching.title || 'Coaching priorities'}</h2>
          <p className="coaching-body">
            {coaching.body
              || ''}
          </p>
          <div className="coaching-stats">
            <div className="coaching-stat">
              <strong>{pendingCoaching}</strong>
              <span>pending coaching</span>
            </div>
            <div className="coaching-stat">
              <strong>{followUpCoaching}</strong>
              <span>needs follow-up</span>
            </div>
          </div>
          <button type="button" className="gold-btn" onClick={onStartEvidence}>
            {coaching.cta || 'Start evidence review →'}
          </button>
          <p className="coaching-foot">{coaching.footnote}</p>
        </section>

        <section className="card trend-card">
          <div className="card-head-row">
            <div>
              <h2>Communication quality trend</h2>
              <p className="card-sub">Crew average across seven shifts</p>
            </div>
            <span className="ghost-chip">Illustrative history</span>
          </div>
          <QualityTrendChart points={qualityTrend} />
        </section>
      </div>
    </div>
  );
}

function ExchangesPage({ exchanges, filter, onFilterChange, onOpenExchange }) {
  const filtered = filterExchangesByReview(exchanges, filter);

  return (
    <div>
      <div className="page-head stacked">
        <div>
          <p className="eyebrow">Evidence workspace</p>
          <h1>Communication exchanges</h1>
        </div>
      </div>

      <div className="seg-filters">
        {EXCHANGE_REVIEW_FILTERS.map((item) => (
          <button
            key={item.id}
            type="button"
            className={`seg-btn${filter === item.id ? ' is-active' : ''}`}
            onClick={() => onFilterChange(item.id)}
          >
            {item.label}
          </button>
        ))}
      </div>

      <section className="card">
        <ExchangeRows exchanges={filtered} onOpen={onOpenExchange} />
      </section>
    </div>
  );
}

function ExchangeDetailPage({
  exchange,
  hasAudio,
  previewUrl,
  isPlaying,
  isProcessing,
  isSavingValidation,
  isSavingCoaching,
  error,
  result,
  onListen,
  onPauseAudio,
  onRunAnalysis,
  onSaveValidation,
  onCompleteCoaching,
  audioRef,
  decision,
  onDecisionChange,
  classification,
  onClassificationChange,
  reviewerNote,
  onReviewerNoteChange,
  coachingNote,
  onCoachingNoteChange,
  evidenceReviewed,
  onEvidenceReviewedChange,
  commitmentRecorded,
  onCommitmentRecordedChange,
  followUp,
  onFollowUpChange,
}) {
  const [playbackProgress, setPlaybackProgress] = useState(0);
  const [currentLabel, setCurrentLabel] = useState('00:00');
  const [durationLabel, setDurationLabel] = useState('00:00');
  const [isDraggingWave, setIsDraggingWave] = useState(false);
  const waveformRef = useRef(null);
  const wasPlayingBeforeDragRef = useRef(false);

  const validationEnabled = String(exchange?.analysis || '') === 'Pending';
  const classificationLocked = decision === 'Not a breach';
  const canSaveValidation = validationEnabled
    && Boolean(decision)
    && (classificationLocked || Boolean(classification));
  const isConfirmedBreach = decision === 'Confirmed breach'
    || exchange?.validation?.decision === 'Confirmed breach';
  const canCompleteCoaching = isConfirmedBreach
    && Boolean(String(coachingNote || '').trim());

  useEffect(() => {
    setPlaybackProgress(0);
    setCurrentLabel('00:00');
    setDurationLabel('00:00');
  }, [exchange?.id, previewUrl]);

  function handleDetailTimeUpdate() {
    const audio = audioRef?.current;
    if (!audio || !Number.isFinite(audio.duration) || audio.duration <= 0) return;
    const progress = Math.min(1, Math.max(0, audio.currentTime / audio.duration));
    setPlaybackProgress(progress);
    setCurrentLabel(formatClock(audio.currentTime));
    setDurationLabel(formatClock(audio.duration));
  }

  function seekAudioAtPointer(clientX) {
    const audio = audioRef?.current;
    const waveform = waveformRef.current;
    if (!audio || !Number.isFinite(audio.duration) || audio.duration <= 0 || !waveform) return;

    const bounds = waveform.getBoundingClientRect();
    const relativeX = Math.min(Math.max(clientX - bounds.left, 0), bounds.width);
    const progress = bounds.width ? relativeX / bounds.width : 0;
    const nextTime = Math.min(Math.max(progress * audio.duration, 0), audio.duration);
    audio.currentTime = nextTime;
    setPlaybackProgress(progress);
    setCurrentLabel(formatClock(nextTime));
  }

  function handleWaveformPointerDown(event) {
    if (!hasAudio || !audioRef?.current) return;
    const audio = audioRef.current;
    wasPlayingBeforeDragRef.current = !audio.paused;
    if (!audio.paused) {
      audio.pause();
      onPauseAudio?.();
    }
    setIsDraggingWave(true);
    seekAudioAtPointer(event.clientX);
    event.currentTarget.setPointerCapture?.(event.pointerId);
    event.preventDefault();
  }

  function handleWaveformPointerMove(event) {
    if (!isDraggingWave) return;
    seekAudioAtPointer(event.clientX);
  }

  async function handleWaveformPointerUp(event) {
    if (!isDraggingWave) return;
    setIsDraggingWave(false);
    event.currentTarget.releasePointerCapture?.(event.pointerId);
    if (!wasPlayingBeforeDragRef.current) return;
    wasPlayingBeforeDragRef.current = false;
    if (typeof onListen === 'function') {
      await onListen();
    }
  }

  const activeWaveIndex = Math.min(
    WAVE_HEIGHTS.length - 1,
    Math.floor(playbackProgress * WAVE_HEIGHTS.length),
  );

  const entities = useMemo(() => {
    const regex = result?.regex ?? {};
    const entityValue = (key) => {
      const values = ['Guest-1', 'Guest-2']
        .map((speaker) => regex[speaker]?.[key])
        .filter((value) => value != null && value !== '');
      const unique = [...new Set(values)];
      return unique.length > 0 ? unique.join(' / ') : regex[key] || null;
    };
    return {
      truck: entityValue('truck_id'),
      shovel: entityValue('shovel_id'),
      pocket: entityValue('pocket_id'),
    };
  }, [result]);

  const transcriptItems = useMemo(() => {
    if (!result?.transcriptions?.length) return [];
    const grouped = {};
    result.transcriptions.forEach((item, index) => {
      const key = item.speaker || `Speaker-${index}`;
      if (!grouped[key]) grouped[key] = [];
      const text = String(item.text || '').trim();
      if (text) grouped[key].push(text);
    });
    return Object.entries(grouped).map(([speaker, texts]) => ({
      speaker: String(speaker).replace(/Guest-/i, 'Operator '),
      text: texts.join(' '),
    }));
  }, [result]);

  const protocol = useMemo(() => {
    const status = result?.regex?.status;
    const isProceed = status === 'PROCEED';
    const isMismatch = result?.regex?.flag === 'Mis Matched';
    const isAmbiguous = status === 'AMBIGUOUS';
    return [
      {
        id: '1',
        label: 'Callout',
        state: !result ? 'WAIT' : 'PASS',
      },
      {
        id: '2',
        label: 'Clearance',
        state: !result ? 'WAIT' : isMismatch ? 'FAIL' : isAmbiguous ? 'READY' : 'PASS',
      },
      {
        id: '3',
        label: 'Acknowledgment',
        state: !result ? 'WAIT' : isMismatch ? 'FAIL' : isAmbiguous ? 'WAIT' : isProceed ? 'PASS' : 'WAIT',
      },
    ];
  }, [result]);

  const riskScore = useMemo(() => {
    if (result?.total_score == null) return null;
    return Number(Math.max(0, Math.min(1, 1 - Number(result.total_score))).toFixed(3));
  }, [result]);

  const acceleratorStatus = isProcessing ? 'PROCESSING' : result ? 'COMPLETE' : 'READY';
  const analysisBadge = analysisDisplayName(exchange.analysis);
  const reviewBadge = exchange.supervisorStatus || 'Not reviewed';
  const audioLabel = exchange.filename
    ? `${exchange.filename}${exchange.job_id ? ` · job ${exchange.job_id}` : ''}`
    : 'No WAV available for this exchange';

  return (
    <div>
      <div className="detail-head">
        <div>
          <h1>{exchange.id} · {exchangeDisplayName(exchange)}</h1>
        </div>
        <div className="detail-badges">
          <StatusPill tone={statusTone(analysisBadge)}>{analysisBadge}</StatusPill>
          <StatusPill tone={statusTone(reviewBadge)}>{reviewBadge}</StatusPill>
        </div>
      </div>

      <div className="detail-layout">
        <section className="accelerator">
          <div className="accelerator-head">
            <h2>Voice AI accelerator</h2>
            <span className={`ready-pill${isProcessing ? ' is-busy' : ''}`}>{acceleratorStatus}</span>
          </div>

          <div className="audio-panel">
            <div className="audio-meta">
              <div>
                <strong>{audioLabel}</strong>
                <span>WAV / AUDIO EVIDENCE</span>
              </div>
              <div className="audio-actions">
                <button
                  type="button"
                  className="gold-btn inline"
                  onClick={onRunAnalysis}
                  disabled={!hasAudio || isProcessing}
                >
                  {isProcessing ? 'Starting…' : 'Run analysis'}
                </button>
              </div>
            </div>

            <div className="wave-time-row dark">
              <span>{currentLabel}</span>
              <span>{durationLabel}</span>
            </div>
            <div
              ref={waveformRef}
              className={`wave-canvas dark is-interactive${isDraggingWave ? ' is-dragging' : ''}`}
              role="slider"
              tabIndex={0}
              aria-label="Audio waveform scrubber"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={Math.round(playbackProgress * 100)}
              onPointerDown={handleWaveformPointerDown}
              onPointerMove={handleWaveformPointerMove}
              onPointerUp={handleWaveformPointerUp}
              onPointerCancel={handleWaveformPointerUp}
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
              <div className="playhead light" style={{ left: `${playbackProgress * 100}%` }} />
            </div>
            <div className="test-wave-actions detail-wave-actions">
              <div className="wave-controls">
                <button
                  type="button"
                  className="dark-btn"
                  onClick={onListen}
                  disabled={!hasAudio || isProcessing || isPlaying}
                >
                  Listen audio
                </button>
                <button
                  type="button"
                  className="dark-btn"
                  onClick={onPauseAudio}
                  disabled={!hasAudio || isProcessing || !isPlaying}
                >
                  Pause
                </button>
              </div>
              <span className="wave-note">Drag the waveform to scrub · live playback position</span>
            </div>

            {previewUrl && (
              <audio
                ref={audioRef}
                className="hidden-audio"
                src={previewUrl}
                onTimeUpdate={handleDetailTimeUpdate}
                onLoadedMetadata={handleDetailTimeUpdate}
                onEnded={() => {
                  setPlaybackProgress(1);
                  onPauseAudio?.();
                }}
              />
            )}
          </div>

          {error && <p className="error-banner" role="alert">{error}</p>}

          <div className="accelerator-grid">
            <div className="acc-block">
              <h3>Extracted entities</h3>
              <div className="entity-row"><span>Truck</span><strong>{entities.truck || '—'}</strong></div>
              <div className="entity-row"><span>Shovel</span><strong>{entities.shovel || '—'}</strong></div>
              <div className="entity-row"><span>Pocket</span><strong>{entities.pocket || '—'}</strong></div>
              {!result && <p className="awaiting">Awaiting analysis</p>}
            </div>

            <div className="acc-block">
              <h3>Protocol state</h3>
              <ol className="protocol-list">
                {protocol.map((step) => (
                  <li key={step.id}>
                    <span>{step.id}. {step.label}</span>
                    <em>{step.state}</em>
                  </li>
                ))}
              </ol>
              <div className="protocol-status">
                <span className="dot" />
                STATUS: {result?.regex?.status || result?.regex?.flag || 'IDLE'}
              </div>
            </div>

            <div className="acc-block transcript-block">
              <h3>Diarized transcript</h3>
              {transcriptItems.length === 0 ? (
                <p className="empty-copy">
                  Run analysis to generate the simulated transcript for this example.
                </p>
              ) : (
                <div className="live-transcript">
                  {transcriptItems.map((item, index) => (
                    <div key={`${item.speaker}-${index}`}>
                      <strong>{item.speaker}</strong>
                      <p>{item.text}</p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          <div className="reasoning-block">
            <h3>Evaluator reasoning</h3>
            <p>
              {result
                ? `Paragraph comparison complete. BERT similarity is ${Number(result.total_score || 0).toFixed(3)}; derived risk is ${riskScore ?? '—'}.`
                : 'The assessment explanation will appear after analysis.'}
            </p>
            <p className="reason-foot">
              {riskScore == null
                ? 'Confidence / risk score not supplied. No calibrated value is fabricated.'
                : `Risk score: ${riskScore}`}
            </p>
          </div>
        </section>

        <aside className="side-stack">
          <div className={`side-card${!validationEnabled ? ' is-disabled-panel' : ''}`}>
            <div className="side-card-title">
              <span className="step-badge">01</span>
              <div>
                <h2>Supervisor validation</h2>
                <p className="hint">
                  {validationEnabled
                    ? 'Assess the evidence before confirming a finding.'
                    : 'Click Run analysis first to enable supervisor validation.'}
                </p>
              </div>
            </div>

            <div className="field">
              <label htmlFor="decision">Decision</label>
              <select
                id="decision"
                value={decision}
                onChange={(event) => onDecisionChange(event.target.value)}
                disabled={!validationEnabled}
              >
                <option value="">Select decision</option>
                {DECISION_OPTIONS.map((option) => (
                  <option key={option} value={option}>{option}</option>
                ))}
              </select>
            </div>

            <div className="field">
              <label htmlFor="classification">Classification</label>
              <select
                id="classification"
                value={classificationLocked ? '' : classification}
                onChange={(event) => onClassificationChange(event.target.value)}
                disabled={!validationEnabled || classificationLocked || !decision}
              >
                <option value="">Select classification</option>
                {CLASSIFICATION_OPTIONS.map((option) => (
                  <option key={option} value={option}>{option}</option>
                ))}
              </select>
            </div>

            <div className="field">
              <label htmlFor="reviewer-note">Reviewer note</label>
              <textarea
                id="reviewer-note"
                value={reviewerNote}
                onChange={(event) => onReviewerNoteChange(event.target.value)}
                placeholder="Explain your assessment..."
                disabled={!validationEnabled}
              />
            </div>

            <button
              type="button"
              className="gold-btn"
              onClick={onSaveValidation}
              disabled={!canSaveValidation || isSavingValidation}
            >
              {isSavingValidation ? 'Saving…' : 'Save validation'}
            </button>
          </div>

          <div className={`side-card coaching-action-card${!isConfirmedBreach ? ' is-disabled-panel' : ''}`}>
            <div className="side-card-title coaching-action-head">
              <span className="step-badge">02</span>
              <h2>Coaching action</h2>
            </div>

            <p className="hint">Turn a confirmed finding into a constructive conversation.</p>

            <div className="coaching-prompt-box">
              What information should have been stated or repeated to make this exchange clear?
            </div>

            <div className="field">
              <label htmlFor="coaching-note">Coaching note / agreed action</label>
              <textarea
                id="coaching-note"
                value={coachingNote}
                onChange={(event) => onCoachingNoteChange(event.target.value)}
                placeholder="Capture reflection and agreed action..."
                disabled={!isConfirmedBreach}
                required
              />
            </div>

            <div className="check-row">
              <label>
                <input
                  type="checkbox"
                  checked={evidenceReviewed}
                  onChange={(event) => onEvidenceReviewedChange(event.target.checked)}
                  disabled={!isConfirmedBreach}
                />
                Evidence reviewed with operator (demo)
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={commitmentRecorded}
                  onChange={(event) => onCommitmentRecordedChange(event.target.checked)}
                  disabled={!isConfirmedBreach}
                />
                Agreed action recorded (demo)
              </label>
            </div>

            <div className="field">
              <label htmlFor="follow-up">Follow-up requirement</label>
              <select
                id="follow-up"
                value={followUp}
                onChange={(event) => onFollowUpChange(event.target.value)}
                disabled={!isConfirmedBreach}
              >
                <option>Recheck next shift</option>
                <option>Recheck within 7 days</option>
                <option>No follow-up required</option>
              </select>
            </div>

            <button
              type="button"
              className="gold-btn soft"
              onClick={onCompleteCoaching}
              disabled={!canCompleteCoaching || isSavingCoaching}
            >
              {isSavingCoaching ? 'Saving…' : '✓ Coaching completed'}
            </button>
            <p className="field-help">
              Requires a confirmed breach. Records a follow-up requirement, not a scheduled task. The original finding remains unchanged.
            </p>
          </div>
        </aside>
      </div>
    </div>
  );
}

function DemoDataModal({
  open,
  onClose,
  exchanges,
  scenarioFiles,
  onScenarioFile,
  importName,
  onImportFile,
  onDownloadTemplate,
  onReset,
}) {
  if (!open) return null;

  return (
    <div className="modal-backdrop" role="presentation" onClick={onClose}>
      <div
        className="modal demo-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="demo-modal-title"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="modal-top">
          <div>
            <p className="eyebrow">Presenter controls</p>
            <h3 id="demo-modal-title">Demonstration data</h3>
          </div>
          <button type="button" className="close-btn" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>

        <p className="modal-lead">
          Import example records or download the exact supported template. Records and saved actions are browser-local; WAV attachments last for this session only.
        </p>

        <section className="modal-section">
          <h4>Import JSON</h4>
          <div className="import-row">
            <label className="file-box">
              <input
                type="file"
                accept=".json,application/json"
                onChange={(event) => onImportFile(event.target.files?.[0])}
              />
              <span>{importName || 'No file chosen'}</span>
            </label>
            <button type="button" className="ghost-btn" onClick={onDownloadTemplate}>
              Download dataset template ↓
            </button>
          </div>
        </section>

        <section className="modal-section">
          <h4>Attach scenario recordings</h4>
          <p className="hint">Enables actual playback. Scenario analysis remains a labelled fixture.</p>
          <div className="scenario-list">
            {exchanges.map((row) => (
              <div className="scenario-item" key={row.id}>
                <strong>{row.id} · {exchangeDisplayName(row)}</strong>
                <label className="file-box">
                  <input
                    type="file"
                    accept=".wav,audio/wav,audio/x-wav"
                    onChange={(event) => onScenarioFile(row.id, event.target.files?.[0])}
                  />
                  <span>
                    {scenarioFiles[row.id]
                      ? `${scenarioFiles[row.id].name} · ${formatBytes(scenarioFiles[row.id].size)}`
                      : 'No file chosen'}
                  </span>
                </label>
              </div>
            ))}
          </div>
        </section>

        <div className="modal-actions">
          <button type="button" className="ghost-btn" onClick={onReset}>
            Reset session actions
          </button>
          <button type="button" className="gold-btn inline" onClick={onClose}>
            Done
          </button>
        </div>
      </div>
    </div>
  );
}

function PlaceholderPage({ title, body }) {
  return (
    <div className="placeholder-page">
      <h1>{title}</h1>
      <p>{body}</p>
    </div>
  );
}

function CoachingPage({ exchanges, onOpenExchange }) {
  const rows = (Array.isArray(exchanges) ? exchanges : []).filter(
    (row) => row?.validation?.decision === 'Confirmed breach',
  );

  return (
    <div>
      <div className="page-head stacked">
        <div>
          <p className="eyebrow">Training processes</p>
          <h1>Coaching</h1>
          <p>Confirmed breaches queued for short, evidence-based coaching conversations.</p>
        </div>  
      </div>

      <section className="card">
        {!rows.length ? (
          <p className="empty-response">
            No confirmed breaches yet. Save a validation with Decision = Confirmed breach to create coaching work.
          </p>
        ) : (
          <div className="coaching-table">
            <div className="coaching-table-head">
              <span>Exchange</span>
              <span>Status</span>
              <span>Follow-up</span>
              <span />
            </div>
            {rows.map((row) => (
              <div className="coaching-table-row" key={row.id}>
                <strong>{row.id} · {exchangeDisplayName(row)}</strong>
                <StatusPill tone={statusTone(row.coaching?.status || 'Pending')}>
                  {row.coaching?.status || 'Pending'}
                </StatusPill>
                <span>{row.coaching?.followUp || 'Recheck next shift'}</span>
                <button type="button" className="open-btn" onClick={() => onOpenExchange(row)}>
                  Open ↗
                </button>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function TestYourAudioPage({ onExchangesChanged, metrics }) {
  const aiMetrics = Array.isArray(metrics) && metrics.length > 0
    ? metrics
    : [
      {
        id: 'processed',
        label: 'Recordings processed',
        value: '—',
        detail: 'Completed by the AI so far',
        tone: 'neutral',
      },
      {
        id: 'queue',
        label: 'Waiting in queue',
        value: '—',
        detail: 'Uploaded and not yet analysed',
        tone: 'neutral',
      },
      {
        id: 'avg_time',
        label: 'Average time to result',
        value: '—',
        detail: 'Typical wait from upload to summary',
        tone: 'neutral',
      },
      {
        id: 'confidence',
        label: 'AI confidence',
        value: '—',
        detail: 'How sure the model is on average',
        tone: 'neutral',
      },
    ];

  const [selectedFile, setSelectedFile] = useState(null);
  const [selectedDemoId, setSelectedDemoId] = useState('');
  const [isLoadingDemo, setIsLoadingDemo] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isDraggingWave, setIsDraggingWave] = useState(false);
  const [isFileDragOver, setIsFileDragOver] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState(null);
  const [previewUrl, setPreviewUrl] = useState('');
  const [playbackProgress, setPlaybackProgress] = useState(0);
  const [currentLabel, setCurrentLabel] = useState('00:00');
  const [durationLabel, setDurationLabel] = useState('00:00');
  const fileInputRef = useRef(null);
  const audioRef = useRef(null);
  const waveformRef = useRef(null);
  const wasPlayingBeforeDragRef = useRef(false);

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
    setPlaybackProgress(0);
    setCurrentLabel('00:00');
    setDurationLabel('00:00');
    return () => URL.revokeObjectURL(objectUrl);
  }, [selectedFile]);

  function chooseFile(file, demoId = '') {
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
    setSelectedDemoId(demoId);
    setSelectedFile(file);
  }

  async function pickDemoAudio(option) {
    if (!option?.file || isProcessing || isLoadingDemo) return;
    setIsLoadingDemo(true);
    setError('');
    try {
      const response = await fetch(
        `${API_BASE}/api/demo-audio/${encodeURIComponent(option.file)}`,
      );
      if (!response.ok) {
        throw new Error('Could not load this demo recording.');
      }
      const blob = await response.blob();
      const file = new File([blob], option.file, { type: 'audio/wav' });
      chooseFile(file, option.id);
    } catch (requestError) {
      const message = requestError.message || 'Could not load this demo recording.';
      setError(
        /Failed to fetch|NetworkError|fetch/i.test(message)
          ? 'Cannot reach the API. Check that the backend is running and reachable.'
          : message,
      );
    } finally {
      setIsLoadingDemo(false);
    }
  }

  function clearFile() {
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.currentTime = 0;
    }
    setSelectedFile(null);
    setSelectedDemoId('');
    setResult(null);
    setIsPlaying(false);
    setPlaybackProgress(0);
    setCurrentLabel('00:00');
    setDurationLabel('00:00');
    setError('');
    if (fileInputRef.current) fileInputRef.current.value = '';
  }

  function handleTimeUpdate() {
    const audio = audioRef.current;
    if (!audio || !Number.isFinite(audio.duration) || audio.duration <= 0) return;
    const progress = Math.min(1, Math.max(0, audio.currentTime / audio.duration));
    setPlaybackProgress(progress);
    setCurrentLabel(formatClock(audio.currentTime));
    setDurationLabel(formatClock(audio.duration));
  }

  function seekAudioAtPointer(clientX) {
    const audio = audioRef.current;
    const waveform = waveformRef.current;
    if (!audio || !Number.isFinite(audio.duration) || audio.duration <= 0 || !waveform) return;

    const bounds = waveform.getBoundingClientRect();
    const relativeX = Math.min(Math.max(clientX - bounds.left, 0), bounds.width);
    const progress = bounds.width ? relativeX / bounds.width : 0;
    const nextTime = Math.min(Math.max(progress * audio.duration, 0), audio.duration);

    audio.currentTime = nextTime;
    setPlaybackProgress(progress);
    setCurrentLabel(formatClock(nextTime));
  }

  function handleWaveformPointerDown(event) {
    if (!selectedFile || !audioRef.current) return;

    const audio = audioRef.current;
    wasPlayingBeforeDragRef.current = !audio.paused;

    if (!audio.paused) {
      audio.pause();
      setIsPlaying(false);
    }

    setIsDraggingWave(true);
    seekAudioAtPointer(event.clientX);
    event.currentTarget.setPointerCapture?.(event.pointerId);
    event.preventDefault();
  }

  function handleWaveformPointerMove(event) {
    if (!isDraggingWave) return;
    seekAudioAtPointer(event.clientX);
  }

  async function handleWaveformPointerUp(event) {
    if (!isDraggingWave) return;
    setIsDraggingWave(false);
    event.currentTarget.releasePointerCapture?.(event.pointerId);

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

  async function handlePlay() {
    if (!selectedFile || !audioRef.current || !previewUrl) {
      setError('Choose a WAV recording first.');
      return;
    }
    try {
      await audioRef.current.play();
      setIsPlaying(true);
    } catch {
      setError('This browser blocked playback. Try again.');
    }
  }

  function handlePause() {
    if (!audioRef.current) return;
    audioRef.current.pause();
    setIsPlaying(false);
  }

  function handleFileDragOver(event) {
    event.preventDefault();
    setIsFileDragOver(true);
  }

  function handleFileDragLeave(event) {
    event.preventDefault();
    setIsFileDragOver(false);
  }

  function handleFileDrop(event) {
    event.preventDefault();
    setIsFileDragOver(false);
    const file = event.dataTransfer?.files?.[0];
    if (file) chooseFile(file);
  }

  const activeWaveIndex = Math.min(
    WAVE_HEIGHTS.length - 1,
    Math.floor(playbackProgress * WAVE_HEIGHTS.length),
  );

  async function runAccelerator() {
    setError('');

    if (!selectedFile) {
      setError('Choose a WAV recording first.');
      return;
    }
    if (isProcessing) return;

    setResult(null);
    setIsProcessing(true);

    const payload = new FormData();
    payload.append('audio', selectedFile);

    try {
      const response = await fetch(`${API_BASE}/api/exchanges/process`, {
        method: 'POST',
        body: payload,
      });
      const raw = await response.text();
      let data = null;
      try {
        data = JSON.parse(raw);
      } catch {
        throw new Error(
          response.status === 404
            ? 'API route not found. Check that the backend is running.'
            : `Backend returned non-JSON (HTTP ${response.status}).`,
        );
      }

      if (typeof onExchangesChanged === 'function') {
        await onExchangesChanged();
      }

      if (!response.ok) {
        const detail = data?.detail;
        throw new Error(
          typeof detail === 'string'
            ? detail
            : Array.isArray(detail)
              ? detail.map((item) => item.msg || JSON.stringify(item)).join('; ')
              : 'The audio could not be processed.',
        );
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

  const extractedEntities = useMemo(() => {
    const regex = result?.regex ?? {};
    const entityValue = (key) => {
      const values = ['Guest-1', 'Guest-2']
        .map((speaker) => regex[speaker]?.[key])
        .filter((value) => value != null && value !== '');
      const unique = [...new Set(values)];
      return unique.length > 0 ? unique.join(' / ') : regex[key] || null;
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
    const isMismatch = result?.regex?.flag === 'Mis Matched';
    const isAmbiguous = status === 'AMBIGUOUS';
    return [
      {
        id: '1',
        label: 'Callout',
        state: !result ? 'WAIT' : 'PASS',
      },
      {
        id: '2',
        label: 'Clearance',
        state: !result ? 'WAIT' : isMismatch ? 'FAIL' : isAmbiguous ? 'READY' : 'PASS',
      },
      {
        id: '3',
        label: 'Acknowledgment',
        state: !result ? 'WAIT' : isMismatch ? 'FAIL' : isAmbiguous ? 'WAIT' : isProceed ? 'PASS' : 'WAIT',
      },
    ];
  }, [result]);

  const transcriptItems = useMemo(() => {
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
      speaker: String(speaker).replace(/Guest-/i, 'Operator '),
      text: texts.join(' '),
    }));
  }, [result]);

  const protocolStatus = result?.regex?.status || result?.regex?.flag || 'IDLE';
  const exchangeLabel = result?.exchange?.id
    ? `${result.exchange.id} · ${exchangeDisplayName(result.exchange)}`
    : null;

  return (
    <div>
      <div className="page-head stacked">
        <div>
          <p className="eyebrow">Accelerator workspace</p>
          <h1>Upload conversations you want to analyze</h1>
          <p>Upload a WAV, preview playback, then run the accelerator to create an exchange record.</p>
        </div>
      </div>

      <div className="ai-metrics-grid" aria-label="AI analysis summary">
        {aiMetrics.map((metric) => (
          <article
            key={metric.id || metric.label}
            className={`ai-metric-card tone-${metric.tone || 'neutral'}`}
          >
            <span className="ai-metric-label">{metric.label}</span>
            <strong className="ai-metric-value">{metric.value}</strong>
            <em className="ai-metric-detail">{metric.detail}</em>
          </article>
        ))}
      </div>

      <div className="test-audio-layout">
          <section className="card test-upload-card">
            <div className="demo-audio-block">
              <div className="demo-audio-head">
                <h3>Audio recordings</h3>
                <span>{isLoadingDemo ? 'Loading…' : 'Pick one to load'}</span>
              </div>
              <div className="demo-audio-grid" role="list">
                {DEMO_AUDIO_OPTIONS.map((option) => (
                  <button
                    key={option.id}
                    type="button"
                    role="listitem"
                    className={`demo-audio-card${selectedDemoId === option.id ? ' is-active' : ''}`}
                    onClick={() => pickDemoAudio(option)}
                    disabled={isProcessing || isLoadingDemo}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            </div>

            <div
              className={`upload-drop${isFileDragOver ? ' is-dragover' : ''}`}
              onDragOver={handleFileDragOver}
              onDragLeave={handleFileDragLeave}
              onDrop={handleFileDrop}
            >
              <div className="upload-icon" aria-hidden="true">↑</div>
              <strong>Upload a audio recording</strong>
              <p>WAV audio · drag and drop here, or choose a file. Upload runs only when you click Run Accelerator.</p>
              <div className="upload-file-row">
                <label className="choose-file-btn">
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept=".wav,audio/wav,audio/x-wav"
                    onChange={(event) => chooseFile(event.target.files?.[0], '')}
                  />
                  Choose File
                </label>
                <span className="choose-file-name">
                  {selectedFile
                    ? `${selectedFile.name} · ${formatBytes(selectedFile.size)}`
                    : 'No file chosen'}
                </span>
              </div>
            </div>

            {previewUrl && (
              <div className="test-wave-block">
                <div className="wave-time-row">
                  <span>{currentLabel}</span>
                  <span>{durationLabel}</span>
                </div>
                <div
                  ref={waveformRef}
                  className={`wave-canvas light is-interactive${isDraggingWave ? ' is-dragging' : ''}`}
                  role="slider"
                  tabIndex={0}
                  aria-label="Audio waveform scrubber"
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={Math.round(playbackProgress * 100)}
                  onPointerDown={handleWaveformPointerDown}
                  onPointerMove={handleWaveformPointerMove}
                  onPointerUp={handleWaveformPointerUp}
                  onPointerCancel={handleWaveformPointerUp}
                >
                  <div className="wave-bars">
                    {WAVE_HEIGHTS.map((height, index) => (
                      <span
                        key={`test-bar-${index}`}
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
                <div className="test-wave-actions">
                  <div className="wave-controls">
                    <button
                      type="button"
                      className="ghost-btn"
                      onClick={handlePlay}
                      disabled={isProcessing || isPlaying}
                    >
                      Play
                    </button>
                    <button
                      type="button"
                      className="ghost-btn"
                      onClick={handlePause}
                      disabled={isProcessing || !isPlaying}
                    >
                      Pause
                    </button>
                    <button
                      type="button"
                      className="ghost-btn"
                      onClick={clearFile}
                      disabled={isProcessing}
                    >
                      Clear
                    </button>
                  </div>
                  <span className="wave-note light">Drag the waveform to scrub · live playback position</span>
                </div>
                <audio
                  ref={audioRef}
                  className="hidden-audio"
                  src={previewUrl}
                  onTimeUpdate={handleTimeUpdate}
                  onLoadedMetadata={handleTimeUpdate}
                  onEnded={() => {
                    setIsPlaying(false);
                    setPlaybackProgress(1);
                  }}
                  onPlay={() => setIsPlaying(true)}
                  onPause={() => setIsPlaying(false)}
                />
              </div>
            )}

            {error && <p className="error-banner" role="alert">{error}</p>}

            <button
              type="button"
              className="gold-btn"
              onClick={runAccelerator}
              disabled={isProcessing || !selectedFile}
            >
              {isProcessing ? 'Running accelerator…' : 'Run Accelerator'}
            </button>
          </section>

          <section className="card test-response-card">
            <div className="card-head-row">
              <div>
                <h2>Accelerator results</h2>
                <p className="card-sub">
                  {result
                    ? (exchangeLabel
                      ? `Exchange ${exchangeLabel} saved for Overview and Exchanges review.`
                      : 'Readable summary of the processed audio exchange.')
                    : 'Run the accelerator to see entities, protocol state, and transcript.'}
                </p>
              </div>
              {result && (
                <StatusPill tone={statusTone(result.exchange?.execution || 'Successful')}>
                  {result.exchange?.execution || 'Successful'}
                </StatusPill>
              )}
            </div>

            {!result && (
              <p className="empty-response">
                No response yet. Run the accelerator to analyze the uploaded recording.
              </p>
            )}

            {result && (
              <div className="accelerator-results">
                <div className="accelerator-grid test-result-grid">
                  <div className="acc-block">
                    <h3>Extracted entities</h3>
                    <div className="entity-row">
                      <span>Truck</span>
                      <strong>{extractedEntities.truck || '—'}</strong>
                    </div>
                    <div className="entity-row">
                      <span>Shovel</span>
                      <strong>{extractedEntities.shovel || '—'}</strong>
                    </div>
                    <div className="entity-row">
                      <span>Pocket</span>
                      <strong>{extractedEntities.pocket || '—'}</strong>
                    </div>
                  </div>

                  <div className="acc-block">
                    <h3>Protocol state</h3>
                    <ol className="protocol-list">
                      {protocolSteps.map((step) => (
                        <li key={step.id}>
                          <span>{step.id}. {step.label}</span>
                          <em>{step.state}</em>
                        </li>
                      ))}
                    </ol>
                    <div className="protocol-status">
                      <span className="dot" />
                      STATUS: {protocolStatus}
                    </div>
                  </div>

                  <div className="acc-block transcript-block">
                    <h3>Diarized transcript</h3>
                    {transcriptItems.length === 0 ? (
                      <p className="empty-copy">No transcript segments were returned for this recording.</p>
                    ) : (
                      <div className="live-transcript">
                        {transcriptItems.map((item) => (
                          <div key={item.id}>
                            <strong>{item.speaker}</strong>
                            <p>{item.text}</p>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}
          </section>
      </div>
    </div>
  );
}

function App() {
  const [activePage, setActivePage] = useState('overview');
  const [overview, setOverview] = useState(null);
  const [overviewLoading, setOverviewLoading] = useState(true);
  const [overviewError, setOverviewError] = useState('');
  const [exchanges, setExchanges] = useState([]);

  const [site, setSite] = useState('Cowal');
  const [crew, setCrew] = useState('All crews');
  const [period, setPeriod] = useState('Last 7 shifts');
  const [exchangeFilter, setExchangeFilter] = useState('all');

  const [demoOpen, setDemoOpen] = useState(false);
  const [coachingSuccessOpen, setCoachingSuccessOpen] = useState(false);
  const [importName, setImportName] = useState('');
  const [scenarioFiles, setScenarioFiles] = useState({});
  const [activeExchange, setActiveExchange] = useState(null);

  const [isProcessing, setIsProcessing] = useState(false);
  const [isSavingValidation, setIsSavingValidation] = useState(false);
  const [isSavingCoaching, setIsSavingCoaching] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState(null);
  const [previewUrl, setPreviewUrl] = useState('');
  const audioRef = useRef(null);

  const [decision, setDecision] = useState('');
  const [classification, setClassification] = useState('');
  const [reviewerNote, setReviewerNote] = useState('');
  const [coachingNote, setCoachingNote] = useState('');
  const [evidenceReviewed, setEvidenceReviewed] = useState(false);
  const [commitmentRecorded, setCommitmentRecorded] = useState(false);
  const [followUp, setFollowUp] = useState('Recheck next shift');

  const attachedFile = activeExchange ? scenarioFiles[activeExchange.id] || null : null;
  const hasAudio = Boolean(attachedFile || activeExchange?.job_id);

  async function loadExchanges() {
    const response = await fetch(`${API_BASE}/api/exchanges`);
    const raw = await response.text();
    const data = JSON.parse(raw);
    if (!response.ok) {
      throw new Error(typeof data?.detail === 'string' ? data.detail : 'Could not load exchanges.');
    }
    const rows = Array.isArray(data?.exchanges) ? data.exchanges : Array.isArray(data) ? data : [];
    setExchanges(rows);
    setActiveExchange((current) => {
      if (!current?.id) return current;
      return rows.find((row) => String(row.id) === String(current.id)) || current;
    });
    return rows;
  }

  useEffect(() => {
    let cancelled = false;

    async function loadOverview() {
      setOverviewLoading(true);
      setOverviewError('');
      try {
        const response = await fetch(`${API_BASE}/api/overview`);
        const raw = await response.text();
        const data = JSON.parse(raw);
        if (!response.ok) {
          throw new Error(typeof data?.detail === 'string' ? data.detail : 'Could not load overview data.');
        }
        if (!cancelled) setOverview(data);
      } catch (err) {
        if (!cancelled) {
          const message = err.message || 'Could not load overview data.';
          setOverviewError(
            /Failed to fetch|NetworkError|fetch/i.test(message)
              ? 'Cannot reach the API. Check that the backend is running.'
              : message,
          );
        }
      } finally {
        if (!cancelled) setOverviewLoading(false);
      }
    }

    async function bootstrap() {
      await loadOverview();
      try {
        if (!cancelled) await loadExchanges();
      } catch (err) {
        if (!cancelled) {
          setOverviewError((prev) => prev || err.message || 'Could not load exchanges.');
        }
      }
    }

    bootstrap();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (attachedFile) {
      const objectUrl = URL.createObjectURL(attachedFile);
      setPreviewUrl(objectUrl);
      return () => URL.revokeObjectURL(objectUrl);
    }
    if (activeExchange?.job_id) {
      setPreviewUrl(`${API_BASE}/api/audio/${encodeURIComponent(activeExchange.job_id)}`);
      return undefined;
    }
    setPreviewUrl('');
    return undefined;
  }, [attachedFile, activeExchange?.job_id]);

  async function openExchange(row) {
    setActiveExchange(row);
    setActivePage('exchange-detail');
    setError('');
    setResult(null);
    setIsPlaying(false);

    const saved = row?.validation || {};
    setDecision(saved.decision || '');
    setClassification(saved.classification || '');
    setReviewerNote(saved.reviewerNote || '');
    setCoachingNote(row?.coaching?.note || '');
    setEvidenceReviewed(false);
    setCommitmentRecorded(false);
    setFollowUp(row?.coaching?.followUp || 'Recheck next shift');

    if (!row?.job_id) return;

    try {
      const response = await fetch(`${API_BASE}/api/results/${encodeURIComponent(row.job_id)}`);
      const raw = await response.text();
      const data = JSON.parse(raw);
      if (!response.ok) {
        throw new Error(
          typeof data?.detail === 'string'
            ? data.detail
            : 'Processed results not found for this exchange.',
        );
      }
      setResult(data);
    } catch (err) {
      setError(err.message || 'Could not load exchange results.');
    }
  }

  function handleDecisionChange(value) {
    setDecision(value);
    if (value === 'Not a breach') {
      setClassification('');
    }
  }

  function handleScenarioFile(id, file) {
    if (!file) return;
    if (!file.name.toLowerCase().endsWith('.wav')) {
      setError('Choose a WAV audio file for scenario attachments.');
      return;
    }
    if (file.size > MAX_UPLOAD_BYTES) {
      setError('This file is larger than the 100 MB upload limit.');
      return;
    }
    setScenarioFiles((prev) => ({ ...prev, [id]: file }));
  }

  async function handleImportFile(file) {
    if (!file) return;
    setImportName(file.name);
    try {
      const text = await file.text();
      const data = JSON.parse(text);
      if (Array.isArray(data?.exchanges)) {
        setExchanges(data.exchanges);
      } else if (Array.isArray(data)) {
        setExchanges(data);
      } else {
        throw new Error('JSON must include an exchanges array.');
      }
    } catch (err) {
      setError(err.message || 'Could not import JSON.');
    }
  }

  function downloadTemplate() {
    const template = {
      exchanges: [
        {
          id: '48291',
          title: 'Compliant entry',
          status: 'PROCEED',
          subtitle: 'Scripted audio demonstration',
          execution: 'Successful',
          analysis: 'Awaiting',
          supervisorStatus: 'Not reviewed',
          filter: 'needs_review',
          job_id: 'example_job',
          filename: 'example.wav',
        },
      ],
    };
    const blob = new Blob([JSON.stringify(template, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = 'exchanges_dataset_template.json';
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
  }

  function resetSession() {
    setScenarioFiles({});
    setImportName('');
    setResult(null);
    setError('');
    setDecision('');
    setClassification('');
    setReviewerNote('');
    setCoachingNote('');
    setEvidenceReviewed(false);
    setCommitmentRecorded(false);
    loadExchanges().catch(() => {});
  }

  async function handleListen() {
    if (!previewUrl || !audioRef.current) {
      setError('No audio is available for this exchange.');
      return;
    }
    try {
      await audioRef.current.play();
      setIsPlaying(true);
    } catch {
      setError('This browser blocked playback. Try again.');
    }
  }

  function handlePauseAudio() {
    if (!audioRef.current) return;
    audioRef.current.pause();
    setIsPlaying(false);
  }

  async function runAnalysis() {
    if (!activeExchange?.id || isProcessing) return;
    if (!hasAudio) {
      setError('No audio is available for this exchange.');
      return;
    }

    setError('');
    setIsProcessing(true);

    try {
      const response = await fetch(
        `${API_BASE}/api/exchanges/${encodeURIComponent(activeExchange.id)}/analysis`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ analysis: 'Pending' }),
        },
      );
      const raw = await response.text();
      const data = JSON.parse(raw);
      if (!response.ok) {
        throw new Error(
          typeof data?.detail === 'string' ? data.detail : 'Could not update analysis status.',
        );
      }
      if (Array.isArray(data?.exchanges)) setExchanges(data.exchanges);
      if (data?.exchange) setActiveExchange(data.exchange);

      if (audioRef.current && previewUrl) {
        try {
          audioRef.current.currentTime = 0;
          await audioRef.current.play();
          setIsPlaying(true);
        } catch {
          setError('Analysis set to Pending, but playback was blocked. Use Listen audio.');
        }
      }
    } catch (requestError) {
      const message = requestError.message || 'Could not start analysis review.';
      setError(
        /Failed to fetch|NetworkError|fetch/i.test(message)
          ? 'Cannot reach the API. Check that the backend is running and reachable.'
          : message,
      );
    } finally {
      setIsProcessing(false);
    }
  }

  async function saveValidation() {
    if (!activeExchange?.id || isSavingValidation) return;
    if (String(activeExchange.analysis || '') !== 'Pending') {
      setError('Click Run analysis before saving supervisor validation.');
      return;
    }
    if (!decision) {
      setError('Decision is required.');
      return;
    }
    if (decision !== 'Not a breach' && !classification) {
      setError('Classification is required unless Decision is Not a breach.');
      return;
    }

    setError('');
    setIsSavingValidation(true);
    try {
      const response = await fetch(
        `${API_BASE}/api/exchanges/${encodeURIComponent(activeExchange.id)}/validation`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            decision,
            classification: decision === 'Not a breach' ? '' : classification,
            reviewerNote,
          }),
        },
      );
      const raw = await response.text();
      const data = JSON.parse(raw);
      if (!response.ok) {
        throw new Error(
          typeof data?.detail === 'string' ? data.detail : 'Could not save validation.',
        );
      }
      if (Array.isArray(data?.exchanges)) setExchanges(data.exchanges);
      if (data?.exchange) setActiveExchange(data.exchange);
    } catch (requestError) {
      const message = requestError.message || 'Could not save validation.';
      setError(
        /Failed to fetch|NetworkError|fetch/i.test(message)
          ? 'Cannot reach the API. Check that the backend is running and reachable.'
          : message,
      );
    } finally {
      setIsSavingValidation(false);
    }
  }

  async function completeCoaching() {
    if (!activeExchange?.id || isSavingCoaching) return;
    if (decision !== 'Confirmed breach' && activeExchange?.validation?.decision !== 'Confirmed breach') {
      setError('Coaching requires a confirmed breach.');
      return;
    }
    if (!String(coachingNote || '').trim()) {
      setError('Coaching note / agreed action is required.');
      return;
    }

    setError('');
    setIsSavingCoaching(true);
    try {
      const response = await fetch(
        `${API_BASE}/api/exchanges/${encodeURIComponent(activeExchange.id)}/coaching`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            status: 'Completed',
            followUp,
            note: coachingNote,
          }),
        },
      );
      const raw = await response.text();
      const data = JSON.parse(raw);
      if (!response.ok) {
        throw new Error(
          typeof data?.detail === 'string' ? data.detail : 'Could not complete coaching.',
        );
      }
      if (Array.isArray(data?.exchanges)) setExchanges(data.exchanges);
      if (data?.exchange) setActiveExchange(data.exchange);
      setCoachingSuccessOpen(true);
    } catch (requestError) {
      const message = requestError.message || 'Could not complete coaching.';
      setError(
        /Failed to fetch|NetworkError|fetch/i.test(message)
          ? 'Cannot reach the API. Check that the backend is running and reachable.'
          : message,
      );
    } finally {
      setIsSavingCoaching(false);
    }
  }

  const crumb = useMemo(() => {
    if (activePage === 'overview') {
      return <>Cowal Gold Operation / <strong>Communications overview</strong></>;
    }
    if (activePage === 'exchanges') {
      return <>Cowal Gold Operation / <strong>Exchanges</strong></>;
    }
    if (activePage === 'exchange-detail') {
      return <>Cowal Gold Operation / <strong>Exchange review</strong></>;
    }
    const label = NAV_ITEMS.find((item) => item.id === activePage)?.label || activePage;
    return <>Cowal Gold Operation / <strong>{label}</strong></>;
  }, [activePage]);

  return (
    <div className="app-layout">
      <Sidebar
        activePage={activePage}
        onNavigate={(page) => {
          setActivePage(page);
          if (page !== 'exchange-detail') setActiveExchange(null);
        }}
        onOpenDemo={() => setDemoOpen(true)}
      />

      <div className="main-pane">
        <Topbar crumb={crumb} />
        <main className="content">
          {activePage === 'overview' && (
            <OverviewPage
              data={overview}
              exchanges={exchanges}
              loading={overviewLoading}
              error={overviewError}
              site={site}
              crew={crew}
              period={period}
              onSiteChange={setSite}
              onCrewChange={setCrew}
              onPeriodChange={setPeriod}
              onOpenExchange={openExchange}
              onStartEvidence={() => setActivePage('coaching')}
            />
          )}

          {activePage === 'exchanges' && (
            <ExchangesPage
              exchanges={exchanges}
              filter={exchangeFilter}
              onFilterChange={setExchangeFilter}
              onOpenExchange={openExchange}
            />
          )}

          {activePage === 'exchange-detail' && activeExchange && (
            <ExchangeDetailPage
              exchange={activeExchange}
              hasAudio={hasAudio}
              previewUrl={previewUrl}
              isPlaying={isPlaying}
              isProcessing={isProcessing}
              isSavingValidation={isSavingValidation}
              isSavingCoaching={isSavingCoaching}
              error={error}
              result={result}
              onListen={handleListen}
              onPauseAudio={handlePauseAudio}
              onRunAnalysis={runAnalysis}
              onSaveValidation={saveValidation}
              onCompleteCoaching={completeCoaching}
              audioRef={audioRef}
              decision={decision}
              onDecisionChange={handleDecisionChange}
              classification={classification}
              onClassificationChange={setClassification}
              reviewerNote={reviewerNote}
              onReviewerNoteChange={setReviewerNote}
              coachingNote={coachingNote}
              onCoachingNoteChange={setCoachingNote}
              evidenceReviewed={evidenceReviewed}
              onEvidenceReviewedChange={setEvidenceReviewed}
              commitmentRecorded={commitmentRecorded}
              onCommitmentRecordedChange={setCommitmentRecorded}
              followUp={followUp}
              onFollowUpChange={setFollowUp}
            />
          )}

          {activePage === 'coaching' && (
            <CoachingPage exchanges={exchanges} onOpenExchange={openExchange} />
          )}

          {activePage === 'test-audio' && (
            <TestYourAudioPage
              onExchangesChanged={loadExchanges}
              metrics={overview?.aiAnalysisMetrics}
            />
          )}
        </main>
      </div>

      <DemoDataModal
        open={demoOpen}
        onClose={() => setDemoOpen(false)}
        exchanges={exchanges}
        scenarioFiles={scenarioFiles}
        onScenarioFile={handleScenarioFile}
        importName={importName}
        onImportFile={handleImportFile}
        onDownloadTemplate={downloadTemplate}
        onReset={resetSession}
      />

      {coachingSuccessOpen && (
        <div
          className="modal-backdrop"
          role="presentation"
          onClick={() => setCoachingSuccessOpen(false)}
        >
          <div
            className="modal coaching-success-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="coaching-success-title"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="coaching-success-icon" aria-hidden="true">✓</div>
            <h2 id="coaching-success-title">Coaching completed successfully</h2>
            <p>
              The coaching session for exchange{' '}
              <strong>{activeExchange?.id || 'this record'}</strong> has been saved.
            </p>
            <div className="modal-actions">
              <button
                type="button"
                className="gold-btn"
                onClick={() => setCoachingSuccessOpen(false)}
              >
                Continue
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
