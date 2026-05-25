from PySide6.QtWidgets import (
    QWidget, QVBoxLayout, QHBoxLayout, QLabel, QPushButton
)
from PySide6.QtGui import QPainter, QColor, QPen
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


# ── Loading spinner (text-based, pulses via QTimer) ────────────────────────

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
    def __init__(self, on_back):
        super().__init__()
        self.on_back    = on_back
        self.track      = None
        self._worker    = None
        self._stat_labels: dict = {}
        self._setup_ui()

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
        self.track = track
        self._stat_labels = {}

        while self.main_layout.count() > 1:
            item = self.main_layout.takeAt(1)
            if item.widget():
                item.widget().deleteLater()
            elif item.layout():
                _clear_layout(item.layout())

        self._build_content(track)

    # ── Build UI ───────────────────────────────────────────────────────────

    def _build_content(self, track: dict):
        # Album art placeholder
        art = QLabel("🎵")
        art.setAlignment(Qt.AlignCenter)
        art.setStyleSheet(f"""
            font-size: 64px; background: {theme.BG_SECONDARY};
            border-radius: {theme.RADIUS_LG}px; padding: 16px;
        """)
        art.setFixedHeight(140)
        self.main_layout.addWidget(art)

        # Title + artist + duration
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

        # ── Stats row ──────────────────────────────────────────────────────
        stats_row = QHBoxLayout()
        stats_row.setSpacing(8)
        for stat_key, value, color in [
            ("BPM",    str(track["bpm"]),                    theme.INFO),
            ("Key",    track["key"],                         theme.SUCCESS),
            ("Status", str(track["status"]).capitalize(),    theme.WARNING),
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

        # ── Loading indicator ──────────────────────────────────────────────
        self._loading_dots = LoadingDots()
        self.main_layout.addWidget(self._loading_dots)

        # ── Error widget — hidden by default ──────────────────────────────
        self._error_widget = self._make_error_widget(track["id"])
        self._error_widget.hide()
        self.main_layout.addWidget(self._error_widget)

        # ── Waveform ───────────────────────────────────────────────────────
        wave_lbl = QLabel("Waveform")
        wave_lbl.setStyleSheet(f"color: {theme.TEXT_TERTIARY}; font-size: 11px; margin-top: 4px;")
        self.main_layout.addWidget(wave_lbl)
        self.main_layout.addWidget(WaveformWidget(seed=track["id"] or 1))
        self.main_layout.addStretch()

        self._fetch_analysis(track["id"])

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
            # No analysis in DB yet — trigger it, then poll every 8 s
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

    def _auto_trigger_analysis(self):
        """No analysis found — trigger the job and start polling."""
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
        # Show loading and re-fetch after 8 s to check if analysis finished
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
