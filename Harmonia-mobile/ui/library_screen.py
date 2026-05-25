from PySide6.QtWidgets import (
    QWidget, QVBoxLayout, QHBoxLayout, QLabel,
    QLineEdit, QScrollArea, QFrame, QPushButton,
    QFileDialog, QMessageBox, QComboBox, QSizePolicy
)
from PySide6.QtCore import Qt, QThread, Signal, QTimer
from PySide6.QtGui import QIntValidator

from data.api_client import (
    get_or_create_user_id, get_user_tracks, normalize_track,
    upload_track, delete_track
)
from data.mock_data import MOCK_TRACKS

PENDING_STATUSES = {"pending", "queued", "analyzing", "processing"}

KEYS = [
    "All Keys",
    "C major", "G major", "D major", "A major", "E major", "B major",
    "F major", "Bb major", "Eb major", "Ab major",
    "A minor", "E minor", "B minor", "F# minor", "C# minor",
    "D minor", "G minor", "C minor", "F minor",
]


def _is_pending(track: dict) -> bool:
    return str(track.get("status", "")).lower() in PENDING_STATUSES


# ── Workers ────────────────────────────────────────────────────────────────

class FetchTracksWorker(QThread):
    finished = Signal(list)
    error    = Signal(str)

    def run(self):
        try:
            user_id = get_or_create_user_id()
            raw = get_user_tracks(user_id)
            self.finished.emit([normalize_track(t) for t in raw])
        except Exception as exc:
            self.error.emit(str(exc))


class UploadWorker(QThread):
    finished = Signal(dict)
    error    = Signal(str)

    def __init__(self, file_path: str):
        super().__init__()
        self.file_path = file_path

    def run(self):
        try:
            user_id = get_or_create_user_id()
            raw = upload_track(user_id, self.file_path)
            self.finished.emit(normalize_track(raw))
        except Exception as exc:
            self.error.emit(str(exc))


class DeleteWorker(QThread):
    finished = Signal(int, bool)

    def __init__(self, track_id: int):
        super().__init__()
        self.track_id = track_id

    def run(self):
        self.finished.emit(self.track_id, delete_track(self.track_id))


# ── Pulsing badge ──────────────────────────────────────────────────────────

class PulseBadge(QLabel):
    _DIM    = "#3d2a80"
    _BRIGHT = "#7c3aed"

    def __init__(self, text: str, pending: bool = False):
        super().__init__(text)
        self.setAlignment(Qt.AlignCenter)
        self.setFixedWidth(86)      # fixed width prevents horizontal overflow
        self._pending = pending
        self._bright  = False
        self._set_style(False)

        if pending:
            self._timer = QTimer(self)
            self._timer.timeout.connect(self._tick)
            self._timer.start(600)

    def _tick(self):
        self._bright = not self._bright
        self._set_style(self._bright)

    def _set_style(self, bright: bool):
        bg  = self._BRIGHT if bright else self._DIM
        col = "#e9d5ff"    if bright else "#a78bfa"
        self.setStyleSheet(f"""
            color: {col}; background: {bg};
            border-radius: 6px; padding: 3px 6px;
            font-size: 11px; font-weight: bold;
        """)


# ── Track card ─────────────────────────────────────────────────────────────

