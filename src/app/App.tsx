import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import PatternWaves from '../components/background/PatternWaves';
import Intro from '../components/intro/Intro';
import UploadPanel, { NoticeView, type FileEntry } from '../components/upload/UploadPanel';
import GlideSelect from '../components/controls/GlideSelect';
import FuseButton from '../components/controls/FuseButton';
import ThoughtLine from '../components/processing/ThoughtLine';
import ReportPreview, { type PreviewView } from '../components/report/ReportPreview';
import PeekRating from '../components/feedback/PeekRating';
import Logo from '../components/Logo';
import type { NormalizedRow, RatioKey, ReportModel, ReportOptions, SellerMetric, TemplateKey } from '../types';
import { parseSpreadsheet } from '../data/normalization/normalizeFile';
import { fileKind } from '../data/parser/readWorkbook';
import { createReportScene } from '../report-engine/scene/createReportScene';
import { TEMPLATES } from '../report-engine/templates/templates';
import { STAGES, runPipeline, withSellerMetric } from './pipeline';
import { ensurePageFonts } from '../report-engine/fonts';
import { storage } from '../lib/motion';

const INTRO_KEY = 'vellora.introSeen.v6';
const SAMPLE_FILES = ['selesai.xlsx', 'menunggu.xlsx', 'belum di bayar pembeli.xlsx', 'tidak memenuhi syarat.xlsx'];

let uid = 0;
const newId = () => `f${Date.now().toString(36)}${(uid++).toString(36)}`;

function initialIntro(): boolean {
  try {
    const q = new URLSearchParams(window.location.search);
    if (q.has('intro')) return true;
    if (q.has('nointro')) return false;
  } catch {
    /* noop */
  }
  const s = storage();
  return !s || s.getItem(INTRO_KEY) !== '1';
}

