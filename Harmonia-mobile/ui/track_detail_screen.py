from PySide6.QtWidgets import (
    QWidget, QVBoxLayout, QHBoxLayout, QLabel, QPushButton, QMessageBox
)
from PySide6.QtGui import QPainter, QColor, QPen, QLinearGradient
from PySide6.QtCore import Qt, QThread, Signal, QTimer
import random

from data.api_client import get_track_analysis, trigger_analysis
from ui import theme


# ── Worker ─────────────────────────────────────────────────────────────────

class FetchAnalysisWorker(QThread):
    finished = Signal(dict)
    error    = Signal(str)

    def __init__(self, track_id):
        super().__init__()
        self.track_id = track_id

    def run(self):
        try:
            data = get_track_analysis(self.track_id)
            self.finished.emit(data)
        except Exception as exc:
            self.error.emit(str(exc))


# ── Waveform widget ────────────────────────────────────────────────────────

class WaveformWidget(QWidget):
    def __init__(self, seed: int = 1):
        super().__init__()
        self.setFixedHeight(72)
        self.seed = seed

    def paintEvent(self, event):
        painter = QPainter(self)
        painter.setRenderHint(QPainter.Antialiasing)
        w, h = self.width(), self.height()
        mid  = h // 2
        pen  = QPen(QColor(theme.ACCENT))
        pen.setWidth(2)
        painter.setPen(pen)
        random.seed(self.seed)
        bars  = 60
        bar_w = w / bars
        for i in range(bars):
            amp = random.uniform(0.1, 0.9) * (mid - 4)
            x   = int(i * bar_w + bar_w / 2)
            painter.drawLine(x, int(mid - amp), x, int(mid + amp))


# ── UC02: FFT spectrum widget ──────────────────────────────────────────────