class TrackCard(QFrame):
    delete_requested = Signal(int)

    def __init__(self, track: dict, on_click):
        super().__init__()
        self.track    = track
        self._pending = _is_pending(track)
        self.setFrameShape(QFrame.NoFrame)
        self.setFixedHeight(56)     # compact fixed height — one card = 56 px
        self.setCursor(Qt.PointingHandCursor)
        self.setStyleSheet("""
            QFrame { background: #1e1e2e; border-radius: 8px; }
            QFrame:hover { background: #252540; }
        """)
        self._build(on_click)

    def _build(self, on_click):
        row = QHBoxLayout(self)
        row.setContentsMargins(10, 0, 6, 0)
        row.setSpacing(8)

        icon = QLabel("♪")
        icon.setFixedWidth(22)
        icon.setStyleSheet("color: #6d6d8a; font-size: 18px;")
        row.addWidget(icon)

        info = QVBoxLayout()
        info.setSpacing(1)
        info.setContentsMargins(0, 0, 0, 0)

        title = QLabel(self.track["title"])
        title.setStyleSheet("color: #e2e2f0; font-weight: bold; font-size: 13px;")
        title.setSizePolicy(QSizePolicy.Expanding, QSizePolicy.Preferred)

        artist = QLabel(self.track["artist"])
        artist.setStyleSheet("color: #6d6d8a; font-size: 11px;")
        artist.setSizePolicy(QSizePolicy.Expanding, QSizePolicy.Preferred)

        info.addWidget(title)
        info.addWidget(artist)
        row.addLayout(info, stretch=1)  # stretch absorbs spare space

        if self._pending:
            badge = PulseBadge("Analyzing…", pending=True)
        else:
            bpm = self.track["bpm"]
            badge = PulseBadge(f"{bpm} BPM" if bpm != "—" else "—", pending=False)
            badge.setStyleSheet("""
                color: #a78bfa; background: #2d1b69;
                border-radius: 6px; padding: 3px 6px;
                font-size: 11px; font-weight: bold;
            """)
        row.addWidget(badge)

        del_btn = QPushButton("✕")
        del_btn.setFixedSize(24, 24)
        del_btn.setToolTip("Delete track")
        del_btn.setStyleSheet("""
            QPushButton {
                background: transparent; color: #444; border: none;
                font-size: 12px; border-radius: 4px;
            }
            QPushButton:hover { color: #f87171; background: #2d1010; }
        """)
        del_btn.clicked.connect(lambda: self.delete_requested.emit(self.track["id"]))
        row.addWidget(del_btn)

        self.mousePressEvent = lambda e: on_click(self.track)


# ── Library screen ─────────────────────────────────────────────────────────