export default function App() {
  const [intro, setIntro] = useState(initialIntro);
  const [entered, setEntered] = useState(false); // studio opened via CTA
  const [entries, setEntries] = useState<FileEntry[]>([]);
  const [opts, setOpts] = useState<ReportOptions>({
    ratio: '4:5',
    customW: 3,
    customH: 4,
    template: 'affiliate-monthly',
    sellerMetric: 'commission',
    title: 'Laporan Affiliate',
  });
  const [proc, setProc] = useState<{ stage: number; startedAt: number; finishedAt: number | null; error: string | null } | null>(null);
  const [model, setModel] = useState<ReportModel | null>(null);
  const rowsRef = useRef<NormalizedRow[]>([]);
  const [revealId, setRevealId] = useState(0);
  const [view, setView] = useState<PreviewView>('artboard');
  const [samplesAvailable, setSamplesAvailable] = useState(false);
  const [showNotes, setShowNotes] = useState(false);
  const studioRef = useRef<HTMLDivElement>(null);
  const reportRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    ensurePageFonts();
    // sample files exist only in the hosted build (public/samples), not in the single-file preview
    if (window.location.protocol === 'file:') return;
    fetch(`./samples/${encodeURIComponent(SAMPLE_FILES[0])}`, { method: 'HEAD' })
      .then((r) => setSamplesAvailable(r.ok))
      .catch(() => setSamplesAvailable(false));
  }, []);

  const endIntro = useCallback(() => {
    storage()?.setItem(INTRO_KEY, '1');
    setIntro(false);
  }, []);

  /* ------------------------------- files -------------------------------- */

  const addFiles = useCallback((files: File[]) => {
    const accepted: FileEntry[] = [];
    for (const file of files) {
      accepted.push({ id: newId(), file, state: fileKind(file.name) ? 'checking' : 'error' });
    }
    setEntries((prev) => [...prev, ...accepted]);
    // validate each file immediately (client-side parse) so the list shows a truthful state
    accepted.forEach(async (e) => {
      let parsed;
      try {
        const buf = await e.file.arrayBuffer();
        parsed = parseSpreadsheet(buf, e.file.name, e.id);
      } catch {
        parsed = parseSpreadsheet(new ArrayBuffer(0), e.file.name, e.id);
      }
      const state: FileEntry['state'] = parsed.fatal
        ? 'error'
        : parsed.notices.some((n) => n.level === 'warning')
          ? 'warning'
          : parsed.rangeRecovered
            ? 'recovered'
            : 'ready';
      setEntries((prev) => prev.map((x) => (x.id === e.id ? { ...x, state, parsed } : x)));
    });
  }, []);

  // paste-file support
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const files = [...(e.clipboardData?.files ?? [])].filter((f) => fileKind(f.name));
      if (files.length) {
        e.preventDefault();
        setEntered(true);
        addFiles(files);
      }
    };
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  }, [addFiles]);

  const loadSamples = async () => {
    try {
      const files = await Promise.all(
        SAMPLE_FILES.map(async (n) => {
          const r = await fetch(`./samples/${encodeURIComponent(n)}`);
          if (!r.ok) throw new Error('missing');
          return new File([await r.blob()], n, { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
        }),
      );
      addFiles(files);
    } catch {
      setSamplesAvailable(false);
    }
  };

  const removeFile = (id: string) => setEntries((prev) => prev.filter((e) => e.id !== id));

  const resetAll = () => {
    setEntries([]);
    setModel(null);
    setProc(null);
    rowsRef.current = [];
  };

  /* ------------------------------ generate ------------------------------ */

  const usable = entries.filter((e) => e.state !== 'error' && e.state !== 'checking');
  const checking = entries.some((e) => e.state === 'checking');
  const running = !!proc && proc.finishedAt === null && !proc.error;

  const generate = async () => {
    if (!usable.length || running) return;
    const startedAt = performance.now();
    setProc({ stage: 0, startedAt, finishedAt: null, error: null });
    setModel(null);
    requestAnimationFrame(() => document.getElementById('processing')?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
    try {
      const res = await runPipeline(
        usable.map((e) => ({ id: e.id, file: e.file })),
        opts.sellerMetric,
        (stage) => setProc((p) => (p ? { ...p, stage } : p)),
        (m) => {
          // build both scenes once during the "visualization" stage (real work, measured)
          createReportScene(m, opts, 'artboard');
          createReportScene(m, opts, 'mobile');
        },
      );
      rowsRef.current = res.rows;
      const finishedAt = performance.now();
      setProc((p) => (p ? { ...p, stage: STAGES.length, finishedAt } : p));
      // let the ready state settle, then reveal
      window.setTimeout(() => {
        setModel(res.model);
        setRevealId((r) => r + 1);
        const narrow = window.innerWidth < 640;
        setView(narrow ? 'mobile' : 'artboard');
        requestAnimationFrame(() => reportRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
      }, 520);
    } catch (err) {
      setProc((p) =>
        p
          ? {
              ...p,
              finishedAt: performance.now(),
              error:
                err instanceof Error && err.message.startsWith('We couldn')
                  ? `${err.message} Periksa catatan pada setiap file di atas.`
                  : 'Terjadi kesalahan saat memproses data. Coba lagi, atau periksa file yang diunggah.',
            }
          : p,
      );
    }
  };

  /* --------------------------- derived scenes --------------------------- */

  const liveModel = useMemo(
    () => (model ? withSellerMetric(model, rowsRef.current, opts.sellerMetric) : null),
    [model, opts.sellerMetric],
  );
  const artboard = useMemo(() => (liveModel ? createReportScene(liveModel, opts, 'artboard') : null), [liveModel, opts]);
  const mobile = useMemo(() => (liveModel ? createReportScene(liveModel, opts, 'mobile') : null), [liveModel, opts]);

  const ratioLabel = opts.ratio === 'custom' ? `${opts.customW}:${opts.customH}` : opts.ratio;

  const enter = () => {
    setEntered(true);
    requestAnimationFrame(() => studioRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
  };

  const notes = model?.warnings ?? [];

  return (
    <>
      <PatternWaves intensity={intro ? 0.85 : 0.6} />
      {intro ? <Intro onDone={endIntro} /> : null}

      <div className={`vl-app ${intro ? 'is-hidden' : 'is-in'}`} aria-hidden={intro}>
        <header className="vl-nav">
          <a className="vl-nav__brand" href="#top" aria-label="VELLORA beranda">
            <Logo />
            <span className="vl-nav__word">VELLORA</span>
          </a>
          <div className="vl-nav__right">
            <span className="vl-nav__tag">Affiliate Intelligence</span>
            <button type="button" className="vl-linkbtn" onClick={() => setIntro(true)}>
              Putar intro
            </button>
          </div>
        </header>

        <main id="top">
          <section className="vl-hero" aria-labelledby="hero-title">
            <p className="vl-eyebrow">AFFILIATE INTELLIGENCE</p>
            <h1 id="hero-title" className="vl-hero__title">
              Siap melihat performa affiliate kamu?
            </h1>
            <p className="vl-hero__lead">Ubah kumpulan data penjualan kamu menjadi laporan visual yang lebih menarik.</p>
            <p className="vl-hero__purpose">
              Website ini dibuat untuk memudahkan affiliate melihat dan memahami laporan bulanan melalui tampilan visual yang rapi, menarik, dan mudah
              dipahami.
            </p>
            <div className="vl-hero__cta">
              <FuseButton onClick={enter} size="lg">
                MULAI SEKARANG →
              </FuseButton>
            </div>
            <ol className="vl-flow" aria-label="Alur VELLORA">
              {['DATA', 'PROCESSING', 'VISUALIZATION', 'INSIGHT'].map((s, i) => (
                <li key={s} className="vl-flow__step">
                  <span className="vl-flow__n">0{i + 1}</span>
                  <span className="vl-flow__l">{s}</span>
                </li>
              ))}
            </ol>
          </section>

          {entered ? (
            <div className="vl-studio" ref={studioRef} id="studio">
              <div className="vl-studio__grid">
                <UploadPanel
                  entries={entries}
                  onAdd={addFiles}
                  onRemove={removeFile}
                  onSamples={loadSamples}
                  samplesAvailable={samplesAvailable}
                />

                <section className="vl-card vl-options" aria-labelledby="opts-title">
                  <div className="vl-card__head">
                    <h2 id="opts-title" className="vl-h2">
                      BUILD REPORT
                    </h2>
                    <p className="vl-muted">Pilih rasio dan template. Rasio hanya mengubah artboard laporan, bukan aplikasi.</p>
                  </div>
                  <label className="vl-field">
                    <span className="vl-field__label">Judul laporan</span>
                    <input
                      type="text"
                      value={opts.title}
                      maxLength={80}
                      onChange={(e) => setOpts((o) => ({ ...o, title: e.target.value }))}
                    />
                  </label>
                  <GlideSelect<RatioKey>
                    label="Rasio laporan"
                    value={opts.ratio}
                    onChange={(ratio) => setOpts((o) => ({ ...o, ratio }))}
                    options={[
                      { value: '1:1', label: '1:1 Square', hint: '1080×1080' },
                      { value: '4:5', label: '4:5 Portrait', hint: '1080×1350' },
                      { value: '9:16', label: '9:16 Story', hint: '1080×1920' },
                      { value: '16:9', label: '16:9 Landscape', hint: '1920×1080' },
                      { value: 'custom', label: 'Custom', hint: 'atur sendiri' },
                    ]}
                  />
                  {opts.ratio === 'custom' ? (
                    <div className="vl-custom">
                      <label className="vl-field">
                        <span className="vl-field__label">Lebar</span>
                        <input
                          type="number"
                          inputMode="decimal"
                          min={1}
                          max={30}
                          step={1}
                          value={opts.customW}
                          onChange={(e) => setOpts((o) => ({ ...o, customW: Math.max(1, Math.min(30, Number(e.target.value) || 1)) }))}
                        />
                      </label>
                      <span className="vl-custom__x" aria-hidden="true">
                        :
                      </span>
                      <label className="vl-field">
                        <span className="vl-field__label">Tinggi</span>
                        <input
                          type="number"
                          inputMode="decimal"
                          min={1}
                          max={30}
                          step={1}
                          value={opts.customH}
                          onChange={(e) => setOpts((o) => ({ ...o, customH: Math.max(1, Math.min(30, Number(e.target.value) || 1)) }))}
                        />
                      </label>
                    </div>
                  ) : null}
                  <GlideSelect<TemplateKey>
                    label="Template visual"
                    value={opts.template}
                    onChange={(template) => setOpts((o) => ({ ...o, template }))}
                    options={Object.values(TEMPLATES).map((t) => ({ value: t.id, label: t.label, hint: t.description }))}
                  />
                  <GlideSelect<SellerMetric>
                    label="Peringkat toko berdasarkan"
                    value={opts.sellerMetric}
                    onChange={(sellerMetric) => setOpts((o) => ({ ...o, sellerMetric }))}
                    options={[
                      { value: 'commission', label: 'Estimasi komisi' },
                      { value: 'gmv', label: 'GMV' },
                      { value: 'units', label: 'Unit terjual' },
                    ]}
                  />
                  <div className="vl-options__actions">
                    <FuseButton onClick={generate} disabled={!usable.length || checking} busy={running} size="lg" className="vl-grow">
                      {running ? 'MEMPROSES…' : model ? 'BUILD ULANG' : 'GENERATE REPORT'}
                    </FuseButton>
                    <FuseButton onClick={resetAll} variant="danger" fuseMs={2400} fuseLabel="Batalkan reset" disabled={!entries.length || running}>
                      RESET
                    </FuseButton>
                  </div>
                  <p className="vl-muted vl-small">
                    {checking
                      ? 'Memeriksa file…'
                      : usable.length
                        ? `${usable.length} file siap diproses.`
                        : 'Unggah minimal satu file yang valid untuk mulai.'}
                  </p>
                </section>
              </div>

              {proc ? (
                <div id="processing" className={`vl-processing ${model ? 'is-quiet' : ''}`}>
                  <ThoughtLine
                    stages={STAGES}
                    current={proc.stage}
                    startedAt={proc.startedAt}
                    finishedAt={proc.finishedAt}
                    error={proc.error}
                  />
                </div>
              ) : null}

              {model && artboard && mobile ? (
                <div ref={reportRef} className="vl-report-wrap" id="report">
                  {notes.length ? (
                    <section className="vl-card vl-notes" aria-labelledby="notes-title">
                      <button type="button" className="vl-notes__toggle" aria-expanded={showNotes} onClick={() => setShowNotes((s) => !s)}>
                        <span id="notes-title" className="vl-eyebrow">
                          CATATAN VALIDASI
                        </span>
                        <span className="vl-muted">
                          {notes.filter((n) => n.level === 'error').length} error · {notes.filter((n) => n.level === 'warning').length} peringatan ·{' '}
                          {notes.filter((n) => n.level === 'info').length} info
                        </span>
                        <span className="vl-notes__chev" aria-hidden="true">
                          {showNotes ? '−' : '+'}
                        </span>
                      </button>
                      {showNotes ? (
                        <div className="vl-notes__list">
                          {notes.map((n, i) => (
                            <div key={i}>
                              {n.file ? <p className="vl-notes__file">{n.file}{n.sheet ? ` · ${n.sheet}` : ''}</p> : null}
                              <NoticeView n={n} />
                            </div>
                          ))}
                        </div>
                      ) : null}
                    </section>
                  ) : null}
                  <ReportPreview artboard={artboard} mobile={mobile} view={view} onView={setView} ratioLabel={ratioLabel} revealId={revealId} />
                </div>
              ) : null}
            </div>
          ) : null}
        </main>

        <footer className="vl-footer">
          <span>VELLORA</span>
          <span className="vl-muted">by Haidar Abdurrohman · data diproses lokal di browser</span>
        </footer>
        <PeekRating />
      </div>
    </>
  );
}