class FFTWidget(QWidget):
    def __init__(self, seed: int = 1):
        super().__init__()
        self.setFixedHeight(64)
        self._seed = seed
        self._magnitudes = None

    def set_magnitudes(self, magnitudes: list):
        self._magnitudes = magnitudes
        self.update()

    def paintEvent(self, event):
        painter = QPainter(self)
        painter.setRenderHint(QPainter.Antialiasing)
        w, h = self.width(), self.height()
        bars = 48

        if self._magnitudes:
            step = max(1, len(self._magnitudes) // bars)
            amps = [self._magnitudes[i * step] for i in range(bars)]
            mx   = max(amps) if max(amps) > 0 else 1
            normalized = [a / mx for a in amps]
        else:
            random.seed(self._seed + 1000)
            normalized = []
            for i in range(bars):
                env = max(0.05, 1.0 - abs(i / bars - 0.3) * 1.2)
                normalized.append(random.uniform(0.05, 1.0) * env)

        bar_w = w / bars
        for i, amp in enumerate(normalized):
            bar_h = max(3, int(amp * (h - 4)))
            x  = int(i * bar_w)
            bw = max(1, int(bar_w) - 1)
            grad = QLinearGradient(x, h - bar_h, x, h)
            grad.setColorAt(0, QColor(theme.INFO))
            grad.setColorAt(1, QColor(theme.INFO).darker(220))
            painter.setBrush(grad)
            painter.setPen(Qt.NoPen)
            painter.drawRoundedRect(x, h - bar_h, bw, bar_h, 2, 2)


# ── Loading spinner ────────────────────────────────────────────────────────

class LoadingDots(QLabel):
    def __init__(self):
        super().__init__("Fetching analysis .")
        self.setAlignment(Qt.AlignCenter)
        self.setStyleSheet(f"color: {theme.TEXT_TERTIARY}; font-size: 12px; padding: 4px;")
        self._step = 0
        self._timer = QTimer(self)
        self._timer.timeout.connect(self._tick)
        self._timer.start(400)

    def _tick(self):
        self._step = (self._step + 1) % 4
        self.setText("Fetching analysis" + " ." * self._step)

    def stop(self):
        self._timer.stop()
        self.hide()


# ── Track detail screen ────────────────────────────────────────────────────

class TrackDetailScreen(QWidget):
    delete_requested  = Signal(int)
    compare_requested = Signal(dict)

    def __init__(self, on_back):
        super().__init__()
        self.on_back             = on_back
        self.track               = None
        self._worker             = None
        self._stat_labels: dict  = {}
        self._library_tracks     = []
        self._fft_widget         = None
        self._reco_container     = None
        self._reco_layout        = None
        self._setup_ui()

    def set_library_tracks(self, tracks: list):
        self._library_tracks = tracks

    def _setup_ui(self):
        self.setObjectName("TrackDetailScreen")
        self.setStyleSheet(f"#TrackDetailScreen {{ background: {theme.BG_PRIMARY}; }}")

        self.main_layout = QVBoxLayout(self)
        self.main_layout.setContentsMargins(16, 14, 16, 14)
        self.main_layout.setSpacing(8)

        back_btn = QPushButton("← Back to Library")
        back_btn.setStyleSheet(f"""
            QPushButton {{
                background: transparent; color: {theme.ACCENT};
                border: none; font-size: 13px;
                text-align: left; padding: 0;
            }}
            QPushButton:hover {{ color: {theme.ACCENT_HOVER}; }}
        """)
        back_btn.clicked.connect(self.on_back)
        self.main_layout.addWidget(back_btn)

        placeholder = QLabel("Select a track from the library.")
        placeholder.setStyleSheet(f"color: {theme.TEXT_SECONDARY}; font-size: 13px;")
        placeholder.setAlignment(Qt.AlignCenter)
        self.main_layout.addWidget(placeholder)
        self.main_layout.addStretch()

    # ── Load track ─────────────────────────────────────────────────────────

    def load_track(self, track: dict):
        self.track           = track
        self._stat_labels    = {}
        self._fft_widget     = None
        self._reco_container = None
        self._reco_layout    = None

        while self.main_layout.count() > 1:
            item = self.main_layout.takeAt(1)
            if item.widget():
                item.widget().deleteLater()
            elif item.layout():
                _clear_layout(item.layout())

        self._build_content(track)

    # ── Build UI ───────────────────────────────────────────────────────────

    def _build_content(self, track: dict):
        art = QLabel("🎵")
        art.setAlignment(Qt.AlignCenter)
        art.setStyleSheet(f"""
            font-size: 64px; background: {theme.BG_SECONDARY};
            border-radius: {theme.RADIUS_LG}px; padding: 16px;
        """)
        art.setFixedHeight(140)
        self.main_layout.addWidget(art)

        title_lbl = QLabel(track["title"])
        title_lbl.setStyleSheet(f"color: {theme.TEXT_PRIMARY}; font-size: 18px; font-weight: bold;")
        title_lbl.setAlignment(Qt.AlignCenter)
        title_lbl.setWordWrap(True)

        artist_lbl = QLabel(track["artist"])
        artist_lbl.setStyleSheet(f"color: {theme.TEXT_SECONDARY}; font-size: 13px;")
        artist_lbl.setAlignment(Qt.AlignCenter)

        duration_lbl = QLabel(f"⏱  {track['duration']}")
        duration_lbl.setStyleSheet(f"color: {theme.TEXT_TERTIARY}; font-size: 12px;")
        duration_lbl.setAlignment(Qt.AlignCenter)

        self.main_layout.addWidget(title_lbl)
        self.main_layout.addWidget(artist_lbl)
        self.main_layout.addWidget(duration_lbl)

        # Stats row
        stats_row = QHBoxLayout()
        stats_row.setSpacing(8)
        for stat_key, value, color in [
            ("BPM",    str(track["bpm"]),                 theme.INFO),
            ("Key",    track["key"],                      theme.SUCCESS),
            ("Status", str(track["status"]).capitalize(), theme.WARNING),
        ]:
            box = QWidget()
            box.setStyleSheet(f"background: {theme.BG_SECONDARY}; border-radius: {theme.RADIUS_MD}px;")
            bl  = QVBoxLayout(box)
            bl.setContentsMargins(8, 8, 8, 8)
            bl.setSpacing(2)
            val_lbl = QLabel(value)
            val_lbl.setStyleSheet(f"color: {color}; font-size: 17px; font-weight: bold;")
            val_lbl.setAlignment(Qt.AlignCenter)
            key_lbl = QLabel(stat_key)
            key_lbl.setStyleSheet(f"color: {theme.TEXT_TERTIARY}; font-size: 10px;")
            key_lbl.setAlignment(Qt.AlignCenter)
            bl.addWidget(val_lbl)
            bl.addWidget(key_lbl)
            stats_row.addWidget(box)
            self._stat_labels[stat_key] = val_lbl
        self.main_layout.addLayout(stats_row)

        # Loading + error
        self._loading_dots = LoadingDots()
        self.main_layout.addWidget(self._loading_dots)

        self._error_widget = self._make_error_widget(track["id"])
        self._error_widget.hide()
        self.main_layout.addWidget(self._error_widget)

        # Waveform
        wave_lbl = QLabel("Waveform")
        wave_lbl.setStyleSheet(f"color: {theme.TEXT_TERTIARY}; font-size: 11px; margin-top: 4px;")
        self.main_layout.addWidget(wave_lbl)
        self.main_layout.addWidget(WaveformWidget(seed=track["id"] or 1))

        # UC02: FFT spectrum
        fft_lbl = QLabel("Frequency Spectrum")
        fft_lbl.setStyleSheet(f"color: {theme.TEXT_TERTIARY}; font-size: 11px; margin-top: 2px;")
        self.main_layout.addWidget(fft_lbl)
        self._fft_widget = FFTWidget(seed=track["id"] or 1)
        self.main_layout.addWidget(self._fft_widget)

        # UC05 + UC06 + UC07 action buttons
        actions = QHBoxLayout()
        actions.setSpacing(6)
        for label, bg_alpha, color, slot in [
            ("🗑  Delete",   "rgba(255,69,58,18)",   theme.ERROR,   lambda: self._confirm_delete(track)),
            ("⇄  Compare",  "rgba(100,210,255,18)", theme.INFO,    lambda: self.compare_requested.emit(track)),
            ("♪  Similar",  "rgba(50,215,75,18)",   theme.SUCCESS, self._show_recommendations),
        ]:
            btn = QPushButton(label)
            btn.setFixedHeight(36)
            btn.setStyleSheet(f"""
                QPushButton {{
                    background: {bg_alpha}; color: {color};
                    border: 1px solid {color}; border-radius: {theme.RADIUS_SM}px;
                    font-size: 12px;
                }}
                QPushButton:hover {{ background: {color}; color: {theme.BG_PRIMARY}; }}
            """)
            btn.clicked.connect(slot)
            actions.addWidget(btn)
        self.main_layout.addLayout(actions)

        # UC07: recommendations container (hidden until button clicked)
        self._reco_container = QWidget()
        self._reco_container.hide()
        self._reco_container.setStyleSheet(
            f"background: {theme.BG_SECONDARY}; border-radius: {theme.RADIUS_MD}px;"
        )
        self._reco_layout = QVBoxLayout(self._reco_container)
        self._reco_layout.setContentsMargins(10, 8, 10, 8)
        self._reco_layout.setSpacing(4)
        self.main_layout.addWidget(self._reco_container)

        self.main_layout.addStretch()
        self._fetch_analysis(track["id"])

    def _confirm_delete(self, track: dict):
        if QMessageBox.question(
            self, "Delete Track",
            f'Delete "{track["title"]}"?\nThis cannot be undone.',
            QMessageBox.Yes | QMessageBox.No, QMessageBox.No
        ) == QMessageBox.Yes:
            self.delete_requested.emit(track["id"])

    # ── UC07: recommendations ──────────────────────────────────────────────

    def _show_recommendations(self):
        if not self._reco_container or not self.track:
            return

        track = self.track
        bpm   = track.get("bpm")
        key   = track.get("key", "").lower()
        root  = key.split()[0] if key else ""

        while self._reco_layout.count():
            item = self._reco_layout.takeAt(0)
            if item.widget():
                item.widget().deleteLater()

        similar = []
        for t in self._library_tracks:
            if t.get("id") == track.get("id"):
                continue
            t_bpm  = t.get("bpm")
            t_key  = t.get("key", "").lower()
            t_root = t_key.split()[0] if t_key else ""
            bpm_ok = isinstance(bpm, int) and isinstance(t_bpm, int) and abs(bpm - t_bpm) <= 5
            key_ok = bool(root and t_root and root == t_root)
            if bpm_ok or key_ok:
                similar.append((t, bpm_ok and key_ok, t_bpm or 0))

        similar.sort(key=lambda x: (not x[1], abs((bpm or 0) - x[2])))

        hdr = QLabel(f"Similar tracks ({len(similar)})")
        hdr.setStyleSheet(f"color: {theme.TEXT_SECONDARY}; font-size: 11px; font-weight: bold;")
        self._reco_layout.addWidget(hdr)

        if not similar:
            lbl = QLabel("No similar tracks in your library")
            lbl.setStyleSheet(f"color: {theme.TEXT_TERTIARY}; font-size: 12px;")
            self._reco_layout.addWidget(lbl)
        else:
            for t, _, _ in similar[:5]:
                row = QHBoxLayout()
                row.setSpacing(6)
                name = QLabel(f"{t['title']} — {t['artist']}")
                name.setStyleSheet(f"color: {theme.TEXT_PRIMARY}; font-size: 12px;")
                row.addWidget(name, stretch=1)
                meta = QLabel(f"{t.get('bpm','—')} BPM · {t.get('key','—')}")
                meta.setStyleSheet(f"color: {theme.INFO}; font-size: 11px;")
                row.addWidget(meta)
                self._reco_layout.addLayout(row)

        self._reco_container.show()

    # ── Error widget ───────────────────────────────────────────────────────

    def _make_error_widget(self, track_id) -> QWidget:
        container = QWidget()
        container.setStyleSheet(
            f"background: rgba(255, 69, 58, 20); border-radius: {theme.RADIUS_SM}px; padding: 4px;"
        )
        row = QHBoxLayout(container)
        row.setContentsMargins(10, 6, 10, 6)
        msg = QLabel("⚠  Could not load analysis")
        msg.setStyleSheet(f"color: {theme.ERROR}; font-size: 12px;")
        row.addWidget(msg)
        row.addStretch()
        retry_btn = QPushButton("Retry")
        retry_btn.setFixedHeight(26)
        retry_btn.setStyleSheet(f"""
            QPushButton {{
                background: {theme.ACCENT}; color: {theme.TEXT_PRIMARY};
                border: none; border-radius: {theme.RADIUS_SM}px;
                font-size: 11px; padding: 0 10px;
            }}
            QPushButton:hover {{ background: {theme.ACCENT_HOVER}; }}
        """)
        retry_btn.clicked.connect(lambda: self._retry_analysis(track_id))
        row.addWidget(retry_btn)
        return container

    # ── Analysis fetch ─────────────────────────────────────────────────────

    def _fetch_analysis(self, track_id):
        if not track_id:
            self._loading_dots.stop()
            return
        self._loading_dots.show()
        self._error_widget.hide()
        self._worker = FetchAnalysisWorker(track_id)
        self._worker.finished.connect(self._on_analysis_loaded)
        self._worker.error.connect(self._on_analysis_error)
        self._worker.start()

    def _retry_analysis(self, track_id):
        self._error_widget.hide()
        self._fetch_analysis(track_id)

    def _on_analysis_loaded(self, analysis: dict):
        self._loading_dots.stop()

        if not analysis:
            self._auto_trigger_analysis()
            return

        key_part   = analysis.get("key",   "") or ""
        scale_part = analysis.get("scale", "") or ""
        key_full   = f"{key_part} {scale_part}".strip() or "—"

        if analysis.get("bpm"):
            bpm = analysis["bpm"]
            self._stat_labels["BPM"].setText(
                str(round(bpm)) if isinstance(bpm, float) else str(bpm)
            )
        self._stat_labels["Key"].setText(key_full)
        self._stat_labels["Status"].setText("Analyzed")

        if self._fft_widget:
            magnitudes = (
                analysis.get("fft_magnitudes")
                or analysis.get("fft_data")
                or analysis.get("spectrum")
            )
            if isinstance(magnitudes, list) and magnitudes:
                self._fft_widget.set_magnitudes(magnitudes)

    def _auto_trigger_analysis(self):
        if not self.track:
            return
        track_id = self.track["id"]
        try:
            trigger_analysis(track_id)
            print(f"DEBUG: auto-triggered analysis for track {track_id}")
        except Exception as exc:
            print(f"DEBUG: auto-trigger failed -> {exc}")
            self._error_widget.show()
            return
        self._loading_dots.show()
        QTimer.singleShot(8000, lambda: self._fetch_analysis(track_id))

    def _on_analysis_error(self, error_msg: str):
        print(f"DEBUG: analysis fetch error -> {error_msg}")
        self._loading_dots.stop()
        self._error_widget.show()


# ── Helper ─────────────────────────────────────────────────────────────────

def _clear_layout(layout):
    while layout.count():
        item = layout.takeAt(0)
        if item.widget():
            item.widget().deleteLater()
        elif item.layout():
            _clear_layout(item.layout())