class LibraryScreen(QWidget):
    connected = Signal(str)

    def __init__(self, on_track_select):
        super().__init__()
        self.on_track_select  = on_track_select
        self.all_tracks: list = []
        self._fetch_worker    = None
        self._upload_worker   = None
        self._delete_worker   = None
        self._use_mock        = False
        self._connected_once  = False
        self._setup_ui()
        self._load_tracks()

    # ── UI ─────────────────────────────────────────────────────────────────

    def _setup_ui(self):
        root = QVBoxLayout(self)
        root.setContentsMargins(14, 14, 14, 10)
        root.setSpacing(6)

        # Header row
        hdr = QHBoxLayout()
        ttl = QLabel("🎧  My Library")
        ttl.setStyleSheet("color: white; font-size: 20px; font-weight: bold;")
        hdr.addWidget(ttl)
        hdr.addStretch()
        self._refresh_btn = self._mk_btn("↻", "#a78bfa", self._load_tracks, "Refresh")
        add_btn           = self._mk_btn("+", "#34d399", self._add_track,   "Upload track")
        hdr.addWidget(self._refresh_btn)
        hdr.addWidget(add_btn)
        root.addLayout(hdr)

        # Search bar
        self._search = QLineEdit()
        self._search.setPlaceholderText("Search by title or artist…")
        self._search.setFixedHeight(38)
        self._search.setStyleSheet("""
            QLineEdit {
                background: #1a1a2e; color: white;
                border: 1px solid #2e2e4a; border-radius: 19px;
                padding: 0 14px; font-size: 13px;
            }
            QLineEdit:focus { border-color: #7c3aed; }
        """)
        self._search.textChanged.connect(self._apply_filters)
        root.addWidget(self._search)

        # Filter row: BPM range + Key
        frow = QHBoxLayout()
        frow.setSpacing(6)

        for lbl_text in ("BPM:",):
            lbl = QLabel(lbl_text)
            lbl.setStyleSheet("color: #555; font-size: 11px;")
            frow.addWidget(lbl)

        self._bpm_min = self._mk_num_input("min")
        self._bpm_max = self._mk_num_input("max")
        self._bpm_min.textChanged.connect(self._apply_filters)
        self._bpm_max.textChanged.connect(self._apply_filters)
        frow.addWidget(self._bpm_min)
        sep = QLabel("–"); sep.setStyleSheet("color: #444; font-size: 11px;")
        frow.addWidget(sep)
        frow.addWidget(self._bpm_max)

        key_lbl = QLabel("Key:")
        key_lbl.setStyleSheet("color: #555; font-size: 11px;")
        frow.addWidget(key_lbl)

        self._key_combo = QComboBox()
        self._key_combo.addItems(KEYS)
        self._key_combo.setFixedHeight(26)
        self._key_combo.setStyleSheet("""
            QComboBox {
                background: #1a1a2e; color: #a78bfa;
                border: 1px solid #2e2e4a; border-radius: 6px;
                padding: 0 6px; font-size: 11px;
            }
            QComboBox::drop-down { border: none; }
            QComboBox QAbstractItemView {
                background: #1a1a2e; color: white;
                selection-background-color: #3d2a80;
            }
        """)
        self._key_combo.currentTextChanged.connect(self._apply_filters)
        frow.addWidget(self._key_combo, stretch=1)
        root.addLayout(frow)

        # Status label
        self._status = QLabel("Connecting…")
        self._status.setStyleSheet("color: #555; font-size: 11px;")
        root.addWidget(self._status)

        # Scroll area — horizontal scroll OFF to prevent card overflow
        scroll = QScrollArea()
        scroll.setWidgetResizable(True)
        scroll.setHorizontalScrollBarPolicy(Qt.ScrollBarAlwaysOff)
        scroll.setVerticalScrollBarPolicy(Qt.ScrollBarAsNeeded)
        scroll.setStyleSheet("QScrollArea { border: none; background: transparent; }")

        self._list_widget = QWidget()
        self._list_layout = QVBoxLayout(self._list_widget)
        self._list_layout.setSpacing(4)
        self._list_layout.setContentsMargins(0, 0, 4, 0)
        self._list_layout.addStretch()
        scroll.setWidget(self._list_widget)
        root.addWidget(scroll)

    def _mk_btn(self, text, color, slot, tip):
        btn = QPushButton(text)
        btn.setFixedSize(34, 34)
        btn.setToolTip(tip)
        btn.setStyleSheet(f"""
            QPushButton {{
                background: #1a1a2e; color: {color};
                border: 1px solid {color}; border-radius: 8px;
                font-size: 17px; font-weight: bold;
            }}
            QPushButton:hover {{ background: {color}; color: #0d0d1a; }}
            QPushButton:disabled {{ opacity: 0.3; }}
        """)
        btn.clicked.connect(slot)
        return btn

    def _mk_num_input(self, placeholder):
        w = QLineEdit()
        w.setPlaceholderText(placeholder)
        w.setFixedSize(40, 26)
        w.setValidator(QIntValidator(0, 999))
        w.setStyleSheet("""
            QLineEdit {
                background: #1a1a2e; color: white;
                border: 1px solid #2e2e4a; border-radius: 6px;
                padding: 0 4px; font-size: 11px;
            }
            QLineEdit:focus { border-color: #7c3aed; }
        """)
        return w

    # ── Loading ────────────────────────────────────────────────────────────

    def _load_tracks(self):
        self._status.setText("Loading…")
        self._refresh_btn.setEnabled(False)
        self._fetch_worker = FetchTracksWorker()
        self._fetch_worker.finished.connect(self._on_loaded)
        self._fetch_worker.error.connect(self._on_error)
        self._fetch_worker.start()

    def _on_loaded(self, tracks: list):
        self._refresh_btn.setEnabled(True)
        self._use_mock  = False
        self.all_tracks = tracks

        if not self._connected_once:
            self._connected_once = True
            self.connected.emit("Connected to Neon Database via Render  ✓")

        self._update_status(len(tracks))
        self._apply_filters()

        if any(_is_pending(t) for t in tracks):
            QTimer.singleShot(8000, self._load_tracks)

    def _on_error(self, msg: str):
        self._refresh_btn.setEnabled(True)
        print(f"DEBUG: API error → {msg}")
        self._use_mock  = True
        self.all_tracks = list(MOCK_TRACKS)
        self._status.setText("⚠  Offline — showing demo tracks")
        self._render_tracks(self.all_tracks)

    # ── Upload ─────────────────────────────────────────────────────────────

    def _add_track(self):
        path, _ = QFileDialog.getOpenFileName(
            self, "Select Audio File", "",
            "Audio Files (*.mp3 *.wav);;All Files (*)"
        )
        if not path:
            return
        self._status.setText("Uploading…")
        self._upload_worker = UploadWorker(path)
        self._upload_worker.finished.connect(self._on_uploaded)
        self._upload_worker.error.connect(
            lambda e: (self._status.setText("Upload failed"),
                       QMessageBox.warning(self, "Upload Failed", e))
        )
        self._upload_worker.start()

    def _on_uploaded(self, track: dict):
        self.all_tracks.insert(0, track)
        self._apply_filters()
        self._update_status(len(self.all_tracks))
        if _is_pending(track):
            QTimer.singleShot(8000, self._load_tracks)

    # ── Delete ─────────────────────────────────────────────────────────────

    def _confirm_delete(self, track_id: int):
        track = next((t for t in self.all_tracks if t["id"] == track_id), None)
        if not track:
            return

        if self._use_mock:
            self.all_tracks = [t for t in self.all_tracks if t["id"] != track_id]
            self._apply_filters()
            self._update_status(len(self.all_tracks))
            return

        if QMessageBox.question(
            self, "Delete Track",
            f'Delete "{track["title"]}"?\nThis cannot be undone.',
            QMessageBox.Yes | QMessageBox.No, QMessageBox.No
        ) != QMessageBox.Yes:
            return

        self._status.setText("Deleting…")
        self._delete_worker = DeleteWorker(track_id)
        self._delete_worker.finished.connect(self._on_deleted)
        self._delete_worker.start()

    def _on_deleted(self, track_id: int, ok: bool):
        if ok:
            self.all_tracks = [t for t in self.all_tracks if t["id"] != track_id]
            self._apply_filters()
            self._update_status(len(self.all_tracks))
        else:
            self._status.setText("Delete failed — try again")

    # ── Filtering & rendering ──────────────────────────────────────────────

    def _apply_filters(self):
        q       = self._search.text().lower()
        bpm_min = self._bpm_min.text().strip()
        bpm_max = self._bpm_max.text().strip()
        key_sel = self._key_combo.currentText()

        filtered = []
        for t in self.all_tracks:
            if q and q not in t["title"].lower() and q not in t["artist"].lower():
                continue
            bpm = t.get("bpm")
            if bpm_min and isinstance(bpm, int) and bpm < int(bpm_min):
                continue
            if bpm_max and isinstance(bpm, int) and bpm > int(bpm_max):
                continue
            if key_sel and key_sel != "All Keys":
                if key_sel.lower() not in str(t.get("key", "")).lower():
                    continue
            filtered.append(t)

        self._render_tracks(filtered)

        any_filter = bool(q or bpm_min or bpm_max or key_sel not in ("All Keys", ""))
        if any_filter:
            self._status.setText(
                f"{len(filtered)} result{'s' if len(filtered) != 1 else ''}"
                if filtered else "No tracks found"
            )
        else:
            self._update_status(len(self.all_tracks))

    def _render_tracks(self, tracks: list):
        while self._list_layout.count() > 1:
            item = self._list_layout.takeAt(0)
            if item.widget():
                item.widget().deleteLater()

        if not tracks:
            empty = QLabel("No tracks found")
            empty.setAlignment(Qt.AlignCenter)
            empty.setStyleSheet("color: #444; font-size: 13px; padding: 20px;")
            self._list_layout.insertWidget(0, empty)
            return

        for track in tracks:
            card = TrackCard(track, self.on_track_select)
            card.delete_requested.connect(self._confirm_delete)
            self._list_layout.insertWidget(self._list_layout.count() - 1, card)

    def _update_status(self, count: int):
        if self._use_mock:
            return
        self._status.setText(
            f"{count} track{'s' if count != 1 else ''}"
            if count else "No tracks yet — press + to upload one"
        )